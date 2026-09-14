# Implementation status — Kaylin Smith CRM

Last updated 2026-09-14, this session (AI FAQ chatbot added — see below).
**Read this before starting work.** It
is the source of truth for what actually exists, corrected against the
repository each time it changes — not what a previous handoff prompt assumed.

---

## Correcting the record

A continuation prompt for this session described a prior agent having
already built a Netlify Database + Drizzle schema (`db/schema.ts`,
`db/index.ts`, `drizzle.config.ts`, Netlify Functions, an unapplied
migration under `netlify/database/migrations/`). **None of that existed in
the repository before this session.** There was no `package.json`, no
`db/`, no `netlify/functions/`, no Drizzle anywhere on disk.

What genuinely existed, and predates this session:

- A mature, well-designed **Supabase-based** CRM data model and business
  logic: `supabase/schema.sql` (the old capture-table design) and
  `supabase/migrations/0001`–`0007` (37 tables: contacts, opportunities,
  pipelines, activity, automations, scoring, consent — real, carefully
  reasoned schema, documented in the original `CRM-ARCHITECTURE.md`).
- Five Supabase Edge Functions (Deno): `ingest-inquiry`, `run-automations`,
  `apply-outcome`, `notify-lead`, `calendar-hold`, plus a shared
  automation-engine module (`supabase/functions/_shared/engine.ts`) and an
  outcome-planner module (`outcomes.ts`).
- Three root-level test harnesses (`tools_engine_test.ts`,
  `tools_flow_test.ts`, `tools_outcome_test.ts`) exercising that engine —
  real, passing tests, just against the Supabase design.
