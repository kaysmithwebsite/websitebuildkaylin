/**
 * KAYLIN SMITH CRM — Drizzle schema, Netlify Database (Postgres)
 * =============================================================================
 * System of record for the CRM. Netlify Database only — no Supabase.
 *
 * This supersedes the table design in supabase/migrations/0001-0007, which was
 * built against a Supabase project that was never provisioned (see
 * IMPLEMENTATION_STATUS.md). The ideas worth keeping were ported deliberately:
 *   - a contact is deduplicated by normalized email/phone, not hoped to be
 *   - lead-score events are one row per rule, unique per (lead, rule), so a
 *     replayed webhook cannot inflate a score
 *   - every stage move and every touch lands on one activity timeline
 *   - attribution (utm_*, landing page, referrer) is written once and never
 *     overwritten
 *   - automation runs are rows with a resume_at timestamp, never a setTimeout
 * What did not carry over: Supabase Auth (`auth.users`, `auth.uid()`) and RLS
 * policies written against it. Authorization for this app is enforced in
 * Netlify Functions (see SECURITY.md) rather than in Postgres row policies,
 * because Netlify Database does not ship a Supabase-style auth/RLS layer.
 * =============================================================================
 */

import {
  pgTable, pgEnum, text, boolean, integer, timestamp, jsonb,
  uuid, uniqueIndex, index, primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ---------------------------------------------------------------------------
 * ENUMS
 * ------------------------------------------------------------------------- */

export const businessLineEnum = pgEnum("business_line", [
  "real_estate", "business_consulting",
]);

export const leadTypeEnum = pgEnum("lead_type", [
  // real estate
  "buyer", "seller", "investor", "home_valuation", "consultation",
  // business consulting
  "strategy", "operations", "crm_automation",
  // fallback when a route cannot be determined deterministically
  "review_required",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "open", "won", "lost",
]);

export const temperatureEnum = pgEnum("temperature", ["cold", "warm", "hot"]);

export const taskStatusEnum = pgEnum("task_status", ["open", "done", "cancelled"]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "booked", "rescheduled", "cancelled", "completed", "no_show",
]);

export const submissionStateEnum = pgEnum("submission_state", [
  "received", "processed", "failed", "rejected",
]);

export const emailDirectionEnum = pgEnum("email_direction", ["outbound", "inbound"]);

export const emailStatusEnum = pgEnum("email_status", [
  "queued", "sent", "delivered", "bounced", "failed", "blocked",
]);

export const googleServiceEnum = pgEnum("google_service", ["gmail", "calendar"]);

export const automationStepTypeEnum = pgEnum("automation_step_type", [
  "email", "wait", "task", "stage_change", "tag", "notify", "stop",
]);

export const automationRunStatusEnum = pgEnum("automation_run_status", [
  "active", "waiting", "completed", "stopped", "failed",
]);

export const aiAnalysisStatusEnum = pgEnum("ai_analysis_status", [
  "pending", "succeeded", "failed",
]);

/* ---------------------------------------------------------------------------
 * BRANDS  — Kaylin Smith Real Estate  /  Kay Smith Consulting Group
 * The unit that owns sender identity, mailbox and email template brand.
 * Every send is validated against contact -> lead -> brand before it leaves
 * (see SECURITY.md, "cross-brand protection").
 * ------------------------------------------------------------------------- */
