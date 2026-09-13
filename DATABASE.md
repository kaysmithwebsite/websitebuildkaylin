# Database — Netlify Database (Postgres)

Netlify Database only. No Supabase. See `IMPLEMENTATION_STATUS.md` for the
audit of what still mentions Supabase and why each mention is inert.

## How it's provisioned

Nothing is provisioned by hand. Per Netlify's own current guidance
(fetched via the Netlify MCP this session — see `db/index.ts`'s comment):
installing `@netlify/database` and deploying (or running `netlify dev`
locally) **automatically provisions a Postgres database for the site**. The
connection string is never configured manually; `@netlify/database`'s
`getConnectionString()` / `getDatabase()` resolve it from the current
deploy context automatically.

Branching: production deploys are the only ones touching the production
database. Every deploy preview gets its own isolated branch, seeded from a
copy of production data on its first deploy.

## Access pattern used here

`db/index.ts` exports a lazily-constructed Drizzle client
(`drizzle-orm/node-postgres` over a `pg.Pool`, `connectionString:
getConnectionString()`). Lazy on purpose: importing `db/schema.ts` or
`db/index.ts` must not throw just because nothing has queried yet, which is
what lets the pure-logic tests and `tsc --noEmit` run in any environment
(including one with no database at all, like the sandbox this was built
in) without special-casing imports.

## Schema → migration workflow

The schema lives in **one place**, `db/schema.ts` (Drizzle). Netlify
Database's own migration runner does not read Drizzle schema files
directly — it applies plain SQL files from
`netlify/database/migrations/<timestamp>_<slug>/migration.sql`, in
lexicographic order, automatically before a production deploy is published
(and before every new deploy on a preview branch; a failure blocks the
deploy in both cases).

So there are two tools bridged by one script:

1. `drizzle-kit generate` reads `db/schema.ts` and writes a flat `.sql`
   file to `drizzle/generated/` (gitignored — scratch output only).
2. `scripts/sync-migrations.ts` runs step 1 for you and copies the result
   into a fresh, correctly-timestamped `netlify/database/migrations/`
   directory — the one that's actually committed and actually applied.

```bash
npm run db:generate                                   # just drizzle-kit generate, inspect the diff
node --experimental-strip-types scripts/sync-migrations.ts add_appointments   # generate + place it correctly
```

Never hand-edit a migration that has already been committed and possibly
already applied — Netlify Database migrations are append-only, same as any
other production Postgres migration tool. Add a new one instead.

**`drizzle-kit push`/`migrate` are deliberately not part of this
project's workflow** — they'd fight with Netlify's own migration runner
over who applied what. `drizzle.config.ts` exists only so `generate` has
somewhere to read the schema from; its `dbCredentials` is a placeholder,
never dialed.

## Seeding

`db/seed.ts` is idempotent (every insert is `ON CONFLICT DO NOTHING`
against a natural key) — safe to run more than once, including in
production after new rows are added to the seed list.

```bash
npm run db:seed
```

Needs a real database connection, so — like the integration tests — this
only works inside `netlify dev` or a deployed Function today (see
`IMPLEMENTATION_STATUS.md`, BLOCKED).

## Schema summary

25 tables, 15 enums. Full detail and design rationale is in the comments at
the top of each section of `db/schema.ts`; the short version:

| Group | Tables |
|---|---|
| Brand / pipeline | `brands`, `pipelines`, `pipeline_stages`, `form_routes` |
| Contact identity | `contacts`, `contact_emails`, `contact_phones` |
| Leads | `leads`, `lead_score_events` |
| Activity | `activity_events`, `tasks`, `appointments`, `tags`, `contact_tags` |
| Ingestion audit | `external_submissions`, `rejected_submissions` |
| Email | `email_messages`, `email_events`, `google_accounts` |
| Automation | `automation_workflows`, `automation_steps`, `automation_runs`, `automation_run_steps` |
| AI / governance | `ai_lead_analysis`, `audit_logs` |

Three load-bearing constraints worth knowing before touching this schema:

- `leads_open_contact_type_uniq` — a **partial** unique index (`WHERE
  status = 'open'`) enforcing one open lead per `(contact, lead_type)`. A
  won/lost lead does not block a fresh one of the same type later. Partial
  unique indexes cannot be targeted by Drizzle's `onConflictDoNothing()` —
  code that needs this guarantee does an explicit select-then-insert
  instead (see `submission-created.mts`).
- `external_submissions_provider_uniq` — the actual idempotency mechanism
  for Netlify Forms delivery retries. `(provider, provider_submission_id)`,
  plain unique, so `onConflictDoNothing` does work here.
- `form_routes.match_lead_type` is `NOT NULL DEFAULT ''`, not nullable.
  Postgres treats every `NULL` as distinct in a unique index, which would
  both allow duplicate "always this route" rows and make the column
  unusable as a plain `ON CONFLICT` target. `""` is the sentinel for "this
  form always resolves the same way" instead — see the comment in
  `db/schema.ts` and `lib/routing.ts`.
