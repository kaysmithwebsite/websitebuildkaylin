/**
 * Contact identity normalization. Pure functions, no DB/network — this is
 * what makes contact deduplication a database constraint (unique index on
 * the normalized value) rather than a hopeful `if` in application code.
 */

/** Trim + lowercase. "KAYLIN@Example.com" and " kaylin@example.com " match. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  return s === "" ? null : s;
}

/**
 * Digits only. "905-555-1234", "(905) 555-1234" and "+1 905 555 1234" all
 * normalize to "19055551234" / "9055551234" — a leading country code "1" is
 * stripped so both forms collide on purpose.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  let digits = (raw ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 10 ? digits : null;
}

/** Empty-string form fields ("" from an unfilled <select>) become null so the
 *  database stores a genuine absence instead of an empty string. */
export function nullIfEmpty(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s === "" ? null : s;
}
