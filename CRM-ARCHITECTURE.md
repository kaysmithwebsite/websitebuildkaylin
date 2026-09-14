# Kaylin Smith CRM — architecture

Rewritten 2026-09-13. This file previously documented a Supabase-based CRM
plan (written 2026-09-03) that was never deployed — no Supabase project was
ever configured. The architecture decision has since changed: **Netlify
Database is the CRM's system of record. Supabase is not used.** This file
now points to the docs that actually describe the current, real
implementation, rather than duplicating them.

Read `IMPLEMENTATION_STATUS.md` first — it has the full, current picture of
what's built, what's partial, what's not started, and what's blocked, kept
up to date as work progresses. It also documents exactly what of the
original Supabase-era design was reused here versus left in
`supabase/` as reference only.

## The documents

| Doc | Covers |
|---|---|
| `IMPLEMENTATION_STATUS.md` | Source of truth: complete / partial / not started / blocked, next action. |
| `NETLIFY_ARCHITECTURE.md` | The overall pipeline, how the public site and CRM share one deploy. |
| `DATABASE.md` | Netlify Database, the Drizzle schema, the migration workflow. |
| `NETLIFY_FORMS.md` | The eleven approved forms, routing, idempotency, spam handling. |
| `SECURITY.md` | Environment variables, authorization, cross-brand send protection. |
| `EMAIL_SYSTEM.md` | Branded email — requirements captured, not yet built. |
| `AUTOMATIONS.md` | The automation engine's design, what's seeded, what the runner needs to be. |
| `GOOGLE_INTEGRATION.md` | Gmail/Calendar — requirements captured, not yet built. |
| `SEO_PROTECTION.md` | What did and did not change on the public site. |

## One-paragraph summary

A visitor submits one of eleven Netlify Forms on the static site
(`build.py` → `dist/`, unchanged). Netlify invokes
`netlify/functions/submission-created.mts`, which validates, deduplicates,
and persists a contact and a lead into Netlify Database (Postgres, via
Drizzle — `db/schema.ts`), scores the lead deterministically, asks Claude
for a Lead Brief (non-fatal if it fails), creates a follow-up task and
timeline entry, and enrolls the lead into a seeded automation workflow.
Nothing about lead capture depends on the database, Claude, or any other
integration being reachable — a failure anywhere past the initial audit
write is recorded, never silently dropped. Everything past ingestion
(the automation runner, the CRM dashboard, Gmail/Calendar, branded email)
is designed and scaffolded but not yet built — see
`IMPLEMENTATION_STATUS.md` for the exact, current boundary.
