/**
 * agtci.com signs in through bkesari.com (OpenID Connect, code + PKCE):
 * token verification, the callback, client-area access per permission,
 * single logout (back-channel and userinfo), and RP-initiated logout.
 */
import "./setup";

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { CLIENT_ID, ISSUER, SITE, fakeIdp, idClaims, otherKey, signJwt, configureOidcEnv, userinfo, type FakeIdp } from "./helpers";

configureOidcEnv();

const { db } = await import("@/server/db");
const { leads, ssoSessions } = await import("@/server/db/schema");
const oidc = await import("@/server/sso/oidc");
const session = await import("@/server/sso/session");
const { accessFor } = await import("@/server/sso/access");
const login = await import("@/app/auth/login/route");
const callback = await import("@/app/auth/callback/route");
const backchannel = await import("@/app/auth/backchannel-logout/route");
const logout = await import("@/app/auth/logout/route");
const enquiries = await import("@/app/api/enquiries/route");

const cfg = oidc.oidcConfig()!;
let idp: FakeIdp;

before(async () => { await db.delete(ssoSessions); });
beforeEach(() => { oidc.resetOidcCaches(); idp = fakeIdp(); });
after(async () => {
  await db.delete(ssoSessions);
  await db.delete(leads).where(eq(leads.email, "enquirer@example.test"));
  process.exit(0); // the mysql2 pool keeps the event loop alive
});

/** Runs /auth/login then /auth/callback as a browser would, with bkesari.com signing the user in. */
async function signIn(claims: Record<string, unknown> = {}, info = userinfo()) {
  const start = await login.GET(new NextRequest(`${SITE}/auth/login?returnTo=/client`));
  assert.equal(start.status, 307);
  const authorize = new URL(start.headers.get("location")!);
  assert.equal(authorize.origin + authorize.pathname, `${ISSUER}/oauth/authorize`);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(authorize.searchParams.get("redirect_uri"), `${SITE}/auth/callback`);
  const stateCookie = start.cookies.get("agtci_oidc")!.value;
  const sealed = oidc.unsealState(cfg, stateCookie)!;
  idp.codes.set("code-1", {
    verifier: authorize.searchParams.get("code_challenge")!,
    idClaims: idClaims({ nonce: authorize.searchParams.get("nonce"), ...claims }),
  });
  idp.userinfo = info;
  const res = await callback.GET(new NextRequest(`${SITE}/auth/callback?code=code-1&state=${authorize.searchParams.get("state")}`, {
    headers: { cookie: `agtci_oidc=${stateCookie}` },
  }));
  return { res, sealed, cookie: res.cookies.get("__Host-agtci_session")?.value };
}

describe("sign-in", () => {
  it("code + PKCE: verifies the ID token and creates a session for this site", async () => {
    const { res, cookie } = await signIn();
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), `${SITE}/client`);
    assert.ok(cookie, "session cookie set");
    const set = res.headers.get("set-cookie") ?? "";
    assert.match(set, /__Host-agtci_session=[^;]+; Path=\/;.*?Secure; HttpOnly; SameSite=lax/i);
    assert.match(set, /Secure/);
    const s = await session.getSession(cfg, cookie);
    assert.equal(s?.email, "client@example.test");
    assert.equal(s?.entitled, true);
    assert.deepEqual(s?.permissions, ["agtci.view_client_area"]);
    // Only the hash is stored.
    const row = await db.query.ssoSessions.findFirst({ where: eq(ssoSessions.sub, "central-user-1") });
    assert.notEqual(row?.id, cookie);
    assert.ok(!row?.accessTokenEnc.startsWith("at-"), "the access token is encrypted at rest");
  });

  it("refuses a callback whose state does not match", async () => {
    const res = await callback.GET(new NextRequest(`${SITE}/auth/callback?code=x&state=forged`, { headers: { cookie: "agtci_oidc=junk" } }));
    assert.equal(res.status, 400);
  });

  it("refuses ID tokens with the wrong nonce, audience, issuer, expiry or key", async () => {
    for (const bad of [{ nonce: "other" }, { aud: "someone-else" }, { iss: "https://gokesari.com/auth" }, { exp: 1 }]) {
      const { res, cookie } = await signIn(bad);
      assert.equal(res.status, 401, JSON.stringify(bad));
      assert.equal(cookie, undefined);
    }
    const d = await oidc.discover(cfg);
    const forged = signJwt(idClaims(), {}, otherKey);
    await assert.rejects(oidc.verifyIdToken(forged, cfg, d, "n"), /bad signature/);
  });
});

describe("client area access", () => {
  const base = { id: "x", sid: "s", sub: "u", email: "e", name: null, idToken: "t" };
  it("decides by entitlement and permission, server-side", () => {
    assert.equal(accessFor(null, null, "agtci.view_client_area").kind, "off");
    assert.equal(accessFor(cfg, null, "agtci.view_client_area").kind, "anonymous");
    assert.equal(accessFor(cfg, { ...base, entitled: false, permissions: [] }, "agtci.view_client_area").kind, "not_entitled");
    assert.equal(accessFor(cfg, { ...base, entitled: true, permissions: ["agtci.view_client_area"] }, "agtci.view_client_area").kind, "ok");
    assert.equal(accessFor(cfg, { ...base, entitled: true, permissions: ["agtci.view_client_area"] }, "agtci.manage_enquiries").kind, "forbidden");
    assert.equal(accessFor(cfg, { ...base, entitled: true, permissions: ["agtci.view_client_area", "agtci.manage_enquiries"] }, "agtci.manage_enquiries").kind, "ok");
  });

  it("a signed-in user without AGTCI gets a session that is not entitled", async () => {
    const { cookie } = await signIn({ sub: "central-user-2", sid: "sid-2" }, userinfo({ sub: "central-user-2", sid: "sid-2", bkesari: { feature: "AGTCI", entitled: false, permissions: [], mfa: false } }));
    const s = await session.getSession(cfg, cookie);
    assert.equal(s?.entitled, false);
    assert.equal(accessFor(cfg, s, "agtci.view_client_area").kind, "not_entitled");
  });
});

