/**
 * Claude Lead Brief. Server-side only — this file must never be imported by
 * anything that ships to a browser. ANTHROPIC_API_KEY lives in Netlify
 * environment variables and is read here, nowhere else.
 *
 * Enrichment is secondary to lead capture: callers MUST treat a thrown error
 * here as non-fatal to ingestion (catch it, record ai_lead_analysis as
 * "failed", move on). See IMPLEMENTATION_STATUS.md, "capture first, enrich
 * third".
 */
import Anthropic from "@anthropic-ai/sdk";
import { LeadBriefSchema, type LeadBrief } from "./validation.ts";

const MODEL = "claude-sonnet-5";

export interface LeadBriefInput {
  businessLine: "real_estate" | "business_consulting";
  leadType: string;
  firstName: string | null;
  lastName: string | null;
  message: string | null;
  formFields: Record<string, string | undefined>;
  score: number;
  scoreReasons: string[];
}

const SYSTEM_PROMPT = `You are a lead-intelligence assistant for a real estate broker and business
consultant. You are given the raw facts from a web form submission. Produce a
concise, honest brief for the person who is about to call this lead. Do not
invent facts that are not present in the input. If information is missing,
say so plainly rather than guessing. Respond with JSON matching the given
schema only — no prose outside the JSON.`;

export async function generateLeadBrief(input: LeadBriefInput): Promise<LeadBrief> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey });

  const userPrompt = JSON.stringify({
    business_line: input.businessLine,
    lead_type: input.leadType,
    name: [input.firstName, input.lastName].filter(Boolean).join(" ") || "(not given)",
    message: input.message ?? "(none)",
    form_fields: input.formFields,
    deterministic_score: input.score,
    score_reasons: input.scoreReasons,
  }, null, 2);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Lead data:\n${userPrompt}\n\nRespond with JSON only, matching this shape:\n` +
        `{"lead_summary":"","intent":"","motivation":"","urgency":"",` +
        `"temperature":"cold|warm|hot","important_context":[],"likely_questions":[],` +
        `"likely_objections":[],"recommended_next_action":"","suggested_call_opener":"",` +
        `"follow_up_strategy":""}`,
    }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Claude returned no text content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(block.text));
  } catch (err) {
    throw new Error(`Claude response was not valid JSON: ${(err as Error).message}`);
  }

  const result = LeadBriefSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Claude response failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

/** Claude sometimes wraps JSON in a ```json fence despite instructions; strip it. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}
