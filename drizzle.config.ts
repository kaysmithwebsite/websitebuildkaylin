/**
 * drizzle-kit config. Used only to GENERATE SQL from db/schema.ts
 * (`npm run db:generate`) — Netlify Database applies migrations itself from
 * netlify/database/migrations/ on deploy (see DATABASE.md), so `drizzle-kit
 * push`/`migrate` are not part of this project's workflow. `dbCredentials`
 * below is required by drizzle-kit's config schema but is never dialed:
 * generation reads only db/schema.ts, no live connection needed.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle/generated",
  dbCredentials: {
    url: process.env.NETLIFY_DATABASE_URL ?? "postgres://placeholder/placeholder",
  },
});
