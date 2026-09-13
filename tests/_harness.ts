/**
 * Minimal shared test harness, matching the style already used in
 * tools_engine_test.ts / tools_flow_test.ts / tools_outcome_test.ts — no
 * external test framework, run directly with
 * `node --experimental-strip-types`.
 */
let failures = 0;
let checks = 0;

export function check(name: string, cond: boolean, got?: unknown): void {
  checks++;
  if (cond) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}${got !== undefined ? `  (got ${JSON.stringify(got)})` : ""}`);
}

export function section(name: string): void {
  console.log(`\n${name}`);
}

export function summary(): { checks: number; failures: number } {
  return { checks, failures };
}

export function reset(): void {
  failures = 0;
  checks = 0;
}
