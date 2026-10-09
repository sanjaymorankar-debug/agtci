/**
 * The service lines shown on the public pages. Descriptions are deliberately
 * plain: no certifications, volumes or claims that have not been confirmed
 * (see the content rule in src/lib/company.ts). Move these into the
 * `services` table once the admin CMS edits them.
 */
export const SERVICES = [
  { slug: "sourcing", title: "Sourcing", summary: "Finding suppliers for a product and specification you describe, and checking they can deliver it." },
  { slug: "import-export", title: "Import & export", summary: "Moving goods across borders: documentation, logistics coordination and the steps in between." },
  { slug: "consultancy", title: "Trade consultancy", summary: "Advice on entering a market, structuring a trade, and the paperwork it needs." },
] as const;
