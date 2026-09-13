# Security

## Environment variables

Only what is actually read by code in this repository. Set in Netlify's
own environment variable store (Project configuration → Environment
variables) — never in a committed file.

| Variable | Used by | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | `lib/ai-brief.ts` | **Not set** — AI Lead Brief fails gracefully without it (`ai_lead_analysis.status = 'failed'`, ingestion unaffected). |
| `GOOGLE_CLIENT_ID` | Gmail/Calendar OAuth (not built yet) | Not set. |
| `GOOGLE_CLIENT_SECRET` | Gmail/Calendar OAuth (not built yet) | Not set. |
| `GOOGLE_REDIRECT_URI` | Gmail/Calendar OAuth (not built yet) | Not set. |
| a token-encryption secret (name TBD when Google OAuth is built) | encrypting `google_accounts.encrypted_refresh_token` at rest | Not set — the column exists, nothing writes to it yet. |

A Netlify Database connection string is **not** in this list —
`@netlify/database`'s `getConnectionString()` resolves it automatically
from the deploy context; see `DATABASE.md`. Nothing in this repository
reads a `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` — see
`IMPLEMENTATION_STATUS.md`'s Supabase-remnants audit.

`ANTHROPIC_API_KEY` is read only in `lib/ai-brief.ts`, which is imported
only by `netlify/functions/submission-created.mts` — a server-side Netlify
Function. It is never imported by, or reachable from, anything that ships
to the browser.

## Authorization

**The public website has no privileged CRM database access**, and none is
planned. Visitors may submit one of the ten approved Netlify Forms (see
`NETLIFY_FORMS.md`); they cannot read contacts or leads, change a pipeline
stage, read analytics, trigger an automation, or reach `ANTHROPIC_API_KEY`
or a Google token under any circumstance, because none of that code is
reachable from a public HTTP request — it all lives behind
`netlify/functions/submission-created.mts`'s own internal logic, which only
ever *writes* new rows (contacts, leads, tasks, activity) and never
*reads back* anything beyond what it just needs to route and dedupe the
current submission.

**The CRM dashboard does not exist yet.** When it is built, it needs a real
authentication story enforced **server-side** in whatever Netlify Functions
back it — hiding a button in the UI is not authorization. See
`IMPLEMENTATION_STATUS.md`, BLOCKED: Netlify Identity is deprecated and
Netlify's current documented primitives (Blobs, Functions, Database, Forms,
Image CDN) do not include a first-party auth service, so this needs a
deliberate decision with the user before any dashboard code is written —
not a default.

## Cross-brand send protection

`lib/cross-brand.ts`:`validateSendAllowed()` — a pure function, unit
tested — refuses a send unless the lead's brand, the email template's
brand, and the sending mailbox's brand all agree. Not wired to a real send
path yet (there is no send path — see `EMAIL_SYSTEM.md`), but it ships now,
tested, so the very first real send path built is required to call it.

## Function-level hardening already in place

`netlify/functions/submission-created.mts`:

- Rejects non-POST methods (405).
- Validates the request body shape with Zod
  (`NetlifySubmissionEnvelope.parse`) before touching anything; a malformed
  payload is logged and acknowledged (200, so Netlify doesn't retry
  forever) rather than crashing.
- Validates every field against a known, bounded schema (`RawFormData`) —
  unrecognized extra fields pass through harmlessly (`.passthrough()`) but
  nothing is trusted beyond what's explicitly read.
- Never trusts a client-submitted `business_line`/routing hint over the
  server-resolved `form_routes` row (see `NETLIFY_FORMS.md`).
- Returns a generic error body on failure — no stack trace, no internal id,
  no database error message reaches the response. The real error is
  recorded server-side (`external_submissions.error_message`).
- Never logs a secret. `console.error` calls in this file log the *error*,
  not any credential or token.

## Audit logging

`audit_logs` (actor, action, entity_type, entity_id, metadata, timestamp).
Written today for `lead.created` on every successful ingestion. Extend the
same pattern for every other sensitive action as it's built (stage change,
assignment, manual email send, automation pause/resume, Google
connect/disconnect, configuration change) — never log a secret in
`metadata`.

## What's explicitly NOT done yet (do not assume otherwise)

- No rate limiting on `submission-created.mts`. Netlify Forms' own spam
  filtering and the honeypot check are the only current defenses against
  abuse; add rate limiting before this is genuinely public-scale.
- No encryption-at-rest implementation for `google_accounts.encrypted_refresh_token` —
  the column name says "encrypted" as a contract for when it's built, not a
  claim that it is.
- No CRM authentication exists (see above) — there is nothing to
  penetration-test yet because there is no dashboard.
