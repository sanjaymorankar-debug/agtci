/**
 * The schema, against a real PostgreSQL.
 *
 * CI already proves two things these tests do not repeat: that the committed
 * migrations apply to an empty database, and that src/server/db/schema.ts has
 * not drifted from them (it runs `drizzle-kit generate` and fails on a diff).
 * Those two compare files and DDL. They never run a query.
 *
 * What is left unverified by them, and is what this file covers: that the ORM
 * can actually read and write every table against the migrated database, that
 * the defaults and constraints declared in the schema exist in it rather than
 * only in TypeScript, and that the enum types refuse a value outside their
 * list. A column renamed in the schema and regenerated correctly satisfies
 * both CI checks and still breaks every query that names the old one.
 *
 * Skipped unless TEST_DATABASE_URL is set, so `npm test` works with no server:
 *
 *   cp .env.test.example .env.test   # points at the local devstack
 *   npm run test:db
 */
import test from "node:test";
import assert from "node:assert/strict";

import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import * as schema from "@/server/db/schema";

const URL = process.env.TEST_DATABASE_URL;
const opts = URL ? {} : { skip: "TEST_DATABASE_URL is not set (see .env.test.example)" };

type Db = NodePgDatabase<typeof schema>;

/**
 * The SQLSTATE behind a failed drizzle query.
 *
 * drizzle wraps driver errors in a DrizzleQueryError, which carries no code of
 * its own -- the `pg` DatabaseError is on `.cause`. Worth knowing beyond these
 * tests: code that wants to turn a duplicate slug into "that slug is taken"
 * rather than a 500 has to unwrap the same way.
 */
function sqlstate(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause?.code ?? (err as { code?: string }).code;
}

/**
 * An empty database with the committed migrations applied, closed when the
 * test ends. Builds its own pool rather than importing src/server/db/index.ts,
 * which creates one at module load from getEnv() and offers no way to close it
 * -- a test importing it would never exit.
 */
async function freshDb(t: { after: (fn: () => unknown) => void }): Promise<{ db: Db; pool: Pool }> {
  const pool = new Pool({ connectionString: URL!, max: 2 });
  t.after(() => pool.end());

  // Dropping the tables is not enough to reset this database. The three
  // pgEnum types live in `public` and survive their tables, so the next
  // CREATE TYPE fails; and drizzle records applied migrations in a separate
  // `drizzle` schema, so leaving that behind makes migrate() decide there is
  // nothing to do. Dropping both schemas outright handles all three.
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await pool.query("CREATE SCHEMA public");

  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, pool };
}

test("every table the schema declares is queryable after migrating", opts, async (t) => {
  const { db } = await freshDb(t);
  // Resolves every column name server-side without needing any rows: a schema
  // naming a column the migration never created fails here.
  await db.select().from(schema.adminUsers).limit(0);
  await db.select().from(schema.categories).limit(0);
  await db.select().from(schema.products).limit(0);
  await db.select().from(schema.leads).limit(0);
  await db.select().from(schema.certifications).limit(0);
  await db.select().from(schema.services).limit(0);
  await db.select().from(schema.siteContent).limit(0);
  await db.select().from(schema.auditLogs).limit(0);
});

test("re-running the migrations is a no-op rather than an error", opts, async (t) => {
  const { db } = await freshDb(t);
  // db:migrate runs on every deploy, so the second run matters as much as the
  // first. The enum types are what make this worth asserting: CREATE TYPE is
  // not idempotent, so a migration replayed against a database that already
  // has them would fail if drizzle's bookkeeping were ever lost.
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.select().from(schema.categories).limit(0);
});

test("a category round-trips, and its declared defaults are the database's", opts, async (t) => {
  const { db } = await freshDb(t);
  const [row] = await db.insert(schema.categories)
    .values({ name: "Spices", slug: "spices" })
    .returning();

  // The id was not supplied: it comes from the column's gen_random_uuid()
  // default, which only exists if the migration carried it across.
  assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(row.name, "Spices");
  assert.equal(row.sortOrder, 0);
  assert.equal(row.isActive, true);
  assert.equal(row.description, null);
  assert.ok(row.createdAt instanceof Date, "created_at should come back as a Date");
});

test("a unique slug is enforced, not merely declared", opts, async (t) => {
  const { db } = await freshDb(t);
  await db.insert(schema.categories).values({ name: "First", slug: "dup" });
  await assert.rejects(
    db.insert(schema.categories).values({ name: "Second", slug: "dup" }),
    (err: unknown) => {
      // 23505 unique_violation. Asserting the SQLSTATE rather than the message
      // keeps this from breaking on a server locale change.
      assert.equal(sqlstate(err), "23505");
      return true;
    },
  );
});

test("a product's jsonb columns and its category foreign key behave", opts, async (t) => {
  const { db } = await freshDb(t);
  const [category] = await db.insert(schema.categories)
    .values({ name: "Pulses", slug: "pulses" }).returning();

  const [row] = await db.insert(schema.products).values({
    categoryId: category.id, name: "Toor Dal", slug: "toor",
    grades: ["A", "B"], specifications: [{ label: "Moisture", value: "12%" }],
  }).returning();

  // jsonb is the column type most likely to survive a bad migration while
  // quietly changing shape, so assert the values and not just that they exist.
  assert.deepEqual(row.grades, ["A", "B"]);
  assert.deepEqual(row.specifications, [{ label: "Moisture", value: "12%" }]);
  assert.deepEqual(row.images, []);          // declared default
  assert.equal(row.exportAvailable, true);
  assert.equal(row.isFeatured, false);

  // onDelete: "restrict" is the whole reason a product cannot be orphaned.
  await assert.rejects(
    db.delete(schema.categories).where(eq(schema.categories.id, category.id)),
    (err: unknown) => {
      assert.equal(sqlstate(err), "23503");  // foreign_key_violation
      return true;
    },
  );
});