describe("single logout", () => {
  it("back-channel logout from bkesari.com ends every session from that sid", async () => {
    const { cookie } = await signIn({ sid: "sid-bc" }, userinfo({ sid: "sid-bc" }));
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({ iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + 120, jti: "j", sid: "sid-bc", sub: "central-user-1",
      events: { "http://schemas.openid.net/event/backchannel-logout": {} } }, { typ: "logout+jwt" });
    const res = await backchannel.POST(new NextRequest(`${SITE}/auth/backchannel-logout`, {
      method: "POST", body: new URLSearchParams({ logout_token: token }), headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    assert.equal(res.status, 200);
    assert.equal(await session.getSession(cfg, cookie), null);
  });

  it("rejects forged or malformed logout tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const good = { iss: ISSUER, aud: CLIENT_ID, iat: now, sid: "sid-x", events: { "http://schemas.openid.net/event/backchannel-logout": {} } };
    for (const token of [
      signJwt(good, { typ: "logout+jwt" }, otherKey),
      signJwt({ ...good, aud: "other" }, { typ: "logout+jwt" }),
      signJwt({ ...good, events: {} }, { typ: "logout+jwt" }),
      signJwt({ ...good, nonce: "n" }, { typ: "logout+jwt" }),
      "not-a-jwt",
    ]) {
      const res = await backchannel.POST(new NextRequest(`${SITE}/auth/backchannel-logout`, {
        method: "POST", body: new URLSearchParams({ logout_token: token }), headers: { "content-type": "application/x-www-form-urlencoded" },
      }));
      assert.equal(res.status, 400);
    }
  });

  it("even without the back-channel call, the next userinfo check ends the session", async () => {
    const { cookie } = await signIn({ sid: "sid-ui" }, userinfo({ sid: "sid-ui" }));
    await db.update(ssoSessions).set({ checkedAt: new Date(Date.now() - 120_000) }).where(eq(ssoSessions.sid, "sid-ui"));
    idp.userinfo = null; // bkesari.com session over
    assert.equal(await session.getSession(cfg, cookie), null);
    assert.equal((await db.select().from(ssoSessions).where(eq(ssoSessions.sid, "sid-ui"))).length, 0);
  });

  it("a revoked subscription is noticed at the next check", async () => {
    const { cookie } = await signIn({ sid: "sid-rev" }, userinfo({ sid: "sid-rev" }));
    await db.update(ssoSessions).set({ checkedAt: new Date(Date.now() - 120_000) }).where(eq(ssoSessions.sid, "sid-rev"));
    idp.userinfo = userinfo({ sid: "sid-rev", bkesari: { feature: "AGTCI", entitled: false, permissions: [], mfa: false } });
    const s = await session.getSession(cfg, cookie);
    assert.equal(s?.entitled, false);
    assert.deepEqual(s?.permissions, []);
  });

  it("logout here ends the local session and hands bkesari.com the ID token to end its own", async () => {
    const { cookie } = await signIn({ sid: "sid-out" }, userinfo({ sid: "sid-out" }));
    const s = (await session.getSession(cfg, cookie))!;
    const forged = await logout.POST(new NextRequest(`${SITE}/auth/logout`, {
      method: "POST", body: new URLSearchParams({ csrf: "wrong" }),
      headers: { cookie: `__Host-agtci_session=${cookie}`, "content-type": "application/x-www-form-urlencoded" },
    }));
    assert.equal(forged.status, 403);
    const res = await logout.POST(new NextRequest(`${SITE}/auth/logout`, {
      method: "POST", body: new URLSearchParams({ csrf: session.csrfToken(cfg, s) }),
      headers: { cookie: `__Host-agtci_session=${cookie}`, "content-type": "application/x-www-form-urlencoded" },
    }));
    assert.equal(res.status, 303);
    const target = new URL(res.headers.get("location")!);
    assert.equal(target.origin + target.pathname, `${ISSUER}/oauth/logout`);
    assert.equal(target.searchParams.get("id_token_hint"), s.idToken);
    assert.equal(target.searchParams.get("post_logout_redirect_uri"), `${SITE}/`);
    assert.equal(await session.getSession(cfg, cookie), null);
  });
});

describe("public pages need no login", () => {
  it("the enquiry form stores an enquiry without any session", async () => {
    const res = await enquiries.POST(new NextRequest(`${SITE}/api/enquiries`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ fullName: "Enquirer", email: "Enquirer@Example.test", specification: "20 tonnes of turmeric, CIF Dubai" }),
    }));
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location")!, /\/contact\?sent=1$/);
    const row = await db.query.leads.findFirst({ where: eq(leads.email, "enquirer@example.test") });
    assert.equal(row?.source, "CONTACT_FORM");
    assert.equal(row?.status, "NEW");
  });

  it("rejects an incomplete enquiry with a message", async () => {
    const res = await enquiries.POST(new NextRequest(`${SITE}/api/enquiries`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ fullName: "E", email: "nope", specification: "" }),
    }));
    assert.match(decodeURIComponent(res.headers.get("location")!), /error=/);
  });
});
