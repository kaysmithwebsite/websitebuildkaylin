/**
 * INGEST INQUIRY  —  CRM phase 2 (sections 6, 7, 32, 33, 55, 65)
 *
 * Promotes rows from crm_inquiries into the CRM: one contact, its interests,
 * the matching profile, an opportunity on the right pipeline, tags, consent
 * records and transparent score events.
 *
 * Runs with the service role, so it is the only thing that may write to the
 * CRM. It is invoked by a database webhook on insert and, as a safety net, by
 * the scheduled runner for anything left in state='received'.
 *
 * Everything here is idempotent: a row already marked processed is skipped,
 * contacts are matched on email then phone, and score events carry a unique
 * (contact_id, rule_key) so replaying cannot inflate a score.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Inquiry = Record<string, any>;

/** Values the form may submit, mirrored from data/crm-forms.json. */
const PATH_BRANCH: Record<string, "real_estate" | "business_consulting" | "unsure"> = {
  buy: "real_estate", sell: "real_estate", invest: "real_estate",
  consulting: "business_consulting", other: "unsure",
};

const PATH_TAGS: Record<string, string[]> = {
  buy: ["real_estate", "buyer"],
  sell: ["real_estate", "seller"],
  invest: ["real_estate", "investor"],
  consulting: ["business"],
};

const INTENT_TAGS: Record<string, string[]> = {
  buy_and_sell: ["buyer", "seller"],
  relocate: ["relocation"],
  pre_construction: ["pre_construction"],
  rent: ["buyer"],
};

const STAGE_TAGS: Record<string, string[]> = {
  idea: ["startup"], pre_launch: ["startup"], new_business: ["startup"],
  established: ["established_business"], scaling: ["growth"],
};

const CHALLENGE_TAGS: Record<string, string[]> = {
  strategy: ["strategy"], growth: ["growth"], operations: ["operations"],
  systems: ["operations"], marketing: ["marketing"], branding: ["marketing"],
};

const NEAR_TERM = new Set(["immediately", "within_30_days", "1_3_months"]);

/** Which sequence a new inquiry enters. "other" has no automation: an
 *  undecided enquiry gets a person, not a drip. */
const PATH_AUTOMATION: Record<string, string> = {
  buy: "re_buyer_inquiry",
  sell: "re_seller_inquiry",
  invest: "re_investor_inquiry",
  consulting: "biz_consulting_inquiry",
};

/** An unfilled <select> or <input> posts "" rather than null. Treat it as
 *  absent so the CRM stores a genuine null instead of an empty string. */
