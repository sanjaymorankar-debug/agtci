/** Moves an enquiry to another status. agtci.manage_enquiries only. */
import { NextResponse, type NextRequest } from "next/server";

import { checkAccess } from "@/server/sso/access";
import { csrfToken } from "@/server/sso/session";
import { isLeadStatus, setEnquiryStatus } from "@/server/services/enquiries";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/client/enquiries/[id]">) {
  const access = await checkAccess("agtci.manage_enquiries");
  if (access.kind === "off") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (access.kind === "anonymous") return NextResponse.json({ error: "login_required" }, { status: 401 });
  if (access.kind !== "ok") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  if (form.get("csrf") !== csrfToken(access.cfg, access.session)) return NextResponse.json({ error: "csrf" }, { status: 403 });
  const status = form.get("status");
  if (!isLeadStatus(status)) return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  const { id } = await ctx.params;
  if (!(await setEnquiryStatus(id, status, access.session))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.redirect(new URL("/client/enquiries", request.url), 303);
}
