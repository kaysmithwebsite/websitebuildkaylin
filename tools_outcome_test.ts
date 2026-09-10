/**
 * Outcome planner tests, run against the mapping as it is actually seeded in
 * migration 0007. Parses the SQL so a stage key that does not exist in the
 * pipeline, or a template that was never seeded, fails here.
 *   node --experimental-strip-types tools_outcome_test.ts
 */
import { readFileSync } from "node:fs";
import { planOutcome, staleReason, nextFollowUp, HOT_LEAD_CADENCE_DAYS,
         type OutcomeConfig, type Outcome } from "./supabase/functions/_shared/outcomes.ts";

const sql = ["0004_crm_rls_triggers_seed", "0006_crm_automations_seed", "0007_crm_outcomes"]
  .map((f) => readFileSync(`supabase/migrations/${f}.sql`, "utf8")).join("\n");

let failures = 0;
function check(n: string, c: boolean, got?: unknown) {
  if (c) { console.log(`  ok    ${n}`); return; }
  failures++; console.log(`  FAIL  ${n}${got !== undefined ? `  (${JSON.stringify(got)})` : ""}`);
}

/* ---- parse the seeded outcome rows -------------------------------------- */
function parseOutcomes(): Map<string, OutcomeConfig> {
  const out = new Map<string, OutcomeConfig>();
  const re = /\('(\w+)','([^']*)',(\d+),(null|'[\w]+'),(null|'[\w]+'),(null|'[\w]+'),(null|'[\w]+'),\s*'(\[[^']*\])','(\[[^']*\])',(null|'\w+'),(true|false)\)/g;
  for (const m of sql.matchAll(re)) {
    const lit = (v: string) => v === "null" ? null : v.slice(1, -1);
    out.set(m[1], {
      outcome: m[1] as Outcome, label: m[2],
      stage_real_estate: lit(m[4]), stage_consulting: lit(m[5]),
      enroll: lit(m[6]), draft_template: lit(m[7]),
      tags: JSON.parse(m[8]), tasks: JSON.parse(m[9]),
      closes: lit(m[10]) as any, requires_reason: m[11] === "true",
    });
  }
  return out;
}
const cfgs = parseOutcomes();
const stages = new Set([...sql.matchAll(/\('([a-z_0-9]+)','[^']*',\d+,(?:true|false),(?:true|false),\d+\)/g)].map((m) => m[1]));
const templates = new Set([...sql.matchAll(/^\('([a-z_0-9]+)','[^']*','[^']*','(?:real_estate|business_consulting)'/gm)].map((m) => m[1]));
const autos = new Set([...sql.matchAll(/^\('([a-z_0-9]+)','\d\d [^']*'/gm)].map((m) => m[1]));

console.log("\nCONSULTATION OUTCOMES\n");
console.log(`  parsed ${cfgs.size} outcomes\n`);

console.log("all twelve outcomes are configured");
const ALL: Outcome[] = ["hot_lead","follow_up","proposal_required","buyer_representation",
  "listing_opportunity","referral_needed","consulting_opportunity","long_term_nurture",
  "not_qualified","not_ready","closed_lost","client"];
for (const o of ALL) check(`  ${o}`, cfgs.has(o));

console.log("\nevery reference resolves");
for (const [key, c] of cfgs) {
  if (c.stage_real_estate) check(`${key} RE stage`, stages.has(c.stage_real_estate), c.stage_real_estate);
  if (c.stage_consulting)  check(`${key} consulting stage`, stages.has(c.stage_consulting), c.stage_consulting);
  if (c.enroll)            check(`${key} automation`, autos.has(c.enroll), c.enroll);
  if (c.draft_template)    check(`${key} draft template`, templates.has(c.draft_template), c.draft_template);
}

const ctx = (o: any = {}) => ({
  interest: "real_estate" as const, hasOpportunity: true,
  lostReason: null, callNotes: null, ...o });

console.log("\nplanning behaviour");
let p = planOutcome("hot_lead", cfgs.get("hot_lead"), ctx({ callNotes: "Wants to buy in Unionville by spring, financing already arranged." }));
check("hot lead moves stage", p.stage === "consultation_complete", p.stage);
check("hot lead enrols the cadence", p.enroll === "re_hot_followup", p.enroll);
check("hot lead tagged hot", p.tags.includes("hot"));
check("recap drafted from real notes", p.draft?.template === "re_post_consult");
check("draft always needs review", p.draft?.requiresReview === true);
check("lifecycle becomes active opportunity", p.lifecycle === "active_opportunity", p.lifecycle);

p = planOutcome("hot_lead", cfgs.get("hot_lead"), ctx({ callNotes: null }));
check("no notes means no invented recap", p.draft === undefined);
check("instead it asks Kaylin to write it", p.tasks.some((t) => /yourself/.test(t.title)));

p = planOutcome("hot_lead", cfgs.get("hot_lead"), ctx({ callNotes: "ok" }));
check("a two-word note is not enough to draft from", p.draft === undefined);

console.log("\nsection 74: a loss needs a reason");
p = planOutcome("closed_lost", cfgs.get("closed_lost"), ctx());
check("closing without a reason is refused", p.errors.length === 1, p.errors);
check("and nothing else is planned", !p.stage && p.tasks.length === 0);
p = planOutcome("closed_lost", cfgs.get("closed_lost"), ctx({ lostReason: "chose_another_realtor" }));
check("with a reason it proceeds", p.errors.length === 0 && p.closes === "lost", p.errors);
check("lifecycle becomes lost", p.lifecycle === "lost", p.lifecycle);
p = planOutcome("not_qualified", cfgs.get("not_qualified"), ctx());
check("not_qualified also requires a reason", p.errors.length === 1);

console.log("\nbranch by interest");
p = planOutcome("proposal_required", cfgs.get("proposal_required"),
  ctx({ interest: "business_consulting" }));
check("consulting gets the consulting stage", p.stage === "proposal_preparation", p.stage);
p = planOutcome("proposal_required", cfgs.get("proposal_required"), ctx({ interest: "real_estate" }));
check("no real-estate stage for a proposal", p.stage === undefined, p.stage);
p = planOutcome("listing_opportunity", cfgs.get("listing_opportunity"), ctx());
check("listing raises a CMA task", p.tasks.some((t) => /market analysis/i.test(t.title)));
check("listing task has a due date", p.tasks[0].dueInMs === 2 * 24 * 3600_000, p.tasks[0].dueInMs);

console.log("\nguards");
p = planOutcome("hot_lead", cfgs.get("hot_lead"), ctx({ hasOpportunity: false }));
check("no opportunity, no stage move", p.stage === undefined && p.errors.length === 1, p.errors);
p = planOutcome("hot_lead", undefined, ctx());
check("an unknown outcome errors rather than guessing", p.errors.length === 1);

console.log("\nsection 75: stale detection");
const base = { temperature: "warm", lifecycle: "inquiry", hoursSinceActivity: 1,
               hasOpenTask: true, hasNextAction: true, stageKey: "connected" };
check("healthy record is not flagged", staleReason(base) === null);
check("hot and quiet 48h", staleReason({ ...base, temperature: "hot", hoursSinceActivity: 49 })
      === "Hot lead with no activity for 48 hours");
check("hot at 47h is not yet stale", staleReason({ ...base, temperature: "hot", hoursSinceActivity: 47 }) === null);
check("consult done, no follow-up", staleReason({ ...base, consultationDoneNoFollowUp: true })
      === "Consultation completed with no follow-up");
check("proposal sent, no task", staleReason({ ...base, proposalSentNoTask: true })
      === "Proposal sent with no next task");
check("qualified with no next action", staleReason({ ...base, hasOpenTask: false, hasNextAction: false })
      === "Qualified opportunity with no next action");
check("warm and untouched a fortnight", staleReason({ ...base, hoursSinceActivity: 15 * 24 })
      === "Warm lead untouched for two weeks");
check("clients are never chased", staleReason({ ...base, lifecycle: "client", temperature: "hot", hoursSinceActivity: 999 }) === null);
check("lost leads are never chased", staleReason({ ...base, lifecycle: "lost", hoursSinceActivity: 999 }) === null);

console.log("\nsection 26: hot lead cadence");
check("cadence is 1, 3, 7, 14, 30", HOT_LEAD_CADENCE_DAYS.join(",") === "1,3,7,14,30");
check("day 0 next is 1", nextFollowUp(0) === 1);
check("day 3 next is 7", nextFollowUp(3) === 7);
check("day 30 has no next", nextFollowUp(30) === null);

console.log(`\n${failures === 0 ? "All outcome tests passed." : `${failures} FAILURE(S)`}\n`);
if (failures) process.exit(1);
