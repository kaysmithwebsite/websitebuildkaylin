#!/usr/bin/env node
/**
 * Netlify Database applies migrations from
 * netlify/database/migrations/<timestamp>_<slug>/migration.sql on every
 * deploy (production) or new preview deploy (branches) — see DATABASE.md.
 * drizzle-kit's own `generate` writes flat *.sql files under
 * drizzle/generated/ instead. This script bridges the two: run it after
 * `npm run db:generate` (or it runs generate itself) and it copies whatever
 * is new in drizzle/generated/ into a fresh, correctly-named Netlify
 * migration directory.
 *
 * Usage:
 *   node --experimental-strip-types scripts/sync-migrations.ts <slug>
 *
 * This never edits or removes a migration directory that already exists —
 * Netlify Database migrations are meant to be append-only, same as any
 * other Postgres migration tool.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const slug = process.argv[2];
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error("Usage: node --experimental-strip-types scripts/sync-migrations.ts <lowercase-hyphenated-slug>");
  process.exit(1);
}

const genDir = "drizzle/generated";
const netlifyDir = "netlify/database/migrations";

console.log(`Running drizzle-kit generate --name ${slug} ...`);
execFileSync("npx", ["drizzle-kit", "generate", "--name", slug], { stdio: "inherit" });

const sqlFiles = readdirSync(genDir).filter((f) => f.endsWith(".sql")).sort();
const latest = sqlFiles[sqlFiles.length - 1];
if (!latest) {
  console.error("No generated SQL file found — did the schema actually change?");
  process.exit(1);
}

// Netlify sorts migration directories lexicographically, so a UTC timestamp
// prefix keeps this one after every existing migration regardless of when
// this script runs.
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const destDir = join(netlifyDir, `${stamp}_${slug}`);

if (existsSync(destDir)) {
  console.error(`${destDir} already exists — refusing to overwrite. Wait a minute and retry, or rename.`);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(join(genDir, latest), join(destDir, "migration.sql"));

console.log(`Wrote ${join(destDir, "migration.sql")}`);
console.log("Review the SQL before committing — Netlify applies this automatically on the next deploy.");
