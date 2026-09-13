# Automation engine

**Schema and enrollment are built. The runner is not.** A contact is
correctly enrolled into the right workflow the moment their lead is
created; nothing advances that enrollment past step 0 yet. This is a
deliberate scope cut for this session (see `IMPLEMENTATION_STATUS.md`,
priority order), not an oversight.

## Design, ported from the Supabase-era engine

`supabase/functions/_shared/engine.ts` (never deployed, but real and
tested — 30 passing tests in `tools_engine_test.ts`) proved out the design
this schema follows:

1. **State lives in the database.** A wait step is a `resume_at`
   timestamp on `automation_runs`, never a `setTimeout` — a cold start or
   redeploy loses nothing.
2. **Every step is idempotent.** `automation_run_steps` has a primary key
   on `(run_id, position)` — claim a position before executing it; a
   redelivered scheduler tick loses the claim race and does nothing.
3. **Stops are checked before every step**, not only at enrollment. A
   human reply at 09:00 must prevent the 09:05 nurture email — this only
   works if the check happens step-by-step, not once up front.

## What's seeded (`db/seed.ts`)

Three workflows, matching the master prompt's automation maps:

- **`real_estate_buyer`** — ack email → notify inbox → "Call new buyer
  lead" task (due in 1 hour) → wait 48h → follow-up email → wait 72h →
  follow-up email.
- **`real_estate_seller`** — ack email → notify inbox → "Call new seller
  lead" task (due in 1 hour) → wait 48h → follow-up email. Used for both
  `seller` and `home_valuation` leads.
- **`business_consulting`** — ack email → notify inbox → "Call new
  consulting lead" task (due in 4 hours) → wait 48h → follow-up email.

Step `config` is a `templateKey` reference (e.g. `re_buyer_ack`) — the
actual template content doesn't exist yet (see `EMAIL_SYSTEM.md`).

## What enrollment does today

`submission-created.mts`, step 24: after a lead is created and scored, it
picks the matching workflow key from business line + lead type, and — if
no *live* run already exists for that `(workflow, contact)` pair (checked
explicitly, since the "one live run" guarantee is a **partial** unique
index that Drizzle's `onConflictDoNothing` can't target directly — see
`DATABASE.md`) — inserts one `automation_runs` row: `status = 'waiting'`,
`current_position = 0`, `resume_at = now()`.

That row then sits there. Nothing reads `automation_runs` looking for due
work.

## What the runner needs to be (next step)

A **scheduled Netlify Function** (see the serverless-functions coding
context fetched this session: `@hourly`-or-finer cron syntax, 30-second
execution limit, only runs on published deploys — not on deploy previews).
Each tick:

1. Select runs where `status = 'waiting' AND resume_at <= now()`
   (`automation_runs_due_idx` already exists for this).
2. For each: **check stop conditions first** (human reply on the contact's
   thread, an appointment booked, `do_not_contact`, unsubscribe, manual
   pause) — set `status = 'stopped'`, `stopped_reason`, and skip execution
   if any apply. This must run before step 3, every tick, not only once.
3. Load `automation_steps` at `current_position + 1`; attempt to insert
   into `automation_run_steps` (the idempotency claim); if the insert
   fails (already claimed), skip — someone else's tick got there first.
4. Execute the step by `step_type` (`email`, `wait`, `task`,
   `stage_change`, `tag`, `notify`, `stop`) and advance
   `current_position`; for `wait`, set `resume_at` instead of executing
   immediately.
5. Mark `completed` when there is no next step.

`supabase/functions/run-automations/index.ts` is a real, if undeployed,
reference implementation of this loop against the old schema — read it
before writing the new one; the control flow ports directly even though
the storage calls need rewriting for Drizzle.

## Hard stops

Every sequence must halt immediately on: a human reply, a booking, unsubscribe,
`do_not_contact`, or a manual pause. None of this is implemented yet — it
belongs in step 2 of the runner above. Until the runner exists, this is
moot: nothing is sending, so nothing needs stopping.
