#!/usr/bin/env node
/**
 * Database checks for agtci, run against a local, throwaway PostgreSQL
 * database. See TEST_SPEC.md (levels S3 and N).
 *
 *   node scripts/db-check.mjs                 the full check; the database must be empty
 *   node scripts/db-check.mjs --probes-only   only the behaviour probes, on a migrated database
 *   add --neon                                 Neon parity: also require TLS, and a role that is not a
 *                                              superuser and owns the database
 *
 * Reads DATABASE_URL_UNPOOLED, else DATABASE_URL. Refuses anything that is not
 * on this machine. The full check:
 *   1. applies the committed migrations (npm run db:migrate), then again (a no-op);
 *   2. compares the database with schema.ts (drizzle-kit push --strict, which
 *      only lists statements: without a terminal it never applies them);
 *   3. checks schema.ts against the committed snapshot (drizzle-kit generate
 *      into a copy of drizzle/);
 *   4. runs behaviour probes in one transaction that is rolled back;
 *   5. reports the role it ran as, creates the trusted extensions Neon allows
 *      (rolled back), and, when TLS is requested and NODE_EXTRA_CA_CERTS is set,
 *      shows the certificate is verified.
 *
 * drizzle-kit exits 0 even when it fails, so its output is checked, not its
 * exit code. Uses only Node and the repository's own dependencies.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probesOnly = process.argv.includes("--probes-only");
const neon = process.argv.includes("--neon");
const results = [];

function record(ok, id, text, detail) {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} - ${id} ${text}${!ok && detail ? `\n       ${detail.replace(/\n/g, "\n       ")}` : ""}`);
}

function die(message) {
  console.error(`db-check: ${message}`);
  process.exit(2);
}

// ------------------------------------------------------------------ target

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) die("set DATABASE_URL (or DATABASE_URL_UNPOOLED) to a local scratch database.");
let target;
try {
  target = new URL(url);
} catch {
  die("DATABASE_URL is not a URL.");
}
const host = target.hostname.replace(/^\[|\]$/g, "");
const database = decodeURIComponent(target.pathname.slice(1));
if (!/^postgres(ql)?:$/.test(target.protocol)) die("not a postgres:// URL.");
if (!["127.0.0.1", "localhost", "::1"].includes(host)) die(`refusing ${host}: only a database on this machine.`);
if (!database || database === "agtci" || /_(dev|test|prod|production)$/.test(database)) {
  die(`refusing database "${database}": use a scratch database such as agtci_scratch.`);
}
const sslmode = target.searchParams.get("sslmode");
if (neon && (!sslmode || sslmode === "disable")) die("--neon needs a URL with sslmode=require (TLS), as Neon's are.");
console.log(`db-check: ${probesOnly ? "probes only" : "full check"}${neon ? " (Neon parity)" : ""} on ${host}:${target.port || 5432}/${database}` +
  ` (sslmode=${sslmode ?? "none"})`);

// Children get both names set to the checked URL, so a developer's .env
// (loaded by dotenv in migrate.ts and drizzle.config.ts) cannot redirect them.
const childEnv = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url, NEXT_TELEMETRY_DISABLED: "1" };

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
client.on("error", (err) => console.error(`db-check: connection error ${err.message}`));
await client.connect().catch((err) => die(`cannot connect: ${err.code ?? ""} ${err.message}`));
const q = async (text, values) => (await client.query(text, values)).rows;

const journal = JSON.parse(readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8"));
const migrationFiles = readdirSync(path.join(root, "drizzle")).filter((f) => f.endsWith(".sql")).sort();

async function appliedMigrations() {
  const [{ exists }] = await q(`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`);
  return exists ? Number((await q(`select count(*)::int as n from drizzle.__drizzle_migrations`))[0].n) : 0;
}

// -------------------------------------------------------- 1. migrations

if (!probesOnly) {
  const [{ v }] = await q(`select current_setting('server_version_num')::int as v`);
  record(v >= 130000, "DB-01", `server is PostgreSQL 13 or newer (gen_random_uuid): ${v}`);

  const [{ n: userTables }] = await q(
    `select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and c.relkind in ('r', 'v', 'm', 'S')`);
  const [{ n: types }] = await q(
    `select count(*)::int as n from pg_type t join pg_namespace s on s.oid = t.typnamespace
      where s.nspname = 'public' and t.typtype = 'e'`);
  if (userTables || types) {
    await client.end();
    die(`"${database}" is not empty (${userTables} relations, ${types} enums). Recreate it first (TEST_SPEC.md, section 2).`);
  }

  const m1 = run("npm", ["run", "-s", "db:migrate"]);
  record(m1.status === 0 && m1.out.includes("Migrations applied."), "DB-02",
    "migrations apply to the empty database", m1.status === 0 ? "" : m1.out.trim());
  const applied = await appliedMigrations();
  record(applied === journal.entries.length, "DB-03",
    `every journal entry is recorded as applied: ${applied}/${journal.entries.length}`);

  const triggerNames = migrationFiles.flatMap((f) =>
    [...readFileSync(path.join(root, "drizzle", f), "utf8").matchAll(/CREATE\s+TRIGGER\s+"?(\w+)"?/gi)].map((m) => m[1]));
  const present = (await q(`select tgname from pg_trigger where not tgisinternal`)).map((r) => r.tgname);
  const missing = triggerNames.filter((t) => !present.includes(t));
  record(triggerNames.length > 0 && missing.length === 0, "DB-04",
    `the ${triggerNames.length} triggers the migrations create exist`, missing.length ? `missing: ${missing.join(", ")}` : "");

  const m2 = run("npm", ["run", "-s", "db:migrate"]);
  const appliedAgain = await appliedMigrations();
  record(m2.status === 0 && appliedAgain === applied, "DB-05",
    "running the migrations again is a no-op", m2.status === 0 ? "" : m2.out.trim());

  // ------------------------------------------- 2. database vs schema.ts

  const push = run(path.join(root, "node_modules/.bin/drizzle-kit"), ["push", "--verbose", "--strict"]);
  const pushOk = push.out.includes("No changes detected");
  record(pushOk, "DB-06", "the migrated database matches schema.ts (drizzle-kit push finds no changes)",
    pushOk ? "" : push.out.replace(/\[[^\]]*\] Pulling schema from database\.\.\.\s*/g, "").trim().slice(0, 4000));

  // ------------------------------------------ 3. schema.ts vs snapshot

  const scratch = path.join(root, "node_modules/.cache/agtci-db-check");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  cpSync(path.join(root, "drizzle"), path.join(scratch, "drizzle"), { recursive: true });
  const gen = run(path.join(root, "node_modules/.bin/drizzle-kit"), [
    "generate", "--dialect", "postgresql", "--schema", "./src/server/db/schema.ts",
    "--out", "./" + path.relative(root, path.join(scratch, "drizzle")),
  ]);
  const list = (dir) => readdirSync(dir, { recursive: true }).map(String).sort();
  const before = list(path.join(root, "drizzle"));
  const after = list(path.join(scratch, "drizzle"));
  const sameFiles = before.join("\n") === after.join("\n");
  const genOk = gen.out.includes("No schema changes") && sameFiles;
  record(genOk, "DB-07", "schema.ts matches the committed snapshot (drizzle-kit generate has nothing to add)",
    genOk ? "" : `${gen.out.trim().slice(0, 2000)}${sameFiles ? "" : `\nnew files: ${after.filter((f) => !before.includes(f)).join(", ")}`}`);
  rmSync(scratch, { recursive: true, force: true });
} else {
  const applied = await appliedMigrations();
  if (applied !== journal.entries.length) {
    await client.end();
    die(`--probes-only needs a migrated database: ${applied}/${journal.entries.length} migrations applied.`);
  }
}

