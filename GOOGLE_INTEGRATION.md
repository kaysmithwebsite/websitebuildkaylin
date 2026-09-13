# Google integration (Gmail + Calendar)

**Not built.** No OAuth flow, no send path, no Calendar sync exists yet.
`google_accounts`, `email_messages.gmail_thread_id`/`gmail_message_id`, and
`appointments.google_event_id` exist in the schema so this can be built
without a migration later, and so nothing built in the meantime has to
guess at column names — but every one of those columns is empty today.

## Two mailboxes, never conflated

| Brand | Mailbox |
|---|---|
| Kaylin Smith Real Estate | info@kaylinsmith.com |
| Kay Smith Consulting Group | kaysmithconsultinggroup@gmail.com |

`google_accounts` has a unique `(brand_id, service)` — one Gmail
connection and one Calendar connection per brand, never shared.
`lib/cross-brand.ts`:`validateSendAllowed()` (built and tested this
session — see `SECURITY.md`) is the guard that must be called before any
future send path uses one of these mailboxes: it refuses to send unless
the lead's brand, the template's brand, and the mailbox's brand all agree.

## Required environment variables (not set)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, plus a
token-encryption secret to be named when this is built — see
`SECURITY.md`. Nothing in this repository reads these yet.

## Connection state must be honest

When a connect/disconnect flow exists, `google_accounts.connected` and
`.last_error` are what any future dashboard reads to decide what to show.
**Never render a mailbox as connected because code exists to connect it —
render it from this table's actual state.** If Google isn't configured,
the correct UI is "Google configuration required," not a fake green
checkmark — this is the "no fake features" requirement from the master
prompt, and it applies here more than anywhere else in this system, since
a wrongly-implied-connected mailbox is the one mistake that could make a
real client email look like it went out when it didn't.

## What's planned once credentials exist

- Connect / disconnect / connection-status endpoints (Netlify Functions,
  authenticated — see `SECURITY.md`, CRM authorization is not built yet
  either, so this is blocked on that too).
- Token refresh, server-side only, encrypted at rest
  (`encrypted_refresh_token` — no encryption implementation exists yet).
- Send via the correct brand's mailbox (`EMAIL_SYSTEM.md`).
- Thread association (`gmail_thread_id`) so a reply in Gmail is
  recognizable as a reply to a specific `email_messages` row.
- **Reply detection**: when a human reply arrives, associate it with the
  contact, add an `activity_events` row, increase lead score
  (`POST_INGEST_RULES.replyReceived`, already defined in
  `lib/scoring.ts`, unused until this exists), and stop any live
  automation run for that contact (`AUTOMATIONS.md`, hard stops) — a
  human reply must never be followed by a robotic nurture email.
- Calendar: `createEvent`/`updateEvent`/`freeBusy`, writing
  `appointments.google_event_id` and a matching `activity_events` row, and
  scoring `POST_INGEST_RULES.appointmentBooked` (also already defined,
  unused until this exists).

## Why this wasn't attempted this session

No Google Cloud OAuth client exists to test against, and per the master
prompt's own instruction, faking connectivity or building UI that implies
a working integration without one is explicitly prohibited. Building the
scaffolding (routes, encryption helpers, a token-refresh function) with no
way to exercise any of it against a real Google account would produce
code with real risk of bugs never caught until first real use — worse than
not building it yet. Do this once a Google Cloud project and OAuth client
exist.
