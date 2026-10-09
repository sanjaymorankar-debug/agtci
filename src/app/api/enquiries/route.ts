/** The public enquiry form. No sign-in needed. */
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

import { createEnquiry } from "@/server/services/enquiries";

const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const b = hits.get(ip);
  if (!b || b.reset < now) { hits.set(ip, { n: 1, reset: now + 3600_000 }); return false; }
  b.n += 1;
  return b.n > 10;
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const back = (q: string) => NextResponse.redirect(new URL(`/contact?${q}`, request.url), 303);
  // Bots fill every field; people never see this one.
  if (form.get("website")) return back("sent=1");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return back("error=" + encodeURIComponent("Too many enquiries from here. Please try again later."));
  const value = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);
  try {
    await createEnquiry({
      fullName: value("fullName") ?? "", email: value("email") ?? "", companyName: value("companyName"),
      phone: value("phone"), country: value("country"), destinationCountry: value("destinationCountry"),
      quantity: value("quantity"), specification: value("specification") ?? "",
    });
  } catch (error) {
    if (error instanceof ZodError) return back("error=" + encodeURIComponent(error.issues[0]?.message ?? "Please check the form."));
    throw error;
  }
  return back("sent=1");
}
