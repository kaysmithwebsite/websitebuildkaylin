/**
 * Regression test for a real bug caught while wiring the chatbot into
 * form_routes: real estate and business consulting both use "consultation"
 * as a lead_type, so a branching form (general-contact, chatbot-intake)
 * seeding one row per (business line, lead_type) produced two rows with the
 * identical matchLeadType "consultation" — violating the unique index and
 * silently dropping one business line's route via onConflictDoNothing. See
 * db/seed.ts:matchKeyFor.
 */
import { section, check, summary } from "./_harness.ts";
import { resolveRoute, type FormRoute } from "../lib/routing.ts";

let n = 0;
const route = (over: Partial<FormRoute>): FormRoute => ({
  id: `route-${++n}`, formName: "chatbot-intake", matchLeadType: "", businessLine: "real_estate",
  leadType: "buyer", pipelineSlug: "real_estate", notifyEmail: "info@kaylinsmith.com", active: true,
  ...over,
});

// Mirrors db/seed.ts:matchKeyFor's disambiguated keys — NOT the bare
// "consultation" both business lines would naively produce.
const ROUTES: FormRoute[] = [
  route({ matchLeadType: "real_estate_consultation", leadType: "consultation", businessLine: "real_estate", notifyEmail: "info@kaylinsmith.com" }),
  route({ matchLeadType: "business_consultation", leadType: "consultation", businessLine: "business_consulting", notifyEmail: "kaysmithconsultinggroup@gmail.com" }),
  route({ matchLeadType: "buyer", leadType: "buyer", businessLine: "real_estate" }),
  route({ matchLeadType: "strategy", leadType: "strategy", businessLine: "business_consulting", notifyEmail: "kaysmithconsultinggroup@gmail.com" }),
];

section("disambiguated consultation keys resolve to the right business line");
check("real_estate_consultation -> real_estate brand, consultation lead type", (() => {
  const r = resolveRoute("chatbot-intake", "real_estate_consultation", ROUTES);
  return r.matched && r.route.businessLine === "real_estate" && r.route.leadType === "consultation";
})());
check("business_consultation -> business_consulting brand, consultation lead type", (() => {
  const r = resolveRoute("chatbot-intake", "business_consultation", ROUTES);
  return r.matched && r.route.businessLine === "business_consulting" && r.route.leadType === "consultation";
})());
check("the two consultation routes notify different inboxes (never cross-brand)", (() => {
  const re = resolveRoute("chatbot-intake", "real_estate_consultation", ROUTES);
  const biz = resolveRoute("chatbot-intake", "business_consultation", ROUTES);
  return re.matched && biz.matched && re.route.notifyEmail !== biz.route.notifyEmail;
})());
check("a bare, unqualified 'consultation' is NOT guessed into either brand", (() => {
  const r = resolveRoute("chatbot-intake", "consultation", ROUTES);
  return !r.matched && r.reason === "unknown_lead_type";
})());
check("non-ambiguous lead types are unaffected by disambiguation", (() => {
  const r = resolveRoute("chatbot-intake", "strategy", ROUTES);
  return r.matched && r.route.businessLine === "business_consulting";
})());

const { checks, failures } = summary();
console.log(`\nrouting-disambiguation: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
