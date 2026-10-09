import type { Metadata } from "next";

import { gate } from "@/components/access-gate";
import { LEAD_STATUSES } from "@/server/db/schema";
import { checkAccess } from "@/server/sso/access";
import { csrfToken } from "@/server/sso/session";
import { allEnquiries } from "@/server/services/enquiries";

export const metadata: Metadata = { title: "Manage enquiries" };
export const dynamic = "force-dynamic";

export default async function ManageEnquiries() {
  const access = await checkAccess("agtci.manage_enquiries");
  const blocked = gate(access, "/client/enquiries");
  if (blocked || access.kind !== "ok") return blocked;
  const rows = await allEnquiries();
  const csrf = csrfToken(access.cfg, access.session);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Manage enquiries</h1>
      <table className="w-full text-left text-sm">
        <thead><tr><th className="py-2">Received</th><th>From</th><th>Requirement</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="border-t border-black/10 align-top dark:border-white/10">
              <td className="py-2 pr-3 whitespace-nowrap">{l.createdAt.toISOString().slice(0, 10)}</td>
              <td className="pr-3">{l.fullName}<br /><span className="opacity-70">{l.email}{l.companyName ? ` · ${l.companyName}` : ""}</span></td>
              <td className="pr-3">{(l.specification ?? "").slice(0, 200)}</td>
              <td>
                <form action={`/api/client/enquiries/${l.id}`} method="post" className="flex gap-2">
                  <input type="hidden" name="csrf" value={csrf} />
                  <select name="status" defaultValue={l.status} className="rounded border border-black/20 bg-transparent px-2 py-1 dark:border-white/20">
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
                  </select>
                  <button type="submit" className="rounded border border-black/20 px-2 py-1 dark:border-white/20">Save</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
