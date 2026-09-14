import { section, check, summary } from "./_harness.ts";
import { detectLeadIntent, detectEscalation } from "../lib/chatbot/intent.ts";

section("detectLeadIntent — obvious signals start the intake offer");
[
  "I want to start",
  "How do I register?",
  "I need services",
  "Can someone call me?",
  "I'd like to book a consultation",
  "I want to buy a house",
  "I need help buying a home",
  "I'd like to work with you",
  "Let's talk",
].forEach((msg) => check(`"${msg}" -> lead intent`, detectLeadIntent(msg) === true));

check("plain FAQ question is NOT lead intent", detectLeadIntent("How much do I need for a down payment?") === false);
check("small talk is NOT lead intent", detectLeadIntent("Thanks, that's helpful") === false);

section("detectEscalation — deterministic safety triggers, never left to the model alone");
check("pricing question escalates", detectEscalation("How much do you charge?").escalate === true);
check("pricing escalation reason is specific_pricing", detectEscalation("What's your commission rate?").reason === "specific_pricing");
check("valuation question escalates", detectEscalation("What is my house worth?").escalate === true);
check("availability question escalates", detectEscalation("Are you available tomorrow?").escalate === true);
check("legal advice request escalates", detectEscalation("I need legal advice about this contract").escalate === true);
check("complaint escalates", detectEscalation("I have a complaint about the service").escalate === true);
check("funding guarantee question escalates", detectEscalation("Do I qualify for the first-time buyer rebate?").escalate === true);

check("a normal FAQ question does not escalate", detectEscalation("What does a real estate consultant do?").escalate === false);
check("an ordinary greeting does not escalate", detectEscalation("Hi, I have a question about Markham").escalate === false);

// Pricing can never be invented: the deterministic layer intercepts before
// the model ever generates a number.
check("no code path lets a pricing question skip escalation", (() => {
  const variants = ["how much does it cost", "what's your fee", "your price", "what do you charge"];
  return variants.every((v) => detectEscalation(v).escalate === true);
})());

const { checks, failures } = summary();
console.log(`\nchatbot-intent: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
