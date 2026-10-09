/**
 * A stand-in for bkesari.com's OpenID provider: discovery, JWKS, token and
 * userinfo, answered through a stubbed global fetch, signing with a real RSA
 * key so every signature check in src/server/sso runs for real.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";

export const ISSUER = "https://dev.bkesari.com/auth";
export const CLIENT_ID = "agtci-dev";
export const CLIENT_SECRET = "agtci-secret";
export const SITE = "https://dev.agtci.com";

export function configureOidcEnv() {
  Object.assign(process.env, { OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: CLIENT_ID, OIDC_CLIENT_SECRET: CLIENT_SECRET, AGTCI_URL: SITE });
}

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-kid";
const jwk = { ...createPublicKey(createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }))).export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

export function signJwt(payload: Record<string, unknown>, header: Record<string, unknown> = {}, key = privateKey): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID, ...header })).toString("base64url");
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${h}.${b}.${sign("RSA-SHA256", Buffer.from(`${h}.${b}`), key).toString("base64url")}`;
}

export const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

export interface FakeIdp {
  /** What userinfo answers; null = the bkesari.com session has ended (401). */
  userinfo: Record<string, unknown> | null;
  /** The code the token endpoint accepts, with what it returns. */
  codes: Map<string, { verifier: string; idClaims: Record<string, unknown> }>;
  calls: string[];
}

export function fakeIdp(): FakeIdp {
  const idp: FakeIdp = { userinfo: null, codes: new Map(), calls: [] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    idp.calls.push(url);
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/oauth/token`,
        userinfo_endpoint: `${ISSUER}/oauth/userinfo`, jwks_uri: `${ISSUER}/oauth/jwks`, end_session_endpoint: `${ISSUER}/oauth/logout`,
      });
    }
    if (url === `${ISSUER}/oauth/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${ISSUER}/oauth/token`) {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")) return Response.json({ error: "invalid_client" }, { status: 401 });
      const body = new URLSearchParams(String(init?.body));
      const grant = idp.codes.get(body.get("code") ?? "");
      if (!grant || body.get("redirect_uri") !== `${SITE}/auth/callback`) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const { createHash } = await import("node:crypto");
      if (createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url") !== grant.verifier) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      idp.codes.delete(body.get("code") ?? "");
      return Response.json({ token_type: "Bearer", access_token: `at-${randomUUID()}`, id_token: signJwt(grant.idClaims), expires_in: 3600 });
    }
    if (url === `${ISSUER}/oauth/userinfo`) {
      return idp.userinfo ? Response.json(idp.userinfo) : Response.json({ error: "invalid_token" }, { status: 401 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return idp;
}

export function idClaims(over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: ISSUER, aud: CLIENT_ID, sub: "central-user-1", sid: "sid-1", iat: now, exp: now + 600, nonce: "n", email: "client@example.test", ...over };
}

export function userinfo(over: Record<string, unknown> = {}) {
  return {
    sub: "central-user-1", sid: "sid-1", email: "client@example.test", name: "Client One",
    bkesari: { feature: "AGTCI", entitled: true, permissions: ["agtci.view_client_area"], subscription: null, mfa: false },
    ...over,
  };
}
