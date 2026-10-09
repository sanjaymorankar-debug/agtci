/**
 * OpenID Connect back-channel logout: bkesari.com calls this, server to
 * server, when a session ends there, and every agtci.com session that came
 * from it ends here at once.
 */
import { type NextRequest } from "next/server";

import { discover, oidcConfig, verifyLogoutToken } from "@/server/sso/oidc";
import { endSessionsForSid } from "@/server/sso/session";

export async function POST(request: NextRequest) {
  const cfg = oidcConfig();
  if (!cfg) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const token = form?.get("logout_token");
  if (typeof token !== "string") return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const { sid } = await verifyLogoutToken(token, cfg, await discover(cfg));
    await endSessionsForSid(sid);
  } catch (error) {
    console.error("[agtci-sso] rejected a logout token:", (error as Error).message);
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}