- **None of it was ever deployed.** No Supabase project was configured
  (`CRM-ARCHITECTURE.md`: *"Database: Not connected... no Supabase project
  is configured"*). Forms POSTed to Supabase PostgREST and, finding nothing
  there, queued submissions in `localStorage` with an honest "not
  delivered" message.

This session's job, per the (accurate) part of the continuation prompt, was
to **stop using Supabase** and build the same kind of CRM on **Netlify
Database + Drizzle + Netlify Functions** instead. The Supabase-era design
was read in full and deliberately ported wherever it was good — see "What
was reused" below — rather than re-invented from scratch.

The `supabase/` directory is left in place (not deleted — nothing there is
live, and deleting proven design/business-logic before it has been fully
ported would be a real loss). It is legacy reference only. See "Supabase
remnants" below for the complete list of what still mentions Supabase and
why each one is safe to leave for now.

---

## COMPLETE

- **Drizzle schema** — [`db/schema.ts`](db/schema.ts). 25 tables, 15 enums,
  on Postgres via Netlify Database. Covers every entity the master prompt
  asked for: brands, pipelines, pipeline_stages, form_routes, contacts,
  contact_emails, contact_phones, leads, lead_score_events,
  activity_events, tasks, appointments, tags/contact_tags,
  external_submissions, rejected_submissions, email_messages, email_events,
  google_accounts, automation_workflows/steps/runs/run_steps,
  ai_lead_analysis, audit_logs. Typechecks clean (`npm run typecheck`).
- **Initial migration**, generated from the schema and placed at
  [`netlify/database/migrations/20260913000001_init_crm_schema/migration.sql`](netlify/database/migrations/20260913000001_init_crm_schema/migration.sql)
  in Netlify's required directory format. **Applied to the live production
  database** — confirmed via the deploy's own summary
  (`database_migrations: [{"name": "20260913000001_init_crm_schema",
  "applied": true}]`, `database_branch_id: "production"`) on deploy
  `6aa70610d8321ba8291145c7`.
- **Seed data** — [`db/seed.ts`](db/seed.ts): both brands, both pipelines,
  all 22 pipeline stages (12 real estate + 10 consulting, exact labels from
  the spec), all 10 form_routes (5 dedicated real-estate forms, 4 dedicated
  business forms, 5 general-contact branches), 10 tags, and the three
  automation workflow/step shells (real_estate_buyer, real_estate_seller,
  business_consulting). Idempotent — safe to re-run.
- **Netlify Forms ingestion** —
  [`netlify/functions/submission-created.mts`](netlify/functions/submission-created.mts).
  Implements essentially the full 26-step pipeline from the master prompt:
  audit-first idempotency (unique on `provider` + Netlify's own submission
  id), honeypot spam check, deterministic route resolution (never guesses),
  email/phone normalization and dedup, contact upsert with
  write-once attribution, one open lead per (contact, lead_type),
  deterministic lead scoring with per-rule score events, activity timeline,
  a follow-up task, an AI Lead Brief attempt (non-fatal on failure),
  automation-workflow enrollment when a matching workflow is seeded, a
  queued (unsent) internal notification email row, and a processed/failed
  external_submissions record. A thrown error anywhere is caught, recorded
  on `external_submissions.state = 'failed'`, and still returns 200 (so
  Netlify does not endlessly retry) — the lead is never silently dropped.
- **Deterministic lead scoring** — [`lib/scoring.ts`](lib/scoring.ts),
  exactly the point values from the master prompt (verified in
  `tests/scoring.test.ts`).
- **Form routing** — [`lib/routing.ts`](lib/routing.ts), pure function,
  fully unit-tested (`tests/routing.test.ts`, 16 checks) including the
  unmatched-form and unmatched-lead-type cases.
- **Normalization** — [`lib/normalize.ts`](lib/normalize.ts): email
  case/whitespace, phone punctuation/country-code variants, all verified
  to collide correctly (`tests/normalize.test.ts`).
- **Cross-brand send guard** — [`lib/cross-brand.ts`](lib/cross-brand.ts):
  pure `validateSendAllowed()`, tested (`tests/cross-brand.test.ts`). Not
  wired to a real send path yet (there is no send path — see Google
  Integration below) but ready for the moment there is one.
- **Zod validation** — [`lib/validation.ts`](lib/validation.ts): the
  Netlify submission envelope, the raw form-data shape, and the AI Lead
  Brief schema. Tested (`tests/validation.test.ts`).
- **Claude Lead Brief** — [`lib/ai-brief.ts`](lib/ai-brief.ts), server-side
  only, Zod-validated response, structured exactly per the spec's schema.
- **Netlify Forms are the first-party capture layer** — the public site's
  three real lead forms (the progressive inquiry form, the short
  real-estate form, the consulting form) now submit to Netlify Forms under
  one of the ten approved form names via
  [`assets/js/forms.js`](assets/js/forms.js):`mapToLeadPayload` /
  `netlifyAttempts`, in addition to the pre-existing (never-configured)
  Supabase attempt. Ten hidden, Netlify-detectable stub forms are emitted
  once per page from `build.py`:`page()` so Netlify's build-time crawler
  registers all ten form names and the canonical field schema — see
  `NETLIFY_FORMS.md`. Verified end-to-end in the browser (see Verification
  below); `data/site.json`'s `netlify_forms` config now lists the ten
  approved routes (was two, with a typo'd consulting notify address, now
  fixed).
- **Calendly booking button** (requested mid-session) —
  `data/site.json`:`booking.real_estate_url` is now set to
  `https://calendly.com/kaylinsmithrealestate`. `build.py`'s existing
  `book_href("real_estate")` helper already threads this through every
  "Book a [Real Estate] Consultation" CTA sitewide (header nav, homepage
  closing section, real-estate hub page, footer) with zero template
  changes needed — verified in the browser, both buttons now link directly
  to Calendly. No consulting-specific link was supplied, so
  `booking.consulting_url` is left blank (falls back to the contact form,
  unchanged). `brands.bookingUrl` (schema + seed) carries the same URL for
  the real-estate brand, ready for Phase 7 email templates to use — every
  branded email must end with a "Book an appointment with me" CTA linking
  there once that system is built (see EMAIL_SYSTEM.md; not built yet).
- **Tests** — 65 pure-logic checks across 5 files, all passing
  (`npm test`), plus an integration test
  (`tests/integration/ingestion.test.ts`) implementing both **mandatory**
  end-to-end scenarios from the master prompt (real-estate-buyer and
  business-consultation, including the "no cross-contamination" automation
  checks) plus an idempotency-replay check. It calls
  `submission-created.mts`'s own default export directly with a synthetic
  `Request` — no server needed — but genuinely needs a live Netlify
  Database to run against, so it **SKIPS cleanly** (not a fake pass) in any
  environment without one, including this sandbox. Run it for real under
  `netlify dev` once a database is provisioned.
- **Docs** — this file, plus `NETLIFY_ARCHITECTURE.md`, `DATABASE.md`,
  `NETLIFY_FORMS.md`, `SECURITY.md`, `EMAIL_SYSTEM.md`, `AUTOMATIONS.md`,
  `GOOGLE_INTEGRATION.md`, `SEO_PROTECTION.md`; `CRM-ARCHITECTURE.md`
  rewritten in place to describe the Netlify Database design instead of
  Supabase.
- **Live deploy, database provisioned, function deployed** — the site is
  now live at `kaylinsmith.com` (production, not SSO-gated), with a real
  Netlify Database provisioned and the CRM migration applied
  (`database_branch_id: "production"`), and `submission-created` deployed
  as a real function (`runtime: nodejs22.x`, secret scan clean). Getting
  here required finding and fixing one real bug — see "Bug found and fixed
  this audit" below.
- **Netlify Forms end-to-end, confirmed live** — submitted a real test
  enquiry through the live site's progressive form (`real-estate-buyer`,
  "Claude AuditTest") and confirmed via the Netlify API that it landed
  (`POST https://kaylinsmith.com/ → 200`, visible in
  `manage-form-submissions`). A second, independent real submission from a
  site visitor (Adina Yankov, `business-consultation`, 8:05 PM) was also
  found in Netlify Forms — see the caveat under "Bug found and fixed."