export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),           // "real_estate" | "consulting"
  name: text("name").notNull(),
  businessLine: businessLineEnum("business_line").notNull(),
  senderName: text("sender_name").notNull(),
  senderEmail: text("sender_email").notNull(),      // info@kaylinsmith.com | kaysmithconsultinggroup@gmail.com
  notifyEmail: text("notify_email").notNull(),
  // Every branded email (Phase 7, not yet built — see EMAIL_SYSTEM.md) must
  // end with a "Book an appointment with me" CTA linking here.
  bookingUrl: text("booking_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------------------------------------------------------------------
 * PIPELINES / STAGES
 * ------------------------------------------------------------------------- */
export const pipelines = pgTable("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),            // "real_estate" | "business_consulting"
  name: text("name").notNull(),
  brandId: uuid("brand_id").notNull().references(() => brands.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pipelineStages = pgTable("pipeline_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  isWon: boolean("is_won").notNull().default(false),
  isLost: boolean("is_lost").notNull().default(false),
}, (t) => ({
  pipelineSlugUnique: uniqueIndex("pipeline_stages_pipeline_slug_uniq").on(t.pipelineId, t.slug),
  pipelinePositionUnique: uniqueIndex("pipeline_stages_pipeline_position_uniq").on(t.pipelineId, t.position),
}));

/* ---------------------------------------------------------------------------
 * FORM ROUTES  — Netlify form name (+ explicit lead_type for general-contact)
 * -> business line / lead type / pipeline / notify email.
 * Seeded deterministically (see db/seed.ts). AI never decides routing when a
 * route already resolves it; an unmatched form/lead_type combination routes
 * to lead_type='review_required' rather than being guessed.
 * ------------------------------------------------------------------------- */
export const formRoutes = pgTable("form_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  formName: text("form_name").notNull(),
  // "" (not null — see below) = this form name always maps to the same lead
  // type (most forms). A real value = this row only applies when the
  // submission's own lead_type field matches (used by "general-contact",
  // which lets the visitor pick). Deliberately NOT NULL: Postgres treats
  // every NULL as distinct in a unique index, which would silently allow
  // duplicate "always this route" rows for the same form_name and, more
  // importantly, is not a valid ON CONFLICT target for a plain composite
  // unique constraint. "" is an ordinary value, so one plain unique index
  // below is enough and `onConflictDoNothing` in db/seed.ts works correctly.
  matchLeadType: text("match_lead_type").notNull().default(""),
  businessLine: businessLineEnum("business_line").notNull(),
  leadType: leadTypeEnum("lead_type").notNull(),
  pipelineSlug: text("pipeline_slug").notNull(),
  notifyEmail: text("notify_email").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  formMatchUnique: uniqueIndex("form_routes_form_match_uniq").on(t.formName, t.matchLeadType),
}));

/* ---------------------------------------------------------------------------
 * CONTACTS — one person, one row. Deduplicated on normalized email/phone at
 * the child-table level (contact_emails / contact_phones), not here, so a
 * person can be reached at more than one address without becoming two people.
 * ------------------------------------------------------------------------- */
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: text("first_name"),
  lastName: text("last_name"),

  businessLine: businessLineEnum("business_line"),   // set on first lead; a contact can hold leads in both lines
  // Denormalized MAX() across this contact's open leads, kept in sync by the
  // ingestion/scoring path — for contact-list sorting only. The lead's own
  // `score`/`temperature` (below) is authoritative.
  leadScore: integer("lead_score").notNull().default(0),
  temperature: temperatureEnum("temperature").notNull().default("cold"),
  ownerLabel: text("owner_label"),                    // free-text assignee until a real user/auth model exists

  doNotContact: boolean("do_not_contact").notNull().default(false),

  // Attribution — written once on first contact creation, never overwritten.
  source: text("source"),
  landingPage: text("landing_page"),
  referrer: text("referrer"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),

  lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactEmails = pgTable("contact_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  email: text("email").notNull(),                     // stored lowercased + trimmed (see lib/normalize.ts)
  isPrimary: boolean("is_primary").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUnique: uniqueIndex("contact_emails_email_uniq").on(t.email),
  contactIdx: index("contact_emails_contact_idx").on(t.contactId),
}));

export const contactPhones = pgTable("contact_phones", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),                     // original display value, as submitted
  phoneNormalized: text("phone_normalized").notNull(), // digits only (see lib/normalize.ts) — dedup key
  isPrimary: boolean("is_primary").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  normalizedUnique: uniqueIndex("contact_phones_normalized_uniq").on(t.phoneNormalized),
  contactIdx: index("contact_phones_contact_idx").on(t.contactId),
}));

/* ---------------------------------------------------------------------------
 * LEADS / OPPORTUNITIES — one per (contact, lead_type). A contact interested
 * in both buying and consulting gets two leads, not two contacts.
 * ------------------------------------------------------------------------- */
export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => brands.id),
  pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id),
  stageId: uuid("stage_id").notNull().references(() => pipelineStages.id),
  leadType: leadTypeEnum("lead_type").notNull(),
  status: leadStatusEnum("status").notNull().default("open"),
  title: text("title"),
  formRouteId: uuid("form_route_id").references(() => formRoutes.id),
  // Authoritative per-lead score: SUM(lead_score_events.points) for this
  // lead, written back here for cheap list/board queries. A contact with
  // both a real-estate and a consulting lead has two different scores —
  // that is why this lives on leads, not only on contacts.
  score: integer("score").notNull().default(0),
  temperature: temperatureEnum("temperature").notNull().default("cold"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => ({
  contactIdx: index("leads_contact_idx").on(t.contactId),
  // One OPEN lead per contact+lead_type. Partial unique index: a lost/won
  // lead does not block a fresh one of the same type later.
  openLeadUnique: uniqueIndex("leads_open_contact_type_uniq")
    .on(t.contactId, t.leadType).where(sql`${t.status} = 'open'`),
}));

