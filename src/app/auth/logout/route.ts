/**
 * Sign out of agtci.com AND bkesari.com: the local session ends here, then
 * bkesari.com ends its own (and tells every other site through back-channel
 * logout) and returns the visitor to this site's home page.
 */
import { NextResponse, type NextRequest } from "next/server";

import { endSessionUrl, oidcConfig } from "@/server/sso/oidc";
import { csrfToken, destroySession, getSession, sessionCookieName } from "@/server/sso/session";

export async function POST(request: NextRequest) {
  const cfg = oidcConfig();
  if (!cfg) return NextResponse.redirect(new URL("/", request.url), 303);
  const token = request.cookies.get(sessionCookieName(cfg))?.value;
  const session = await getSession(cfg, token);
  const form = await request.formData().catch(() => null);
  if (session && form?.get("csrf") !== csrfToken(cfg, session)) {
    return new NextResponse("This form expired. Go back, reload and try again.", { status: 403 });
  }
  const row = await destroySession(token);
  let target = new URL("/", cfg.redirectUri).toString();
  if (row) {
    try { target = await endSessionUrl(cfg, row.idToken); } catch { /* signed out here at least */ }
  }
  const res = NextResponse.redirect(target, 303);
  res.cookies.set(sessionCookieName(cfg), "", { httpOnly: true, secure: cfg.secure, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
