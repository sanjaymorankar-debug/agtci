/**
 * bkesari.com sends the visitor back here with a one-time code. The code is
 * exchanged server-side (client secret + PKCE verifier), the ID token is
 * verified, and a session for this site is created.
 */
import { NextResponse, type NextRequest } from "next/server";

import { discover, exchangeCode, fetchUserInfo, oidcConfig, unsealState, verifyIdToken } from "@/server/sso/oidc";
import { createSession, SESSION_TTL_SECONDS, sessionCookieName } from "@/server/sso/session";

function fail(message: string, status = 400) {
  return new NextResponse(`${message}\n\nGo back to the home page and try signing in again.`, {
    status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const cfg = oidcConfig();
  if (!cfg) return fail("Sign-in is not configured on this site.", 503);
  const params = request.nextUrl.searchParams;
  const login = unsealState(cfg, request.cookies.get("agtci_oidc")?.value);
  if (!login || !params.get("state") || params.get("state") !== login.state) return fail("This sign-in expired or did not start here.");

  const error = params.get("error");
  if (error) {
    // Not signed in at bkesari.com (prompt=none) or the visitor cancelled.
    return NextResponse.redirect(new URL("/", cfg.redirectUri));
  }
  const code = params.get("code");
  if (!code) return fail("bkesari.com did not return a code.");

  let cookieValue: string;
  try {
    const tokens = await exchangeCode(cfg, code, login.verifier);
    const d = await discover(cfg);
    const claims = await verifyIdToken(tokens.id_token, cfg, d, login.nonce);
    const info = await fetchUserInfo(cfg, tokens.access_token);
    if (!info || info.sub !== claims.sub) return fail("bkesari.com did not confirm this sign-in.", 401);
    cookieValue = await createSession(cfg, { info, accessToken: tokens.access_token, idToken: tokens.id_token, sid: claims.sid });
  } catch (e) {
    console.error("[agtci-sso] callback failed:", (e as Error).message);
    return fail("Signing in did not complete.", 401);
  }

  const res = NextResponse.redirect(new URL(login.returnTo, cfg.redirectUri));
  res.cookies.set(sessionCookieName(cfg), cookieValue, { httpOnly: true, secure: cfg.secure, sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS });
  res.cookies.set("agtci_oidc", "", { httpOnly: true, secure: cfg.secure, sameSite: "lax", path: "/auth", maxAge: 0 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
