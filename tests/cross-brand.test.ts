import { section, check, summary } from "./_harness.ts";
import { validateSendAllowed } from "../lib/cross-brand.ts";

section("validateSendAllowed");
check("same brand throughout -> allowed", validateSendAllowed({
  leadBrandSlug: "real_estate", templateBrandSlug: "real_estate", mailboxBrandSlug: "real_estate",
}).allowed === true);
check("same brand throughout (consulting) -> allowed", validateSendAllowed({
  leadBrandSlug: "consulting", templateBrandSlug: "consulting", mailboxBrandSlug: "consulting",
}).allowed === true);

check("real estate lead, consulting template -> BLOCKED", validateSendAllowed({
  leadBrandSlug: "real_estate", templateBrandSlug: "consulting", mailboxBrandSlug: "real_estate",
}).allowed === false);
check("real estate lead, consulting mailbox -> BLOCKED", validateSendAllowed({
  leadBrandSlug: "real_estate", templateBrandSlug: "real_estate", mailboxBrandSlug: "consulting",
}).allowed === false);
check("consulting lead, real estate mailbox -> BLOCKED (the exact incident this guards against)", validateSendAllowed({
  leadBrandSlug: "consulting", templateBrandSlug: "consulting", mailboxBrandSlug: "real_estate",
}).allowed === false);

check("a blocked decision carries a human-readable reason", (() => {
  const d = validateSendAllowed({ leadBrandSlug: "real_estate", templateBrandSlug: "consulting", mailboxBrandSlug: "real_estate" });
  return !d.allowed && typeof d.reason === "string" && d.reason.length > 0;
})());

const { checks, failures } = summary();
console.log(`\ncross-brand: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
