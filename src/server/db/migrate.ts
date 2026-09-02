import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set.");
  const connection = await mysql.createConnection(url);
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await connection.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
