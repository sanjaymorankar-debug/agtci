import type { Metadata } from "next";

import { COMPANY } from "@/lib/company";

export const metadata: Metadata = { title: "Contact" };

const field = "w-full rounded border border-black/20 bg-transparent px-3 py-2 dark:border-white/20";

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const q = await searchParams;
  const sent = q.sent === "1";
  const error = typeof q.error === "string" ? q.error : null;
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Send an enquiry</h1>
      <p className="opacity-80">Or write to <a className="underline" href={`mailto:${COMPANY.salesEmail}`}>{COMPANY.salesEmail}</a>.</p>
      {sent ? <p role="status" className="rounded bg-green-100 p-3 text-green-900">Thank you. We have your enquiry and will reply by email.</p> : null}
      {error ? <p role="alert" className="rounded bg-red-100 p-3 text-red-900">{error}</p> : null}
      <form action="/api/enquiries" method="post" className="grid gap-4">
        <label className="grid gap-1 text-sm font-medium">Name<input name="fullName" required maxLength={255} className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">Email<input name="email" type="email" required maxLength={255} className={field} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Company<input name="companyName" maxLength={255} className={field} /></label>
          <label className="grid gap-1 text-sm font-medium">Phone<input name="phone" maxLength={50} className={field} /></label>
          <label className="grid gap-1 text-sm font-medium">Your country<input name="country" maxLength={100} className={field} /></label>
          <label className="grid gap-1 text-sm font-medium">Destination country<input name="destinationCountry" maxLength={100} className={field} /></label>
        </div>
        <label className="grid gap-1 text-sm font-medium">Quantity<input name="quantity" maxLength={255} className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">What do you need?<textarea name="specification" required minLength={5} maxLength={5000} rows={5} className={field} /></label>
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <p className="text-xs opacity-70">We use these details only to answer your enquiry. See <a className="underline" href="/privacy">Privacy</a>.</p>
        <button type="submit" className="justify-self-start rounded bg-foreground px-4 py-2 font-semibold text-background">Send</button>
      </form>
    </div>
  );
}
