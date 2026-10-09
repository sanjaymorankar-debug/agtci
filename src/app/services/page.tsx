import Link from "next/link";
import type { Metadata } from "next";

import { SERVICES } from "@/lib/services";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Services</h1>
      {SERVICES.map((s) => (
        <section key={s.slug} className="rounded-lg border border-black/10 p-5 dark:border-white/10">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          <p className="mt-1 opacity-80">{s.summary}</p>
        </section>
      ))}
      <p><Link href="/contact" className="underline">Send an enquiry</Link></p>
    </div>
  );
}
