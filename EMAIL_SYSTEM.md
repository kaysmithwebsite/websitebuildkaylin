# Email system

**Not built yet.** This document exists so the requirements that were given
during this session are not lost before implementation, and so
`email_messages` rows created today are read correctly (see below) rather
than mistaken for something they aren't.

## What exists today

`submission-created.mts` creates exactly one `email_messages` row per
processed lead: an internal notification, `status = 'queued'`,
`template_key = 'internal_notify_new_lead'`, `body_text` only (no HTML),
addressed to the lead's brand notify inbox
(`info@kaylinsmith.com` / `kaysmithconsultinggroup@gmail.com`). **Nothing
sends it.** It exists purely as an auditable record that ingestion decided
a human should be told about this lead — read it as "a notification was
queued," never as "an email was sent." A dashboard reading this table
should render `queued` rows honestly (e.g. "not yet sent — Gmail not
connected") rather than implying delivery.

No lead-facing acknowledgment or nurture email is queued or sent at all
today — the automation workflows that would trigger them are seeded but
have no runner (see `AUTOMATIONS.md`).

## Requirements captured for when this is built

### Every template ends with a booking CTA

Requested mid-session: every outbound email must end with a
**"Book an appointment with me"** call to action.

- `brands.booking_url` (schema + seed) already carries the URL:
  `https://calendly.com/kaylinsmithrealestate` for the real-estate brand.
  The consulting brand's `booking_url` is `null` — no consulting-specific
  Calendly link was supplied; get one before consulting emails ship, or
  explicitly decide to reuse the same link.
- The eventual `Signature` or `Footer` email component should read
  `brands.booking_url` for the lead's own brand and render the CTA from
  there — never hard-code the URL in a template, so updating it in one
  place (the brand row) updates every template automatically.

### Reusable components (from the master prompt, not yet built)

`LogoHeader`, `Hero`, `Heading`, `TextSection`, `CTAButton`,
`AppointmentCard`, `PropertyCard`, `ResourceCard`, `Signature`,
`UnsubscribeFooter`. Needs: responsive HTML, a plain-text fallback (every
`email_messages` row already has separate `body_html`/`body_text` columns,
ready for this), a preview/test-send path, template variables, and
versioning (`email_messages.template_key` is the seam for the last one —
render from the template keyed by that value, not by hard-coded content
per call site).

### Sender identity per brand

| Brand | Sender | Tone |
|---|---|---|
| Kaylin Smith Real Estate | Kaylin Smith \<info@kaylinsmith.com\> | premium, warm, local, personal, knowledgeable, polished |
| Kay Smith Consulting Group | Kay Smith Consulting Group \<kaysmithconsultinggroup@gmail.com\> | strategic, credible, polished, concise, approachable |

### Cross-brand protection

Before any real send exists, it must call
`lib/cross-brand.ts`:`validateSendAllowed()` and refuse to send on anything
but `{ allowed: true }`. Already implemented and tested (see `SECURITY.md`)
— the send path just doesn't exist yet to call it.

## Next step

Build the send path only after Gmail is connected (`GOOGLE_INTEGRATION.md`)
— there is no point building a template renderer with nothing that can
actually deliver its output. When it exists: render from `template_key`,
validate the resolved sender/template/lead brand triple with
`validateSendAllowed()`, write the rendered HTML/text back onto the
existing `email_messages` row before sending (not a new table), and flip
`status` from `queued` to `sent` only after the provider confirms.
