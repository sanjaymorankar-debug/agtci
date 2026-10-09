import Link from "next/link";

import { COMPANY } from "@/lib/company";
import { SERVICES } from "@/lib/services";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{COMPANY.fullName}</h1>
        <p className="max-w-2xl text-lg opacity-80">Sourcing, import-export and trade consultancy. Tell us what you need and where it has to go; we come back with a plan.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/contact" className="rounded bg-foreground px-4 py-2 font-semibold text-background">Send an enquiry</Link>
          <a href={`https://wa.me/${COMPANY.whatsappNumber}`} className="rounded border border-black/20 px-4 py-2 dark:border-white/20">WhatsApp us</a>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {SERVICES.map((s) => (
          <div key={s.slug} className="rounded-lg border border-black/10 p-5 dark:border-white/10">
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm opacity-75">{s.summary}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
