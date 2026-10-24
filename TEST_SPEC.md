# agtci — test specification

agtci is the Next.js 16 site for **agtci.com** (AGTCI, a B2B sourcing and export
business). It is its own domain, not a bkesari.com tab, and it is served at the
site root (no `basePath`). It is more than the bare `create-next-app` scaffold
it started as, though the pages still are: `/` is the untouched starter page.
Behind it there is a complete data model for the catalogue, lead capture and an
admin CMS: 8 PostgreSQL tables in `src/server/db/schema.ts`, two migrations in
`drizzle/`, environment validation, a node-postgres pool tuned for Neon, a
`GET /api/health` route, and the business identity in `src/lib/company.ts`.
No page reads the database yet, and there is no auth, admin UI or form.
Production runs on PostgreSQL on Neon. This spec covers the whole repository:
lint, types, the migrations against a real PostgreSQL, the production build,
a smoke run of it, hygiene, and Neon parity. It does not cover Neon itself or a
deployed tier. The README has the setup and the Neon layout; CI is
`.github/workflows/ci.yml`.

Testing agent: `.claude/agents/agtci-tester.md`. It runs automatically after every
code change (the test gate, `.claude/hooks/test_gate.py`); run it by hand by
asking Claude to "run the agtci-tester agent".

## 1. Scope

| Component | Path | Language / framework |
|---|---|---|
| Pages and layout | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `public/` | React 19, Next.js 16.3 (App Router, Turbopack), Tailwind 4 |
| Health route | `src/app/api/health/route.ts` | Next.js route handler |
| Database schema | `src/server/db/schema.ts` | Drizzle ORM 0.45 (pg-core) |
| Migrations | `drizzle/*.sql`, `drizzle/meta/`, `drizzle.config.ts`, `src/server/db/migrate.ts` | drizzle-kit 0.31, SQL (PostgreSQL 13+) |
| Database client | `src/server/db/index.ts`, `src/server/db/connection.ts` | node-postgres (`pg`) 8 |
| Environment | `src/lib/env.ts`, `.env.example` | zod 4 |
| Business identity | `src/lib/company.ts` | TypeScript constants (nothing imports it yet) |
| Test scripts | `scripts/db-check.mjs`, `scripts/smoke.mjs` | Node 22, no extra dependencies |
| CI | `.github/workflows/ci.yml` | GitHub Actions, PostgreSQL 16 service |

Out of scope:
- **Neon and deployed tiers** (agtci.com, the staging subdomain). Nothing in
  this suite connects to a hosted database, and nothing may. Neon behaviour is
  covered by the parity level (N) against a local stand-in.
- **`next-auth` / `@auth/drizzle-adapter`.** They are dependencies, but nothing
  uses them, and the schema has none of the adapter's tables.
- **Draft PR #3** ("Give this repo a test setup, starting with the schema").
  It is not merged and was written for MySQL. See *Known gaps*.
- **The `.claude/` test gate** (hooks and settings). It belongs to the session
  tooling, not the product.

## 2. Environment

**Tools.** CI runs on `ubuntu-latest` with Node 22 (`actions/setup-node`), npm
from it, and a `postgres:16` service container. On the Mac,
`bkesari-platform/docs/MAC_DEPLOYMENT.md` installs `node@22` and
`postgresql@16` with Homebrew. The N level also needs `pgbouncer` (`brew install pgbouncer`)
and OpenSSL. The suite was measured with Node 22.22 / npm 10.9 and
PostgreSQL 16.15.

**Scratch databases.** These are PostgreSQL databases on this machine only,
owned by a scratch role that is **not** a superuser. **They are dropped and
recreated by this suite. Never point it at a database you care about.** Both
scripts refuse any host other than `127.0.0.1`, `localhost` or `::1`.
`db-check.mjs`, which migrates the database it is given, also refuses a
database named `agtci` or `bk_agtci` (the Neon name), and names ending in
`_dev`, `_test`, `_prod` or `_production`.

