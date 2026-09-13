import { section, check, summary } from "./_harness.ts";
import { NetlifySubmissionEnvelope, RawFormData, LeadBriefSchema } from "../lib/validation.ts";

section("NetlifySubmissionEnvelope");
check("accepts a realistic Netlify submission-created payload", NetlifySubmissionEnvelope.safeParse({
  payload: {
    id: "abc123", form_name: "real-estate-buyer", created_at: "2026-09-13T00:00:00Z",
    data: { first_name: "Test", last_name: "Buyer", email: "test@example.com" },
  },
}).success === true);
check("rejects a payload missing the Netlify submission id", NetlifySubmissionEnvelope.safeParse({
  payload: { form_name: "real-estate-buyer", data: {} },
}).success === false);
check("rejects a payload missing form_name", NetlifySubmissionEnvelope.safeParse({
  payload: { id: "abc123", data: {} },
}).success === false);
check("data defaults to {} when omitted", (() => {
  const r = NetlifySubmissionEnvelope.safeParse({ payload: { id: "x", form_name: "y" } });
  return r.success && JSON.stringify(r.data.payload.data) === "{}";
})());

section("RawFormData");
check("accepts an empty object (every field optional)", RawFormData.safeParse({}).success === true);
check("passthrough keeps fields not explicitly declared", (() => {
  const r = RawFormData.safeParse({ some_future_field: "x" });
  return r.success && (r.data as Record<string, unknown>).some_future_field === "x";
})());

section("LeadBriefSchema — the AI Lead Brief contract");
const VALID_BRIEF = {
  lead_summary: "First-time buyer, pre-approved, looking in the next 60 days.",
  intent: "buy", motivation: "growing family needs more space", urgency: "high",
  temperature: "hot", important_context: ["pre-approved for $750K"],
  likely_questions: ["What is the current inventory like?"],
  likely_objections: ["Concerned about rates"],
  recommended_next_action: "Call within the hour",
  suggested_call_opener: "Hi, I saw you're looking to buy in the next couple of months...",
  follow_up_strategy: "Daily contact until a showing is booked",
};
check("accepts a well-formed brief", LeadBriefSchema.safeParse(VALID_BRIEF).success === true);
check("rejects an invalid temperature value", LeadBriefSchema.safeParse({
  ...VALID_BRIEF, temperature: "lukewarm",
}).success === false);
check("rejects a brief missing a required field", LeadBriefSchema.safeParse((() => {
  const { follow_up_strategy, ...rest } = VALID_BRIEF;
  return rest;
})()).success === false);
check("rejects important_context that is not an array", LeadBriefSchema.safeParse({
  ...VALID_BRIEF, important_context: "not an array",
}).success === false);

const { checks, failures } = summary();
console.log(`\nvalidation: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
