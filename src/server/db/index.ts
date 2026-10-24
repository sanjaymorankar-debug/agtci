import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getEnv } from "@/lib/env";
import { handlePoolErrors, poolConfig } from "./connection";
import * as schema from "./schema";

// Reuse one pool across hot reloads in development so `next dev` doesn't
// open a new set of connections every time this module is re-evaluated.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

// Runtime traffic uses DATABASE_URL: on Neon, the pooled endpoint.
const pool =
  globalForDb.pgPool ??
  handlePoolErrors(new Pool(poolConfig(getEnv().DATABASE_URL, { max: 10 })), "app");

if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export type DbClient = typeof db;
