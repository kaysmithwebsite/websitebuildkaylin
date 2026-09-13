import { section, check, summary } from "./_harness.ts";
import { normalizeEmail, normalizePhone, nullIfEmpty } from "../lib/normalize.ts";

section("normalizeEmail");
check("trims and lowercases", normalizeEmail("  KAYLIN@Example.com ") === "kaylin@example.com");
check("KAYLIN@example.com === kaylin@example.com", normalizeEmail("KAYLIN@example.com") === normalizeEmail("kaylin@example.com"));
check("empty string -> null", normalizeEmail("") === null);
check("null -> null", normalizeEmail(null) === null);
check("undefined -> null", normalizeEmail(undefined) === null);

section("normalizePhone");
check("905-555-1234 -> 9055551234", normalizePhone("905-555-1234") === "9055551234");
check("(905) 555-1234 -> 9055551234", normalizePhone("(905) 555-1234") === "9055551234");
check("+1 905 555 1234 -> 9055551234", normalizePhone("+1 905 555 1234") === "9055551234");
check("all three forms match", (() => {
  const a = normalizePhone("905-555-1234");
  const b = normalizePhone("(905) 555-1234");
  const c = normalizePhone("+1 905 555 1234");
  return a === b && b === c;
})());
check("too short -> null", normalizePhone("555-1234") === null);
check("empty -> null", normalizePhone("") === null);

section("nullIfEmpty");
check("whitespace-only -> null", nullIfEmpty("   ") === null);
check("real value passes through", nullIfEmpty(" hello ") === "hello");
check("undefined -> null", nullIfEmpty(undefined) === null);

const { checks, failures } = summary();
console.log(`\nnormalize: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
