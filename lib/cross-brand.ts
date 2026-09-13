/**
 * Cross-brand send guard (Phase 7 requirement: real estate communication must
 * never originate from the consulting mailbox, and vice versa). Pure
 * function so it is unit-testable without a mail provider — call this and
 * refuse to send on anything but `allowed: true`, regardless of how
 * confident the calling code feels.
 *
 * Not wired to a real send path yet: Gmail is not connected (see
 * GOOGLE_INTEGRATION.md). This exists now so the guard — and its tests —
 * ship with the schema, before there is any way to send an email at all.
 */

export interface BrandSendContext {
  /** The brand the lead/contact belongs to, e.g. from leads.brand_id. */
  leadBrandSlug: string;
  /** The brand the chosen email template was authored for. */
  templateBrandSlug: string;
  /** The brand that owns the Gmail mailbox about to be used. */
  mailboxBrandSlug: string;
}

export type SendDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export function validateSendAllowed(ctx: BrandSendContext): SendDecision {
  const { leadBrandSlug, templateBrandSlug, mailboxBrandSlug } = ctx;

  if (templateBrandSlug !== leadBrandSlug) {
    return {
      allowed: false,
      reason: `Template brand "${templateBrandSlug}" does not match lead brand "${leadBrandSlug}".`,
    };
  }
  if (mailboxBrandSlug !== leadBrandSlug) {
    return {
      allowed: false,
      reason: `Mailbox brand "${mailboxBrandSlug}" does not match lead brand "${leadBrandSlug}".`,
    };
  }
  return { allowed: true };
}
