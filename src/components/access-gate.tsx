import { redirect } from "next/navigation";

import type { Access } from "@/server/sso/access";
import { subscribeUrl } from "@/server/sso/access";

/**
 * What a gated page shows when access is not "ok". Never the content: only
 * sign-in, request-access or not-allowed. Returns null when access is ok.
 */
export function gate(access: Access, returnTo: string) {
  switch (access.kind) {
    case "off":
      return <p>The client area is not available on this site yet.</p>;
    case "anonymous":
      redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    case "not_entitled":
      return (
        <div className="max-w-xl space-y-3">
          <h1 className="text-2xl font-bold">Client area</h1>
          <p>Your bkesari account does not include the AGTCI client area yet.</p>
          <p><a className="underline" href={subscribeUrl(access.cfg)}>Request access</a></p>
        </div>
      );
    case "forbidden":
      return <p>You do not have access to this page.</p>;
    default:
      return null;
  }
}
