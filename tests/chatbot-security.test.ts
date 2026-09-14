/**
 * ANTHROPIC_API_KEY must never appear in anything the browser downloads.
 * Scans every file that actually ships to a visitor (assets/js/*.js, and
 * dist/ if a build exists) — not just chatbot.js, in case a future edit
 * accidentally pastes a key into an unrelated file.
 */
import { section, check, summary } from "./_harness.ts";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{10,}/;
const ENV_NAME_PATTERN = /ANTHROPIC_API_KEY/;

function jsFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => join(dir, f));
}

section("no Anthropic key material in shipped client JS");
const clientFiles = [
  ...jsFilesUnder("assets/js"),
  ...jsFilesUnder("dist/assets/js"), // present only after `python3 build.py`; skipped otherwise
];
check("at least the source assets/js/*.js files were scanned", jsFilesUnder("assets/js").length > 0);

for (const file of clientFiles) {
  const content = readFileSync(file, "utf8");
  check(`${file}: no literal API key pattern`, !KEY_PATTERN.test(content));
  check(`${file}: does not even reference the ANTHROPIC_API_KEY env var name`, !ENV_NAME_PATTERN.test(content));
}

section("the server-side function reads the key only from process.env, never a literal");
const fnSource = readFileSync("netlify/functions/chat.mts", "utf8");
check("reads ANTHROPIC_API_KEY from process.env", /process\.env\.ANTHROPIC_API_KEY/.test(fnSource));
check("contains no literal key-shaped string", !KEY_PATTERN.test(fnSource));
check("never returns the raw error/stack to the client (no err.stack in a Response body)",
  !/json\(\{[^}]*err\.(stack|message)/.test(fnSource));

const { checks, failures } = summary();
console.log(`\nchatbot-security: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
