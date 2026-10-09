import Link from "next/link";
import type { Metadata } from "next";

import { gate } from "@/components/access-gate";
import { checkAccess } from "@/server/sso/access";
import { enquiriesFor } from "@/server/services/enquiries";

export const metadata: Metadata = { title: "Client area" };
export const dynamic = "force-dynamic";

export default async function ClientArea() {
  const access = await checkAccess("agtci.view_client_area");
  const blocked = gate(access, "/client");
  if (blocked || access.kind !== "ok") return blocked;
  const { session } = access;
  const mine = await enquiriesFor(session.email);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Client area</h1>
      <p className="opacity-80">Signed in as {session.name ?? session.email}.</p>
      {session.permissions.includes("agtci.manage_enquiries") ? (
        <p><Link className="underline" href="/client/enquiries">Manage all enquiries</Link></p>
      ) : null}
      <h2 className="text-lg font-semibold">Your enquiries</h2>
      {mine.length === 0 ? (
        <p>No enquiries yet. <Link className="underline" href="/contact">Send one</Link>.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead><tr><th className="py-2">Sent</th><th>Requirement</th><th>Status</th></tr></thead>
          <tbody>
            {mine.map((l) => (
              <tr key={l.id} className="border-t border-black/10 dark:border-white/10">
                <td className="py-2 pr-3 whitespace-nowrap">{l.createdAt.toISOString().slice(0, 10)}</td>
                <td className="pr-3">{(l.specification ?? "").slice(0, 120)}</td>
                <td>{l.status.replace(/_/g, " ").toLowerCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
