/**
 * Exercises netlify/functions/chat.mts directly via its own default export
 * with a synthetic Request — no server needed, same technique as
 * tests/integration/ingestion.test.ts. Unlike ingestion, this endpoint
 * touches no database, so method/input validation and the deterministic
 * escalation layer are fully testable here without any live infrastructure.
 * Only the "a real question gets a real answer" case needs a live
 * ANTHROPIC_API_KEY, and skips cleanly without one — never a fake pass.
 */
import { section, check, summary } from "../_harness.ts";

// A minimal Context stand-in — chat.mts only reads context.ip.
function fakeContext(ip = "203.0.113.1"): any {
  return { ip };
}

function req(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  const { default: handler } = await import("../../netlify/functions/chat.mts");

  section("method and input validation — no API key needed for any of this");
  {
    const res = await handler(req("GET"), fakeContext());
    check("GET is rejected (405)", res.status === 405);
  }
  {
    const res = await handler(req("DELETE"), fakeContext());
    check("DELETE is rejected (405)", res.status === 405);
  }
  {
    const res = await handler(req("POST", { message: "" }), fakeContext());
    check("empty message is rejected (400)", res.status === 400);
  }
  {
    const res = await handler(req("POST", {}), fakeContext());
    check("missing message is rejected (400)", res.status === 400);
  }
  {
    const res = await handler(req("POST", { message: "a".repeat(5000) }), fakeContext());
    check("oversized message (5000 chars) is rejected (400)", res.status === 400);
  }
  {
    const badReq = new Request("http://localhost/api/chat", { method: "POST", body: "not json" });
    const res = await handler(badReq, fakeContext());
    check("malformed JSON body is rejected (400)", res.status === 400);
  }

  section("deterministic escalation short-circuits before any Claude call");
  {
    const res = await handler(req("POST", { message: "What is my house worth?" }), fakeContext());
    const body = await res.json() as Record<string, unknown>;
    check("valuation question returns 200 with escalate=true", res.status === 200 && body.escalate === true);
    check("escalation reply never invents a number", typeof body.reply === "string" && !/\$\d/.test(body.reply as string));
    check("escalation reply offers to connect with the team", /team/i.test(body.reply as string));
  }
  {
    const res = await handler(req("POST", { message: "How much do you charge?" }), fakeContext());
    const body = await res.json() as Record<string, unknown>;
    check("pricing question returns 200 with escalate=true (never invents a price)", res.status === 200 && body.escalate === true);
  }

  section("a real question, against the real Claude API");
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("\nSKIPPED: ANTHROPIC_API_KEY is not set in this environment.");
    console.log("  Run this after setting it in Netlify's environment variables (see CHATBOT.md).");
  } else {
    const res = await handler(req("POST", { message: "What areas do you serve?" }), fakeContext());
    const body = await res.json() as Record<string, unknown>;
    check("a grounded question returns 200", res.status === 200);
    check("the reply mentions the real service area (Markham)", typeof body.reply === "string" && /markham/i.test(body.reply as string));
    check("no diagnosis/guarantee language leaks through for an unrelated grounded question", !/guarantee/i.test((body.reply as string) || ""));
  }

  const { checks, failures } = summary();
  console.log(`\nintegration/chatbot-endpoint: ${checks - failures}/${checks} passed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
