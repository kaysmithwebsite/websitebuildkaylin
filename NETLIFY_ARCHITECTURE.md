# Netlify architecture

How the public site and the CRM share one Netlify project and one deploy.
See `IMPLEMENTATION_STATUS.md` for what of this is actually built vs. planned.

```
PUBLIC WEBSITE (build.py → dist/, unchanged)
      │  visitor submits a form
      ▼
NETLIFY FORMS (native, first-party — see NETLIFY_FORMS.md)
      │  submission-created event
      ▼
NETLIFY FUNCTIONS (netlify/functions/submission-created.mts)
      │  Drizzle ORM
      ▼
NETLIFY DATABASE (Postgres — see DATABASE.md)
      │
      ├─→ AI LEAD ANALYSIS (Claude API, server-side only)
      ├─→ AUTOMATION ENGINE (workflows seeded; runner NOT built — status doc)
      └─→ GMAIL / GOOGLE CALENDAR (NOT built — see GOOGLE_INTEGRATION.md)

CRM APPLICATION (dashboard UI — NOT built yet)
```

## One deploy, two halves

`netlify.toml` builds and publishes the static marketing site (`dist/`, via
`python3 build.py --production`) exactly as before, and — additively —
bundles `netlify/functions/` and applies `netlify/database/migrations/`.
Per `HANDOFF.md`, this project's deploy path is Netlify's zip-and-build
upload (git is not connected as a deploy source), so both halves travel in
the same uploaded source tree and the same build.

Nothing about the public site's architecture changed to accommodate the
CRM: no framework was introduced, `build.py` still emits static HTML, and
the only public-site changes this session were (1) the forms now submit to
Netlify Forms as their primary path and (2) real-estate booking CTAs link
to Calendly. See `SEO_PROTECTION.md`.

## Why Netlify Functions, not the static build, own the CRM

A static Python build cannot hold a database connection, a server-side
Anthropic API key, or OAuth tokens. Netlify Functions are the only piece of
this deploy with a server-side execution context, so every privileged
operation (writing to the database, calling Claude, eventually calling
Gmail/Calendar) happens there — never in code that ships to the browser.
See `SECURITY.md`.

## Directory layout

```
db/
  schema.ts        Drizzle schema — the system of record's shape
  index.ts         Lazy Drizzle client (Netlify Database via @netlify/database)
  seed.ts          Idempotent seed: brands, pipelines, stages, form_routes, tags, workflows
lib/
  normalize.ts     Email/phone normalization (pure)
  scoring.ts        Deterministic lead scoring (pure)
  routing.ts        form_name (+lead_type) → route resolution (pure)
  cross-brand.ts    Send-allowed guard (pure)
  validation.ts     Zod schemas (Netlify payload, AI Lead Brief)
  ai-brief.ts        Claude API call (server-side only)
netlify/
  functions/
    submission-created.mts   Netlify Forms ingestion (the pipeline)
  database/
    migrations/       SQL Netlify applies automatically on deploy
tests/
  *.test.ts            Pure-logic unit tests (no DB needed)
  integration/          End-to-end tests against a live Netlify Database
scripts/
  sync-migrations.ts    drizzle-kit generate → netlify/database/migrations/ bridge
```

## What decides what

- **Routing** (`lib/routing.ts` + `form_routes` table): explicit form data
  only. AI is never consulted for routing.
- **Scoring** (`lib/scoring.ts`): a fixed point table. AI may *explain* a
  score (the Lead Brief); it never sets one.
- **AI enrichment** (`lib/ai-brief.ts`): additive and non-fatal. A Claude
  failure is recorded and retryable; it never blocks or removes a lead.

This ordering — capture first, persist second, enrich third, automate
fourth — is enforced structurally in
`netlify/functions/submission-created.mts`: the audit row is written before
anything else runs, and every step after it is wrapped so a failure is
recorded rather than thrown away.
