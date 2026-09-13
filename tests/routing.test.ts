import { section, check, summary } from "./_harness.ts";
import { resolveRoute, type FormRoute } from "../lib/routing.ts";

const RE_EMAIL = "info@kaylinsmith.com";
const BIZ_EMAIL = "kaysmithconsultinggroup@gmail.com";

let n = 0;
const route = (over: Partial<FormRoute>): FormRoute => ({
  id: `route-${++n}`, formName: "x", matchLeadType: "", businessLine: "real_estate",
  leadType: "buyer", pipelineSlug: "real_estate", notifyEmail: RE_EMAIL, active: true,
  ...over,
});

// The exact set specified in the master prompt.
const ROUTES: FormRoute[] = [
  route({ formName: "real-estate-buyer", leadType: "buyer", notifyEmail: RE_EMAIL }),
  route({ formName: "real-estate-seller", leadType: "seller", notifyEmail: RE_EMAIL }),
  route({ formName: "real-estate-investor", leadType: "investor", notifyEmail: RE_EMAIL }),
  route({ formName: "real-estate-home-valuation", leadType: "home_valuation", notifyEmail: RE_EMAIL }),
  route({ formName: "real-estate-consultation", leadType: "consultation", notifyEmail: RE_EMAIL }),
  route({ formName: "business-consultation", leadType: "consultation", businessLine: "business_consulting", pipelineSlug: "business_consulting", notifyEmail: BIZ_EMAIL }),
  route({ formName: "business-strategy", leadType: "strategy", businessLine: "business_consulting", pipelineSlug: "business_consulting", notifyEmail: BIZ_EMAIL }),
  route({ formName: "business-operations", leadType: "operations", businessLine: "business_consulting", pipelineSlug: "business_consulting", notifyEmail: BIZ_EMAIL }),
  route({ formName: "business-crm-automation", leadType: "crm_automation", businessLine: "business_consulting", pipelineSlug: "business_consulting", notifyEmail: BIZ_EMAIL }),
  // general-contact branches
  route({ formName: "general-contact", matchLeadType: "buyer", leadType: "buyer", notifyEmail: RE_EMAIL }),
  route({ formName: "general-contact", matchLeadType: "seller", leadType: "seller", notifyEmail: RE_EMAIL }),
  route({ formName: "general-contact", matchLeadType: "consultation", leadType: "consultation", businessLine: "business_consulting", pipelineSlug: "business_consulting", notifyEmail: BIZ_EMAIL }),
  route({ formName: "inactive-form", leadType: "buyer", active: false }),
];

section("dedicated real estate forms");
check("real-estate-buyer -> real_estate/buyer/info@kaylinsmith.com", (() => {
  const r = resolveRoute("real-estate-buyer", null, ROUTES);
  return r.matched && r.route.businessLine === "real_estate" && r.route.leadType === "buyer" && r.route.notifyEmail === RE_EMAIL;
})());
check("real-estate-seller -> seller", (() => {
  const r = resolveRoute("real-estate-seller", null, ROUTES);
  return r.matched && r.route.leadType === "seller";
})());
check("real-estate-investor -> investor", (() => {
  const r = resolveRoute("real-estate-investor", null, ROUTES);
  return r.matched && r.route.leadType === "investor";
})());
check("real-estate-home-valuation -> home_valuation", (() => {
  const r = resolveRoute("real-estate-home-valuation", null, ROUTES);
  return r.matched && r.route.leadType === "home_valuation";
})());
check("real-estate-consultation -> consultation", (() => {
  const r = resolveRoute("real-estate-consultation", null, ROUTES);
  return r.matched && r.route.leadType === "consultation";
})());
check("a fixed-route form ignores a stray lead_type field", (() => {
  const r = resolveRoute("real-estate-buyer", "seller", ROUTES);
  return r.matched && r.route.leadType === "buyer";
})());

section("dedicated business consulting forms");
check("business-consultation -> business_consulting/consultation/kaysmithconsultinggroup@gmail.com", (() => {
  const r = resolveRoute("business-consultation", null, ROUTES);
  return r.matched && r.route.businessLine === "business_consulting" && r.route.notifyEmail === BIZ_EMAIL;
})());
check("business-strategy -> strategy", (() => {
  const r = resolveRoute("business-strategy", null, ROUTES);
  return r.matched && r.route.leadType === "strategy";
})());
check("business-operations -> operations", (() => {
  const r = resolveRoute("business-operations", null, ROUTES);
  return r.matched && r.route.leadType === "operations";
})());
check("business-crm-automation -> crm_automation", (() => {
  const r = resolveRoute("business-crm-automation", null, ROUTES);
  return r.matched && r.route.leadType === "crm_automation";
})());

section("general-contact — explicit selection determines routing, never guessed");
check("general-contact + buyer -> real_estate/buyer", (() => {
  const r = resolveRoute("general-contact", "buyer", ROUTES);
  return r.matched && r.route.businessLine === "real_estate" && r.route.leadType === "buyer";
})());
check("general-contact + consultation -> business_consulting", (() => {
  const r = resolveRoute("general-contact", "consultation", ROUTES);
  return r.matched && r.route.businessLine === "business_consulting";
})());
check("general-contact + unrecognized lead_type -> unmatched, reason unknown_lead_type", (() => {
  const r = resolveRoute("general-contact", "something-made-up", ROUTES);
  return !r.matched && r.reason === "unknown_lead_type";
})());
check("general-contact + no lead_type at all -> unmatched, never silently guessed", (() => {
  const r = resolveRoute("general-contact", null, ROUTES);
  return !r.matched && r.reason === "unknown_lead_type";
})());

section("unknown / inactive forms");
check("completely unknown form_name -> unmatched, reason unknown_form", (() => {
  const r = resolveRoute("some-form-that-does-not-exist", null, ROUTES);
  return !r.matched && r.reason === "unknown_form";
})());
check("inactive route is not selected", (() => {
  const r = resolveRoute("inactive-form", null, ROUTES);
  return !r.matched && r.reason === "unknown_form";
})());

const { checks, failures } = summary();
console.log(`\nrouting: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
