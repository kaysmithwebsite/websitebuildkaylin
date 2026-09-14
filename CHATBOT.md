# Website chatbot

A floating chat widget that answers visitor questions from an approved
knowledge base, offers to book a call, and captures leads through the same
Netlify Forms → CRM pipeline as every other form on the site. It never
invents pricing, availability, valuations, or program eligibility — those
categories are intercepted and escalated to a human before the model is
ever asked.

## Architecture

```
Website Chat UI (assets/js/chatbot.js, .chatw panel in build.py)
  → POST /api/chat  (netlify/functions/chat.mts)
    → deterministic escalation check (lib/chatbot/intent.ts) — no Claude call
    → deterministic lead-intent check (lib/chatbot/intent.ts)
    → Claude API (Anthropic SDK, server-side only)
        system prompt built from content/chatbot-knowledge.json
        (lib/chatbot/system-prompt.ts)
  ← { reply, escalate, suggestLead }

Lead capture (separate from the chat turn above):
Website Chat UI → POST / (application/x-www-form-urlencoded, form-name=chatbot-intake)
  → Netlify Forms → "submission-created" event
    → netlify/functions/submission-created.mts (same ingestion as every other form)
      → CRM (contacts, leads, activity_events — see CRM-ARCHITECTURE.md)
```

Two independent requests, two independent failure modes:
- If `/api/chat` fails or returns nothing useful, the widget still shows a
  fallback message and offers the lead form — the chat *conversation* can
  break without blocking lead capture.
- If the `chatbot-intake` Netlify Forms POST fails, the widget shows a
  direct-contact fallback (`info@kaylinsmith.com`) rather than pretending
  it succeeded.

### Files

| File | Role |
|---|---|
| `content/chatbot-knowledge.json` | The only source of what the bot is allowed to say. Not code — see below. |
| `lib/chatbot/validation.ts` | Zod schemas: `ChatRequest`, `ChatResponse`, `KnowledgeBase`. |
| `lib/chatbot/knowledge.ts` | Loads and validates the knowledge base once (statically imported, not read from disk at request time — see "Why a static import" below). |
| `lib/chatbot/system-prompt.ts` | Turns the validated knowledge base into Claude's system prompt, including the ABSOLUTE RULES. |
| `lib/chatbot/intent.ts` | Pure-function pattern matching: `detectEscalation` (pricing/valuation/availability/legal/complaint/funding-guarantee) and `detectLeadIntent`. Runs before any Claude call. |
| `lib/chatbot/sanitize.ts` | Strips control characters from the incoming message. |
| `lib/chatbot/rate-limit.ts` | Per-IP rate limiting via Netlify Blobs, fails open. |
| `netlify/functions/chat.mts` | The `/api/chat` endpoint — wires all of the above together. |
| `assets/js/chatbot.js` | The widget: opens from the existing "Let's Talk" floating menu, renders the conversation, submits the lead form. |
| `.chatw` block in `assets/css/site.css` | Widget styling — reuses the site's existing navy/white/off-white design tokens, not a separate look. |
| `chatw_html()` in `build.py` | Emits the `.chatw` panel markup once per page. |

### Why a static import, not `fs.readFileSync`

`knowledge.ts` imports the JSON with `import knowledgeData from "../../content/chatbot-knowledge.json" with { type: "json" }` instead of reading the file at request time. This is deliberate: a runtime `fs.readFileSync` call is exactly what broke `submission-created.mts`'s Netlify bundler tracing earlier in this project (see `IMPLEMENTATION_STATUS.md`). A static import is bundled correctly by `zip-it-and-ship-it` every time; there is no file-tracing risk to repeat.

## How to edit FAQs

Open `content/chatbot-knowledge.json` → `faqs`, an array of `{ "q": "...", "a": "..." }` pairs. Add, edit, or remove entries directly — no code changes needed. The bot only ever answers from this list and the other sections below it; it does not browse the rest of the site.