export const leadScoreEvents = pgTable("lead_score_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key").notNull(),
  points: integer("points").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // A rule can only fire once per lead — replaying an ingest event cannot
  // inflate the score.
  leadRuleUnique: uniqueIndex("lead_score_events_lead_rule_uniq").on(t.leadId, t.ruleKey),
}));

/* ---------------------------------------------------------------------------
 * ACTIVITY TIMELINE, TASKS, APPOINTMENTS, TAGS
 * ------------------------------------------------------------------------- */
export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),          // "inquiry" | "stage_change" | "email_sent" | "reply" | "note" | ...
  summary: text("summary").notNull(),
  meta: jsonb("meta"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index("activity_events_contact_idx").on(t.contactId, t.occurredAt),
}));

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  detail: text("detail"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: taskStatusEnum("status").notNull().default("open"),
  createdByAutomationId: uuid("created_by_automation_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  openDueIdx: index("tasks_open_due_idx").on(t.dueAt).where(sql`${t.status} = 'open'`),
  contactIdx: index("tasks_contact_idx").on(t.contactId),
}));

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  status: appointmentStatusEnum("status").notNull().default("booked"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  location: text("location"),
  meetingUrl: text("meeting_url"),
  googleEventId: text("google_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index("appointments_contact_idx").on(t.contactId, t.startsAt),
  googleEventUnique: uniqueIndex("appointments_google_event_uniq")
    .on(t.googleEventId).where(sql`${t.googleEventId} is not null`),
}));

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
});

export const contactTags = pgTable("contact_tags", {
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  automatic: boolean("automatic").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.contactId, t.tagId] }),
}));

/* ---------------------------------------------------------------------------
 * EXTERNAL SUBMISSION AUDIT + REJECTED SUBMISSION LOG
 * Every Netlify Forms submission is recorded here first, unconditionally —
 * "capture first, persist second, enrich third, automate fourth". The
 * Netlify submission id is the idempotency key: a retried webhook delivery
 * can never create a duplicate lead (see NETLIFY_FORMS.md, "idempotency").
 * ------------------------------------------------------------------------- */
export const externalSubmissions = pgTable("external_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("netlify"),
  providerSubmissionId: text("provider_submission_id").notNull(),
  formName: text("form_name").notNull(),
  rawPayload: jsonb("raw_payload").notNull(),
  state: submissionStateEnum("state").notNull().default("received"),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // The actual idempotency guard: a second delivery of the same Netlify
  // submission id can insert its audit row (ON CONFLICT DO NOTHING) but can
  // never re-run ingestion.
  providerSubmissionUnique: uniqueIndex("external_submissions_provider_uniq")
    .on(t.provider, t.providerSubmissionId),
  stateIdx: index("external_submissions_state_idx").on(t.state),
}));