// ---------------------------------------------------- 4. behaviour probes

async function expectError(code, text, values) {
  await client.query("savepoint probe");
  try {
    await client.query(text, values);
    await client.query("release savepoint probe");
    return "no error";
  } catch (err) {
    await client.query("rollback to savepoint probe");
    return err.code === code ? null : `${err.code} ${err.message}`;
  }
}

await client.query("begin");
try {
  const [cat] = await q(`insert into categories (name, slug) values ('Spices', 'probe-spices') returning *`);
  record(/^[0-9a-f-]{36}$/.test(cat.id) && cat.sort_order === 0 && cat.is_active === true && cat.created_at instanceof Date,
    "PR-01", "categories: uuid id, sort_order 0, is_active true, created_at set by default");

  const [prod] = await q(
    `insert into products (category_id, name, slug) values ($1, 'Turmeric', 'probe-turmeric') returning *`, [cat.id]);
  const emptyLists = ["images", "grades", "packaging_options", "specifications", "certifications"]
    .every((c) => Array.isArray(prod[c]) && prod[c].length === 0);
  record(emptyLists && prod.export_available === true && prod.is_featured === false && prod.is_active === true,
    "PR-02", "products: jsonb lists default to [], export_available true, is_featured false");

  const [cert] = await q(`insert into certifications (slug, name) values ('probe-iso', 'ISO') returning *`);
  record(cert.is_enabled === false, "PR-03", "certifications are disabled by default (never shown unless enabled)");

  const [admin] = await q(
    `insert into admin_users (email, password_hash) values ('Sales@Probe.example', 'x') returning *`);
  record(admin.role === "STAFF", "PR-04", "admin_users: role defaults to STAFF");

  const [lead] = await q(
    `insert into leads (source, full_name, email, product_id, product_name_snapshot, assigned_to)
     values ('PRODUCT_QUOTE', 'A Buyer', 'buyer@probe.example', $1, 'Turmeric', $2) returning *`, [prod.id, admin.id]);
  record(lead.status === "NEW" && Array.isArray(lead.attachments) && lead.attachments.length === 0,
    "PR-05", "leads: status defaults to NEW, attachments to []");

  record(await expectError("22P02", `insert into leads (source, status, full_name, email)
    values ('CONTACT_FORM', 'WON', 'x', 'x@probe.example')`) === null,
  "PR-06", "leads: a status outside LEAD_STATUSES is rejected");

  record(await expectError("23505", `insert into categories (name, slug) values ('Dup', 'probe-spices')`) === null,
    "PR-07", "categories: slug is unique");

  record(await expectError("23505", `insert into admin_users (email, password_hash) values ('sales@probe.EXAMPLE', 'x')`) === null,
    "PR-08", "admin_users: email is unique regardless of case");

  record(await expectError("23503", `delete from categories where id = $1`, [cat.id]) === null,
    "PR-09", "a category that still has products cannot be deleted");

  await q(`insert into audit_logs (actor_id, action, entity_type, entity_id) values ($1, 'probe', 'lead', $2)`, [admin.id, lead.id]);
  record(await expectError("23503", `delete from admin_users where id = $1`, [admin.id]) === null,
    "PR-10", "an admin user with audit-log entries cannot be deleted (audit trail kept)");

  await q(`delete from audit_logs where actor_id = $1`, [admin.id]);
  await q(`delete from admin_users where id = $1`, [admin.id]);
  await q(`delete from products where id = $1`, [prod.id]);
  const [after] = await q(`select product_id, product_name_snapshot, assigned_to from leads where id = $1`, [lead.id]);
  record(after.product_id === null && after.product_name_snapshot === "Turmeric" && after.assigned_to === null,
    "PR-11", "deleting a product or admin keeps the lead: product_id and assigned_to become null, the snapshot stays");

  // updated_at: a plain SQL UPDATE bumps it; a no-op UPDATE and an explicit value do not.
  await q(`insert into site_content (key, value) values ('probe', '{"a":1}')`);
  const [p2] = await q(`insert into products (category_id, name, slug) values ($1, 'Pepper', 'probe-pepper') returning id`, [cat.id]);
  const rows = [["categories", "id", cat.id, "name = 'Spices 2'"], ["products", "id", p2.id, "name = 'Pepper 2'"],
    ["leads", "id", lead.id, "notes = 'called'"], ["site_content", "key", "probe", `value = '{"a":2}'`]];
  const bumped = [];
  for (const [table, keyCol, key, change] of rows) {
    await q(`update ${table} set updated_at = '2000-01-01T00:00:00Z' where ${keyCol} = $1`, [key]);
    await q(`update ${table} set ${change} where ${keyCol} = $1`, [key]);
    const [r] = await q(`select updated_at from ${table} where ${keyCol} = $1`, [key]);
    if (r.updated_at.getUTCFullYear() > 2000) bumped.push(table);
  }
  record(bumped.length === rows.length, "PR-12", "a plain SQL UPDATE bumps updated_at (trigger) on categories, products, leads, site_content",
    bumped.length === rows.length ? "" : `not bumped: ${rows.map((r) => r[0]).filter((t) => !bumped.includes(t)).join(", ")}`);

  await q(`update categories set updated_at = '2000-01-01T00:00:00Z' where id = $1`, [cat.id]);
  await q(`update categories set name = name where id = $1`, [cat.id]);
  const [noop] = await q(`select updated_at from categories where id = $1`, [cat.id]);
  record(noop.updated_at.getUTCFullYear() === 2000, "PR-13", "an UPDATE that changes nothing, or sets updated_at itself, leaves it as given");

  const [sc] = await q(`select value from site_content where "key" = 'probe'`);
  record(sc?.value?.a === 2, "PR-14", `site_content: the reserved-word "key" column and jsonb value round-trip`);

  // ------------------------------------------- 5. role and extensions
  const [role] = await q(`select current_user as name, r.rolsuper as superuser,
      pg_get_userbyid(d.datdba) = current_user as owns_db,
      exists (select 1 from pg_roles n where n.rolname = 'neon_superuser' and pg_has_role(current_user, n.oid, 'member')) as neon_member
    from pg_roles r, pg_database d where r.rolname = current_user and d.datname = current_database()`);
  const extFailures = [];
  for (const ext of ["citext", "btree_gist", "pgcrypto"]) {
    const err = await expectError("none", `create extension if not exists ${ext}`);
    if (err !== "no error") extFailures.push(`${ext}: ${err}`);
  }
  const roleOk = !neon || (role.superuser === false && role.owns_db === true);
  if (!roleOk) extFailures.push("--neon: the role must not be a superuser and must own the database");
  record(extFailures.length === 0, "PR-15",
    `role ${role.name} (superuser: ${role.superuser}, owns database: ${role.owns_db}, neon_superuser member: ${role.neon_member}) can create citext, btree_gist, pgcrypto`,
    extFailures.join("\n"));
} finally {
  await client.query("rollback");
}

