/**
 * Zod schemas for everything crossing a trust boundary: an inbound Netlify
 * Forms submission, and the Claude Lead Brief response. Validate first,
 * touch the database second.
 */
import { z } from "zod";

/* ---------------------------------------------------------------------------
 * Netlify Forms "submission-created" payload.
 * Netlify's own envelope is stable and only loosely typed here — `data` is
 * whatever the HTML form posted, entirely untrusted. `id` is the Netlify
 * submission id and is the idempotency key (db/schema.ts:
 * external_submissions.provider_submission_id).
 * ------------------------------------------------------------------------- */
export const NetlifySubmissionEnvelope = z.object({
  payload: z.object({
    id: z.string().min(1),
    form_name: z.string().min(1),
    created_at: z.string().optional(),
    data: z.record(z.string(), z.unknown()).default({}),
    human_fields: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type NetlifySubmissionEnvelope = z.infer<typeof NetlifySubmissionEnvelope>;

/**
 * Every field the public forms are asked to send (see NETLIFY_FORMS.md).
 * Everything is a plain string because that is what an HTML form posts;
 * coercion (booleans, numbers, enums) happens in lib/routing.ts and
 * netlify/functions/submission-created.mts, deliberately kept out of this
 * schema so an unexpected value fails soft (becomes null / "review_required")
 * rather than rejecting the whole submission and losing the lead.
 */
export const RawFormData = z.object({
  "bot-field": z.string().optional(),           // honeypot; non-empty = spam
  business_line: z.string().optional(),
  lead_type: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  message: z.string().optional(),

  // real estate
  timeline: z.string().optional(),               // "immediately" | "within_30_days" | "1_3_months" | ...
  budget: z.string().optional(),
  mortgage_pre_approved: z.string().optional(),   // "yes" | "no" | ""
  has_realtor: z.string().optional(),             // "yes" | "no" | ""
  property_address: z.string().optional(),        // seller / valuation forms

  // business consulting
  company_name: z.string().optional(),
  company_website: z.string().optional(),
  support_needed_by: z.string().optional(),       // "now" | "within_30_days" | "1_3_months" | "exploring"
  challenge: z.string().optional(),
  established_company: z.string().optional(),     // "yes" | "no" | ""

  // chatbot
  location: z.string().optional(),                 // free-text area/neighbourhood, chatbot-intake only
  conversation_summary: z.string().optional(),      // chatbot-intake only — the chat transcript summary shown to and editable by the visitor before sending

  // attribution / metadata
  form_version: z.string().optional(),
  landing_page: z.string().optional(),
  page_url: z.string().optional(),
  referrer: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_content: z.string().optional(),
  utm_term: z.string().optional(),
  submission_timestamp: z.string().optional(),
  site_name: z.string().optional(),
  consent: z.string().optional(),                 // "true" | "" — checkbox
}).passthrough();
export type RawFormData = z.infer<typeof RawFormData>;

/* ---------------------------------------------------------------------------
 * Claude Lead Brief — server-side only, never sent to the browser unvalidated.
 * ------------------------------------------------------------------------- */
export const LeadBriefSchema = z.object({
  lead_summary: z.string(),
  intent: z.string(),
  motivation: z.string(),
  urgency: z.string(),
  temperature: z.enum(["cold", "warm", "hot"]),
  important_context: z.array(z.string()),
  likely_questions: z.array(z.string()),
  likely_objections: z.array(z.string()),
  recommended_next_action: z.string(),
  suggested_call_opener: z.string(),
  follow_up_strategy: z.string(),
});
export type LeadBrief = z.infer<typeof LeadBriefSchema>;