## PARTIAL

- **Automation engine** — workflows and steps are seeded and
  `submission-created.mts` enrolls a contact into the right workflow
  (`automation_runs`, status `waiting`, position 0). **There is no runner.**
  A run sits at position 0 forever until a scheduled Netlify Function is
  built to advance it (claim the next due step via the
  `automation_run_steps` idempotency table, execute it, set `resume_at`).
  This is a deliberate scope cut, not an oversight — see NEXT ACTION.
- **AI Lead Brief** — the call, schema, and non-fatal-failure handling are
  real and wired into ingestion. It has not been exercised against a live
  Anthropic API key in this environment (no live DB to attach the result
  to, either). Model id used: `claude-sonnet-5`.
- **Notifications** — a real `email_messages` row is created (status
  `queued`) for every processed submission, addressed to the correct
  brand's notify inbox. Nothing actually sends — see Google Integration.

## NOT STARTED

- **Automation runner** (scheduled function to advance `automation_runs`).
- **CRM dashboard** — no UI exists. Nothing has been built that could be
  mistaken for one; there is no admin route, no auth-gated page, nothing.
- **CRM authorization / login** — see BLOCKED (Netlify Identity).
- **Branded HTML email system** (Phase 7) — no `EmailTemplate`,
  `CTAButton`, etc. components exist. `email_messages.body_html` is always
  null today; the one row created per lead has `body_text` only, used
  purely as an internal audit trail.
- **Gmail send / reply detection / thread association.**
- **Google Calendar integration** (`appointments.google_event_id` exists
  in the schema; nothing populates it).
- **Analytics / reporting queries.**
- **Real-time "Needs Attention" screen** — the data it would read
  (`rejected_submissions`, failed `external_submissions`, failed
  `ai_lead_analysis`, unassigned leads) is all captured correctly; no UI
  reads it yet.

## BLOCKED

Both blockers that used to be here — no Netlify Database provisioned, and a
Netlify account credit limit — are resolved: the database is provisioned
and migrated, and deploys are succeeding. What remains:

- **`ANTHROPIC_API_KEY` is not set** in this environment (expected — it
  belongs in Netlify's environment variables, never in code or `.env` in
  git). AI Lead Brief generation will fail gracefully (recorded as
  `ai_lead_analysis.status = 'failed'`, ingestion unaffected) until it is
  set there.