export const rejectedSubmissions = pgTable("rejected_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalSubmissionId: uuid("external_submission_id")
    .references(() => externalSubmissions.id, { onDelete: "cascade" }),
  formName: text("form_name").notNull(),
  reason: text("reason").notNull(),   // "unknown_form" | "unknown_lead_type" | "validation_failed" | "spam_honeypot"
  rawPayload: jsonb("raw_payload").notNull(),
  reviewed: boolean("reviewed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------------------------------------------------------------------
 * EMAIL  — messages sent/received through the connected Gmail mailboxes.
 * Schema is ready; sending is blocked until Google OAuth is configured
 * (see GOOGLE_INTEGRATION.md). No fabricated rows: an empty table means
 * "nothing sent yet", not "email isn't built".
 * ------------------------------------------------------------------------- */
export const emailMessages = pgTable("email_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  brandId: uuid("brand_id").notNull().references(() => brands.id),
  direction: emailDirectionEnum("direction").notNull(),
  status: emailStatusEnum("status").notNull().default("queued"),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  templateKey: text("template_key"),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  gmailThreadId: text("gmail_thread_id"),
  gmailMessageId: text("gmail_message_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index("email_messages_contact_idx").on(t.contactId, t.createdAt),
  gmailThreadIdx: index("email_messages_gmail_thread_idx").on(t.gmailThreadId),
}));

export const emailEvents = pgTable("email_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailMessageId: uuid("email_message_id").notNull().references(() => emailMessages.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),   // "sent" | "delivered" | "bounced" | "reply_detected" | "failed"
  meta: jsonb("meta"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------------------------------------------------------------------
 * GOOGLE ACCOUNT CONNECTIONS — one per brand mailbox (real estate, consulting)
 * ------------------------------------------------------------------------- */
export const googleAccounts = pgTable("google_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").notNull().references(() => brands.id),
  service: googleServiceEnum("service").notNull(),
  emailAddress: text("email_address").notNull(),
  // Tokens are encrypted application-side before storage (see SECURITY.md).
  // Never selected by a generic "SELECT *" path in application code.
  encryptedRefreshToken: text("encrypted_refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  connected: boolean("connected").notNull().default(false),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  brandServiceUnique: uniqueIndex("google_accounts_brand_service_uniq").on(t.brandId, t.service),
}));

/* ---------------------------------------------------------------------------
 * AUTOMATION ENGINE — workflows / steps / runs.
 * A run is a row with a resume_at timestamp, never a setTimeout, so a
 * redeploy or a cold start loses nothing. Step execution is idempotent via a
 * unique (run_id, position) claim, ported from the design proven in
 * supabase/functions/_shared/engine.ts.
 * ------------------------------------------------------------------------- */
export const automationWorkflows = pgTable("automation_workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),     // "real_estate_buyer" | "real_estate_seller" | "business_consulting"
  name: text("name").notNull(),
  brandId: uuid("brand_id").notNull().references(() => brands.id),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const automationSteps = pgTable("automation_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id").notNull().references(() => automationWorkflows.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  stepType: automationStepTypeEnum("step_type").notNull(),
  config: jsonb("config").notNull().default({}),
}, (t) => ({
  workflowPositionUnique: uniqueIndex("automation_steps_workflow_position_uniq")
    .on(t.workflowId, t.position),
}));

export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id").notNull().references(() => automationWorkflows.id),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  status: automationRunStatusEnum("status").notNull().default("active"),
  currentPosition: integer("current_position").notNull().default(0),
  resumeAt: timestamp("resume_at", { withTimezone: true }),
  stoppedReason: text("stopped_reason"),   // "human_reply" | "booked" | "unsubscribed" | "manual_pause" | null
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({
  // One live run per workflow per contact — enrolling twice is a no-op.
  liveRunUnique: uniqueIndex("automation_runs_live_uniq")
    .on(t.workflowId, t.contactId).where(sql`${t.status} in ('active','waiting')`),
  dueIdx: index("automation_runs_due_idx").on(t.resumeAt).where(sql`${t.status} = 'waiting'`),
}));

export const automationRunSteps = pgTable("automation_run_steps", {
  runId: uuid("run_id").notNull().references(() => automationRuns.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
  result: jsonb("result"),
}, (t) => ({
  // The idempotency claim: a step can only ever execute once per run.
  pk: primaryKey({ columns: [t.runId, t.position] }),
}));

/* ---------------------------------------------------------------------------
 * AI LEAD ANALYSIS (Claude). Enrichment is secondary to lead capture: a
 * failure here never blocks or removes a lead. Status starts "pending" and
 * is retryable.
 * ------------------------------------------------------------------------- */
export const aiLeadAnalysis = pgTable("ai_lead_analysis", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  status: aiAnalysisStatusEnum("status").notNull().default("pending"),
  brief: jsonb("brief"),          // validated against lib/validation.ts:LeadBriefSchema
  model: text("model"),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  leadIdx: index("ai_lead_analysis_lead_idx").on(t.leadId),
}));

/* ---------------------------------------------------------------------------
 * AUDIT LOG — sensitive actions only. Never logs secrets.
 * ------------------------------------------------------------------------- */
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),        // "system:submission-created" | a staff identifier once auth exists
  action: text("action").notNull(),      // "lead.created" | "lead.stage_changed" | "email.sent" | "google.connected" | ...
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  entityIdx: index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  createdIdx: index("audit_logs_created_idx").on(t.createdAt),
}));
