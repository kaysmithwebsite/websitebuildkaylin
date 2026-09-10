# Kaylin Smith CRM — audit, architecture and build plan

Written 2026-09-03. Section numbers refer to the CRM master build prompt.

---

## 1. CURRENT STATE — what exists today

| Area | Reality |
|---|---|
| Framework | **None.** `build.py` is a ~2,600 line Python 3 static site generator. It emits 25 static HTML pages into `dist/`. |
| Runtime | No application server. Netlify runs `python3 build.py --preview` and serves the output as files. |
| Database | **Not connected.** `supabase/schema.sql` defines 20 tables, but no Supabase project is configured. `KS_CONFIG.supabase.url` and `anonKey` are empty strings. |
| Authentication | None. There is no login anywhere on the site. |
| Contact forms | 9 forms across 3 tables: `leads` (6), `business_enquiries` (2), `referral_requests` (1). `assets/js/forms.js` POSTs directly to Supabase PostgREST. |
| Form behaviour today | Because no database is configured, submissions are queued in `localStorage` and the form tells the visitor plainly that the message was **not** delivered. Nothing is silently dropped. |
| Booking | A link only. `supabase/functions/calendar-hold/index.ts` exists but is not deployed and holds no real availability. |
| Email | None. `supabase/functions/notify-lead/index.ts` would route a lead notification to two inboxes, but is not deployed. |
| Integrations | None live. |
| Design system | Mature and reusable: CSS custom properties, navy/white/black, editorial type, `.g12` grid. Already matches §76. |

**The existing 20 tables are capture tables, not a CRM.** They are one-table-per-form
(`showing_requests`, `valuation_requests`, …) plus content tables left over from the
removed listings section. None of the 30+ entities §68 requires exists.

### What this means

The prompt asks for a system where "kaylinsmith.com should ultimately function as
website + CRM + automation". The website half is built and deployed. The CRM half is
greenfield, and the site as it stands cannot host it: a CRM admin needs authentication,
server-side data access and a persistent job runner, none of which a static Python build
can provide.

---

## 2. CRM ARCHITECTURE — what gets added

Three deployable pieces, deliberately decoupled so no single vendor is load-bearing (§71):

```
  PUBLIC SITE                    CRM CORE                      ADMIN
  (exists today)                 (Supabase)                    (to build)

  static HTML  ──POST──►  capture tables ──► ingest fn ──► contacts
  build.py                  (anon INSERT      (service       opportunities   ◄── Kaylin
  forms.js                   only)             role)         activity            signs in
                                                  │
                                                  ▼
                                            job_queue  ◄── scheduled fn (every minute)
                                                  │           runs automations,
                                                  ▼           sends due email,
                                     adapters: email │ calendar │ sms          fires reminders
```

**Why an ingest function rather than writing straight to `contacts`:** the anon key ships
in public JavaScript. Anything it can write, anyone can write. It keeps INSERT-only access
to the capture tables; a service-role function promotes those rows into the CRM, where
deduplication, scoring and consent are applied under controlled conditions (§7, §65).

**Why a persistent `job_queue`:** §69 requires a scheduled follow-up to survive a restart.
Delays are rows with a `run_after` timestamp, not `setTimeout`. Every job carries a
`dedupe_key` so a retry cannot send the same email twice.

### The one open decision

The admin UI needs an application runtime. Three options:

1. **Static admin SPA + Supabase Auth** — no server, deploys beside the existing site, RLS
   is the only authorization layer. Lightest, and fits the current architecture.
2. **Separate Next.js app** at `crm.kaylinsmith.com` — server-side rendering, server actions,
   heavier but more capable.
3. **Combined build** — Next.js swallowing the marketing site too. Rewrites work that is
   already finished and deployed. Not recommended.

**Recommendation: option 1.** The RLS policies in `0004` already enforce staff-only access at
the database, so a static admin adds no new trust boundary. This choice does not affect the
data model, which is why Phase 1 proceeded without settling it.

---

## 3. DATA MODEL — 37 tables

Implemented in `supabase/migrations/0001`–`0004`. Additive; the existing capture tables are
untouched.

**Identity** `crm_users` · `contacts` · `organizations`
**Interest** `contact_interests` · `real_estate_profiles` · `business_profiles`
**Pipeline** `pipelines` · `pipeline_stages` · `opportunities` · `opportunity_stage_history`
**Activity** `activity_events` · `notes` · `tasks` · `calls` · `appointments` · `appointment_types` · `documents`
**Marketing** `resources` · `resource_tags` · `contact_resources` · `tags` · `contact_tags` · `email_templates` · `emails` · `email_events` · `email_suppressions`
**Scoring** `lead_scoring_rules` · `contact_score_events`
**Automation** `automations` · `automation_steps` · `automation_runs` · `automation_run_steps` · `job_queue`
**Network** `partners` · `referrals`
**Governance** `consents` · `audit_events`

Decisions worth stating:

- **One person, one row.** `contacts.email` is `citext unique`; `phone_normalized` is a
  generated column stripping punctuation. Deduplication is a database constraint, not a
  hopeful `if` in application code (§7).
