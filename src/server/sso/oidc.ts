/**
 * OpenID Connect client for signing in at bkesari.com: authorization code
 * flow with PKCE (S256), state and nonce, server-side code exchange, and RS256
 * ID-token verification against the provider's published keys.
 *
 * agtci.com and bkesari.com are different sites, so no cookie can be shared:
 * this redirects to bkesari.com, which signs the visitor in (silently, if they
 * already are) and sends back a one-time code that only this server, holding
 * the client secret and the PKCE verifier, can exchange.
 *
 * No library: Node's crypto does all of it, and every check is visible here.
 */
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as cryptoVerify, type JsonWebKey } from "node:crypto";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  /** Signs the state cookie. */
  secret: string;
  /** Secure cookies (https site). */
  secure: boolean;
}

export function oidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const issuer = (env.OIDC_ISSUER ?? "").trim().replace(/\/+$/, "");
  const clientId = (env.OIDC_CLIENT_ID ?? "").trim();
  const clientSecret = env.OIDC_CLIENT_SECRET ?? "";
  if (!issuer || !clientId || !clientSecret) return null;
  const site = (env.AGTCI_URL ?? env.AUTH_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: `${site}/auth/callback`,
    postLogoutRedirectUri: `${site}/`,
    secret: env.AUTH_SECRET ?? "",
    secure: site.startsWith("https://"),
  };
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  end_session_endpoint: string;
}

type Fetch = typeof fetch;
const discoveryCache = new Map<string, { at: number; value: Discovery }>();
const jwksCache = new Map<string, { at: number; keys: (JsonWebKey & { kid?: string })[] }>();
const HOUR = 3600_000;

export async function discover(cfg: OidcConfig, fetchImpl: Fetch = fetch): Promise<Discovery> {
  const hit = discoveryCache.get(cfg.issuer);
  if (hit && Date.now() - hit.at < HOUR) return hit.value;
  const res = await fetchImpl(`${cfg.issuer}/.well-known/openid-configuration`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`discovery answered ${res.status}`);
  const value = (await res.json()) as Discovery;
  if (value.issuer !== cfg.issuer) throw new Error("discovery issuer mismatch");
  discoveryCache.set(cfg.issuer, { at: Date.now(), value });
  return value;
}