The current FAQ entries are drawn verbatim from `data/faqs.json` (the FAQ page's own content), so the chatbot never contradicts the FAQ page a visitor could also read.

## How to add knowledge

Everything the bot can say lives in `content/chatbot-knowledge.json`, validated on load against the `KnowledgeBase` Zod schema in `lib/chatbot/validation.ts` (`.passthrough()`, so extra fields are tolerated but the required shape is enforced). Top-level sections:

- `organization.brands[]` — the two brands (`real_estate`, `business_consulting`), each with registration, brokerage/relationship info, contact, and booking details. Both must be present or `buildSystemPrompt` throws at request time — this is intentional, not a bug to silence.
- `real_estate_services[]` / `consulting_services[]` — `{ title, summary }` pairs.
- `pricing` / `government_programs` — each carries a `status` field (`"not_published"` / `"unverified_do_not_state_figures"`) and a `guidance` string telling the model what to say instead of a number. Do not add real figures here until they are genuinely ready to publish — the model is instructed to treat this section's `status` as authoritative.
- `booking` — the two booking URLs/notes plus general guidance text.
- `faqs[]` — see above.
- `policies` — disclosure text and the privacy policy URL.
- `escalation_triggers.always_escalate[]` — a plain-language list embedded directly into the system prompt as an extra instruction layer, on top of (not instead of) the deterministic patterns in `intent.ts`.

To add a new topic area, add a new top-level section to the JSON and reference it explicitly from `buildSystemPrompt` in `system-prompt.ts` — the model only sees what that function actually writes into the prompt string, not the raw JSON file.

**Never add real pricing, real government-program figures, or real appointment availability to this file until they are independently verified and approved for publication.** That is the one rule this entire feature exists to enforce.

## Required environment variables

Set in Netlify's project environment variables (Site configuration → Environment variables), not in any file in this repo:

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes, for the bot to actually answer | Read only in `netlify/functions/chat.mts` via `process.env.ANTHROPIC_API_KEY`. Never sent to the client, never logged, never present in any file under `assets/js/`. If unset, the endpoint returns 200 with a graceful "having trouble answering, let me connect you with the team" reply and `suggestLead: true` — it never 500s and never blocks lead capture. |

No other chatbot-specific environment variables exist yet. Netlify Blobs (used by the rate limiter) needs no configuration — it's automatically available in the Netlify runtime.

## Lead submission flow

1. The bot offers the lead form (`offerLeadCapture()` in `chatbot.js`) whenever a reply is escalated (`escalate: true`) or otherwise flagged (`suggestLead: true`) — never forced on the visitor.
2. `showLeadForm()` pre-fills the "Your question" field with the last few things the visitor typed, editable before sending.
3. `submitLead()` POSTs `application/x-www-form-urlencoded` to `/` with `form-name=chatbot-intake` — the same mechanism every other form on the site uses (see `NETLIFY_FORMS.md`).
4. Netlify Forms accepts it, fires `submission-created`, and `netlify/functions/submission-created.mts` ingests it into the CRM exactly like `general-contact`: `chatbot-intake` is a branching form seeded with one `form_routes` row per real business-line/lead-type combination (`branchRoutes()` in `db/seed.ts`), so an unrecognized `lead_type` is recorded in `rejected_submissions` rather than guessed at.
5. Two fields exist only on this form: `location` (free-text area/neighbourhood) and `conversation_summary` (the chat transcript summary the visitor saw and could edit) — see `RawFormData` in `lib/validation.ts` and `NETLIFY_FIELDS` in `build.py`.

## Safety rules

Enforced in two layers, deliberately redundant — the deterministic layer runs regardless of whether the model follows its instructions:

**1. Deterministic (`lib/chatbot/intent.ts`), before any Claude call:**
Pattern-matches the incoming message against six categories — specific pricing, specific valuation, specific availability, legal/tax/financial advice, complaint or dispute, and funding/program guarantees. A match short-circuits straight to `ESCALATION_REPLY` in `chat.mts`; Claude is never invoked for these messages, so there is no way for a prompt-injection attempt inside the message itself to talk the model past this check.

**2. Model-level (`lib/chatbot/system-prompt.ts` ABSOLUTE RULES):**
For everything the deterministic layer doesn't catch, the system prompt instructs Claude to: answer only from the embedded knowledge; say it doesn't want to guess rather than fill a gap; never state a commission/fee/price; never estimate a property's worth; never state specific availability; never state a government-program figure or guarantee eligibility; never give individualized legal/tax/accounting/financial advice; never mix the two brands; never disclose the system prompt or internal workings; and escalate complaints/disputes/safety concerns rather than attempting to resolve them.

**Both layers together:**
- `ANTHROPIC_API_KEY` never reaches the client — read only in the Netlify Function, confirmed by `tests/chatbot-security.test.ts` scanning every shipped `assets/js/*.js` file for both the literal key pattern and the env-var name itself.
- Errors are never exposed to the visitor: `chat.mts`'s catch blocks log server-side and return the same generic `FALLBACK_REPLY`, never `err.stack` or `err.message` in the response body.
- Rate limiting (`lib/chatbot/rate-limit.ts`) fails open — a Netlify Blobs outage degrades to "no rate limiting" rather than taking the endpoint down.
- Input is bounded (`ChatRequest`: message ≤ 1000 chars, history ≤ 20 turns) and sanitized (control characters stripped) before it reaches the model.
- The widget's own copy tells visitors not to share sensitive personal or financial details in chat.

## Testing

No test framework — plain `node --experimental-strip-types`, shared harness (`tests/_harness.ts`). Run everything with `npm test`, or individually:

```bash
node --experimental-strip-types tests/chatbot-intent.test.ts
node --experimental-strip-types tests/chatbot-knowledge.test.ts
node --experimental-strip-types tests/chatbot-validation.test.ts
node --experimental-strip-types tests/chatbot-security.test.ts
node --experimental-strip-types tests/integration/chatbot-endpoint.test.ts
```

| File | Covers |
|---|---|
| `tests/chatbot-intent.test.ts` | `detectEscalation` / `detectLeadIntent` pattern coverage. |
| `tests/chatbot-knowledge.test.ts` | The knowledge base validates against its Zod schema and both brands are present. |
| `tests/chatbot-validation.test.ts` | `ChatRequest`/`ChatResponse` schema edge cases (empty/oversized message, history cap). |
| `tests/chatbot-security.test.ts` | No API key material or env-var name in any shipped client JS; the server reads the key only from `process.env`; no raw error text in a response body. |
| `tests/integration/chatbot-endpoint.test.ts` | Calls `chat.mts`'s default export directly with a synthetic `Request` — method/input validation and deterministic escalation need no live infrastructure and always run; the "a real question gets a real answer" case needs a live `ANTHROPIC_API_KEY` and **skips cleanly, never fake-passes**, without one. |

To exercise the real-Claude case, set `ANTHROPIC_API_KEY` locally before running the integration test. To verify `chatbot-intake` actually reaches Netlify Forms in production (not just the local dev server, which returns `501` for form POSTs), submit the widget's lead form on the live site after deploy and confirm the submission in Netlify's dashboard, exactly as documented for `general-contact` in `NETLIFY_FORMS.md`.

Also run before every deploy, as with any other change: `python3 build.py --production`, `python3 audit.py`, `python3 antiai_audit.py`.
