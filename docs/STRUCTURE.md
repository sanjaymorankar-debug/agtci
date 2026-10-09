# agtci.com: what exists, and the structure this branch adds

## What existed before this branch (2026-10-09)

- Next.js 16.3 / React 19 / Tailwind 4, Drizzle on MySQL. No test runner.
- **One page**: the create-next-app placeholder (`src/app/page.tsx`).
- A designed but unused schema (`drizzle/0000_*`): `products`, `categories`,
  `leads` (enquiries, with statuses NEW → COMPLETED / LOST), `services`,
  `certifications`, `site_content`, `admin_users` (password hashes, ADMIN/STAFF),
  `audit_logs`.
- `next-auth` and its Drizzle adapter installed but not wired up: **no login of any kind**.
- `src/lib/company.ts`: business identity, with PLACEHOLDER fields still to fill.

## What this branch adds

Identity comes only from bkesari.com (OpenID Connect). Business data stays
here, in this site's own database.

| Path | Who | What |
|---|---|---|
| `/`, `/services`, `/contact`, `/privacy` | anyone | public site; the contact form writes a `leads` row (`CONTACT_FORM`) |
| `/client` | signed in, AGTCI subscribed, `agtci.view_client_area` | the client's own enquiries (matched on the verified email) |
| `/client/enquiries` | + `agtci.manage_enquiries` (AGTCI moderators, bkesari admins) | every enquiry; change status (audited in `audit_logs`) |
| `/auth/login` → bkesari.com → `/auth/callback` | | code + PKCE; silent when already signed in at bkesari.com |
| `/auth/logout` (POST) | | ends the session here and at bkesari.com |
| `/auth/backchannel-logout` (POST) | bkesari.com, server to server | ends sessions here when one ends there |

Unsubscribed users see a "request access" link to bkesari.com, never the
content; the API answers 403. A signed-in session is re-checked against
bkesari.com every minute, so a revoked subscription or a logout elsewhere
takes effect even if the back-channel call is lost.

New table: `sso_sessions` (`drizzle/0001_sso_sessions.sql`): hashed cookie id,
the bkesari.com `sid`, the user, entitlement and `agtci.*` permissions, the
encrypted access token and the ID token (for logout).

`admin_users` is left in place and unused. When the admin CMS is built it
should use the same bkesari.com sign-in (`agtci.manage_enquiries`, or a new
`agtci.manage_content` permission in bkesari-platform `portal/auth/rbac.js`)
rather than its own passwords.

## Tests

`npm test` (Node's test runner via tsx, against `TEST_DATABASE_URL`):
the full sign-in with a stand-in provider signing real RS256 tokens, every
ID-token and logout-token rejection case, access per permission, back-channel
and userinfo-driven single logout, RP-initiated logout, and the public form.
