import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { handlePoolErrors, poolConfig } from "./connection";

async function main() {
  // Schema changes go over the direct endpoint. On Neon that is
  // DATABASE_URL_UNPOOLED; a local database or CI only sets DATABASE_URL.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set.");
  const pool = handlePoolErrors(new Pool(poolConfig(url, { max: 1 })), "migrate");
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
