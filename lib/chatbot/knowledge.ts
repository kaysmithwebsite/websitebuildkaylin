/**
 * Loads and validates the approved knowledge base. Never fetches or scrapes
 * anything at runtime — content/chatbot-knowledge.json is the entire source
 * of truth, reviewed and edited by hand (see CHATBOT.md).
 *
 * Imported statically (not read via fs at runtime) so the file is a real
 * part of the module graph — a bundler resolves and includes it the same
 * way it would any other import, rather than needing to trace a dynamic
 * fs.readFileSync path, which is exactly the class of bug that broke the
 * CRM ingestion function's first deploy (see IMPLEMENTATION_STATUS.md).
 */
import knowledgeData from "../../content/chatbot-knowledge.json" with { type: "json" };
import { KnowledgeBase, type KnowledgeBase as KnowledgeBaseType } from "./validation.ts";

let cached: KnowledgeBaseType | undefined;

export function loadKnowledgeBase(): KnowledgeBaseType {
  if (!cached) cached = KnowledgeBase.parse(knowledgeData);
  return cached;
}
