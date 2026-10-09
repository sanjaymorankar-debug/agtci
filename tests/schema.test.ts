/**
 * The schema, against a real MySQL.
 *
 * src/server/db/schema.ts (what the app queries through) and drizzle/*.sql
 * (what actually built the database) are two separate artefacts kept in step
 * by remembering to run `npm run db:generate`. Nothing checked that they
 * agree, and nothing had ever run the generated DDL: a column renamed in the
 * schema but not regenerated typechecks perfectly and fails at runtime with
 * "Unknown column".
 *
 * So this applies the committed migrations to an empty database exactly as
 * `npm run db:migrate` does in production, then writes and reads every table
 * through the schema. A disagreement between the two shows up as a MySQL
 * error rather than as a passing test.
 *
 * Skipped unless TEST_DATABASE_URL is set, so `npm test` works with no server:
 *
 *   cp .env.test.example .env.test   # points at the local devstack
 *   npm run test:db
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

import * as schema from "@/server/db/schema";

const URL = process.env.TEST_DATABASE_URL;
const opts = URL ? {} : { skip: "TEST_DATABASE_URL is not set (see .env.test.example)" };

type Db = MySql2Database<typeof schema>;

/**
 * The MySQL errno behind a failed drizzle query.
 *
 * drizzle wraps driver errors in a DrizzleQueryError, which carries no errno
 * of its own -- the mysql2 error is on `.cause`. Worth knowing beyond these
 * tests: any code that wants to turn a duplicate slug into "that slug is
 * taken" rather than a 500 has to unwrap the same way.
 */
function driverErrno(err: unknown): number | undefined {
  const cause = (err as { cause?: { errno?: number } }).cause;
  return cause?.errno ?? (err as { errno?: number }).errno;
}

/**
 * An empty database with the committed migrations applied, closed when the
 * test ends. Builds its own connection rather than importing
 * src/server/db/index.ts, which creates a pool at module load from getEnv()
 * and offers no way to close it — a test importing it would never exit.
 */
async function freshDb(t: { after: (fn: () => unknown) => void }): Promise<Db> {
  const connection = await mysql.createConnection(URL!);
  t.after(() => connection.end());

  // Drop everything, including drizzle's own bookkeeping table, so migrate()
  // runs the migrations rather than deciding they are already applied.
  // FOREIGN_KEY_CHECKS off because the drop order would otherwise matter.
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()",
  );
  if (rows.length) {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const row of rows) await connection.query(`DROP TABLE IF EXISTS \`${row.t}\``);
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  }

  const db = drizzle(connection, { schema, mode: "default" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

test("the committed migrations apply to an empty database", opts, async (t) => {
  const db = await freshDb(t);
  // Every table the schema declares must exist after migrating. `WHERE false`
  // asks MySQL to resolve each column name without needing any rows.
  await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, "none"));
  await db.select().from(schema.categories).where(eq(schema.categories.id, "none"));
  await db.select().from(schema.products).where(eq(schema.products.id, "none"));
  await db.select().from(schema.leads).where(eq(schema.leads.id, "none"));
  await db.select().from(schema.certifications).where(eq(schema.certifications.id, "none"));
  await db.select().from(schema.services).where(eq(schema.services.id, "none"));
  await db.select().from(schema.siteContent).where(eq(schema.siteContent.key, "none"));
  await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, "none"));
});

test("re-running the migrations is a no-op rather than an error", opts, async (t) => {
  const db = await freshDb(t);
  // `db:migrate` runs on every deploy, so the second run matters as much as
  // the first. drizzle tracks applied migrations in __drizzle_migrations.
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.select().from(schema.categories).where(eq(schema.categories.id, "none"));
});

test("a category round-trips, and its declared defaults are the database's", opts, async (t) => {
  const db = await freshDb(t);
  const id = randomUUID();
  await db.insert(schema.categories).values({ id, name: "Spices", slug: `spices-${id.slice(0, 8)}` });

  const [row] = await db.select().from(schema.categories).where(eq(schema.categories.id, id));
  assert.equal(row.name, "Spices");
  // Defaults declared in schema.ts only exist in the database if the
  // migration carried them across.
  assert.equal(row.sortOrder, 0);
  assert.equal(row.isActive, true);
  assert.ok(row.createdAt instanceof Date, "created_at should come back as a Date");
  assert.equal(row.description, null);
});

