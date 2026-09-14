/**
 * WEBSITE CHATBOT ENDPOINT
 *
 * Website Chat UI -> this function -> Claude API (server-side only) ->
 * approved knowledge (content/chatbot-knowledge.json) -> response.
 *
 * ANTHROPIC_API_KEY is read only here, from Netlify's environment
 * variables, and never returned to the client. This is a normal (not
 * event-triggered) function, so — unlike submission-created.mts — it is
 * allowed to declare a custom `config.path`.
 */
import type { Context, Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { ChatRequest, ChatResponse, type ChatTurn } from "../../lib/chatbot/validation.ts";
import { loadKnowledgeBase } from "../../lib/chatbot/knowledge.ts";
import { buildSystemPrompt } from "../../lib/chatbot/system-prompt.ts";
import { detectEscalation, detectLeadIntent } from "../../lib/chatbot/intent.ts";
import { sanitizeMessage } from "../../lib/chatbot/sanitize.ts";
import { checkRateLimit } from "../../lib/chatbot/rate-limit.ts";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 400;

const ESCALATION_REPLY =
  "I don't want to guess about that. I can send your question straight to Kaylin's team if you'd like — want me to take your contact details?";
const FALLBACK_REPLY =
  "Sorry, I'm having trouble answering right now. I can still help you send a message to our team.";

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const ip = context.ip || "unknown";
  const rl = await checkRateLimit(ip);
  if (!rl.allowed) {
    return json(
      { reply: "You're sending messages a little fast — please wait a moment and try again.", escalate: false, suggestLead: false },
      429,
      rl.retryAfterSeconds ? { "Retry-After": String(rl.retryAfterSeconds) } : undefined,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const parsed = ChatRequest.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid request" }, 400);
  }

  const message = sanitizeMessage(parsed.data.message);
  if (!message) {
    return json({ error: "message is empty" }, 400);
  }
  const history = parsed.data.history;

  // Deterministic safety check FIRST — never depends on the model
  // complying with the system prompt for these categories.
  const escalation = detectEscalation(message);
  if (escalation.escalate) {
    return json(
      { reply: ESCALATION_REPLY, escalate: true, suggestLead: true } satisfies ChatResponse,
      200,
    );
  }

  const leadIntent = detectLeadIntent(message);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No key configured — never fail silently, but also never expose why
    // to the visitor beyond the same honest fallback used for any AI failure.
    console.error("chat: ANTHROPIC_API_KEY is not configured");
    return json(
      { reply: FALLBACK_REPLY, escalate: false, suggestLead: true } satisfies ChatResponse,
      200,
    );
  }

  try {
    const kb = loadKnowledgeBase();
    const system = buildSystemPrompt(kb);
    const client = new Anthropic({ apiKey });

    const messages = [
      ...history.map((turn: ChatTurn) => ({ role: turn.role, content: turn.content })),
      { role: "user" as const, content: message },
    ];

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    });

    const block = response.content.find((b) => b.type === "text");
    const reply = block && block.type === "text" ? block.text.trim() : FALLBACK_REPLY;

    return json(
      { reply, escalate: false, suggestLead: leadIntent } satisfies ChatResponse,
      200,
    );
  } catch (err) {
    console.error("chat: Claude request failed", err instanceof Error ? err.message : err);
    return json(
      { reply: FALLBACK_REPLY, escalate: false, suggestLead: true } satisfies ChatResponse,
      200,
    );
  }
};

function json(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export const config: Config = {
  path: "/api/chat",
};