function nz(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function digits(v: unknown): string | null {
  const d = String(v ?? "").replace(/[^0-9]/g, "");
  return d.length >= 10 ? d : null;
}

/** Only values the Postgres enum accepts; anything else becomes null rather
 *  than failing the whole ingest on one unexpected string. */
function enumOr<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = String(v ?? "").trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

const RE_INTENT = ["buy","sell","buy_and_sell","invest","rent","relocate",
  "pre_construction","commercial","first_time_buyer","general","undecided"] as const;
const RE_TIMELINE = ["immediately","within_30_days","1_3_months","3_6_months",
  "6_12_months","researching"] as const;
const RE_BUDGET = ["under_500k","500k_750k","750k_1m","1m_1_5m","1_5m_2m",
  "2m_plus","unsure"] as const;
const BIZ_STAGE = ["idea","pre_launch","new_business","growing","established",
  "scaling","restructuring","unsure"] as const;
const BIZ_CHALLENGE = ["strategy","growth","marketing","branding","sales","systems",
  "operations","financing","business_model","expansion","real_estate","leadership","other"] as const;
const BIZ_REVENUE = ["pre_revenue","under_100k","100k_250k","250k_500k","500k_1m",
  "1m_5m","5m_plus","undisclosed"] as const;
const BIZ_URGENCY = ["now","within_30_days","1_3_months","exploring"] as const;

/** Section 33. Bands, not a black box; Kaylin can override on the record. */
function temperatureFor(score: number): "hot" | "warm" | "nurture" | "cold" {
  if (score >= 45) return "hot";
  if (score >= 25) return "warm";
  if (score >= 10) return "nurture";
  return "cold";
}

/** Find an existing contact by email, then by normalized phone (section 7). */
async function findContact(db: SupabaseClient, email: string | null, phone: string | null) {
  if (email) {
    const { data } = await db.from("contacts").select("*").eq("email", email).maybeSingle();
    if (data) return data;
  }
  if (phone) {
    const { data } = await db.from("contacts").select("*")
      .eq("phone_normalized", phone).limit(1).maybeSingle();
    if (data) return data;
  }
  return null;
}

async function applyTags(db: SupabaseClient, contactId: string, keys: string[]) {
  if (!keys.length) return;
  const { data: tags } = await db.from("tags").select("id,key").in("key", [...new Set(keys)]);
  if (!tags?.length) return;
  await db.from("contact_tags").upsert(
    tags.map((t) => ({ contact_id: contactId, tag_id: t.id, automatic: true })),
    { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
  );
}

/**
 * Score events are unique per (contact, rule), so re-running this cannot
 * inflate a score. Points come from lead_scoring_rules so they stay editable
 * in the admin rather than being compiled into this file (section 32).
 */
async function applyScore(db: SupabaseClient, contactId: string, ruleKeys: string[]) {
  if (!ruleKeys.length) return;
  const { data: rules } = await db.from("lead_scoring_rules")
    .select("id,key,points,active").in("key", [...new Set(ruleKeys)]);
  const rows = (rules ?? []).filter((r) => r.active).map((r) => ({
    contact_id: contactId, rule_id: r.id, rule_key: r.key, points: r.points,
    reason: "Set on inquiry ingest",
  }));
  if (rows.length) {
    await db.from("contact_score_events")
      .upsert(rows, { onConflict: "contact_id,rule_key", ignoreDuplicates: true });
  }
}

/**
 * Consent is recorded with the wording that was on screen. A service enquiry
 * creates service consent only; marketing consent exists only if the visitor
 * ticked the separate, never pre-checked box (sections 65-67).
 */
async function recordConsent(db: SupabaseClient, contactId: string, q: Inquiry) {
  const rows: Record<string, unknown>[] = [];
  if (q.consent_contact) {
    rows.push({
      contact_id: contactId, kind: "service", basis: "express", granted: true,
      wording: "Kaylin may contact me about this enquiry.",
      source: (q.context?.source ?? "inquiry_form"), granted_at: q.created_at,
      evidence_url: q.context?.page_path ?? null, user_agent: q.context?.user_agent ?? null,
    });
  }
  rows.push({
    contact_id: contactId, kind: "all_marketing",
    basis: q.consent_marketing ? "express" : "none",
    granted: !!q.consent_marketing,
    wording: q.consent_marketing_text ?? "(marketing box not ticked)",
    source: (q.context?.source ?? "inquiry_form"),
    granted_at: q.consent_marketing ? q.created_at : null,
    evidence_url: q.context?.page_path ?? null, user_agent: q.context?.user_agent ?? null,
  });
  if (rows.length) await db.from("consents").insert(rows);
}

export async function ingestOne(db: SupabaseClient, q: Inquiry) {
  const branch = PATH_BRANCH[q.path] ?? "unsure";
  const email = q.email ? String(q.email).trim().toLowerCase() : null;
  const phone = digits(q.phone);

  const existing = await findContact(db, email, phone);

  // forms.js nests everything it captured about the visit under `context`.
  const ctx = (q.context ?? {}) as Record<string, any>;
  const utm = (ctx.utm ?? {}) as Record<string, any>;

  // Attribution is written once and never overwritten, so the record always
  // shows where the relationship actually began (section 7).
  const attribution = existing
    ? {}
    : {
        source: ctx.source ?? "website_inquiry",
        source_detail: q.path ?? null,
        landing_page: ctx.page_path ?? null,
        referrer: ctx.referrer ?? null,
        utm_source: utm.utm_source ?? null,
        utm_medium: utm.utm_medium ?? null,
        utm_campaign: utm.utm_campaign ?? null,
        utm_content: utm.utm_content ?? null,
        utm_term: utm.utm_term ?? null,
      };

  const identity = {
    first_name: nz(q.first_name) ?? existing?.first_name ?? null,
    last_name: nz(q.last_name) ?? existing?.last_name ?? null,
    email: email ?? existing?.email ?? null,
    phone: nz(q.phone) ?? existing?.phone ?? null,
  };

  let contact = existing;
  if (contact) {
    const { data } = await db.from("contacts")
      .update({ ...identity, last_contacted_at: null })
      .eq("id", contact.id).select().single();
    contact = data ?? contact;
  } else {
    const { data, error } = await db.from("contacts")
      .insert({ ...identity, ...attribution, lifecycle: "inquiry" })
      .select().single();
    if (error) throw new Error(`contact insert failed: ${error.message}`);
    contact = data;
  }
  const contactId = contact!.id as string;

  const tags: string[] = [...(PATH_TAGS[q.path] ?? [])];
  const scoreKeys: string[] = [];
  const interest = branch === "unsure" ? null
    : (branch as "real_estate" | "business_consulting");

  if (interest) {
    await db.from("contact_interests")
      .upsert({ contact_id: contactId, interest }, { onConflict: "contact_id,interest",
                ignoreDuplicates: true });
  }

  if (branch === "real_estate") {
    const intent = enumOr(q.re_intent, RE_INTENT)
      ?? (q.path === "sell" ? "sell" : q.path === "invest" ? "invest" : "buy");
    const timeline = enumOr(q.re_timeline, RE_TIMELINE);
    const budget = enumOr(q.re_budget, RE_BUDGET);
    const preApproved = q.re_pre_approved === "yes" ? true
      : q.re_pre_approved === "no" ? false : null;

    await db.from("real_estate_profiles").upsert({
      contact_id: contactId,
      intent, timeline, budget_band: budget,
      preferred_location: nz(q.re_location),
      property_type: nz(q.re_property_type),
      seller_address: nz(q.re_seller_address),
      selling_timeline: enumOr(q.re_selling_timeline, RE_TIMELINE),
      pre_approved: preApproved,
      has_realtor: q.re_has_realtor === "yes" ? true : q.re_has_realtor === "no" ? false : null,
      success_looks_like: nz(q.message),
    }, { onConflict: "contact_id" });

    tags.push(...(INTENT_TAGS[intent] ?? []));
    if (timeline && NEAR_TERM.has(timeline)) scoreKeys.push("re_timeline_under_90");
    if (preApproved) scoreKeys.push("re_financing_ready");
    if (budget && budget !== "unsure") scoreKeys.push("re_budget_specified");
    if (nz(q.re_seller_address)) scoreKeys.push("re_seller_address");
  }

  if (branch === "business_consulting") {
    const stage = enumOr(q.biz_stage, BIZ_STAGE);
    const challenge = enumOr(q.biz_challenge, BIZ_CHALLENGE);
    const revenue = enumOr(q.biz_revenue, BIZ_REVENUE);
    const urgency = enumOr(q.biz_urgency, BIZ_URGENCY);

    let organizationId: string | null = null;
    if (nz(q.biz_name)) {
      const { data: org } = await db.from("organizations")
        .insert({ name: nz(q.biz_name), website: nz(q.biz_website) })
        .select().single();
      organizationId = org?.id ?? null;
      if (organizationId) {
        await db.from("contacts").update({ organization_id: organizationId }).eq("id", contactId);
      }
    }

    await db.from("business_profiles").upsert({
      contact_id: contactId, organization_id: organizationId,
      business_name: nz(q.biz_name), website: nz(q.biz_website),
      stage, primary_challenge: challenge, revenue_band: revenue, urgency,
      biggest_problem: nz(q.message) ?? nz(q.other_detail),
    }, { onConflict: "contact_id" });

    if (stage) tags.push(...(STAGE_TAGS[stage] ?? []));
    if (challenge) tags.push(...(CHALLENGE_TAGS[challenge] ?? []));
    if (urgency === "now") scoreKeys.push("biz_immediate_problem");
    if (stage === "established" || stage === "scaling") scoreKeys.push("biz_established");
    if (revenue && revenue !== "undisclosed") scoreKeys.push("biz_revenue_supplied");
    if (challenge) scoreKeys.push("biz_clear_project");
  }

  await applyTags(db, contactId, tags);
  await applyScore(db, contactId, scoreKeys);
  await recordConsent(db, contactId, q);

  // An opportunity per interest, so someone in both funnels has two of them
  // rather than two contact records (section 2).
  let opportunityId: string | null = null;
  if (interest) {
    const { data: existingOpp } = await db.from("opportunities")
      .select("id").eq("contact_id", contactId).eq("interest", interest)
      .eq("is_open", true).maybeSingle();
    if (existingOpp) {
      opportunityId = existingOpp.id;
    } else {
      const pipelineKey = interest === "real_estate" ? "real_estate" : "consulting";
      const { data: pipeline } = await db.from("pipelines")
        .select("id").eq("key", pipelineKey).single();
      const { data: stage } = await db.from("pipeline_stages")
        .select("id").eq("pipeline_id", pipeline!.id).eq("key", "new_inquiry").single();
      const { data: opp } = await db.from("opportunities").insert({
        contact_id: contactId, pipeline_id: pipeline!.id, stage_id: stage!.id,
        interest, title: interest === "real_estate"
          ? `${q.first_name ?? "New"} — ${q.path ?? "real estate"}`
          : `${q.biz_name ?? q.first_name ?? "New"} — consulting`,
      }).select().single();
      opportunityId = opp?.id ?? null;
    }
  }

  // Score is recalculated by trigger; read it back rather than guessing.
  const { data: scored } = await db.from("contacts")
    .select("lead_score").eq("id", contactId).single();
  const score = scored?.lead_score ?? 0;
  await db.from("contacts")
    .update({ temperature: temperatureFor(score) }).eq("id", contactId);

  await db.from("activity_events").insert({
    contact_id: contactId, opportunity_id: opportunityId,
    kind: "inquiry", summary: `Inquiry submitted: ${q.path ?? "unspecified"}`,
    ref_table: "crm_inquiries", ref_id: q.id,
    meta: { path: q.path, source: q.context?.source, score, branch },
  });

  // Enrolment is last, so a sequence never starts against a half-built record.
  // crm_enroll is a no-op when a live run for this automation already exists.
  let runId: string | null = null;
  const automationKey = PATH_AUTOMATION[q.path];
  if (automationKey) {
    const { data } = await db.rpc("crm_enroll", {
      p_contact: contactId,
      p_automation_key: automationKey,
      p_opportunity: opportunityId,
    });
    runId = (data as string | null) ?? null;
  }

  await db.from("crm_inquiries").update({
    state: "processed", processed_at: new Date().toISOString(), contact_id: contactId,
  }).eq("id", q.id);

  return { contactId, opportunityId, score, temperature: temperatureFor(score),
           tags, automation: automationKey ?? null, runId };
}

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set" }),
      { status: 503, headers: { "content-type": "application/json" } });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let ids: string[] = [];
  try {
    const body = await req.json();
    if (body?.record?.id) ids = [body.record.id];       // database webhook
    else if (Array.isArray(body?.ids)) ids = body.ids;  // manual replay
  } catch { /* no body: fall through to the backlog sweep */ }

  if (!ids.length) {
    const { data } = await db.from("crm_inquiries")
      .select("id").eq("state", "received").order("created_at").limit(50);
    ids = (data ?? []).map((r) => r.id);
  }

  const results: unknown[] = [];
  for (const id of ids) {
    const { data: q } = await db.from("crm_inquiries").select("*").eq("id", id).single();
    if (!q || q.state === "processed") continue;
    try {
      results.push({ id, ...(await ingestOne(db, q)) });
    } catch (err) {
      await db.from("crm_inquiries")
        .update({ state: "failed", error: String(err) }).eq("id", id);
      results.push({ id, error: String(err) });
    }
  }
  return new Response(JSON.stringify({ processed: results.length, results }),
    { headers: { "content-type": "application/json" } });
});
