# Netlify Forms

Netlify Forms is the first-party, public lead-capture layer. It needs no
database and no API key, so lead capture never depends on anything else in
this stack being configured correctly — see "capture first" in
`IMPLEMENTATION_STATUS.md`.

## The ten approved forms

Seeded in `db/seed.ts` → `form_routes`, configured in `data/site.json` →
`netlify_forms`, declared for Netlify's crawler in `build.py` →
`netlify_form_stubs()`:

| Netlify form name | Business line | Lead type | Notify |
|---|---|---|---|
| `real-estate-buyer` | real_estate | buyer | info@kaylinsmith.com |
| `real-estate-seller` | real_estate | seller | info@kaylinsmith.com |
| `real-estate-investor` | real_estate | investor | info@kaylinsmith.com |
| `real-estate-home-valuation` | real_estate | home_valuation | info@kaylinsmith.com |
| `real-estate-consultation` | real_estate | consultation | info@kaylinsmith.com |
| `business-consultation` | business_consulting | consultation | kaysmithconsultinggroup@gmail.com |
| `business-strategy` | business_consulting | strategy | kaysmithconsultinggroup@gmail.com |
| `business-operations` | business_consulting | operations | kaysmithconsultinggroup@gmail.com |
| `business-crm-automation` | business_consulting | crm_automation | kaysmithconsultinggroup@gmail.com |
| `general-contact` | — decided by the visitor's own `lead_type` selection — |

`general-contact` never guesses: an unrecognized or missing `lead_type` is
recorded in `rejected_submissions` (reason `unknown_lead_type`) rather than
routed anywhere. Same for a `form_name` that isn't one of the ten above
(reason `unknown_form`) — see `lib/routing.ts`.

## Why the visible forms don't look like this

The public site has three real, hand-built lead forms (the progressive
"inquiry" form used across most pages, a short real-estate form, and a
consulting form — see `build.py`: `inquiry_form()`, `real_estate_form()`,
`consulting_form()`), none of which use these ten form names or this exact
field schema directly. Rewriting all three to match field-for-field was a
larger, riskier change to the working public site than this session's
budget justified, so instead:

- **`assets/js/forms.js`:`mapToLeadPayload(form, record)`** is the one
  place that translates whichever of the three internal record shapes a
  visible form produced into the canonical field set and one of the ten
  form names, at submit time. It's a pure mapping — see the function body
  for the exact rules per `data-table` value (`crm_inquiries`, `leads`,
  `business_enquiries`).
- **`netlify_form_stubs()`** (`build.py`) emits ten hidden,
  `data-netlify="true"` forms — one per approved name, sharing the
  canonical field list (`NETLIFY_FIELDS`) — once per page, purely so
  Netlify's build-time HTML crawler registers all ten names and their
  schema. They are never rendered for a person to fill in
  (`hidden aria-hidden="true" tabindex="-1"`); the *visible* form is always
  submitted by `fetch()`, which is exactly why Netlify would never see it
  without these stubs.

If a form's field names are ever changed to match the canonical set
directly, `mapToLeadPayload` for that form becomes a straight passthrough
and can be simplified — nothing else needs to change.

## Canonical field set

Declared in `NETLIFY_FIELDS` (`build.py`) and `RawFormData` (`lib/validation.ts`) —
keep both in sync if either changes:

```
business_line, lead_type, first_name, last_name, email, phone, message,
timeline, budget, mortgage_pre_approved, has_realtor, property_address,
company_name, company_website, support_needed_by, challenge, established_company,
form_version, landing_page, page_url, referrer,
utm_source, utm_medium, utm_campaign, utm_content, utm_term,
submission_timestamp, site_name, consent
```

`business_line` is accepted but not authoritative — the resolved
`form_routes` row decides business line, never the raw field (so a
tampered or stale client value can't misroute a lead).

## Submission flow

```
visible form (fetch, url-encoded, same-origin POST to "/")
  → Netlify's form-processing pipeline (spam filtering, honeypot check)
  → "submission-created" event
  → netlify/functions/submission-created.mts (this project's function)
```

Netlify invokes a function named exactly `submission-created` automatically
whenever any Netlify Form on the site is submitted — a stable, filename-based
convention unrelated to the function's own modern `export default` shape.
**Not yet verified against a real deploy** (see `IMPLEMENTATION_STATUS.md`,
BLOCKED — no deploy has succeeded past the billing limit this session). If
it does not fire after the next successful deploy, the fallback is a
Netlify Forms **Outgoing Webhook** (Project configuration → Forms →
Notifications → Outgoing webhook) pointed at this function's own HTTP
path — the function's logic is identical either way, since it already just
reads a JSON body.

## Idempotency and spam

- **Idempotency**: `external_submissions` has a unique index on
  `(provider, provider_submission_id)` using Netlify's own submission id.
  A redelivered webhook re-runs the function, but every downstream write is
  itself idempotent (dedup on email/phone, `ON CONFLICT DO NOTHING` on
  score events, a select-before-insert on the one-open-lead and
  one-live-automation-run constraints) — see `DATABASE.md`.
- **Spam**: every form carries `data-netlify-honeypot="bot-field"`. A
  non-empty `bot-field` value is also checked explicitly in
  `submission-created.mts` and recorded in `rejected_submissions` (reason
  `spam_honeypot`) rather than silently dropped — auditable, never
  invisible.

## Field encoding

Netlify Forms submissions from JavaScript **must** be URL-encoded
(`application/x-www-form-urlencoded`), not JSON — `submitToNetlify()` in
`forms.js` does this. A hidden `<input name="form-name" value="...">`
matching the target form's declared name must be present in the encoded
body; `mapToLeadPayload`'s returned `formName` is what supplies it.
