/**
 * Starts sign-in at bkesari.com (OpenID Connect, code + PKCE).
 * If the visitor is already signed in there, they come straight back.
 */
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

import { authorizationUrl, oidcConfig, pkcePair, safeReturnTo, sealState } from "@/server/sso/oidc";

export async function GET(request: NextRequest) {
  const cfg = oidcConfig();
  if (!cfg) return new NextResponse("Sign-in is not configured on this site.", { status: 503 });
  const { verifier, challenge } = pkcePair();
  const login = {
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    verifier,
    returnTo: safeReturnTo(request.nextUrl.searchParams.get("returnTo")),
  };
  let url: string;
  try {
    url = await authorizationUrl(cfg, login, challenge);
  } catch (error) {
    console.error("[agtci-sso] discovery failed:", (error as Error).message);
    return new NextResponse("Sign-in is unavailable right now. Please try again shortly.", { status: 502 });
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("agtci_oidc", sealState(cfg, login), { httpOnly: true, secure: cfg.secure, sameSite: "lax", path: "/auth", maxAge: 600 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
