/**
 * Who may see what on agtci.com. Server-side, for every page and route.
 *
 *   public pages                 anyone
 *   /client                      signed in at bkesari.com + AGTCI + agtci.view_client_area
 *   /client/enquiries (manage)   ... + agtci.manage_enquiries
 */
import { cookies } from "next/headers";

import { oidcConfig, type OidcConfig } from "./oidc";
import { getSession, sessionCookieName, type ClientSession } from "./session";

export type Access =
  | { kind: "off" }
  | { kind: "anonymous"; cfg: OidcConfig }
  | { kind: "not_entitled"; cfg: OidcConfig; session: ClientSession }
  | { kind: "forbidden"; cfg: OidcConfig; session: ClientSession }
  | { kind: "ok"; cfg: OidcConfig; session: ClientSession };

export async function currentSession(): Promise<{ cfg: OidcConfig | null; session: ClientSession | null }> {
  // Read the cookies first, unconditionally: it marks every page that shows
  // the header as per-request, so a page built while sign-in was not
  // configured is not served stale once it is.
  const store = await cookies();
  const cfg = oidcConfig();
  if (!cfg) return { cfg: null, session: null };
  return { cfg, session: await getSession(cfg, store.get(sessionCookieName(cfg))?.value) };
}

export type ClientPermission = "agtci.view_client_area" | "agtci.manage_enquiries";

export async function checkAccess(permission: ClientPermission): Promise<Access> {
  const { cfg, session } = await currentSession();
  return accessFor(cfg, session, permission);
}

/** The decision itself, separate from reading the cookie so it is testable. */
export function accessFor(cfg: OidcConfig | null, session: ClientSession | null, permission: ClientPermission): Access {
  if (!cfg) return { kind: "off" };
  if (!session) return { kind: "anonymous", cfg };
  if (!session.entitled) return { kind: "not_entitled", cfg, session };
  if (!session.permissions.includes(permission)) return { kind: "forbidden", cfg, session };
  return { kind: "ok", cfg, session };
}

/** bkesari.com's "request access" page for the AGTCI feature. */
export function subscribeUrl(cfg: OidcConfig): string {
  return `${new URL(cfg.issuer).origin}/auth/subscribe/agtci`;
}