async function jwks(d: Discovery, fetchImpl: Fetch, { refresh = false } = {}) {
  const hit = jwksCache.get(d.jwks_uri);
  if (!refresh && hit && Date.now() - hit.at < HOUR) return hit.keys;
  const res = await fetchImpl(d.jwks_uri, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`jwks answered ${res.status}`);
  const keys = ((await res.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys ?? [];
  jwksCache.set(d.jwks_uri, { at: Date.now(), keys });
  return keys;
}

/** For tests: forget cached discovery documents and keys. */
export function resetOidcCaches() {
  discoveryCache.clear();
  jwksCache.clear();
}

/* ------------------------------------------------------------------ PKCE, state */

const b64url = (buf: Buffer) => buf.toString("base64url");

export function pkcePair() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

/** Tamper-evident (HMAC) and short-lived. The verifier is only ever in this cookie and the token request. */
export function sealState(cfg: OidcConfig, value: LoginState, ttlSeconds = 600): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...value, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = b64url(createHmac("sha256", cfg.secret).update(`oidc-state:${body}`).digest());
  return `${body}.${sig}`;
}

export function unsealState(cfg: OidcConfig, sealed: string | undefined): LoginState | null {
  const [body, sig] = String(sealed ?? "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", cfg.secret).update(`oidc-state:${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString()) as LoginState & { exp: number };
    if (!v.exp || v.exp * 1000 < Date.now()) return null;
    return { state: v.state, nonce: v.nonce, verifier: v.verifier, returnTo: v.returnTo };
  } catch {
    return null;
  }
}

/** Only paths on this site. */
export function safeReturnTo(value: string | null | undefined): string {
  const v = String(value ?? "");
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") && !/[\r\n]/.test(v) ? v : "/client";
}

export async function authorizationUrl(cfg: OidcConfig, login: LoginState, challenge: string, fetchImpl: Fetch = fetch) {
  const d = await discover(cfg, fetchImpl);
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: "openid email profile",
    state: login.state,
    nonce: login.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

/* ------------------------------------------------------------------ JWT verification */

export interface IdClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  sid: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string | null;
}

/** Verifies an RS256 JWT's signature against the provider's keys; returns header and payload. */
export async function verifyJwt(token: string, d: Discovery, fetchImpl: Fetch = fetch) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as { alg?: string; kid?: string; typ?: string };
  if (header.alg !== "RS256") throw new Error("unexpected alg");
  let keys = await jwks(d, fetchImpl);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // The provider may have rotated its key since we cached the set.
    keys = await jwks(d, fetchImpl, { refresh: true });
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("unknown signing key");
  const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!ok) throw new Error("bad signature");
  return { header, payload: JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown> };
}

const SKEW = 60;

export async function verifyIdToken(token: string, cfg: OidcConfig, d: Discovery, nonce: string, fetchImpl: Fetch = fetch): Promise<IdClaims> {
  const { payload } = await verifyJwt(token, d, fetchImpl);
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== cfg.issuer) throw new Error("issuer mismatch");
  if (payload.aud !== cfg.clientId) throw new Error("audience mismatch");
  if (typeof payload.exp !== "number" || payload.exp + SKEW < now) throw new Error("expired");
  if (typeof payload.iat !== "number" || payload.iat - SKEW > now) throw new Error("issued in the future");
  if (payload.nonce !== nonce) throw new Error("nonce mismatch");
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") throw new Error("missing sub or sid");
  return payload as unknown as IdClaims;
}

const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/** OpenID Connect Back-Channel Logout 1.0 §2.6 checks. Returns the sid to end. */
export async function verifyLogoutToken(token: string, cfg: OidcConfig, d: Discovery, fetchImpl: Fetch = fetch): Promise<{ sid: string; sub?: string }> {
  const { header, payload } = await verifyJwt(token, d, fetchImpl);
  const now = Math.floor(Date.now() / 1000);
  if (header.typ && header.typ !== "logout+jwt") throw new Error("not a logout token");
  if (payload.iss !== cfg.issuer) throw new Error("issuer mismatch");
  if (payload.aud !== cfg.clientId) throw new Error("audience mismatch");
  if (typeof payload.iat !== "number" || payload.iat - SKEW > now) throw new Error("bad iat");
  if (typeof payload.exp === "number" && payload.exp + SKEW < now) throw new Error("expired");
  if (!payload.events || typeof payload.events !== "object" || !(BACKCHANNEL_EVENT in (payload.events as object))) throw new Error("no logout event");
  if ("nonce" in payload) throw new Error("a logout token must not carry a nonce");
  if (typeof payload.sid !== "string") throw new Error("no sid");
  return { sid: payload.sid, sub: typeof payload.sub === "string" ? payload.sub : undefined };
}

/* ------------------------------------------------------------------ token + userinfo */

export interface TokenSet {
  access_token: string;
  id_token: string;
  expires_in: number;
}

export async function exchangeCode(cfg: OidcConfig, code: string, verifier: string, fetchImpl: Fetch = fetch): Promise<TokenSet> {
  const d = await discover(cfg, fetchImpl);
  const res = await fetchImpl(d.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, code_verifier: verifier }).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
  return (await res.json()) as TokenSet;
}

export interface UserInfo {
  sub: string;
  sid: string;
  email?: string;
  name?: string | null;
  bkesari?: { feature: string; entitled: boolean; permissions: string[]; mfa: boolean };
}

/** null when the bkesari.com session behind the token has ended. */
export async function fetchUserInfo(cfg: OidcConfig, accessToken: string, fetchImpl: Fetch = fetch): Promise<UserInfo | null> {
  const d = await discover(cfg, fetchImpl);
  const res = await fetchImpl(d.userinfo_endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`userinfo answered ${res.status}`);
  return (await res.json()) as UserInfo;
}

export async function endSessionUrl(cfg: OidcConfig, idToken: string, fetchImpl: Fetch = fetch): Promise<string> {
  const d = await discover(cfg, fetchImpl);
  const u = new URL(d.end_session_endpoint);
  u.search = new URLSearchParams({ id_token_hint: idToken, post_logout_redirect_uri: cfg.postLogoutRedirectUri }).toString();
  return u.toString();
}
