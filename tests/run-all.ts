#!/usr/bin/env node
/**
 * Runs every *.test.ts in this directory (and tests/integration/) as its own
 * process — each file already sets process.exitCode on failure — and
 * reports a final pass/fail summary. `npm test`.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".test.ts"))
    .map((e) => join(dir, e.name))
    .sort();
}

const files = [...testFiles("tests"), ...testFiles("tests/integration")];

let failed = 0;
for (const file of files) {
  console.log(`\n=== ${file} ===`);
  try {
    execFileSync("node", ["--experimental-strip-types", file], { stdio: "inherit" });
  } catch {
    failed++;
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`${files.length - failed}/${files.length} test files passed`);
if (failed > 0) process.exit(1);
