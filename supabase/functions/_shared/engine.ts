/**
 * AUTOMATION ENGINE  —  CRM phase 4 (sections 41, 42, 64, 69)
 *
 * Deliberately free of imports. It talks to a Store interface rather than to
 * Supabase, so the same file runs unmodified in Deno (the scheduled function)
 * and in Node (the test harness). An engine that decides what email a real
 * person receives should be executable on a laptop, not only in production.
 *
 * The three rules it exists to enforce:
 *   1. State lives in the database. A delay is a resume_at timestamp, never a
 *      timer, so a restart loses nothing (section 69).
 *   2. Every step is idempotent. Step results are unique per (run, position);
 *      a replay records nothing twice and sends nothing twice.
 *   3. Stops are checked before every single step, not once at enrolment. A
 *      person who replies at 09:00 does not receive the 09:05 nurture email
 *      (section 42).
 */

export type StepType =
  | "condition" | "delay" | "email" | "sms" | "task"
  | "stage_change" | "tag" | "notify" | "webhook" | "stop";

export type RunStatus = "active" | "waiting" | "completed" | "stopped" | "failed";

export interface Step {
  id: string;
  position: number;
  step_type: StepType;
  config: Record<string, any>;
  on_true_position?: number | null;
  on_false_position?: number | null;
}

export interface Run {
  id: string;
  automation_id: string;
  automation_key?: string;
  contact_id: string;
  opportunity_id?: string | null;
  status: RunStatus;
  current_position: number;
  resume_at?: string | null;
  started_at: string;
}

/** Everything a condition may read. Assembled once per step so a rule cannot
 *  quietly issue its own queries. */
export interface Facts {
  id: string;
  do_not_contact: boolean;
  unsubscribed: boolean;
  lifecycle: string;
  temperature: string;
  lead_score: number;
  email?: string | null;
  tags: string[];
  interest?: string | null;
  replied_at?: string | null;
  booked_at?: string | null;
  paused: boolean;
  re?: Record<string, any> | null;
  biz?: Record<string, any> | null;
}

export interface QueuedEmail {
  templateKey: string;
  reason: string;
}

export interface Store {
  now(): Date;
  dueRuns(limit: number): Promise<Run[]>;
  steps(automationId: string): Promise<Step[]>;
  facts(contactId: string): Promise<Facts | null>;
  saveRun(id: string, patch: Partial<Run> & { stopped_reason?: string | null }): Promise<void>;
  /**
   * Reserves a position before anything happens. Backed by a unique index on
   * (run_id, position), so a redelivered tick loses the race and returns false.
   * The claim MUST happen before the step executes: checking afterwards means
   * the email has already gone out by the time you notice it was a duplicate.
   */
  claimStep(runId: string, position: number, stepId: string | null): Promise<boolean>;
  /** Fills in the outcome of a position already claimed. */
  recordStep(runId: string, position: number, result: string,
             detail?: string, emailId?: string | null): Promise<void>;
  /** Returns an email id, or null when the send was suppressed (unsubscribed,
   *  bounced, or the same template already went to this contact recently). */
  queueEmail(contactId: string, runId: string, templateKey: string,
             opts: Record<string, any>): Promise<string | null>;
  createTask(contactId: string, opportunityId: string | null,
             title: string, dueAt: string | null, detail?: string): Promise<void>;
  moveStage(opportunityId: string, stageKey: string): Promise<void>;
  addTag(contactId: string, tagKey: string): Promise<void>;
  notify(subject: string, body: string, contactId: string): Promise<void>;
  callWebhook(url: string, payload: Record<string, any>): Promise<void>;
  sendSms?(contactId: string, body: string): Promise<void>;
}

/* ------------------------------------------------------------------ stops */

export type StopReason =
  | "do_not_contact" | "unsubscribed" | "replied"
  | "consultation_booked" | "converted" | "paused";

/**
 * Section 42. Evaluated before every step. `replied` and `consultation_booked`
 * only count when they happened after the run began, so enrolling someone who
 * booked last year does not stop a fresh sequence on its first step.
 */
