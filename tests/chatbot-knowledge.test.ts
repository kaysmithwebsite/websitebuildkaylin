/**
 * The knowledge base must load, validate, and — this is the important
 * part — must not itself contain a fabricated price or a specific
 * government-program figure. "Pricing cannot be invented" and "availability
 * cannot be invented" are enforced two ways in this codebase: the
 * deterministic escalation layer (chatbot-intent.test.ts) intercepts the
 * visitor's question, and this test makes sure there is nothing for the
 * model to invent FROM even if it were asked directly.
 */
import { section, check, summary } from "./_harness.ts";
import { loadKnowledgeBase } from "../lib/chatbot/knowledge.ts";
import { buildSystemPrompt } from "../lib/chatbot/system-prompt.ts";

const kb = loadKnowledgeBase();

section("knowledge base loads and validates");
check("loads without throwing", !!kb);
check("has both brands", kb.organization.brands.length === 2);
check("real_estate brand present", kb.organization.brands.some((b) => b.slug === "real_estate"));
check("business_consulting brand present", kb.organization.brands.some((b) => b.slug === "business_consulting"));
check("has at least one FAQ", kb.faqs.length > 0);
check("has escalation triggers", kb.escalation_triggers.always_escalate.length > 0);

section("no fabricated pricing or availability in the knowledge base itself");
const priceLike = /\$\s?\d/; // a literal dollar figure anywhere pricing.guidance shouldn't have one
check("pricing.guidance names no dollar figure", !priceLike.test(kb.pricing.guidance));
check("pricing.status says pricing is not published", kb.pricing.status === "not_published");
check("government_programs.status flags figures as unverified", kb.government_programs.status === "unverified_do_not_state_figures");
check("booking.guidance forbids inventing availability",
  /never invent/i.test(kb.booking.guidance) && /availability/i.test(kb.booking.guidance));

section("system prompt embeds the safety rules, not just the facts");
const prompt = buildSystemPrompt(kb);
check("instructs never to invent missing information", /never invent/i.test(prompt));
check("instructs never to state a commission rate or price", /never state or estimate a commission/i.test(prompt));
check("instructs never to estimate a property's worth", /never estimate what a specific property is worth/i.test(prompt));
check("instructs never to promise appointment availability", /never state specific appointment availability/i.test(prompt));
check("instructs never to guarantee government programs", /never say a program, rebate or funding is guaranteed/i.test(prompt));
check("instructs no individualized legal/tax/financial advice", /never give individualized legal, tax, accounting or financial advice/i.test(prompt));
check("instructs the two brands are never mixed", /never mix the two brands/i.test(prompt));
check("carries the real contact email for real estate", prompt.includes("info@kaylinsmith.com"));
check("carries the real contact email for consulting", prompt.includes("kaysmithconsultinggroup@gmail.com"));

const { checks, failures } = summary();
console.log(`\nchatbot-knowledge: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
