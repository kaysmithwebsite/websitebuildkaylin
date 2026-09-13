/**
 * Drizzle client, wired to Netlify Database via @netlify/database's
 * getConnectionString(). No connection string is ever hand-configured or
 * hard-coded: Netlify provisions it automatically per deploy/branch (see
 * DATABASE.md).
 *
 * Truly lazy: `getConnectionString()` only works inside a Netlify Function
 * or `netlify dev` — it throws in a plain `node` process. Importing this
 * module must not throw just because nothing has queried yet, so both the
 * pool and the Drizzle instance are created on first property access via a
 * Proxy, not at import time. Pure logic (lib/, tests/) can therefore import
 * from "../db/schema.ts" directly without ever touching this file.
 */
import { getConnectionString } from "@netlify/database";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

let _pool: pg.Pool | undefined;
let _db: NodePgDatabase<typeof schema> | undefined;

function real(): NodePgDatabase<typeof schema> {
  if (!_db) {
    _pool = new pg.Pool({ connectionString: getConnectionString() });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

export const db: NodePgDatabase<typeof schema> = new Proxy({}, {
  get(_target, prop, receiver) {
    return Reflect.get(real() as object, prop, receiver);
  },
}) as NodePgDatabase<typeof schema>;

export * as schema from "./schema.ts";