test("the lead enum types accept every declared value and refuse others", opts, async (t) => {
  const { db } = await freshDb(t);
  const [row] = await db.insert(schema.leads)
    .values({ source: "PRODUCT_QUOTE", fullName: "A Buyer", email: "buyer@example.test" })
    .returning();

  assert.equal(row.source, "PRODUCT_QUOTE");
  assert.equal(row.status, "NEW");           // declared default
  assert.deepEqual(row.attachments, []);

  // Every value in the exported lists has to exist in its enum type, or the
  // admin UI offers a status the database rejects. Unlike MySQL's inline
  // ENUM, these are named types shared by column and TypeScript union, so a
  // value added to one list and not regenerated fails right here.
  for (const status of schema.LEAD_STATUSES) {
    await db.update(schema.leads).set({ status }).where(eq(schema.leads.id, row.id));
  }
  for (const source of schema.LEAD_SOURCES) {
    await db.update(schema.leads).set({ source }).where(eq(schema.leads.id, row.id));
  }

  await assert.rejects(
    db.update(schema.leads)
      .set({ status: "NOT_A_STATUS" as (typeof schema.LEAD_STATUSES)[number] })
      .where(eq(schema.leads.id, row.id)),
    (err: unknown) => {
      // 22P02 invalid_text_representation. Note this is the same SQLSTATE
      // PostgreSQL gives for a malformed uuid, so the code alone does not say
      // which it was -- it is asserted here only as "the column refused it".
      assert.equal(sqlstate(err), "22P02");
      return true;
    },
  );
});

test("site_content's jsonb payload round-trips under its text primary key", opts, async (t) => {
  const { db } = await freshDb(t);
  // `key` needed quoting on MySQL, where it is reserved; in PostgreSQL it is
  // not reserved, so that particular hazard is gone. What is worth keeping is
  // the jsonb round-trip on the one table whose whole purpose is an arbitrary
  // payload the admin panel edits without a schema change.
  await db.insert(schema.siteContent)
    .values({ key: "homepage.hero", value: { title: "Sourcing", nested: { ok: true } } });

  const [row] = await db.select().from(schema.siteContent)
    .where(eq(schema.siteContent.key, "homepage.hero"));
  assert.deepEqual(row.value, { title: "Sourcing", nested: { ok: true } });
  assert.ok(row.updatedAt instanceof Date);
});

test("an audit log row may have no actor", opts, async (t) => {
  const { db } = await freshDb(t);
  // actor_id is nullable and references admin_users; a system action has no
  // actor, so the foreign key must permit NULL rather than demanding a user.
  const [row] = await db.insert(schema.auditLogs)
    .values({ action: "seed", entityType: "system", previousValue: null, newValue: { ok: true } })
    .returning();

  assert.equal(row.actorId, null);
  assert.deepEqual(row.newValue, { ok: true });
});

test("timestamptz keeps the same instant across a session time-zone change", opts, async (t) => {
  const { db, pool } = await freshDb(t);
  const written = new Date("2026-03-04T05:06:07.000Z");
  const [ins] = await db.insert(schema.categories)
    .values({ name: "Dated", slug: "dated", createdAt: written }).returning();
  assert.equal(ins.createdAt.getTime(), written.getTime());

  // One pinned connection, because SET TIME ZONE is per-session and a pool
  // would hand the second query a different one.
  const client = await pool.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");
    const utc = (await client.query(
      "SELECT created_at, created_at::text AS as_text FROM categories WHERE slug = 'dated'")).rows[0];
    await client.query("SET TIME ZONE 'Asia/Kolkata'");
    const kolkata = (await client.query(
      "SELECT created_at, created_at::text AS as_text FROM categories WHERE slug = 'dated'")).rows[0];

    // The point of `withTimezone: true`: the stored value is an instant, so
    // the session zone changes how it RENDERS and not what it IS. Measured
    // rather than assumed -- the rendered text really does move.
    assert.equal((utc.created_at as Date).getTime(), written.getTime());
    assert.equal((kolkata.created_at as Date).getTime(), written.getTime());
    assert.notEqual(utc.as_text, kolkata.as_text);
    assert.match(kolkata.as_text as string, /\+05:30$/);
  } finally {
    client.release();
  }
});

test("the migration really did create enum types, not check constraints", opts, async (t) => {
  const { db } = await freshDb(t);
  // pgEnum compiles to a named type. If a future schema edit replaced one with
  // a plain text column, every test above would still pass -- the ORM would
  // accept the same values -- while the database stopped refusing bad ones.
  const rows = await db.execute(sql`
    SELECT t.typname AS name
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype = 'e' AND n.nspname = 'public'
    ORDER BY t.typname`);
  assert.deepEqual(rows.rows.map((r) => r.name), ["admin_role", "lead_source", "lead_status"]);
});
