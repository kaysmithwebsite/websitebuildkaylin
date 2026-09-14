import { section, check, summary } from "./_harness.ts";
import { ChatRequest, ChatResponse } from "../lib/chatbot/validation.ts";

section("ChatRequest — the boundary the endpoint actually trusts");
check("accepts a normal message", ChatRequest.safeParse({ message: "What areas do you serve?" }).success === true);
check("rejects an empty message", ChatRequest.safeParse({ message: "" }).success === false);
check("rejects a missing message", ChatRequest.safeParse({}).success === false);
check("rejects an oversized message (>1000 chars)", ChatRequest.safeParse({ message: "a".repeat(1001) }).success === false);
check("accepts a message right at the limit (1000 chars)", ChatRequest.safeParse({ message: "a".repeat(1000) }).success === true);
check("history defaults to an empty array", (() => {
  const r = ChatRequest.safeParse({ message: "hi" });
  return r.success && Array.isArray(r.data.history) && r.data.history.length === 0;
})());
check("rejects history longer than 20 turns", ChatRequest.safeParse({
  message: "hi",
  history: Array.from({ length: 21 }, () => ({ role: "user", content: "x" })),
}).success === false);
check("rejects an invalid role in history", ChatRequest.safeParse({
  message: "hi", history: [{ role: "system", content: "x" }],
}).success === false);
check("rejects a non-string message (e.g. an object, a common injection attempt)",
  ChatRequest.safeParse({ message: { toString: () => "hi" } }).success === false);

section("ChatResponse — what the endpoint promises the widget");
check("accepts a well-formed response", ChatResponse.safeParse({
  reply: "Kaylin serves Markham, Toronto and the GTA.", escalate: false, suggestLead: false,
}).success === true);
check("rejects a response missing escalate", ChatResponse.safeParse({ reply: "hi", suggestLead: false }).success === false);

const { checks, failures } = summary();
console.log(`\nchatbot-validation: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
