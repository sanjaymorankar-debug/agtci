/**
 * Client-area sessions on agtci.com, after signing in at bkesari.com.
 *
 * The cookie holds a random token; the database holds its SHA-256, so the
 * table is useless to whoever reads it. Each session is tied to the
 * bkesari.com session (`sid`) it came from, and is re-checked against
 * bkesari.com's userinfo at most once a minute: when that session has
 * ended (logout anywhere, suspension, revoked access) this one ends too,
 * even if the back-channel logout call was lost.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";

import { db } from "@/server/db";
import { ssoSessions, type SsoSession } from "@/server/db/schema";
import { fetchUserInfo, type OidcConfig, type UserInfo } from "./oidc";

export const SESSION_TTL_SECONDS = 8 * 3600;
const RECHECK_MS = 60_000;
export const FEATURE = "AGTCI";

export function sessionCookieName(cfg: Pick<OidcConfig, "secure">): string {
  return cfg.secure ? "__Host-agtci_session" : "agtci_session";
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function key(cfg: OidcConfig): Buffer {
  return createHash("sha256").update(`agtci-session-key:${cfg.secret}`).digest();
}

function encrypt(cfg: OidcConfig, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(cfg), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

function decrypt(cfg: OidcConfig, blob: string): string {
  const [iv, tag, ct] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(cfg), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

function access(info: UserInfo) {
  const b = info.bkesari;
  const entitled = Boolean(b && b.feature === FEATURE && b.entitled);
  return { entitled, permissions: entitled ? (b!.permissions ?? []).filter((p) => p.startsWith("agtci.")) : [] };
}

/** Creates a session and returns the cookie value. */
export async function createSession(cfg: OidcConfig, args: { info: UserInfo; accessToken: string; idToken: string; sid: string }): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { entitled, permissions } = access(args.info);
  await db.insert(ssoSessions).values({
    id: hash(token),
    sid: args.sid,
    sub: args.info.sub,
    email: args.info.email ?? "",
    name: args.info.name ?? null,
    entitled,
    permissions,
    accessTokenEnc: encrypt(cfg, args.accessToken),
    idToken: args.idToken,
    checkedAt: new Date(),
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });
  // Housekeeping: expired rows are useless.
  await db.delete(ssoSessions).where(lt(ssoSessions.expiresAt, new Date())).catch(() => {});
  return token;
}

export interface ClientSession {
  id: string;
  sid: string;
  sub: string;
  email: string;
  name: string | null;
  entitled: boolean;
  permissions: string[];
  idToken: string;
}

const toClient = (row: SsoSession): ClientSession => ({
  id: row.id, sid: row.sid, sub: row.sub, email: row.email, name: row.name,
  entitled: row.entitled, permissions: row.permissions ?? [], idToken: row.idToken,
});

/**
 * The live session for a cookie value, or null. Re-checks with bkesari.com
 * when the last check is older than a minute. If bkesari.com cannot be
 * reached, the last known answer stands for at most five minutes.
 */
export async function getSession(cfg: OidcConfig, token: string | undefined, fetchImpl: typeof fetch = fetch): Promise<ClientSession | null> {
  if (!token || token.length > 200) return null;
  const row = await db.query.ssoSessions.findFirst({ where: eq(ssoSessions.id, hash(token)) });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(ssoSessions).where(eq(ssoSessions.id, row.id));
    return null;
  }
  const age = Date.now() - row.checkedAt.getTime();
  if (age < RECHECK_MS) return toClient(row);
  let info: UserInfo | null;
  try {
    info = await fetchUserInfo(cfg, decrypt(cfg, row.accessTokenEnc), fetchImpl);
  } catch (error) {
    console.error("[agtci-sso] userinfo check failed:", (error as Error).message);
    return age < 5 * RECHECK_MS ? toClient(row) : null;
  }
  if (!info || info.sub !== row.sub) {
    await db.delete(ssoSessions).where(eq(ssoSessions.sid, row.sid));
    return null;
  }
  const { entitled, permissions } = access(info);
  await db.update(ssoSessions).set({ entitled, permissions, checkedAt: new Date(), name: info.name ?? row.name }).where(eq(ssoSessions.id, row.id));
  return { ...toClient(row), entitled, permissions, name: info.name ?? row.name };
}

/** Back-channel logout: ends every session that came from this bkesari.com session. */
export async function endSessionsForSid(sid: string): Promise<number> {
  const rows = await db.select({ id: ssoSessions.id }).from(ssoSessions).where(eq(ssoSessions.sid, sid));
  await db.delete(ssoSessions).where(eq(ssoSessions.sid, sid));
  return rows.length;
}

export async function destroySession(token: string | undefined): Promise<SsoSession | null> {
  if (!token) return null;
  const row = await db.query.ssoSessions.findFirst({ where: eq(ssoSessions.id, hash(token)) });
  if (row) await db.delete(ssoSessions).where(eq(ssoSessions.id, row.id));
  return row ?? null;
}

/** CSRF token for this session's forms: derived from the session id, so it needs no storage. */
export function csrfToken(cfg: OidcConfig, session: ClientSession): string {
  return createHash("sha256").update(`agtci-csrf:${cfg.secret}:${session.id}`).digest("base64url");
}
