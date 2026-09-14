/**
 * Zod schemas for the chat endpoint — everything crossing the browser/
 * function boundary, plus the knowledge base's own shape so a malformed
 * edit to content/chatbot-knowledge.json fails loudly at build/test time
 * rather than shipping a broken chatbot.
 */
import { z } from "zod";

export const ChatRole = z.enum(["user", "assistant"]);

export const ChatTurn = z.object({
  role: ChatRole,
  content: z.string().min(1).max(2000),
});
export type ChatTurn = z.infer<typeof ChatTurn>;

/** Request body the widget sends to /.netlify/functions/chat. */
export const ChatRequest = z.object({
  message: z.string().min(1, "message is required").max(1000, "message is too long"),
  // Prior turns only — the new message is passed separately as `message`.
  // Capped well below Claude's own limits; this is about not letting one
  // visitor balloon a single request, not about Claude's context window.
  history: z.array(ChatTurn).max(20).optional().default([]),
  pageUrl: z.string().max(500).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const ChatResponse = z.object({
  reply: z.string(),
  escalate: z.boolean(),
  suggestLead: z.boolean(),
});
export type ChatResponse = z.infer<typeof ChatResponse>;

/* ---------------------------------------------------------------------------
 * Knowledge base shape — see content/chatbot-knowledge.json.
 * ------------------------------------------------------------------------- */
const Brand = z.object({
  slug: z.enum(["real_estate", "business_consulting"]),
  name: z.string(),
  person: z.string(),
  email: z.string().email(),
  booking_url: z.string().url().nullable(),
}).passthrough();

export const KnowledgeBase = z.object({
  organization: z.object({
    brands: z.array(Brand).min(2),
    hours: z.string(),
  }),
  real_estate_services: z.array(z.object({ key: z.string(), title: z.string(), summary: z.string() })),
  consulting_services: z.array(z.object({ title: z.string(), summary: z.string() })),
  pricing: z.object({ status: z.string(), guidance: z.string() }),
  government_programs: z.object({ status: z.string(), guidance: z.string() }),
  booking: z.object({ real_estate: z.string(), consulting: z.string(), guidance: z.string() }),
  faqs: z.array(z.object({ topic: z.string(), q: z.string(), a: z.string() })),
  policies: z.record(z.string(), z.string()),
  escalation_triggers: z.object({
    description: z.string(),
    always_escalate: z.array(z.string()),
  }),
}).passthrough();
export type KnowledgeBase = z.infer<typeof KnowledgeBase>;
