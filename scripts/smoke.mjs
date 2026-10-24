#!/usr/bin/env node
/**
 * Smoke test for agtci: start the production build, probe it, stop it.
 * See TEST_SPEC.md (levels S5 and N).
 *
 *   npm run build && node scripts/smoke.mjs                start, probe, stop
 *   node scripts/smoke.mjs --terminate                     also: let the app go idle, terminate its
 *                                                          database connections, and check it recovers
 *   node scripts/smoke.mjs --db-down                       DATABASE_URL points at no server: the pages
 *                                                          still work and /api/health is a bare 503
 *
 * Environment:
 *   DATABASE_URL           the app's runtime URL (Neon: the pooled one); must be on this machine,
 *                          and the database must be migrated
 *   DATABASE_URL_UNPOOLED  optional; the direct URL, used to terminate the app's connections
 *   SMOKE_PORT             default 3104
 *
 * AUTH_SECRET is set to a random canary, and every response body and the
 * server's log are checked for it, for the database password, and for stack
 * traces. Uses only Node and the repository's own dependencies.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const terminate = process.argv.includes("--terminate");
const dbDown = process.argv.includes("--db-down");
if (terminate && dbDown) die("--terminate and --db-down do not go together.");
const port = Number(process.env.SMOKE_PORT || 3104);
const base = `http://127.0.0.1:${port}`;
const results = [];

function record(ok, id, text, detail) {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} - ${id} ${text}${!ok && detail ? `\n       ${String(detail).slice(0, 1500).replace(/\n/g, "\n       ")}` : ""}`);
}

function die(message) {
  console.error(`smoke: ${message}`);
  process.exit(2);
}

function localUrl(name) {
  const value = process.env[name];
  if (!value) return null;
  let u;
  try {
    u = new URL(value);
  } catch {
    die(`${name} is not a URL.`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) die(`refusing ${name} on ${host}: only a database on this machine.`);
  return u;
}

const appUrl = localUrl("DATABASE_URL");
if (!appUrl) die("set DATABASE_URL to a local, migrated scratch database.");
const directUrl = localUrl("DATABASE_URL_UNPOOLED") ?? appUrl;
if (!existsSync(path.join(root, ".next/BUILD_ID"))) die("no production build: run `npm run build` first.");

try {
  await fetch(base, { signal: AbortSignal.timeout(1000) });
  die(`port ${port} is already in use.`);
} catch {
  // free
}

const canary = `smoke-canary-${randomBytes(12).toString("hex")}`;
const password = decodeURIComponent(appUrl.password || "");
const secrets = [canary, ...(password.length >= 4 ? [password] : []),
  ...(directUrl.password && decodeURIComponent(directUrl.password).length >= 4 ? [decodeURIComponent(directUrl.password)] : [])];
const stackTrace = /\n\s+at \S.*:\d+:\d+\)?/;

// ------------------------------------------------------------ start the app

let log = "";
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
  cwd: root,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    AUTH_SECRET: canary,
    DATABASE_URL: appUrl.href,
    // Shadow any DATABASE_URL_UNPOOLED in a developer's .env.
    DATABASE_URL_UNPOOLED: directUrl.href,
  },
});
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
let exited = null;
server.on("exit", (code, signal) => (exited = { code, signal }));

async function stop() {
  if (exited) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
  for (let i = 0; i < 50 && !exited; i++) await sleep(100);
  if (!exited) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
}
process.on("SIGINT", async () => {
  await stop();
  process.exit(130);
});

async function get(p) {
  const res = await fetch(base + p, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

function clean(body) {
  for (const s of secrets) if (body.includes(s)) return "a secret appears in the response";
  if (stackTrace.test(body)) return "a stack trace appears in the response";
  if (/node_modules|DATABASE_URL/.test(body)) return "server internals appear in the response";
  return null;
}

try {
  const started = Date.now();
  let ready = false;
  while (!ready && !exited && Date.now() - started < 60_000) {
    try {
      await get("/");
      ready = true;
    } catch {
      await sleep(250);
    }
  }
  if (!ready) throw new Error(`the server did not start within 60 s\n${log}`);
  console.log(`smoke: next start on ${base}, ready in ${Date.now() - started} ms; database ${appUrl.hostname}:${appUrl.port || 5432}${appUrl.pathname} (sslmode=${appUrl.searchParams.get("sslmode") ?? "none"})`);

  // ---------------------------------------------------------------- routes
  const home = await get("/");
  record(home.status === 200 && home.body.includes('<html lang="en"') && home.body.includes("page.tsx"),
    "SM-01", "GET / is 200 and renders the home page", `${home.status}`);
  record(clean(home.body) === null, "SM-02", "GET / leaks no secret, stack trace or internals", clean(home.body));

  const asset = home.body.match(/\/_next\/static\/[^"'\s)]+\.css/)?.[0];
  const css = asset ? await get(asset) : null;
  record(css?.status === 200 && css.body.length > 0, "SM-03", `the home page's stylesheet is served from the site root (${asset ?? "none found"})`, `${css?.status}`);

  for (const [id, p, needle] of [["SM-04", "/favicon.ico", null], ["SM-05", "/next.svg", "<svg"]]) {
    const r = await get(p);
    record(r.status === 200 && (!needle || r.body.includes(needle)), id, `GET ${p} is 200`, `${r.status}`);
  }

  const health = await get("/api/health");
  const [wantStatus, wantBody] = dbDown ? [503, '{"status":"error","database":"down"}'] : [200, '{"status":"ok","database":"up"}'];
  record(health.status === wantStatus && health.body === wantBody && /no-store/.test(health.headers.get("cache-control") ?? ""),
    "SM-06", `GET /api/health is ${wantStatus} ${wantBody}, not cached`, `${health.status} ${health.body} ${health.headers.get("cache-control")}`);

  const missing = await get(`/no-such-page-${randomBytes(4).toString("hex")}`);
  record(missing.status === 404 && missing.body.includes("This page could not be found") && clean(missing.body) === null,
    "SM-07", "an unknown path is a clean 404", `${missing.status} ${clean(missing.body) ?? ""}`);

  const privatePaths = ["/.env", "/.env.example", "/.env.local", "/package.json", "/next.config.ts", "/drizzle.config.ts",
    "/drizzle/0000_baseline.sql", "/drizzle/meta/_journal.json", "/src/lib/env.ts", "/src/server/db/schema.ts",
    "/.git/config", "/.next/BUILD_ID", "/.claude/settings.json", "/scripts/smoke.mjs"];
  const served = [];
  for (const p of privatePaths) {
    const r = await get(p);
    if (r.status !== 404 || clean(r.body) !== null) served.push(`${p} -> ${r.status}`);
  }
  record(served.length === 0, "SM-08", `none of ${privatePaths.length} private files is served (all 404)`, served.join("\n"));

  // ----------------------------------------- idle connections terminated
  if (terminate) {
    const warm = await get("/api/health");
    await sleep(1500); // idle, but within the pool's idle timeout
    const admin = new pg.Client({ connectionString: directUrl.href, connectionTimeoutMillis: 15_000 });
    admin.on("error", () => {});
    await admin.connect();
    const scope = `from pg_stat_activity a left join pg_stat_ssl s using (pid)
      where a.usename = current_user and a.datname = current_database() and a.pid <> pg_backend_pid()`;
    const [{ n, all_ssl }] = (await admin.query(`select count(*)::int as n, bool_and(coalesce(s.ssl, false)) as all_ssl ${scope}`)).rows;
    const [{ killed }] = (await admin.query(`select count(pg_terminate_backend(a.pid))::int as killed ${scope}`)).rows;
    await admin.end();
    record(warm.status === 200 && killed >= 1, "NP-01",
      `after ${1500} ms idle, the app's ${killed} server connection(s) were terminated (server-side TLS on all: ${all_ssl ?? "n/a"})`,
      `warm-up ${warm.status}, connections found ${n}`);
    await sleep(1000);
    record(exited === null, "NP-02", "the app is still running after its connections were terminated", JSON.stringify(exited));
    const after = await get("/api/health");
    record(after.status === 200 && after.body.includes('"database":"up"'), "NP-03",
      "the next request after the termination succeeds", `${after.status} ${after.body}`);
    const sameEndpoint = appUrl.host === directUrl.host;
    if (sameEndpoint) {
      record(log.includes("[db:app] idle connection closed"), "NP-04",
        "the pool's error handler logged the closed connection (the app connects directly here)", log.slice(-1500));
    }
  }
} catch (err) {
  record(false, "SM-00", "the smoke run completed", err.stack ?? String(err));
} finally {
  await stop();
}

// ------------------------------------------------------- the server's log
const leaked = secrets.filter((s) => log.includes(s));
const crashed = /uncaughtException|unhandledRejection|Unhandled/.test(log) || stackTrace.test(log);
record(leaked.length === 0, "SM-09", "the server log contains no secret");
record(!crashed, "SM-10", "the server log has no uncaught exception or stack trace", log.slice(-3000));

const failed = results.filter((ok) => !ok).length;
console.log(`smoke: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