- **No Google OAuth client** exists yet (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`). Blocks all of Gmail send,
  reply detection, and Calendar.
- **Netlify Identity is deprecated.** The master prompt names it as an
  option ("Netlify Identity or the appropriate current Netlify-native
  authentication mechanism"); Netlify's own current coding guidance
  (fetched this session via the Netlify MCP) lists Blobs, Image CDN,
  Forms, Functions and Database as first-class primitives and **does not
  mention Identity or any auth-as-a-service product at all** — a real
  signal it is not the current recommendation. **This is a genuine open
  decision, not a rubber-stamp**: the CRM dashboard needs *some*
  authentication story before it can exist safely (Phase-6/13 work), and
  picking one (a small credentials table + signed session cookies issued
  by a Netlify Function, vs. a third-party auth provider) should be a
  deliberate choice made with the user, not guessed. Flagged here rather
  than decided unilaterally.

## Bug found and fixed this audit (2026-09-13, later session)

The deploy that provisioned the database still failed the first several
times — always the same generic error, `"Build script returned non-zero
exit code: 2"`, with no further detail available through any MCP tool.
Got the real error by opening the deploy's log directly in the browser
(`https://app.netlify.com/sites/<site-id>/deploys/<deploy-id>`, which turned
out not to require login — only the dashboard's other pages do):

> **Configuration error — Error message:** Event-triggered functions must
> not specify a custom path. Please remove the "path" configuration from
> the following event-triggered functions...

`submission-created.mts` had `export const config: Config = { path:
"/.netlify/functions/submission-created" }` — redundant (it was the
function's own default path) and, it turns out, **not allowed** on a
Netlify Forms event-triggered function at all. Netlify manages that
function's invocation path itself. Fix: removed the `config` export and
the now-unused `Config` import entirely (`netlify/functions/submission-created.mts`).
Confirmed locally with Netlify's own bundler (`@netlify/zip-it-and-ship-it`)
before redeploying — `routes: []` and no `config` block, where before there
was a `path` route. Redeployed; this time it went all the way to `ready`.

**One caveat found in the process:** a real visitor (Adina Yankov) submitted
the `business-consultation` form at 8:05 PM, *before* this fix was live —
Netlify Forms captured it fine (forms storage is independent of the
function), but `submission-created` didn't exist yet to promote it into a
contact/lead. Netlify does not replay old form submissions through a
function deployed after the fact. If that enquiry should be in the CRM, it
needs manual entry (or a small one-off backfill script reading Netlify
Forms' submission list and calling the same ingestion logic) — it will not
appear on its own.

**Not independently verified:** whether `submission-created` actually wrote
a contact/lead to the database for the post-fix test submission. Netlify
rejects direct HTTP calls to an event-triggered function's URL (confirmed:
`curl` to it returns a real `403` from Netlify's edge, by design, not a bug),
and the Functions log page requires a real dashboard login this session
doesn't have. The Netlify Forms submission itself is confirmed real and
accepted (`200`); whether ingestion completed needs a look at Netlify's
Functions log or a database query.

## AI FAQ chatbot added (2026-09-14, later session)

A floating website chat widget was built and locally verified end-to-end
(desktop + mobile viewports, lead-form submission attempt, all 12 test
files passing, `build.py --production` / `audit.py` / `antiai_audit.py`
all clean). Full architecture, knowledge-base editing instructions,
required environment variables, and safety rules are in **`CHATBOT.md`** —
not duplicated here. In short:

- `netlify/functions/chat.mts` (`/api/chat`) — Claude-backed, grounded only
  in `content/chatbot-knowledge.json`, rate-limited via Netlify Blobs,
  deterministic escalation/lead-intent detection runs before any Claude
  call, fails open to a human-contact message if the API key is missing or
  the call errors.
- `assets/js/chatbot.js` + the `.chatw` panel in `build.py` — the widget UI,
  reusing the site's existing design tokens and `KS.*` helpers.
- `chatbot-intake` — the eleventh Netlify Form (see `NETLIFY_FORMS.md`),
  seeded into `form_routes` via the same `branchRoutes()`/`matchKeyFor()`
  disambiguation as `general-contact`, so it ingests into the CRM through
  the existing `submission-created.mts` pipeline like any other lead.
- **Not yet done:** `ANTHROPIC_API_KEY` is not yet set in Netlify's
  environment variables, so the live chatbot currently falls back to its
  graceful "connect with the team" message rather than answering from
  Claude. Setting it and verifying a real round-trip (including a live
  `chatbot-intake` submission through the real Netlify Forms API, not just
  the local dev server) is the next action for this feature specifically.

## NEXT ACTION

In priority order:

1. **Confirm the fix worked at the database level** — check
   `https://app.netlify.com/projects/kaysmith/logs/functions/submission-created`
   for the "Claude AuditTest" invocation (should show a 200 and no
   exception), or query `contacts`/`leads` for `claude-audit-test@example.com`.
   Delete that test contact/lead once confirmed — it isn't a real person.
2. Decide what to do about Adina Yankov's uncaptured `business-consultation`
   submission (see caveat above) — backfill manually, write the one-off
   script, or accept the gap since it's a single enquiry.
3. Run `tests/integration/ingestion.test.ts` for real against the live
   database (needs a way to reach it — `netlify dev` locally, or run the
   test from inside a Netlify Function/build).
4. Set `ANTHROPIC_API_KEY` in Netlify's environment variables; verify a
   real AI Lead Brief round-trip.
5. Build the automation runner (a scheduled Netlify Function, 30-second
   execution limit — see `get-netlify-coding-context` output for the exact
   scheduled-function shape) that advances `automation_runs` past `wait`
   steps and executes `email`/`task`/`notify`/`stage_change`/`tag`/`stop`
   steps, claiming each via `automation_run_steps` for idempotency.
6. Decide the CRM dashboard's authentication approach with the user (see
   BLOCKED above) before writing any dashboard code.
7. Build the CRM dashboard read path (Contacts, Leads, Needs Attention
   first — they need no external credentials, unlike Email/Calendar).
8. Google OAuth scaffolding (Gmail + Calendar), once there is a client ID
   and secret to configure.
9. Branded HTML email system (Phase 7), threading `brands.bookingUrl`
   into a "Book an appointment with me" CTA on every template as
   requested.

---

## What was reused from the Supabase-era design

Deliberately ported, not reinvented, from `supabase/migrations/0001`-`0007`
and `supabase/functions/`:

- Deduplicate contacts by normalized email/phone as a **database
  constraint**, not an `if` in application code.
- Lead-score events as **one row per rule, unique per (lead, rule)** — a
  replayed webhook cannot inflate a score. (Originally per-contact; moved
  to per-lead here because a contact can hold two open leads with two very
  different scores — see `db/schema.ts` comment on `leads.score`.)
- One open opportunity/lead **per (contact, lead_type)**, not per contact —
  the "two funnels at once" requirement.
- Every touch lands on **one activity timeline**, not a union of six
  tables.
- Attribution (`utm_*`, landing page, referrer) is **written once and
  never overwritten**.
- An automation run is **a row with a `resume_at` timestamp**, never a
  `setTimeout` — survives a cold start or redeploy. Step execution is
  idempotent via a unique claim (here: `automation_run_steps` primary key
  on `(run_id, position)`).
- "Capture first, persist second, enrich third, automate fourth" — the
  exact ingestion failure-handling philosophy in
  `supabase/functions/ingest-inquiry/index.ts`'s docstring.

What did **not** carry over: Supabase Auth (`auth.users`, `auth.uid()`) and
Postgres RLS policies written against it. Netlify Database has no
equivalent auth/RLS layer, so authorization here is enforced in Netlify
Functions instead (see `SECURITY.md`) — this is the main reason the CRM
dashboard's auth story (see BLOCKED) is a real open question rather than a
lift-and-shift.

## Supabase remnants — audited, none active

Searched the whole repository for `supabase`, `SUPABASE_`, `@supabase`.
Every hit, and why it is safe to leave:

| Location | What it is | Why it stays |
|---|---|---|
| `supabase/schema.sql`, `supabase/migrations/*.sql` | The original capture-table schema and the superseded 37-table CRM design | Legacy reference; ideas already ported (see above). Never applied to a live database — see `CRM-ARCHITECTURE.md`'s original "Not connected" note. |
| `supabase/functions/*` | Deno Edge Functions implementing the old design | Never deployed. `tools_engine_test.ts`/`tools_flow_test.ts`/`tools_outcome_test.ts` still import from here and still pass — deleting the source would break real, working tests for no benefit. |
| `data/site.json`:`SITE["supabase"]` (`url`, `anon_key`) | Both already empty strings | `build.py` reads this only to decide whether to render a "database not configured" dev-mode banner and to populate `KS_CONFIG.supabase` for `forms.js`'s now-secondary fallback attempt. `forms.js`'s Supabase POST path (`submitRecord`) is untouched this session — it simply never fires successfully (empty credentials), same as before; Netlify Forms is now the primary, working path (see above). |
| `README.md`, `HANDOFF.md`, original `CRM-ARCHITECTURE.md` (pre-this-session) | Documentation describing the Supabase plan | `CRM-ARCHITECTURE.md` is rewritten this session. `README.md`/`HANDOFF.md` were not touched — they predate the CRM work entirely and describe the static site, not the database layer. |

**No `SUPABASE_*` environment variable is used, referenced, or documented
by anything built this session.** The environment variable list in
`SECURITY.md` does not include one.
