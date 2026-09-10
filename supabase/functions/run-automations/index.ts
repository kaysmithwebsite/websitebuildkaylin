/**
 * AUTOMATION RUNNER  —  CRM phase 4
 *
 * Scheduled every minute. Picks up automation_runs whose resume_at has passed
 * and advances them through the shared engine. All the decision logic lives in
 * _shared/engine.ts, which has no Supabase dependency and is covered by
 * tools_engine_test.ts; this file is only the adapter between that engine and
 * the database.
 *
 * Email is queued, never sent from here. Until a transactional provider is
 * configured the send-email function leaves rows at status='queued' and says
 * so, rather than pretending a delivery happened.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runDue, type Store, type Run, type Step, type Facts }
  from "../_shared/engine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALERT_TO     = Deno.env.get("CRM_ALERT_EMAIL") ?? "";

function makeStore(db: SupabaseClient): Store {
  return {
    now: () => new Date(),

    async dueRuns(limit) {
      const { data } = await db.from("automation_runs")
        .select("id,automation_id,contact_id,opportunity_id,status,current_position,resume_at,started_at,automations(key)")
        .in("status", ["active", "waiting"])
        .or(`resume_at.is.null,resume_at.lte.${new Date().toISOString()}`)
        .order("resume_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      return (data ?? []).map((r: any) => ({
        ...r, automation_key: r.automations?.key,
      })) as Run[];
    },

    async steps(automationId) {
      const { data } = await db.from("automation_steps")
        .select("id,position,step_type,config,on_true_position,on_false_position")
        .eq("automation_id", automationId).order("position");
      return (data ?? []) as Step[];
    },

    /**
     * One query per run assembles everything a condition may read. Conditions
     * cannot issue their own lookups, so what they can branch on is fixed and
     * auditable.
     */
    async facts(contactId): Promise<Facts | null> {
      const { data: c } = await db.from("contacts")
        .select("id,do_not_contact,lifecycle,temperature,lead_score,email")
        .eq("id", contactId).maybeSingle();
      if (!c) return null;

      const [{ data: tags }, { data: re }, { data: biz }, { data: sup },
             { data: lastReply }, { data: booking }, { data: pause }] = await Promise.all([
        db.from("contact_tags").select("tags(key)").eq("contact_id", contactId),
        db.from("real_estate_profiles").select("*").eq("contact_id", contactId).maybeSingle(),
        db.from("business_profiles").select("*").eq("contact_id", contactId).maybeSingle(),
        c.email ? db.from("email_suppressions").select("email").eq("email", c.email).maybeSingle()
                : Promise.resolve({ data: null }),
        db.from("email_events").select("occurred_at,emails!inner(contact_id)")
          .eq("event", "replied").eq("emails.contact_id", contactId)
          .order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("appointments").select("created_at").eq("contact_id", contactId)
          .in("status", ["booked", "completed"])
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("activity_events").select("occurred_at").eq("contact_id", contactId)
          .eq("kind", "automation_paused").limit(1).maybeSingle(),
      ]);

      return {
        id: c.id,
        do_not_contact: !!c.do_not_contact,
        unsubscribed: !!sup,
        lifecycle: c.lifecycle,
        temperature: c.temperature,
        lead_score: c.lead_score ?? 0,
        email: c.email,
        tags: (tags ?? []).map((t: any) => t.tags?.key).filter(Boolean),
        interest: re ? "real_estate" : biz ? "business_consulting" : null,
        replied_at: (lastReply as any)?.occurred_at ?? null,
        booked_at: (booking as any)?.created_at ?? null,
        paused: !!pause,
        re: re ?? null,
        biz: biz ?? null,
      };
    },

    async saveRun(id, patch) {
      const row: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
      if (patch.status === "completed" || patch.status === "stopped") {
        row.completed_at = new Date().toISOString();
      }
      await db.from("automation_runs").update(row).eq("id", id);
    },

    /** The unique index on (run_id, position) is what makes this a claim. A
     *  duplicate insert fails, this returns false, and nothing runs twice. */
    async claimStep(runId, position, stepId) {
      const { error } = await db.from("automation_run_steps")
        .insert({ run_id: runId, position, step_id: stepId, result: "claimed" });
      return !error;
    },

    async recordStep(runId, position, result, detail, emailId) {
      await db.from("automation_run_steps")
        .update({ result, detail: detail ?? null, email_id: emailId ?? null })
        .eq("run_id", runId).eq("position", position);
    },

    async queueEmail(contactId, runId, templateKey, opts) {
      const { data: tpl } = await db.from("email_templates")
        .select("id,subject,body_markdown,class,active").eq("key", templateKey).maybeSingle();
      if (!tpl || !tpl.active) return null;

      const { data: c } = await db.from("contacts")
        .select("email,do_not_contact").eq("id", contactId).maybeSingle();
      if (!c?.email || c.do_not_contact) return null;

      const { data: sup } = await db.from("email_suppressions")
        .select("email").eq("email", c.email).maybeSingle();
      if (sup) return null;

      // Section 42: overlapping automations must not both send the same thing.
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const { data: dupe } = await db.from("emails")
        .select("id").eq("contact_id", contactId).eq("template_id", tpl.id)
        .gte("created_at", since).limit(1).maybeSingle();
      if (dupe) return null;

      const { data: mail } = await db.from("emails").insert({
        contact_id: contactId, template_id: tpl.id, automation_run_id: runId,
        to_email: c.email, subject: tpl.subject, class: tpl.class,
        status: "queued", requires_review: !!opts.requiresReview,
      }).select().single();
      return mail?.id ?? null;
    },

    async createTask(contactId, opportunityId, title, dueAt, detail) {
      await db.from("tasks").insert({
        contact_id: contactId, opportunity_id: opportunityId,
        title, detail: detail ?? null, due_at: dueAt,
      });
    },

    async moveStage(opportunityId, stageKey) {
      const { data: opp } = await db.from("opportunities")
        .select("pipeline_id").eq("id", opportunityId).maybeSingle();
      if (!opp) return;
      const { data: stage } = await db.from("pipeline_stages")
        .select("id,probability").eq("pipeline_id", opp.pipeline_id)
        .eq("key", stageKey).maybeSingle();
      if (!stage) return;
      await db.from("opportunities")
        .update({ stage_id: stage.id, probability: stage.probability })
        .eq("id", opportunityId);
    },

    async addTag(contactId, tagKey) {
      const { data: tag } = await db.from("tags").select("id").eq("key", tagKey).maybeSingle();
      if (!tag) return;
      await db.from("contact_tags").upsert(
        { contact_id: contactId, tag_id: tag.id, automatic: true },
        { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
    },

    async notify(subject, body, contactId) {
      await db.from("activity_events").insert({
        contact_id: contactId, kind: "internal_alert",
        summary: subject, meta: { body, to: ALERT_TO || null },
      });
    },

    async callWebhook(url, payload) {
      try {
        await fetch(url, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (_err) { /* recorded as the step result by the engine */ }
    },
  };
}

Deno.serve(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set" }),
      { status: 503, headers: { "content-type": "application/json" } });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const reports = await runDue(makeStore(db), 50);
  return new Response(JSON.stringify({ advanced: reports.length, reports }),
    { headers: { "content-type": "application/json" } });
});
