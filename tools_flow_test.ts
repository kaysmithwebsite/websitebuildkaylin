/**
 * Runs the flows as they are actually seeded in migration 0006 through the
 * real engine. The engine tests use fixtures; this parses the SQL so a typo in
 * a seeded step, a template that does not exist, or a stage key that is not in
 * the pipeline is caught here rather than in production.
 *   node --experimental-strip-types tools_flow_test.ts
 */
import { readFileSync } from "node:fs";
import { advanceRun, type Store, type Run, type Step, type Facts }
  from "./supabase/functions/_shared/engine.ts";

const sql = ["0004_crm_rls_triggers_seed", "0006_crm_automations_seed"]
  .map((f) => readFileSync(`supabase/migrations/${f}.sql`, "utf8")).join("\n");

/* ---- parse the seeded steps, templates and stage keys out of the SQL ---- */
function parseFlows(): Map<string, Step[]> {
  const flows = new Map<string, Step[]>();
  const blocks = sql.split(/select id into a from automations where key = '/).slice(1);
  for (const b of blocks) {
    const key = b.slice(0, b.indexOf("'"));
    const rows = [...b.matchAll(
      /\(a,\s*(\d+),'(\w+)',\s*'([^']*)',\s*(null|\d+),\s*(null|\d+)\)/g)];
    flows.set(key, rows.map((m) => ({
      id: `${key}-${m[1]}`, position: Number(m[1]), step_type: m[2] as Step["step_type"],
      config: JSON.parse(m[3] || "{}"),
      on_true_position: m[4] === "null" ? null : Number(m[4]),
      on_false_position: m[5] === "null" ? null : Number(m[5]),
    })));
  }
  return flows;
}
const seededTemplates = new Set([...sql.matchAll(/^\('([a-z_0-9]+)','[^']*','[^']*','(?:real_estate|business_consulting)'/gm)].map((m) => m[1]));
const seededStages = new Set([...sql.matchAll(/\('([a-z_0-9]+)','[^']*',\d+,(?:true|false),(?:true|false),\d+\)/g)].map((m) => m[1]));
const seededTags = new Set([...sql.matchAll(/^\s*\('([a-z_0-9]+)','[^']*','[a-z_]*',\s*(?:true|false)\)/gm)].map((m) => m[1]));

let failures = 0;
function check(n: string, c: boolean, got?: unknown) {
  if (c) { console.log(`  ok    ${n}`); return; }
  failures++; console.log(`  FAIL  ${n}${got !== undefined ? `  (${JSON.stringify(got)})` : ""}`);
}

class Mem implements Store {
  clock = new Date("2026-09-08T09:00:00Z");
  emails: string[] = []; tasks: string[] = []; stages: string[] = [];
  tags: string[] = []; notices: string[] = []; logged = new Set<string>();
  steps_: Step[]; f: Facts; run: Run;
  /* Written out rather than as parameter properties: Node's strip-only
     TypeScript mode does not support that shorthand. */
  constructor(steps_: Step[], f: Facts, run: Run) {
    this.steps_ = steps_; this.f = f; this.run = run;
  }
  now() { return this.clock; }
  tick(ms: number) { this.clock = new Date(this.clock.getTime() + ms); }
  async dueRuns() { return [this.run]; }
  async steps() { return this.steps_; }
  async facts() { return this.f; }
  async saveRun(_i: string, p: any) { Object.assign(this.run, p); }
  async claimStep(r: string, p: number) {
    const k = `${r}:${p}`; if (this.logged.has(k)) return false; this.logged.add(k); return true;
  }
  async recordStep() {}
  async queueEmail(_c: string, _r: string, t: string) { this.emails.push(t); return `e${this.emails.length}`; }
  async createTask(_c: string, _o: string | null, t: string) { this.tasks.push(t); }
  async moveStage(_o: string, s: string) { this.stages.push(s); }
  async addTag(_c: string, t: string) { this.tags.push(t); }
  async notify(s: string) { this.notices.push(s); }
  async callWebhook() {}
}

function facts(over: Partial<Facts> = {}): Facts {
  return { id: "c1", do_not_contact: false, unsubscribed: false, lifecycle: "inquiry",
    temperature: "warm", lead_score: 30, email: "a@b.co", tags: [], interest: null,
    paused: false, replied_at: null, booked_at: null, re: null, biz: null, ...over };
}
function run(): Run {
  return { id: "r1", automation_id: "a1", contact_id: "c1", opportunity_id: "o1",
    status: "active", current_position: 1, started_at: "2026-09-08T09:00:00Z" };
}

/** Drives a flow to completion, jumping the clock past each delay. */
async function drive(m: Mem, maxTicks = 12) {
  for (let i = 0; i < maxTicks; i++) {
    const r = await advanceRun(m, m.run);
    if (r.status !== "waiting") return r;
    m.tick(31 * 24 * 3600_000);
  }
  return { status: "waiting" as const, runId: "r1", steps: 0 };
}

const flows = parseFlows();
console.log("\nSEEDED FLOWS\n");
console.log(`  parsed ${flows.size} flows: ${[...flows.keys()].join(", ")}\n`);

/* ------- every referenced template, stage and tag must actually exist ------ */
console.log("references");
for (const [key, steps] of flows) {
  for (const s of steps) {
    if (s.step_type === "email")
      check(`${key} step ${s.position} template exists`, seededTemplates.has(s.config.template), s.config.template);
    if (s.step_type === "stage_change")
      check(`${key} step ${s.position} stage exists`, seededStages.has(s.config.stage), s.config.stage);
    if (s.step_type === "tag")
      check(`${key} step ${s.position} tag exists`, seededTags.has(s.config.tag), s.config.tag);
  }
  check(`${key} terminates in a stop step`, steps[steps.length - 1]?.step_type === "stop");
}

/* --------------------------- behaviour of each flow ---------------------- */
console.log("\nbuyer flow behaviour");
let m = new Mem(flows.get("re_buyer_inquiry")!,
  facts({ re: { timeline: "within_30_days" } }), run());
let rep = await drive(m);
check("completes", rep.status === "completed", rep.status);
check("near-term buyer gets a call task", m.tasks.length === 1, m.tasks);
check("sends 3 emails across the cadence", m.emails.length === 3, m.emails);
check("ends in long-term nurture", m.stages.includes("long_term_nurture"), m.stages);

m = new Mem(flows.get("re_buyer_inquiry")!,
  facts({ re: { timeline: "researching" } }), run());
await drive(m);
check("researcher gets no urgent call task", m.tasks.length === 0, m.tasks);

console.log("\nseller flow behaviour");
m = new Mem(flows.get("re_seller_inquiry")!,
  facts({ re: { seller_address: "Unionville" } }), run());
await drive(m);
check("address supplied raises an internal alert", m.notices.length === 1, m.notices);
check("CMA task created", m.tasks.some((t) => /CMA/.test(t)), m.tasks);

m = new Mem(flows.get("re_seller_inquiry")!, facts({ re: {} }), run());
await drive(m);
check("no address, no alert", m.notices.length === 0, m.notices);

console.log("\nconsulting flow behaviour");
m = new Mem(flows.get("biz_consulting_inquiry")!,
  facts({ biz: { urgency: "now" } }), run());
await drive(m);
check("urgent lead raises an alert", m.notices.length === 1, m.notices);
check("sends 3 emails", m.emails.length === 3, m.emails);

m = new Mem(flows.get("biz_consulting_inquiry")!,
  facts({ biz: { urgency: "exploring" } }), run());
await drive(m);
check("exploring lead raises no alert", m.notices.length === 0, m.notices);

console.log("\nstops apply to the seeded flows too");
m = new Mem(flows.get("re_buyer_inquiry")!, facts({ re: { timeline: "researching" } }), run());
await advanceRun(m, m.run);
m.f = facts({ re: { timeline: "researching" }, booked_at: "2026-09-08T10:00:00Z" });
m.tick(3 * 24 * 3600_000);
const r2 = await advanceRun(m, m.run);
check("booking halts the buyer sequence", r2.stopped === "consultation_booked", r2.stopped);
check("only the welcome email was sent", m.emails.length === 1, m.emails);

console.log(`\n${failures === 0 ? "All seeded flows behave correctly." : `${failures} FAILURE(S)`}\n`);
if (failures) process.exit(1);
