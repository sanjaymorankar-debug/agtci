/**
 * Enquiries: the public contact form writes them, the client area lists a
 * client's own, and enquiry managers move them through their statuses.
 * Stored in the existing `leads` table.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/server/db";
import { auditLogs, LEAD_STATUSES, leads, type Lead, type LeadStatus } from "@/server/db/schema";

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const enquirySchema = z.object({
  fullName: z.string().trim().min(2, "Please enter your name.").max(255),
  email: z.string().trim().toLowerCase().email("Please enter a valid email.").max(255),
  companyName: optional(255),
  phone: optional(50),
  country: optional(100),
  destinationCountry: optional(100),
  quantity: optional(255),
  specification: z.string().trim().min(5, "Please describe what you need.").max(5000),
});

export type EnquiryInput = z.input<typeof enquirySchema>;

export async function createEnquiry(input: EnquiryInput): Promise<string> {
  const data = enquirySchema.parse(input);
  const id = crypto.randomUUID();
  await db.insert(leads).values({ id, source: "CONTACT_FORM", ...data });
  return id;
}

/** A client's own enquiries: matched on the email bkesari.com verified. */
export async function enquiriesFor(email: string): Promise<Lead[]> {
  return db.select().from(leads).where(eq(leads.email, email.toLowerCase())).orderBy(desc(leads.createdAt)).limit(200);
}

export async function allEnquiries(): Promise<Lead[]> {
  return db.select().from(leads).orderBy(desc(leads.createdAt)).limit(500);
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

export async function setEnquiryStatus(id: string, status: LeadStatus, actor: { sub: string; email: string }): Promise<boolean> {
  const before = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!before) return false;
  await db.update(leads).set({ status }).where(eq(leads.id, id));
  // actorId references admin_users; a bkesari.com account is recorded in the values instead.
  await db.insert(auditLogs).values({
    action: "LEAD_STATUS_CHANGED", entityType: "lead", entityId: id,
    previousValue: { status: before.status }, newValue: { status, by: actor.email, bkesari_sub: actor.sub },
  });
  return true;
}