- **Interest is a table, not a column.** §2 requires a contact to be in both funnels at
  once. Such a contact has one `contacts` row, two `contact_interests` rows and two
  `opportunities`.
- **Lead score is derived.** `contact_score_events` holds one row per rule fired, with the
  rule key and points; a trigger sums them into `contacts.lead_score`. Kaylin can always
  see *why* a score is what it is, which §32 demands and an opaque score cannot give.
- **Consent stores its wording.** `consents.wording` keeps the exact text shown at the time.
  CASL requires proving what someone agreed to (§67).
- **Stage moves are history.** A trigger writes `opportunity_stage_history` on every change.
- **Everything lands on one timeline.** Calls, notes, tasks, appointments and emails each
  fire a trigger into `activity_events`, so nothing can happen to a contact without showing
  on the record (§37).

---

## 4. AUTOMATION MAP

### Real estate

```
form submitted
  → ingest: contact upsert, interest=real_estate, opportunity in "New Inquiry"
  → score: timeline, budget, financing, seller address
  → tag: buyer | seller | investor | first_time_buyer
  → INSTANT email, resources chosen by tag (§15)
  → task: "Call {name} within 1 business hour" if timeline < 90 days
  → wait 2d ─ booked? ─ yes → stop, hand to booking flow
                       └ no → resource email
  → wait 3d ─ replied? ─ yes → STOP, notify Kaylin
                        └ no → personal-style check-in
  → wait 5d → final gentle invitation
  → move to long-term nurture
```

### Business consulting

```
form submitted
  → ingest: contact + business_profile + opportunity in "New Inquiry"
  → classify stage + primary challenge
  → INSTANT email naming the challenge, resources by stage/challenge
  → wait 2d → framework for that challenge
  → wait 3d → short strategic insight
  → wait 5d → invitation to book when timing is right
  → business insights nurture
```

### Hard stops (§42)

Every sequence halts immediately on: reply, booking, conversion to client,
unsubscribe, manual pause, or `do_not_contact`. Enforced by a partial unique index —
one live run per automation per contact — plus a stop check before each step executes.

---

## 5. INTEGRATION PLAN

Each integration is an adapter behind an interface, so no vendor is hard-wired (§71, §81).

| Integration | Interface | Status |
|---|---|---|
| Email | `send(message) → {providerMessageId}` | **Blocked — needs an API key.** Resend recommended. |
| Calendar | `createEvent`, `updateEvent`, `freeBusy` | **Blocked — needs Google OAuth client + refresh token.** |
| SMS | `sendSms` | **Blocked — needs a provider account.** Optional. |
| Forms | already POST to capture tables | Works; needs a live Supabase project. |
| Analytics / UTM | captured on `contacts` | Built into the schema. |

In development every adapter runs in **log mode**: the message is written to `emails` with
`status='queued'`, the run is recorded, and nothing is transmitted. That keeps the audit
trail honest instead of faking a send (§81).

---

## 6. SECURITY AND PRIVACY

- **Anon key can INSERT into capture tables and nothing else.** It cannot read, write or see
  any CRM table. Enforced by RLS, not by the client.
- **Every CRM policy requires an authenticated staff row** in `crm_users`. `crm_is_staff()`
  and `crm_can_write()` are `security definer`. Deletion is restricted to `owner`.
- **The first owner must be created with the service role key**, since the insert policy
  requires an existing writer.
- **Transactional and marketing mail are different classes** (`emails.class`) with separate
  consent gates. A service enquiry does not create marketing consent (§65).
- **`audit_events`** records actor, action, before/after for sensitive changes.
- **`email_suppressions`** is checked before every send, marketing or not.
- Open-tracking is recorded but treated as unreliable; replies and clicks carry the weight (§53).

---

## 7. IMPLEMENTATION PHASES

| Phase | Scope | State |
|---|---|---|
| 1 | Database architecture, contacts, opportunities, profiles, pipelines, activity | **Built** — 37 tables, 22 enums, 34 indexes, RLS, triggers, seed |
| 2 | Progressive inquiry forms, classification, tagging, scoring | **Built** — 4-step branching form, `crm_inquiries` capture, ingest function, dedup, tags, transparent scoring, consent capture |
| 3 | Email infrastructure, template engine, resource library | Needs provider key |
| 4 | Automation engine, delays, conditions, persistence | **Built** — engine + scheduled runner + 4 seeded flows; 30 engine tests and 32 flow tests pass in Node |
| 5 | Booking, reminders, consultation briefs | Needs calendar credentials |
| 6 | Post-consultation workflows, tasks, pipeline moves | **Built** — 12 outcomes, hot-lead cadence, lost-reason guard, needs-attention view; 60 outcome tests pass |
| 7 | Dashboard, analytics, source attribution | Next — unblocked |
| 8 | AI assistance — briefs, call summaries, drafts | After 6 |
| 9 | Security review, consent, audit, end-to-end tests | Last |

Phases 2, 4, 6, 7 need no external credentials. Phases 3 and 5 are genuinely blocked.
