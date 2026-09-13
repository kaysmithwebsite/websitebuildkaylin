/**
 * NETLIFY FORMS INGESTION  —  capture first, persist second, enrich third,
 * automate fourth.
 *
 * Netlify invokes a function named exactly `submission-created` whenever any
 * Netlify Form on this site is submitted (this is a stable, filename-based
 * Netlify Forms convention, unrelated to the function's own export style —
 * see NETLIFY_FORMS.md for the fallback if this does not fire after deploy:
 * an Outgoing Webhook pointed at this function's URL).
 *
 * A failure anywhere past step 1 is recorded, never silently dropped — see
 * external_submissions.state and rejected_submissions.
 */
import { eq, and, sql as rawSql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { NetlifySubmissionEnvelope, RawFormData } from "../../lib/validation.ts";
import { normalizeEmail, normalizePhone, nullIfEmpty } from "../../lib/normalize.ts";
import { resolveRoute, type FormRoute } from "../../lib/routing.ts";
import {
  scoreRealEstateLead, scoreBusinessLead, normalizeScore, temperatureFor,
  POST_INGEST_RULES,
} from "../../lib/scoring.ts";
import { generateLeadBrief } from "../../lib/ai-brief.ts";

const TIMELINE_DAYS: Record<string, number> = {
  now: 0, immediately: 0,
  within_30_days: 30,
  "1_3_months": 90,
  "3_6_months": 180,
  "6_12_months": 365,
  researching: 9999, exploring: 9999,
};

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let envelope: NetlifySubmissionEnvelope;
  try {
    const body = await req.json();
    envelope = NetlifySubmissionEnvelope.parse(body);
  } catch (err) {
    // Malformed payload is not a lead we can save — log and 200 so Netlify
    // does not retry forever, but this is visible in function logs.
    console.error("submission-created: invalid payload", err);
    return json({ error: "invalid payload" }, 200);
  }

  const { id: providerSubmissionId, form_name: formName, data: rawData } = envelope.payload;
  const form = RawFormData.safeParse(rawData);
  const data = form.success ? form.data : ({} as RawFormData);

  // ---- Step 1-2: audit row first, unconditionally. This is the idempotency
  // guard: a retried delivery of the same Netlify submission id can insert
  // this row's conflict-branch but nothing else runs twice from here down
  // once a prior attempt reached "processed".
  const [existing] = await db.select().from(schema.externalSubmissions)
    .where(and(
      eq(schema.externalSubmissions.provider, "netlify"),
      eq(schema.externalSubmissions.providerSubmissionId, providerSubmissionId),
    ));

  if (existing?.state === "processed" || existing?.state === "rejected") {
    return json({ ok: true, deduped: true, submissionId: existing.id });
  }

  let submissionRow = existing;
  if (!submissionRow) {
    const [inserted] = await db.insert(schema.externalSubmissions).values({
      provider: "netlify",
      providerSubmissionId,
      formName,
      rawPayload: envelope.payload as Record<string, unknown>,
      state: "received",
    }).onConflictDoNothing({
      target: [schema.externalSubmissions.provider, schema.externalSubmissions.providerSubmissionId],
    }).returning();
    submissionRow = inserted ?? (await db.select().from(schema.externalSubmissions)
      .where(and(
        eq(schema.externalSubmissions.provider, "netlify"),
        eq(schema.externalSubmissions.providerSubmissionId, providerSubmissionId),
      )))[0];
  }
  if (!submissionRow) {
    console.error("submission-created: could not create or read external_submissions row");
    return json({ error: "internal" }, 200);
  }
  const submissionId = submissionRow.id;

  try {
    // ---- Step 3: honeypot spam check.
    if (nullIfEmpty(data["bot-field"])) {
      await reject(submissionId, formName, "spam_honeypot", rawData as Record<string, unknown>);
      return json({ ok: true, spam: true });
    }

    // ---- Step 4-5: resolve the route. Explicit form data decides; nothing
    // here guesses.
    const routes = await db.select().from(schema.formRoutes).where(eq(schema.formRoutes.active, true));
    const resolution = resolveRoute(formName, nullIfEmpty(data.lead_type), routes as FormRoute[]);
    if (!resolution.matched) {
      await reject(submissionId, formName, resolution.reason, rawData as Record<string, unknown>);
      return json({ ok: true, routed: false, reason: resolution.reason });
    }
    const route = resolution.route;

    // ---- Step 6-9: normalize identity, dedupe, upsert contact.
    const email = normalizeEmail(data.email);
    const phone = normalizePhone(data.phone);
    if (!email && !phone) {
      await reject(submissionId, formName, "validation_failed", rawData as Record<string, unknown>);
      return json({ ok: true, routed: false, reason: "unreachable" });
    }

    const contactId = await upsertContact({
      email, phone,
      firstName: nullIfEmpty(data.first_name),
      lastName: nullIfEmpty(data.last_name),
      businessLine: route.businessLine,
      attribution: {
        source: "netlify_form",
        landingPage: nullIfEmpty(data.landing_page) ?? nullIfEmpty(data.page_url),
        referrer: nullIfEmpty(data.referrer),
        utmSource: nullIfEmpty(data.utm_source),
        utmMedium: nullIfEmpty(data.utm_medium),
        utmCampaign: nullIfEmpty(data.utm_campaign),
        utmContent: nullIfEmpty(data.utm_content),
        utmTerm: nullIfEmpty(data.utm_term),
      },
    });

    // ---- Step 10-17: pipeline/stage assignment + lead upsert (one open
    // lead per contact+lead_type — resubmitting the same form updates the
    // existing open lead instead of creating a duplicate).
    const [brand] = await db.select().from(schema.brands)
      .where(eq(schema.brands.businessLine, route.businessLine));
    const [pipeline] = await db.select().from(schema.pipelines).where(eq(schema.pipelines.slug, route.pipelineSlug));
    if (!brand || !pipeline) throw new Error(`brand/pipeline not seeded for ${route.pipelineSlug}`);
    const [firstStage] = await db.select().from(schema.pipelineStages)
      .where(and(eq(schema.pipelineStages.pipelineId, pipeline.id), eq(schema.pipelineStages.position, 1)));
    if (!firstStage) throw new Error(`pipeline ${route.pipelineSlug} has no stage at position 1`);

    const [existingLead] = await db.select().from(schema.leads).where(and(
      eq(schema.leads.contactId, contactId),
      eq(schema.leads.leadType, route.leadType as (typeof schema.leadTypeEnum.enumValues)[number]),
      eq(schema.leads.status, "open"),
    ));

    let leadId: string;
    if (existingLead) {
      leadId = existingLead.id;
    } else {
      const [inserted] = await db.insert(schema.leads).values({
        contactId, brandId: brand.id, pipelineId: pipeline.id, stageId: firstStage.id,
        leadType: route.leadType as (typeof schema.leadTypeEnum.enumValues)[number],
        formRouteId: route.id,
        title: [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || null,
      }).returning();
      if (!inserted) throw new Error("lead insert failed");
      leadId = inserted.id;
    }

    // ---- Step 20: deterministic lead score.
    const events = route.businessLine === "real_estate"
      ? scoreRealEstateLead({
          requestedConsultation: route.leadType === "consultation",
          timelineDays: data.timeline ? TIMELINE_DAYS[data.timeline] ?? null : null,
          mortgagePreApproved: data.mortgage_pre_approved === "yes",
          hasNoAgent: data.has_realtor === "no",
          isSellerValuationRequest: route.leadType === "home_valuation" || route.leadType === "seller",
        })
      : scoreBusinessLead({
          requestedConsultation: route.leadType === "consultation",
          supportNeededWithinDays: data.support_needed_by ? TIMELINE_DAYS[data.support_needed_by] ?? null : null,
          hasSpecificChallenge: !!nullIfEmpty(data.challenge),
          isEstablishedCompany: data.established_company === "yes",
        });

    if (events.length) {
      await db.insert(schema.leadScoreEvents).values(
        events.map((e) => ({ leadId, ruleKey: e.ruleKey, points: e.points, reason: e.reason })),
      ).onConflictDoNothing({ target: [schema.leadScoreEvents.leadId, schema.leadScoreEvents.ruleKey] });
    }
    const scoreRows = await db.select().from(schema.leadScoreEvents).where(eq(schema.leadScoreEvents.leadId, leadId));
    const score = normalizeScore(scoreRows);
    const temperature = temperatureFor(score);
    await db.update(schema.leads).set({ score, temperature, updatedAt: new Date() }).where(eq(schema.leads.id, leadId));
    await syncContactAggregate(contactId);

    // ---- Step 21-22: activity + follow-up task.
    await db.insert(schema.activityEvents).values({
      contactId, leadId, kind: "inquiry",
      summary: `Submitted ${formName} (${route.leadType})`,
      meta: { formName, leadType: route.leadType, score, scoreEvents: events },
    });
    await db.insert(schema.tasks).values({
      contactId, leadId,
      title: `Call ${[data.first_name, data.last_name].filter(Boolean).join(" ") || "new lead"}`,
      detail: nullIfEmpty(data.message),
      dueAt: new Date(Date.now() + 60 * 60 * 1000), // 1 business hour — a fixed offset here, not calendar-aware yet
    });

    // ---- Step 23: AI Lead Brief. Never fatal to ingestion.
    const [analysisRow] = await db.insert(schema.aiLeadAnalysis)
      .values({ leadId, status: "pending" }).returning();
    if (analysisRow) {
      try {
        const brief = await generateLeadBrief({
          businessLine: route.businessLine, leadType: route.leadType,
          firstName: nullIfEmpty(data.first_name), lastName: nullIfEmpty(data.last_name),
          message: nullIfEmpty(data.message),
          formFields: data as unknown as Record<string, string | undefined>,
          score, scoreReasons: events.map((e) => e.reason),
        });
        await db.update(schema.aiLeadAnalysis)
          .set({ status: "succeeded", brief, model: "claude-sonnet-5", updatedAt: new Date() })
          .where(eq(schema.aiLeadAnalysis.id, analysisRow.id));
      } catch (err) {
        console.error("submission-created: AI lead brief failed (non-fatal)", err);
        await db.update(schema.aiLeadAnalysis)
          .set({ status: "failed", errorMessage: String(err), attempts: rawSql`${schema.aiLeadAnalysis.attempts} + 1`, updatedAt: new Date() })
          .where(eq(schema.aiLeadAnalysis.id, analysisRow.id));
      }
    }

    // ---- Step 24: enroll into the matching automation workflow, if seeded.
    // The runner that advances a run is not built yet (IMPLEMENTATION_STATUS.md)
    // — enrolling now means nothing sends until it exists, by design (no fake
    // sends). notify-inbox step below is the one immediate, real side effect:
    // a queued (unsent) email_messages row, visible in the CRM.
    const workflowKey = route.businessLine === "real_estate"
      ? (route.leadType === "seller" || route.leadType === "home_valuation" ? "real_estate_seller" : "real_estate_buyer")
      : "business_consulting";
    const [workflow] = await db.select().from(schema.automationWorkflows)
      .where(and(eq(schema.automationWorkflows.key, workflowKey), eq(schema.automationWorkflows.active, true)));
    if (workflow) {
      // Not a plain onConflictDoNothing: the "one live run" guard
      // (automation_runs_live_uniq) is a partial unique index — Postgres
      // only accepts a conflict target that exactly matches an index,
      // predicate included, so this checks explicitly instead.
      const [liveRun] = await db.select().from(schema.automationRuns).where(and(
        eq(schema.automationRuns.workflowId, workflow.id),
        eq(schema.automationRuns.contactId, contactId),
        rawSql`${schema.automationRuns.status} in ('active','waiting')`,
      ));
      if (!liveRun) {
        await db.insert(schema.automationRuns).values({
          workflowId: workflow.id, contactId, leadId, status: "waiting", currentPosition: 0, resumeAt: new Date(),
        });
      }
    }

    // ---- Step 25: notification, in log/queued mode (Gmail not connected —
    // GOOGLE_INTEGRATION.md). A real row exists so this is auditable and
    // sendable the moment a mailbox is connected; nothing is faked as sent.
    await db.insert(schema.emailMessages).values({
      contactId, leadId, brandId: brand.id, direction: "outbound", status: "queued",
      fromAddress: brand.senderEmail, toAddress: route.notifyEmail,
      subject: `New ${route.leadType} lead: ${[data.first_name, data.last_name].filter(Boolean).join(" ") || "unnamed"}`,
      templateKey: "internal_notify_new_lead",
      bodyText: `New ${formName} submission. Score ${score} (${temperature}). See CRM for details.`,
    });

    // ---- Step 26: mark processed.
    await db.update(schema.externalSubmissions).set({
      state: "processed", contactId, leadId, processedAt: new Date(),
    }).where(eq(schema.externalSubmissions.id, submissionId));

    await db.insert(schema.auditLogs).values({
      actor: "system:submission-created", action: "lead.created",
      entityType: "lead", entityId: leadId,
      metadata: { formName, leadType: route.leadType, businessLine: route.businessLine, score },
    });

    return json({ ok: true, contactId, leadId, score, temperature });
  } catch (err) {
    console.error("submission-created: ingestion failed", err);
    await db.update(schema.externalSubmissions).set({
      state: "failed",
      errorMessage: String(err instanceof Error ? err.message : err),
      retryCount: rawSql`${schema.externalSubmissions.retryCount} + 1`,
    }).where(eq(schema.externalSubmissions.id, submissionId));
    // Netlify does not retry submission-created on a non-2xx response, so we
    // still return 200: the failure is preserved in external_submissions
    // (state='failed') and surfaces on the Needs Attention screen rather than
    // being invisible. The lead is NOT silently dropped.
    return json({ ok: false, error: "ingestion failed, recorded for review" }, 200);
  }
};

async function reject(
  submissionId: string, formName: string,
  reason: "spam_honeypot" | "unknown_form" | "unknown_lead_type" | "validation_failed",
  rawPayload: Record<string, unknown>,
) {
  await db.insert(schema.rejectedSubmissions).values({
    externalSubmissionId: submissionId, formName, reason, rawPayload,
  });
  await db.update(schema.externalSubmissions).set({ state: "rejected" })
    .where(eq(schema.externalSubmissions.id, submissionId));
}

async function upsertContact(input: {
  email: string | null; phone: string | null;
  firstName: string | null; lastName: string | null;
  businessLine: "real_estate" | "business_consulting";
  attribution: Record<string, string | null>;
}): Promise<string> {
  let contactId: string | undefined;

  if (input.email) {
    const [row] = await db.select().from(schema.contactEmails).where(eq(schema.contactEmails.email, input.email));
    if (row) contactId = row.contactId;
  }
  if (!contactId && input.phone) {
    const [row] = await db.select().from(schema.contactPhones).where(eq(schema.contactPhones.phoneNormalized, input.phone));
    if (row) contactId = row.contactId;
  }

  if (contactId) {
    // Identity fields may fill in; attribution is written once and never
    // overwritten (see db/schema.ts comment on contacts).
    await db.update(schema.contacts).set({
      firstName: input.firstName ?? undefined,
      lastName: input.lastName ?? undefined,
      businessLine: rawSql`coalesce(${schema.contacts.businessLine}, ${input.businessLine})`,
      lastInteractionAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.contacts.id, contactId));
  } else {
    const [inserted] = await db.insert(schema.contacts).values({
      firstName: input.firstName, lastName: input.lastName, businessLine: input.businessLine,
      source: input.attribution.source, landingPage: input.attribution.landingPage,
      referrer: input.attribution.referrer, utmSource: input.attribution.utmSource,
      utmMedium: input.attribution.utmMedium, utmCampaign: input.attribution.utmCampaign,
      utmContent: input.attribution.utmContent, utmTerm: input.attribution.utmTerm,
      lastInteractionAt: new Date(),
    }).returning();
    if (!inserted) throw new Error("contact insert failed");
    contactId = inserted.id;
  }

  if (input.email) {
    await db.insert(schema.contactEmails).values({ contactId, email: input.email, isPrimary: true })
      .onConflictDoNothing({ target: schema.contactEmails.email });
  }
  if (input.phone) {
    await db.insert(schema.contactPhones).values({
      contactId, phone: input.phone, phoneNormalized: input.phone, isPrimary: true,
    }).onConflictDoNothing({ target: schema.contactPhones.phoneNormalized });
  }

  return contactId;
}

/** Keeps contacts.lead_score/temperature as MAX() across this contact's open
 *  leads — a cheap denormalization for list views; leads.score is authoritative. */
async function syncContactAggregate(contactId: string) {
  const openLeads = await db.select().from(schema.leads)
    .where(and(eq(schema.leads.contactId, contactId), eq(schema.leads.status, "open")));
  if (!openLeads.length) return;
  const best = openLeads.reduce((a, b) => (b.score > a.score ? b : a));
  await db.update(schema.contacts)
    .set({ leadScore: best.score, temperature: best.temperature, updatedAt: new Date() })
    .where(eq(schema.contacts.id, contactId));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// No `export const config` here on purpose: this is a Netlify Forms
// event-triggered function (the "submission-created" filename convention),
// and Netlify rejects a custom `path` on event-triggered functions —
// "Event-triggered functions must not specify a custom path." Netlify
// manages the invocation path/trigger for these automatically.
