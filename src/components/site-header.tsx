import Link from "next/link";

import { COMPANY } from "@/lib/company";
import { currentSession } from "@/server/sso/access";
import { csrfToken } from "@/server/sso/session";

/** Site header. Shows sign-in only when sign-in through bkesari.com is configured. */
export async function SiteHeader() {
  const { cfg, session } = await currentSession();
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight">{COMPANY.tradeName}</Link>
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/services">Services</Link>
          <Link href="/contact">Contact</Link>
          {cfg ? <Link href="/client">Client area</Link> : null}
        </nav>
        <div className="ml-auto text-sm">
          {cfg && session ? (
            <form action="/auth/logout" method="post" className="flex items-center gap-3">
              <input type="hidden" name="csrf" value={csrfToken(cfg, session)} />
              <span className="opacity-70">{session.name ?? session.email}</span>
              <button type="submit" className="rounded border border-black/20 px-3 py-1 dark:border-white/20">Sign out</button>
            </form>
          ) : cfg ? (
            <a href="/auth/login?returnTo=/client" className="rounded border border-black/20 px-3 py-1 dark:border-white/20">Sign in</a>
          ) : null}
        </div>
      </div>
    </header>
  );
}