| Name (Mac) | Used by | Note |
|---|---|---|
| role `agtci_scratch` | everything | `LOGIN`, not a superuser, a member of `neon_superuser` |
| database `agtci_scratch` | S3, S5 | must be **empty** before `db-check.mjs` runs |
| database `agtci_scratch_app` | N | the Neon-like app database, also recreated empty |

In CI the database is `agtci_ci` (superuser `ci`, from the service container).
In the agent's cloud container the names are `t_agtci` / `t_agtci_app` for both
role and databases (an example, not a rule). Any local names that pass the
scripts' guard work.

Create the role once on the Mac. `neon_superuser` stands in for Neon's role of
that name:

```bash
psql -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='neon_superuser')
  THEN CREATE ROLE neon_superuser NOLOGIN CREATEDB CREATEROLE; END IF; END$$;
DO $$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='agtci_scratch')
  THEN CREATE ROLE agtci_scratch LOGIN PASSWORD 'agtci_scratch'; END IF; END$$;
GRANT neon_superuser TO agtci_scratch;
SQL
```

Recreate the databases before every run (`--force` drops any connections left
over, including PgBouncer's):

```bash
for db in agtci_scratch agtci_scratch_app; do
  dropdb --if-exists --force "$db" && createdb -O agtci_scratch "$db"
done
```

**Environment variables.**

| Variable | Value for the suite | Read by |
|---|---|---|
| `DATABASE_URL` | `postgres://agtci_scratch:agtci_scratch@127.0.0.1:5432/agtci_scratch` | `db-check.mjs`, `smoke.mjs` (the app's runtime URL) |
| `DATABASE_URL_UNPOOLED` | unset for S3/S5; the direct TLS URL for N | `db-check.mjs` (preferred over `DATABASE_URL`), `smoke.mjs` (to terminate the app's connections) |
| `AUTH_SECRET` | blank is fine | `smoke.mjs` sets it to a random canary for the app it starts |
| `NODE_EXTRA_CA_CERTS` | the local CA bundle, only for N | Node. pg verifies the server certificate on `sslmode=require` |
| `SMOKE_PORT` | blank is fine (3104) | `smoke.mjs` |
| `NEXT_TELEMETRY_DISABLED` | `1` (optional) | Next.js |

A developer's `.env` may hold Neon URLs. The suite never uses them:
- `db-check.mjs` gives its children (`npm run db:migrate`, drizzle-kit) both
  `DATABASE_URL` and `DATABASE_URL_UNPOOLED` set to the checked URL.
- `smoke.mjs` does the same for `next start`. dotenv and Next.js never
  override a variable that is already set.

Do **not** run `npm run db:migrate` by hand with only `DATABASE_URL` exported
while `.env` holds `DATABASE_URL_UNPOOLED`: migrations prefer the latter.

**Port.** The smoke run binds 127.0.0.1:3104 (`SMOKE_PORT`). The script stops
if the port is taken.

**One-time setup.** `npm ci`. That is all: the scripts migrate the scratch
database themselves.

**Neon-like test bed (level N only).** You need a PostgreSQL that offers TLS,
plus a PgBouncer in front of it. The agent's container already has one:
direct 127.0.0.1:5432, pooled 127.0.0.1:6432, CA bundle
`/etc/neonlike/node-ca-bundle.crt`. On a Mac, build the same thing:
1. Make a local CA and a server certificate for `localhost` / `127.0.0.1`
   with `openssl`. In `postgresql.conf` set `ssl = on`, `ssl_cert_file` and
   `ssl_key_file`, and use `scram-sha-256` auth for 127.0.0.1 in
   `pg_hba.conf`.
2. Run PgBouncer on 6432 with:
   - `pool_mode = transaction`
   - `max_prepared_statements = 1000`
   - `client_tls_sslmode = require`, plus `client_tls_cert_file` and
     `client_tls_key_file`
   - `server_tls_sslmode = require`
   - `auth_type = scram-sha-256`, with an `auth_query` or an `auth_file`
     listing `agtci_scratch`
3. Export `NODE_EXTRA_CA_CERTS=<your CA .crt>`. Never add a CA path or
   `rejectUnauthorized: false` to app code: Neon's certificate comes from a
   public CA.

With no test bed, N is reported `SKIPPED: no TLS PostgreSQL / PgBouncer`.
Section 6 says when that still allows PASS.

## 3. Standard suite

Run in order from the repository root. In the tables, `\|` is a literal `|`.
Before S3, recreate `agtci_scratch` as in section 2 (and `agtci_scratch_app`
before N). Set `DATABASE_URL` as in section 2. For N, also define:

```bash
SCRATCH_PW=agtci_scratch          # the scratch role's password
DIRECT="postgres://agtci_scratch:$SCRATCH_PW@127.0.0.1:5432/agtci_scratch_app?sslmode=require&channel_binding=require"
POOLED="postgres://agtci_scratch:$SCRATCH_PW@127.0.0.1:6432/agtci_scratch_app?sslmode=require&channel_binding=require"
```

| # | Level | Command | Passes when |
|---|---|---|---|
| 1 | S1 install | `npm ci` | exit 0 |
| 2 | S1 lint | `npm run lint` | exit 0, no problems printed |
| 3 | S1 typecheck | `npx next typegen && npx tsc --noEmit` | exit 0. A bare `tsc` fails on a fresh clone: `LayoutProps` is a generated type |
| 4 | S1 static config | see **S1 static checks** below | each check as stated |
| 5 | S2 unit | none yet: there is no test runner (PR #3 brings one) | `N/A`; reported as such |
| 6 | S3 database | `node scripts/db-check.mjs` | exit 0, `db-check: 23 passed, 0 failed` |
| 7 | S4 build | `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u AUTH_SECRET npm run build` | exit 0. The route list shows `○ /`, `○ /_not-found`, `ƒ /api/health` |
| 8 | S5 smoke | `node scripts/smoke.mjs --terminate` (on the database S3 just migrated) | exit 0, `smoke: 14 passed, 0 failed`; no `next start` left running |
| 9 | S5 smoke, database down | `DATABASE_URL=postgres://nobody:none@127.0.0.1:1/none node scripts/smoke.mjs --db-down` | exit 0, `smoke: 10 passed, 0 failed` |
| 10 | S6 hygiene | see **S6 checks** below | each check as stated |
| 11 | N1 migrations over the direct endpoint, TLS, non-superuser | `DATABASE_URL="$POOLED" DATABASE_URL_UNPOOLED="$DIRECT" node scripts/db-check.mjs --neon` (empty `agtci_scratch_app`) | exit 0, `25 passed, 0 failed`; includes `TLS-01`, `TLS-02` and PR-15 with `superuser: false, owns database: true` |
| 12 | N2 queries through the pooler | `DATABASE_URL="$POOLED" node scripts/db-check.mjs --probes-only --neon` | exit 0, `18 passed, 0 failed` |
| 13 | N3 the app on the pooled URL | `DATABASE_URL="$POOLED" DATABASE_URL_UNPOOLED="$DIRECT" node scripts/smoke.mjs --terminate` | exit 0, `13 passed, 0 failed` |
| 14 | N4 the app on the direct URL, TLS | `DATABASE_URL="$DIRECT" node scripts/smoke.mjs --terminate` | exit 0, `14 passed, 0 failed`, including NP-04 |

**What the scripts check.** Each prints one `ok` / `FAIL` line per check, then
a count.

- `db-check.mjs` (full):
  - `DB-01`: the server is PostgreSQL 13 or newer.
  - `DB-02`, `DB-03`: `npm run db:migrate` applies every journal entry to the
    empty database.
  - `DB-04`: every `CREATE TRIGGER` in `drizzle/*.sql` exists.
  - `DB-05`: a second migrate is a no-op.
  - `DB-06`: `drizzle-kit push --verbose --strict` reports `No changes
    detected`, so the database matches `schema.ts`. Without a terminal it never
    applies anything.
  - `DB-07`: `drizzle-kit generate` into a copy of `drizzle/` reports `No
    schema changes` and adds no file, so `schema.ts` matches the snapshot.
  - `PR-01`…`PR-14`: behaviour probes in one transaction that is rolled back.
  - `PR-15`: the role, and `CREATE EXTENSION` for citext, btree_gist and
    pgcrypto (rolled back).
  - `PR-16`: a named prepared statement reused across transactions.
  - `TLS-01`, `TLS-02`: TLS in use, and the certificate verified. They run
    only when the URL has `sslmode`, and `TLS-02` only when
    `NODE_EXTRA_CA_CERTS` is set.
  - drizzle-kit exits 0 even when it fails, so the script reads its output.
- `db-check.mjs` options:
  - `--probes-only` skips DB-01…DB-07 and needs a migrated database.
  - `--neon` also requires TLS, a role that is not a superuser, and a role that
    owns the database.
- `smoke.mjs` starts `next start` on 127.0.0.1:3104 with a random canary
  `AUTH_SECRET`, then:
  - `SM-01`: `/` is 200 and has `<html lang="en"` and `page.tsx`.
  - `SM-02`: no secret, stack trace or internals in `/`.
  - `SM-03`: the page's `/_next/static/…css` is 200.
  - `SM-04`, `SM-05`: `/favicon.ico` and `/next.svg` are 200.
  - `SM-06`: `/api/health` returns exactly `{"status":"ok","database":"up"}`
    with `Cache-Control: no-store`. With `--db-down`, a bare 503
    `{"status":"error","database":"down"}`.
  - `SM-07`: an unknown path is 404 "This page could not be found".
  - `SM-08`: 14 private paths are 404: `.env*`, `package.json`, configs,
    `drizzle/`, `src/`, `.git/`, `.next/`, `.claude/`, `scripts/`.
  - `SM-09`, `SM-10`: the server log has no secret, no `uncaughtException`,
    and no stack trace.
  - `--terminate`:
    - `NP-01`: warm the pool, wait 1.5 s, then `pg_terminate_backend` every
      other connection of the role to that database. At least 1 must be
      terminated.
    - `NP-02`: the app is still running.
    - `NP-03`: the next `/api/health` is 200.
    - `NP-04`: when the app connects directly, its pool logged
      `[db:app] idle connection closed`.
  - The script always stops the server it started.

**S1 static checks** (row 4). These are the parts of R2 that only the code can show:

| Check | Command | Passes when |
|---|---|---|
| ST-01 served at the domain root | `grep -c basePath next.config.ts` | prints `0` |
| ST-02 every pool has an error handler | `git grep --untracked -n "new Pool(" -- src \| grep -v handlePoolErrors` | prints nothing |
| ST-03 connect timeout of at least 10 s | `grep -E "CONNECT_TIMEOUT_MS = [0-9_]+" src/server/db/connection.ts` | the value is 10_000 or more |
| ST-04 schema changes use the direct URL | `grep -c "process.env.DATABASE_URL_UNPOOLED \|\| process.env.DATABASE_URL" src/server/db/migrate.ts drizzle.config.ts` | both files `:1` |
| ST-05 the app uses the runtime (pooled) URL | `grep -c "getEnv().DATABASE_URL" src/server/db/index.ts` | prints `1` |

**S6 checks** (row 10):

| Check | Command | Passes when |
|---|---|---|
| No env or key file would be committed | `git ls-files --cached --others --exclude-standard \| grep -E '(^\|/)\.env($\|\.)\|\.pem$\|\.key$' \| grep -v '^\.env\.example$'` | prints nothing |
| `.env` is ignored | `git check-ignore -q .env && git check-ignore -q .env.local` | exit 0 |
| No real credential in a URL | `git grep --untracked -nIE "postgres(ql)?://[^:/ ]+:[^@ ]+@" -- . ':!package-lock.json' \| grep -vE "@(127\.0\.0\.1\|localhost)[:/]\|<password>"` | prints nothing (only local placeholders and `<password>` remain) |
| Nothing private served, nothing leaked | SM-02, SM-07, SM-08, SM-09, SM-10 from rows 8 and 9 | all `ok` |
| Protected routes refuse anonymous access | none exist yet (no admin or auth routes) | `N/A`. Becomes mandatory with the first admin route |
| Dependency audit | `npm audit --omit=dev` | report-only. Baseline: 4 advisories (1 critical `next`, 3 high: `zod`, `sharp`, `source-map-js`). Report any advisory not in that list |

## 4. Regression suite

**R1, the full suite.** The whole of section 3, rows 1–14, in order. There is
no separate test runner, so the full suite and the standard suite are the same
set. Nothing may be left out or sampled.

**R2, critical regressions.** Each row must be `ok` in every run.

| ID | Behaviour that must never break | Checked by |
|---|---|---|
| AGTCI-CR-01 | The committed migrations build an empty PostgreSQL from scratch, and every journal entry is recorded | `db-check.mjs` DB-02, DB-03 (rows 6, 11) |
| AGTCI-CR-02 | Re-running migrations (every deploy does) is a no-op | DB-05 |
| AGTCI-CR-03 | The database the migrations build is exactly what `schema.ts` declares: no hand-edited SQL, no forgotten column | DB-06 |
| AGTCI-CR-04 | `schema.ts` has no change that `npm run db:generate` has not turned into a migration | DB-07 |
| AGTCI-CR-05 | `updated_at` is bumped by any UPDATE that changes the row, even plain SQL outside the ORM, but not by a no-op or by an explicit value (the migration's trigger). The ORM's own `$onUpdate` has no check yet | DB-04, PR-12, PR-13 |
| AGTCI-CR-06 | The lead pipeline: new leads are `NEW`, unknown statuses are refused, and deleting a product or admin never deletes a lead (the product-name snapshot survives) | PR-05, PR-06, PR-11 |
| AGTCI-CR-07 | The catalogue: a category with products cannot be deleted, and slugs are unique | PR-07, PR-09 |
| AGTCI-CR-08 | Admin identity: email unique regardless of case, role defaults to `STAFF`, and an admin with audit entries cannot be deleted | PR-04, PR-08, PR-10 |
| AGTCI-CR-09 | A certification is never shown unless enabled: `is_enabled` defaults to false | PR-03 |
| AGTCI-CR-10 | The app uses `DATABASE_URL` (pooled), and migrations and drizzle-kit use `DATABASE_URL_UNPOOLED`, falling back to `DATABASE_URL` | S1 static checks; N1 and N3 |
| AGTCI-CR-11 | A Neon connection string (`?sslmode=require&channel_binding=require`) works unchanged over TLS, and the certificate is verified | TLS-01, TLS-02 (N1, N2); SM-06 in N3 and N4 |
| AGTCI-CR-12 | A server-terminated idle connection (a Neon compute suspending) neither crashes the app nor surfaces as an uncaught exception, and the next request succeeds | NP-01 to NP-04, SM-10 (rows 8, 13, 14); S1 "every pool has an error handler" |
| AGTCI-CR-13 | The connect timeout is at least 10 s, enough for a cold start | S1 static check |
| AGTCI-CR-14 | Migrations and trusted extensions work as a non-superuser role that owns its database (Neon's model) | PR-15 with `--neon` (N1) |
| AGTCI-CR-15 | Queries and named prepared statements work through a transaction-mode pooler | N2 (PR-01 to PR-16 over PgBouncer) |
| AGTCI-CR-16 | `/api/health` is 200 when the database is up and a bare 503 when it is down, never cached and never with error details | SM-06 (rows 8, 9) |
| AGTCI-CR-17 | The site is served at the domain root and its static assets load | SM-01, SM-03, SM-04, SM-05; S1 `basePath` check |
| AGTCI-CR-18 | No private file is served, and no secret or stack trace reaches a response or the log | SM-02, SM-07 to SM-10 |
| AGTCI-CR-19 | `next build` needs no database settings and makes no connection | row 7, run with the variables unset |

**R3, change-area map.** For each changed file, run everything (R1) as
always, and look hardest at these.

| Path | Emphasise |
|---|---|
| `src/server/db/schema.ts`, `drizzle/**`, `drizzle.config.ts` | CR-01 to CR-09, CR-14 (rows 6, 11). A schema change without a new migration fails DB-06/DB-07. |
| `src/server/db/migrate.ts` | CR-01, CR-02, CR-10, CR-14 |
| `src/server/db/index.ts`, `src/server/db/connection.ts` | CR-10 to CR-13, CR-15 (rows 4, 8, 11–14) |
| `src/lib/env.ts`, `.env.example` | CR-10, CR-16, CR-19. The env validation has no unit test yet (*Known gaps*) |
| `src/app/api/**` | CR-12, CR-16, CR-18 (rows 8, 9, 13, 14) |
| `src/app/**` pages and layout, `public/**`, `next.config.ts` | CR-17, CR-18, CR-19. **Update SM-01's expected strings** when the home page changes; add a probe for every new page |
| `package.json`, `package-lock.json` | all of R1. For `pg`, `drizzle-*` or `next` bumps, also CR-11 to CR-13 and the audit. pg 9 changes what `sslmode=require` means (see *Known gaps*) |
| `.github/workflows/ci.yml` | the workflow keeps a local `postgres:16` service, never a Neon URL or secret; the same commands as section 3 |
| `scripts/*.mjs` | run them against a deliberately broken database, or a temporary code change, to show the edited check still fails when it should; then R1 |

**R4, baseline comparison.** Compare each count with section 5. A level with
fewer checks than its baseline, a check that was `ok` and is now `FAIL`, or a
new `N/A`/`SKIPPED` is a failure even if every printed line is `ok`. When a
change adds checks, the new count becomes the baseline for the next run; say
so in the report.

## 5. Baseline

Measured on 2026-10-24 at commit `ddbfabe` (branch `claude/fervent-bell-wcmmdu`),
with the uncommitted changes listed in `.claude/test-runs/20261024-155200-agtci-tester.md`.
Environment: the agent's Linux container (4 shared CPUs), Node 22.22.0,
npm 10.9.4, PostgreSQL 16.15. N ran against PgBouncer 1.22 (transaction mode,
TLS required, `max_prepared_statements=1000`) and a local CA. The role was
`t_agtci`: not a superuser, a member of `neon_superuser`, owner of `t_agtci` and
`t_agtci_app`.

The first and final complete runs gave the same counts. The first run already
included the fixes for the defects found on `ddbfabe` as merged; the report
lists those. The durations are from the final run.

| # | Level | Checks | Passed | Failed | Skipped / N/A | Duration |
|---|---|---|---|---|---|---|
| 1 | S1 install | 1 | 1 | 0 | 0 | 23 s |
| 2 | S1 lint | 1 | 1 | 0 | 0 | 3 s |
| 3 | S1 typecheck | 1 | 1 | 0 | 0 | 6 s |
| 4 | S1 static (ST-01 to ST-05) | 5 | 5 | 0 | 0 | <1 s |
| 5 | S2 unit | 0 | 0 | 0 | N/A (no runner) | — |
| 6 | S3 `db-check.mjs` | 23 | 23 | 0 | 0 | 4 s |
| 7 | S4 build | 1 | 1 | 0 | 0 | 6 s with `.next/cache` warm, about 20 s cold |
| 8 | S5 smoke `--terminate` | 14 | 14 | 0 | 0 | 4 s |
| 9 | S5 smoke `--db-down` | 10 | 10 | 0 | 0 | 1 s |
| 10 | S6 hygiene | 4 | 4 | 0 | 1 N/A (no protected routes); audit report-only: 4 advisories | 3 s |
| 11 | N1 `db-check --neon`, direct TLS | 25 | 25 | 0 | 0 | 5 s |
| 12 | N2 `db-check --probes-only --neon`, pooled TLS | 18 | 18 | 0 | 0 | <1 s |
| 13 | N3 smoke, pooled TLS | 13 | 13 | 0 | 0 | 5 s |
| 14 | N4 smoke, direct TLS | 14 | 14 | 0 | 0 | 4 s |

The whole suite takes about 75 s. Expected `N/A`s:
- S2: there is no test runner yet.
- S6 "protected routes": there are none.

N3 has no NP-04: through the pooler, PgBouncer's server connections are
terminated, not the app's own.

## 6. Pass criteria

- **PASS**: rows 1–14 all ran.
  - Every check is `ok`, at or above the section 5 counts, with no new `N/A`.
  - Every R2 row is `ok`.
  - Nothing above S4 is left open.
  - The audit is reported. Its advisories are report-only: list each under
    *Open items* with the fixing version and whether it is in range. They do
    not change the verdict by themselves. An upgrade outside the declared range
    is proposed, not made.
  - There is one exception for N (rows 11–14). If the machine has no Neon-like
    test bed, N may be `SKIPPED` with that reason only when the change touches
    none of these: `src/server/db/**`, `src/lib/env.ts`, `src/app/api/**`,
    `drizzle/**`, `drizzle.config.ts`, the `pg` / `drizzle-*` entries in
    `package-lock.json`, `scripts/*.mjs`. Otherwise a skipped N makes the run
    `BLOCKED`.
- **FAIL**: a check is still `FAIL` after the fix loop (three rounds at most),
  or a count fell below the baseline.
- **BLOCKED**: the suite could not run. Causes:
  - no local PostgreSQL;
  - `npm ci` cannot reach the registry;
  - port 3104 is taken by something that is not ours;
  - a hard rule fired: a URL pointing at Neon or any remote host, or a scratch
    name the guard refuses;
  - the N rule above.

## 7. Defect handling

| Severity | Meaning here | Example from this project |
|---|---|---|
| S1 | Data loss, security, or the app does not start | A migration that drops or rewrites data; a secret or stack trace in a response; `next start` failing to boot against the pooled URL |
| S2 | A feature broken | A pool with no `error` handler: a Neon suspend becomes an `uncaughtException` in the app and kills any standalone script. No connect timeout, so requests hang while a compute does not answer. A schema change with no migration (DB-06/DB-07). The `updated_at` trigger missing |
| S3 | Degraded, with a workaround | `tsc --noEmit` failing on a fresh clone until `next typegen` has run; `channel_binding=require` ignored by the driver (TLS still verified) |
| S4 | Cosmetic | The README pointing at `app/page.tsx` instead of `src/app/page.tsx`; the starter page's title "Create Next App" |

**The agent may fix on its own:** product code, migrations (as a **new**
migration, never an edit to an applied one), the scripts, CI commands and the
docs. Each fix must be the smallest correct one, at the root cause, with a check
added to `db-check.mjs` or `smoke.mjs` when the existing ones missed it.

**The agent reports instead:**
- dependency upgrades outside the declared semver range (for example the
  `next` fix that needs 16.4.x);
- anything needing Neon, a deployed tier or a credential;
- changes to `.claude/settings.json`, `.claude/hooks/`, `.claude/test-gate.json`,
  `.gitignore`, `CLAUDE.md` or `AGENTS.md`;
- a fix that would change documented behaviour.

**Never:**
- skip, disable, delete or loosen a check, or change an expected value to
  match wrong output;
- point anything at Neon or a non-local database, or run `drizzle-kit push`
  with a terminal attached (it would ask to apply);
- edit `.env` files or anything under `.claude/state/`;
- run `next dev`: it rewrites `AGENTS.md`. Use `next build` and `next start`.
  If `AGENTS.md` changes anyway, `git checkout -- AGENTS.md`;
- commit, push, deploy or touch a server;
- leave a `next start` or PgBouncer connection of ours running.

## 8. Report format

Write to `.claude/test-runs/<UTC yyyymmdd-hhmmss>-agtci-tester.md` and copy it to
`.claude/test-runs/latest-agtci-tester.md`:

```markdown
# agtci-tester report — <UTC date time>

- Commit: <short sha> on <branch>; working tree: <clean | N files changed>
- Changed files (vs origin/staging, plus uncommitted): <list, each mapped to an R3 area>
- Environment: Node <v>, npm <v>, PostgreSQL <v>; N test bed: <PgBouncer <v> on :6432, TLS, CA <path> | none>
- Scratch: role <name> (superuser: <yes/no>), databases <names>

## Results

| # | Level | Command | Result | Counts (pass/fail/skip) | Duration | vs baseline |
|---|---|---|---|---|---|---|
| 1 | S1 install | `npm ci` | PASS | 1/0/0 | 27 s | = |
| … | … | … | … | … | … | … |

### Critical regressions (R2)

| ID | Result | Evidence (check IDs) |
|---|---|---|
| AGTCI-CR-01 | ok | DB-02, DB-03 (rows 6, 11) |
| … | … | … |

### Audit (report-only)

<npm audit --omit=dev summary, each advisory, fix version, in range or not>

## Defects

| ID | Severity | Area | Symptom | Root cause | Fix | Files | Check added | Status |
|---|---|---|---|---|---|---|---|---|
| D1 | S2 | … | … | … | … | … | … | fixed / open / pre-existing |

## Re-test

<which checks were re-run first, then the complete run's table or "same as above">

## Open items

<what is left, who must act, proposed patch or command>

TESTER: agtci-tester
VERDICT: PASS | FAIL | BLOCKED
```

## 9. Known gaps

- **No unit or integration test runner.** Draft PR #3 (`tests/schema.test.ts`,
  `tests/env.test.ts`, `npm test` / `npm run test:db`, a CI database job) brings
  one. When it lands, rebased onto PostgreSQL, this spec must:
  - fill S2 with `npm test` (the env tests: missing `DATABASE_URL` /
    `AUTH_SECRET`, `""` treated as unset, a non-postgres URL refused,
    `DATABASE_URL_UNPOOLED` optional);
  - add `npm run test:db` to S3 against `agtci_scratch` through its
    `TEST_DATABASE_URL`;
  - rebase its counts into section 5;
  - map its tests onto the R2 rows, folding duplicate PR-xx probes into the
    tests or keeping both;
  - add `tests/**` to R3.

  Until then, `src/lib/env.ts` is exercised only on its valid path (rows 8,
  13, 14), and its "" handling and URL checks are untested.
- **No browser end-to-end tests.** The smoke checks HTML strings and status
  codes, not rendering or client-side JavaScript. The site has no interactive
  page yet.
- **No page reads the database.** Only `/api/health` does, so the smoke proves
  the connection, not real queries. Add probes as the catalogue pages and lead
  forms arrive.
- **No auth or admin routes**, so "protected routes refuse anonymous access" is
  `N/A`. The first admin route must come with a smoke probe that is 401/403 or
  a redirect when signed out.
- **Neon itself is not tested.** That covers the pooler's exact behaviour,
  cold-start latency, autosuspend timing, branch copies, and channel binding
  being enforced. pg 8 uses SCRAM-SHA-256-PLUS when the server offers it but
  cannot *require* it. Certificate verification is what protects the
  connection.
- **pg 9 will change `sslmode=require`** to libpq semantics: TLS without
  certificate verification. `pg` is `^8.23.1`, so it will not arrive by
  itself. When it is upgraded, switch the Neon URLs to `sslmode=verify-full`,
  or keep verification some other way. TLS-02 will catch the change.
- **No load, concurrency or pool-exhaustion tests.**
- **The dependency audit is report-only.** The `next` critical advisory needs a
  minor upgrade outside the pinned version (see the latest report).