test("a unique slug is enforced, not merely declared", opts, async (t) => {
  const db = await freshDb(t);
  const slug = `dup-${randomUUID().slice(0, 8)}`;
  await db.insert(schema.categories).values({ id: randomUUID(), name: "First", slug });
  await assert.rejects(
    db.insert(schema.categories).values({ id: randomUUID(), name: "Second", slug }),
    (err: unknown) => {
      // 1062 is MySQL's duplicate-entry errno. Asserting the errno rather than
      // the message keeps this from breaking on a server locale change.
      assert.equal(driverErrno(err), 1062);
      return true;
    },
  );
});

test("a product's json columns and its category foreign key behave", opts, async (t) => {
  const db = await freshDb(t);
  const categoryId = randomUUID();
  await db.insert(schema.categories).values({
    id: categoryId, name: "Pulses", slug: `pulses-${categoryId.slice(0, 8)}`,
  });

  const id = randomUUID();
  await db.insert(schema.products).values({
    id, categoryId, name: "Toor Dal", slug: `toor-${id.slice(0, 8)}`,
    grades: ["A", "B"], specifications: [{ label: "Moisture", value: "12%" }],
  });

  const [row] = await db.select().from(schema.products).where(eq(schema.products.id, id));
  // json columns are the ones most likely to survive a bad migration while
  // silently changing shape, so assert the value and not just that it is set.
  assert.deepEqual(row.grades, ["A", "B"]);
  assert.deepEqual(row.specifications, [{ label: "Moisture", value: "12%" }]);
  assert.deepEqual(row.images, []);            // declared default ('[]')
  assert.equal(row.exportAvailable, true);
  assert.equal(row.isFeatured, false);

  // onDelete: "restrict" is the whole reason a product cannot be orphaned.
  await assert.rejects(
    db.delete(schema.categories).where(eq(schema.categories.id, categoryId)),
    (err: unknown) => {
      // 1451: cannot delete a parent row, a foreign key constraint fails.
      assert.equal(driverErrno(err), 1451);
      return true;
    },
  );
});

test("a lead's enums accept the declared values and refuse others", opts, async (t) => {
  const db = await freshDb(t);
  const id = randomUUID();
  await db.insert(schema.leads).values({
    id, source: "PRODUCT_QUOTE", fullName: "A Buyer", email: "buyer@example.test",
  });

  const [row] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
  assert.equal(row.source, "PRODUCT_QUOTE");
  assert.equal(row.status, "NEW");             // declared default
  assert.deepEqual(row.attachments, []);

  // Every status and source in the exported lists has to exist in the column's
  // enum, or the admin UI offers a value the database rejects.
  for (const status of schema.LEAD_STATUSES) {
    await db.update(schema.leads).set({ status }).where(eq(schema.leads.id, id));
  }
  for (const source of schema.LEAD_SOURCES) {
    await db.update(schema.leads).set({ source }).where(eq(schema.leads.id, id));
  }

  await assert.rejects(
    db.update(schema.leads)
      .set({ status: "NOT_A_STATUS" as (typeof schema.LEAD_STATUSES)[number] })
      .where(eq(schema.leads.id, id)),
    "an unknown status should be refused by the column, not just by TypeScript",
  );
});

test("site_content works despite `key` being a MySQL reserved word", opts, async (t) => {
  const db = await freshDb(t);
  // `key` is reserved. Drizzle quotes identifiers, so this is fine — but it is
  // exactly the column where hand-written SQL would hit errno 1064, and the
  // only way to know the generated DDL quoted it is to run it.
  await db.insert(schema.siteContent).values({ key: "homepage.hero", value: { title: "Sourcing" } });

  const [row] = await db.select().from(schema.siteContent)
    .where(eq(schema.siteContent.key, "homepage.hero"));
  assert.deepEqual(row.value, { title: "Sourcing" });
  assert.ok(row.updatedAt instanceof Date);
});

test("an audit log row may have no actor", opts, async (t) => {
  const db = await freshDb(t);
  const id = randomUUID();
  // actorId is nullable and references admin_users; a system action has none,
  // so the foreign key must permit NULL rather than demanding a user.
  await db.insert(schema.auditLogs).values({
    id, action: "seed", entityType: "system", previousValue: null, newValue: { ok: true },
  });

  const [row] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, id));
  assert.equal(row.actorId, null);
  assert.deepEqual(row.newValue, { ok: true });
});