// A named (protocol-level) prepared statement, used again in separate
// transactions: what drizzle's .prepare("name") does. Through a transaction-mode
// pooler this works only if it supports prepared statements, as Neon's does.
try {
  const stmt = { name: "agtci_db_check_probe", text: "select $1::int + 1 as n" };
  let okRuns = 0;
  for (let i = 0; i < 3; i++) {
    const r = await client.query({ ...stmt, values: [i] });
    if (r.rows[0].n === i + 1) okRuns++;
  }
  record(okRuns === 3, "PR-16", "a named prepared statement runs again in later transactions");
} catch (err) {
  record(false, "PR-16", "a named prepared statement runs again in later transactions", `${err.code} ${err.message}`);
}

const [{ ssl }] = await q(`select coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as ssl`);
await client.end();

if (sslmode && sslmode !== "disable") {
  record(ssl === true, "TLS-01", `the connection uses TLS (sslmode=${sslmode})`);
  if (process.env.NODE_EXTRA_CA_CERTS && existsSync(process.env.NODE_EXTRA_CA_CERTS)) {
    // Without the local CA the same URL must fail: the driver verifies the
    // server certificate rather than accepting any.
    const env = { ...childEnv };
    delete env.NODE_EXTRA_CA_CERTS;
    const probe = spawnSync(process.execPath, ["-e", `
      const c = new (require("pg").Client)({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
      c.connect().then(() => { console.log("CONNECTED"); return c.end(); }, (e) => { console.log("ERR " + (e.code || e.message)); });`],
    { cwd: root, env, encoding: "utf8", timeout: 30_000 });
    const out = (probe.stdout ?? "").trim();
    record(/ERR (SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER_CERT_LOCALLY)/.test(out),
      "TLS-02", "the server certificate is verified (without the local CA the connection is refused)", out);
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(`db-check: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
