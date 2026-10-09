This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Configuration

`src/lib/env.ts` validates the environment once at startup and refuses to run
without `DATABASE_URL` and `AUTH_SECRET`, so a missing value stops the process
immediately rather than surfacing later as a connection error mid-request.

```bash
cp .env.example .env.local      # then fill in a real AUTH_SECRET
npm run db:migrate              # applies drizzle/ to that database
```

## Tests

```bash
npm test        # 15 tests; no database needed, the 8 schema tests skip
npm run lint
```

`npm test` works on a fresh clone. The environment-validation tests need
nothing; the schema tests skip themselves with a reason.

Those schema tests are the ones worth running. `src/server/db/schema.ts` (what
the app queries through) and `drizzle/*.sql` (what actually built the database)
are two artefacts kept in step only by remembering to run `npm run
db:generate`. A column renamed in one and not the other typechecks perfectly
and fails at runtime with "Unknown column". To catch that, point them at a
throwaway MySQL:

```bash
cp .env.test.example .env.test  # defaults match the local devstack
npm run test:db                 # all 15, nothing skipped
```

They apply the committed migrations to an empty database exactly as
`db:migrate` does, then write and read every table through the schema, checking
the declared defaults, the unique and foreign-key constraints, the `json`
columns, and that every value in `LEAD_STATUSES` / `LEAD_SOURCES` exists in its
column's enum. `site_content` gets its own case because `key` is a MySQL
reserved word.

> `TEST_DATABASE_URL`, deliberately not `DATABASE_URL`: these tests **drop
> every table** in the target database. They must not be able to pick up a
> development database from a `.env` by accident.

CI runs both — the server-free tests in the `build` job, the schema tests in
`db-mysql` against a real MySQL 8.0 service, which fails if any case skips.

The test setup adds no dependencies: Node's own test runner, loaded through the
`tsx` that `db:migrate` already uses.

Note that `npx tsc --noEmit` does not work on a fresh clone — `layout.tsx` uses
`LayoutProps`, a type Next generates into `.next/types` during a build. Run
`npm run build`, which typechecks, instead.

## Branches and promotion

| Branch | Environment |
|---|---|
| `staging` | A separate staging subdomain with its own database |
| `main` | The production site |

Work happens on feature branches. Open a PR into `staging`; CI (`.github/workflows/ci.yml`) must pass before merging. Test on staging, then promote with a PR from `staging` into `main`. Don't commit directly to `staging` or `main`.