export function stopReason(f: Facts, run: Run): StopReason | null {
  if (f.do_not_contact) return "do_not_contact";
  if (f.unsubscribed) return "unsubscribed";
  if (f.paused) return "paused";
  if (f.lifecycle === "client") return "converted";
  if (f.replied_at && f.replied_at > run.started_at) return "replied";
  if (f.booked_at && f.booked_at > run.started_at) return "consultation_booked";
  return null;
}

/* -------------------------------------------------------------- conditions */

/** Dotted lookup across the fact bundle: "re.timeline", "lead_score", "biz.stage". */
export function readFact(f: Facts, path: string): any {
  const parts = path.split(".");
  let cur: any = f;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * A small fixed operator set rather than an expression evaluator. Automation
 * conditions are edited in an admin UI by a non-developer; there is no reason
 * for arbitrary code to be reachable from that surface.
 */
export function evaluate(f: Facts, config: Record<string, any>): boolean {
  const op = String(config.op ?? "eq");
  if (op === "always") return true;
  if (op === "never") return false;

  if (op === "has_tag")     return f.tags.includes(String(config.value));
  if (op === "not_has_tag") return !f.tags.includes(String(config.value));

  const left = readFact(f, String(config.field ?? ""));
  const right = config.value;

  switch (op) {
    case "exists":     return left !== undefined && left !== null && left !== "";
    case "not_exists": return left === undefined || left === null || left === "";
    case "eq":         return left === right;
    case "ne":         return left !== right;
    case "in":         return Array.isArray(right) && right.includes(left as never);
    case "not_in":     return Array.isArray(right) && !right.includes(left as never);
    case "gt":         return Number(left) >  Number(right);
    case "gte":        return Number(left) >= Number(right);
    case "lt":         return Number(left) <  Number(right);
    case "lte":        return Number(left) <= Number(right);
    default:           return false;
  }
}

/* ------------------------------------------------------------------ delays */

export function delayMs(config: Record<string, any>): number {
  const m = Number(config.minutes ?? 0);
  const h = Number(config.hours ?? 0);
  const d = Number(config.days ?? 0);
  return ((d * 24 + h) * 60 + m) * 60_000;
}

/* ------------------------------------------------------------------ runner */

export interface StepOutcome {
  result: string;
  detail?: string;
  emailId?: string | null;
  /** Where to go next. Undefined means "the next position in order". */
  jumpTo?: number;
  /** Stop the run here. */
  finish?: RunStatus;
  /** Pause until this time. */
  waitUntil?: Date;
}

export async function executeStep(
  store: Store, run: Run, step: Step, f: Facts,
): Promise<StepOutcome> {
  const cfg = step.config ?? {};
  switch (step.step_type) {
    case "condition": {
      const passed = evaluate(f, cfg);
      const jump = passed ? step.on_true_position : step.on_false_position;
      return {
        result: passed ? "condition_true" : "condition_false",
        detail: `${cfg.field ?? cfg.op}`,
        jumpTo: jump ?? undefined,
      };
    }
    case "delay": {
      const until = new Date(store.now().getTime() + delayMs(cfg));
      return { result: "delayed", detail: until.toISOString(), waitUntil: until };
    }
    case "email": {
      const id = await store.queueEmail(run.contact_id, run.id,
        String(cfg.template), { reason: cfg.reason ?? run.automation_key ?? "automation" });
      return id
        ? { result: "email_queued", detail: String(cfg.template), emailId: id }
        : { result: "email_suppressed", detail: String(cfg.template) };
    }
    case "sms": {
      if (!store.sendSms) return { result: "sms_unavailable", detail: "no sms adapter" };
      await store.sendSms(run.contact_id, String(cfg.body ?? ""));
      return { result: "sms_sent" };
    }
    case "task": {
      const dueAt = cfg.due_in
        ? new Date(store.now().getTime() + delayMs(cfg.due_in)).toISOString()
        : null;
      await store.createTask(run.contact_id, run.opportunity_id ?? null,
        String(cfg.title), dueAt, cfg.detail ? String(cfg.detail) : undefined);
      return { result: "task_created", detail: String(cfg.title) };
    }
    case "stage_change": {
      if (!run.opportunity_id) return { result: "stage_skipped", detail: "no opportunity" };
      await store.moveStage(run.opportunity_id, String(cfg.stage));
      return { result: "stage_changed", detail: String(cfg.stage) };
    }
    case "tag": {
      await store.addTag(run.contact_id, String(cfg.tag));
      return { result: "tag_added", detail: String(cfg.tag) };
    }
    case "notify": {
      await store.notify(String(cfg.subject ?? "CRM alert"),
        String(cfg.body ?? ""), run.contact_id);
      return { result: "notified", detail: String(cfg.subject ?? "") };
    }
    case "webhook": {
      await store.callWebhook(String(cfg.url), { contact_id: run.contact_id, run_id: run.id });
      return { result: "webhook_called", detail: String(cfg.url) };
    }
    case "stop":
      return { result: "stopped", finish: "completed" };
    default:
      return { result: "unknown_step", detail: step.step_type, finish: "failed" };
  }
}

export interface RunReport {
  runId: string;
  steps: number;
  status: RunStatus;
  stopped?: StopReason | null;
}

/**
 * Advances one run as far as it can go right now. A delay ends the turn; the
 * run resumes on a later tick. maxSteps stops a mis-wired condition loop from
 * spinning forever.
 */
export async function advanceRun(
  store: Store, run: Run, maxSteps = 50,
): Promise<RunReport> {
  const steps = await store.steps(run.automation_id);
  const byPosition = new Map(steps.map((s) => [s.position, s]));
  const ordered = [...steps].sort((a, b) => a.position - b.position);

  let position = run.current_position;
  let executed = 0;

  for (; executed < maxSteps; executed++) {
    const f = await store.facts(run.contact_id);
    if (!f) {
      await store.saveRun(run.id, { status: "failed", stopped_reason: "contact_missing" });
      return { runId: run.id, steps: executed, status: "failed" };
    }

    const stop = stopReason(f, run);
    if (stop) {
      if (await store.claimStep(run.id, position, null)) {
        await store.recordStep(run.id, position, "stopped", stop);
      }
      await store.saveRun(run.id, {
        status: "stopped", stopped_reason: stop, resume_at: null,
      });
      return { runId: run.id, steps: executed, status: "stopped", stopped: stop };
    }

    const step = byPosition.get(position)
      ?? ordered.find((s) => s.position > position);
    if (!step) {
      await store.saveRun(run.id, { status: "completed", resume_at: null });
      return { runId: run.id, steps: executed, status: "completed" };
    }

    // Claim first, execute second. Each position therefore runs at most once
    // per run, which is also what stops a backward jump from looping: a
    // re-entered position is already claimed and is skipped.
    const claimed = await store.claimStep(run.id, step.position, step.id);
    if (!claimed) {
      position = step.position + 1;
      await store.saveRun(run.id, { current_position: position });
      continue;
    }

    const outcome = await executeStep(store, run, step, f);
    await store.recordStep(
      run.id, step.position, outcome.result, outcome.detail, outcome.emailId);

    if (outcome.finish) {
      await store.saveRun(run.id, { status: outcome.finish, resume_at: null });
      return { runId: run.id, steps: executed + 1, status: outcome.finish };
    }

    if (outcome.waitUntil) {
      position = step.position + 1;
      await store.saveRun(run.id, {
        status: "waiting", current_position: position,
        resume_at: outcome.waitUntil.toISOString(),
      });
      return { runId: run.id, steps: executed + 1, status: "waiting" };
    }

    position = outcome.jumpTo ?? step.position + 1;
    await store.saveRun(run.id, { status: "active", current_position: position });
  }

  await store.saveRun(run.id, { status: "failed", stopped_reason: "step_limit" });
  return { runId: run.id, steps: executed, status: "failed" };
}

export async function runDue(store: Store, limit = 50): Promise<RunReport[]> {
  const runs = await store.dueRuns(limit);
  const out: RunReport[] = [];
  for (const run of runs) out.push(await advanceRun(store, run));
  return out;
}
