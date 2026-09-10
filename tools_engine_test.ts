/**
 * Automation engine tests. Runs the real engine against an in-memory store.
 *   node --experimental-strip-types tools_engine_test.ts
 *
 * These exist because the engine decides what email a real person receives.
 * "It looks right" is not good enough for that.
 */
import {
  advanceRun, runDue, stopReason, evaluate, delayMs,
  type Store, type Run, type Step, type Facts,
} from "./supabase/functions/_shared/engine.ts";

let failures = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}${got !== undefined ? `  (got ${JSON.stringify(got)})` : ""}`);
}

class Memory implements Store {
  clock = new Date("2026-09-08T09:00:00Z");
  runs = new Map<string, Run>();
  stepsByAutomation = new Map<string, Step[]>();
  factsById = new Map<string, Facts>();
  logged = new Set<string>();
  emails: { contact: string; template: string }[] = [];
  tasks: { title: string }[] = [];
  stages: { opp: string; stage: string }[] = [];
  tags: { contact: string; tag: string }[] = [];
  notices: string[] = [];
  webhooks: string[] = [];
  suppressed = new Set<string>();

  now() { return this.clock; }
  tick(ms: number) { this.clock = new Date(this.clock.getTime() + ms); }

  async dueRuns(limit: number) {
    return [...this.runs.values()].filter((r) =>
      (r.status === "active" || r.status === "waiting") &&
      (!r.resume_at || new Date(r.resume_at) <= this.clock)).slice(0, limit);
  }
  async steps(id: string) { return this.stepsByAutomation.get(id) ?? []; }
  async facts(id: string) { return this.factsById.get(id) ?? null; }
  async saveRun(id: string, patch: any) { Object.assign(this.runs.get(id)!, patch); }
  async claimStep(runId: string, position: number) {
    const key = `${runId}:${position}`;
    if (this.logged.has(key)) return false;      // unique (run_id, position)
    this.logged.add(key);
    return true;
  }
  async recordStep() { /* outcome text is not asserted on */ }
  async queueEmail(contactId: string, _r: string, template: string) {
    if (this.suppressed.has(contactId)) return null;
    this.emails.push({ contact: contactId, template });
    return `email-${this.emails.length}`;
  }
  async createTask(_c: string, _o: string | null, title: string) { this.tasks.push({ title }); }
  async moveStage(opp: string, stage: string) { this.stages.push({ opp, stage }); }
  async addTag(contact: string, tag: string) { this.tags.push({ contact, tag }); }
  async notify(subject: string) { this.notices.push(subject); }
  async callWebhook(url: string) { this.webhooks.push(url); }
}

function baseFacts(over: Partial<Facts> = {}): Facts {
  return {
    id: "c1", do_not_contact: false, unsubscribed: false, lifecycle: "inquiry",
    temperature: "warm", lead_score: 30, email: "a@b.co", tags: ["buyer"],
    interest: "real_estate", paused: false, replied_at: null, booked_at: null,
    re: { timeline: "within_30_days", budget_band: "750k_1m" }, biz: null, ...over,
  };
}

function newRun(over: Partial<Run> = {}): Run {
  return {
    id: "r1", automation_id: "a1", automation_key: "re_buyer_inquiry",
    contact_id: "c1", opportunity_id: "o1", status: "active",
    current_position: 1, started_at: "2026-09-08T09:00:00Z", ...over,
  };
}

/* The buyer inquiry flow from section 83, expressed as steps. */
const BUYER_FLOW: Step[] = [
  { id: "s1", position: 1, step_type: "email",  config: { template: "re_buyer_welcome" } },
  { id: "s2", position: 2, step_type: "delay",  config: { days: 2 } },
  { id: "s3", position: 3, step_type: "condition",
    config: { field: "booked_at", op: "not_exists" }, on_true_position: 4, on_false_position: 7 },
  { id: "s4", position: 4, step_type: "email",  config: { template: "re_buyer_resource" } },
  { id: "s5", position: 5, step_type: "delay",  config: { days: 3 } },
  { id: "s6", position: 6, step_type: "task",   config: { title: "Call buyer", due_in: { hours: 1 } } },
  { id: "s7", position: 7, step_type: "stop",   config: {} },
];

console.log("\nAUTOMATION ENGINE\n");

/* -------------------------------------------------------------- unit rules */
console.log("rules");
check("delay maths: 2 days", delayMs({ days: 2 }) === 172_800_000, delayMs({ days: 2 }));
check("delay maths: mixed",  delayMs({ days: 1, hours: 2, minutes: 30 }) === 95_400_000);
check("condition in",        evaluate(baseFacts(), { field: "re.timeline", op: "in", value: ["within_30_days"] }));
check("condition not_exists",evaluate(baseFacts(), { field: "booked_at", op: "not_exists" }));
check("condition has_tag",   evaluate(baseFacts(), { op: "has_tag", value: "buyer" }));
check("condition gte score", evaluate(baseFacts({ lead_score: 45 }), { field: "lead_score", op: "gte", value: 45 }));
check("dotted miss is safe", !evaluate(baseFacts(), { field: "biz.stage", op: "exists" }));
check("unknown op is false", !evaluate(baseFacts(), { field: "lead_score", op: "wat", value: 1 }));

/* ------------------------------------------------------------------- stops */
console.log("\nstop conditions (section 42)");
const r = newRun();
check("clean run does not stop",  stopReason(baseFacts(), r) === null);
check("do_not_contact stops",     stopReason(baseFacts({ do_not_contact: true }), r) === "do_not_contact");
check("unsubscribed stops",       stopReason(baseFacts({ unsubscribed: true }), r) === "unsubscribed");
check("client conversion stops",  stopReason(baseFacts({ lifecycle: "client" }), r) === "converted");
check("reply after start stops",  stopReason(baseFacts({ replied_at: "2026-09-08T10:00:00Z" }), r) === "replied");
check("reply BEFORE start ignored", stopReason(baseFacts({ replied_at: "2020-01-01T00:00:00Z" }), r) === null);
check("booking after start stops", stopReason(baseFacts({ booked_at: "2026-09-08T11:00:00Z" }), r) === "consultation_booked");
check("manual pause stops",       stopReason(baseFacts({ paused: true }), r) === "paused");

/* ---------------------------------------------------------- the happy path */
console.log("\nbuyer flow, end to end");
const m = new Memory();
m.stepsByAutomation.set("a1", BUYER_FLOW);
m.factsById.set("c1", baseFacts());
m.runs.set("r1", newRun());

let rep = await advanceRun(m, m.runs.get("r1")!);
check("stops at the first delay", rep.status === "waiting", rep.status);
check("welcome email queued",     m.emails.length === 1 && m.emails[0].template === "re_buyer_welcome");

let due = await m.dueRuns(10);
check("not due before the delay elapses", due.length === 0, due.length);

m.tick(2 * 24 * 3600_000);
due = await m.dueRuns(10);
check("due once 2 days pass", due.length === 1);

rep = await advanceRun(m, m.runs.get("r1")!);
check("condition sent it to the resource email", m.emails.length === 2 &&
      m.emails[1].template === "re_buyer_resource");
check("waiting on the second delay", rep.status === "waiting", rep.status);

m.tick(3 * 24 * 3600_000);
rep = await advanceRun(m, m.runs.get("r1")!);
check("call task created", m.tasks.length === 1 && m.tasks[0].title === "Call buyer");
check("run completed at stop", rep.status === "completed", rep.status);

/* ------------------------------------------------- booking takes the branch */
console.log("\nbooking short-circuits the nurture");
const m2 = new Memory();
m2.stepsByAutomation.set("a1", BUYER_FLOW);
m2.factsById.set("c1", baseFacts());
m2.runs.set("r1", newRun());
await advanceRun(m2, m2.runs.get("r1")!);
m2.tick(2 * 24 * 3600_000);
// they book during the delay, at a time after the run started
m2.factsById.set("c1", baseFacts({ booked_at: "2026-09-09T12:00:00Z" }));
const rep2 = await advanceRun(m2, m2.runs.get("r1")!);
check("run stopped, not branched", rep2.status === "stopped" && rep2.stopped === "consultation_booked",
      `${rep2.status}/${rep2.stopped}`);
check("no follow-up email sent", m2.emails.length === 1, m2.emails.length);

/* --------------------------------------------------------- reply mid-flight */
console.log("\nreply halts everything");
const m3 = new Memory();
m3.stepsByAutomation.set("a1", BUYER_FLOW);
m3.factsById.set("c1", baseFacts());
m3.runs.set("r1", newRun());
await advanceRun(m3, m3.runs.get("r1")!);
m3.tick(2 * 24 * 3600_000);
m3.factsById.set("c1", baseFacts({ replied_at: "2026-09-08T09:30:00Z" }));
const rep3 = await advanceRun(m3, m3.runs.get("r1")!);
check("stopped on reply", rep3.stopped === "replied", rep3.stopped);
check("only the first email ever sent", m3.emails.length === 1, m3.emails.length);

/* ------------------------------------------------------------ idempotency */
console.log("\nidempotency (section 69)");
const m4 = new Memory();
m4.stepsByAutomation.set("a1", [
  { id: "s1", position: 1, step_type: "email", config: { template: "welcome" } },
  { id: "s2", position: 2, step_type: "stop", config: {} },
]);
m4.factsById.set("c1", baseFacts());
m4.runs.set("r1", newRun());
await advanceRun(m4, m4.runs.get("r1")!);
// simulate a redelivery of the same tick: rewind position, run again
m4.runs.get("r1")!.status = "active";
m4.runs.get("r1")!.current_position = 1;
await advanceRun(m4, m4.runs.get("r1")!);
check("replay does not resend", m4.emails.length === 1, m4.emails.length);

/* ---------------------------------------------------------- suppression */
console.log("\nsuppression and guards");
const m5 = new Memory();
m5.stepsByAutomation.set("a1", [
  { id: "s1", position: 1, step_type: "email", config: { template: "welcome" } },
  { id: "s2", position: 2, step_type: "stop", config: {} },
]);
m5.factsById.set("c1", baseFacts());
m5.suppressed.add("c1");
m5.runs.set("r1", newRun());
await advanceRun(m5, m5.runs.get("r1")!);
check("suppressed send queues nothing", m5.emails.length === 0);
check("run still completes", m5.runs.get("r1")!.status === "completed");

const m6 = new Memory();
m6.stepsByAutomation.set("a1", [
  { id: "s1", position: 1, step_type: "condition",
    config: { op: "always" }, on_true_position: 1 },   // deliberate loop
]);
m6.factsById.set("c1", baseFacts());
m6.runs.set("r1", newRun());
const rep6 = await advanceRun(m6, m6.runs.get("r1")!, 10);
check("a backward jump terminates instead of spinning",
      rep6.status === "completed" && rep6.steps <= 3, `${rep6.status}/${rep6.steps}`);

/* --------------------------------------------------------------- runDue */
console.log("\nscheduler sweep");
const m7 = new Memory();
m7.stepsByAutomation.set("a1", BUYER_FLOW);
for (const id of ["c1", "c2", "c3"]) {
  m7.factsById.set(id, baseFacts({ id }));
  m7.runs.set(`run-${id}`, newRun({ id: `run-${id}`, contact_id: id }));
}
const reports = await runDue(m7, 10);
check("all three runs advanced", reports.length === 3, reports.length);
check("three welcome emails", m7.emails.length === 3, m7.emails.length);

console.log(`\n${failures === 0 ? "All engine tests passed." : `${failures} FAILURE(S)`}\n`);
if (failures) process.exit(1);
