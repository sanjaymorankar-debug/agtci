/**
 * AGTCI business identity — single source of truth for contact details
 * shown across the site (header, footer, contact page, WhatsApp CTAs).
 *
 * Per the brief's content rule: never invent facts. Fields marked
 * PLACEHOLDER below are not yet provided and must not be treated as real
 * until replaced — search for "PLACEHOLDER" to find everything still
 * outstanding.
 */
export const COMPANY = {
  tradeName: "AGTCI",
  fullName: "Asmi Global Trade Consultancy & International",
  legalName: "ASMY GLOBAL TRADING & CONSULTANCY INDIA PRIVATE LIMITED",
  domain: "agtci.com",

  salesEmail: "globalsales@agtci.com",
  supportEmail: "support@agtci.com",
  phone: "+919175193009",
  /** Digits only, with country code, for WhatsApp click-to-chat links (wa.me). */
  whatsappNumber: "919175193009",

  address: "[PLACEHOLDER: Registered office / business address]",
  businessHours: "[PLACEHOLDER: Business hours, e.g. Mon–Sat, 9:30 AM – 6:30 PM IST]",
  googleMapsEmbedUrl: null as string | null,

  /** IEC / GST / CIN etc. — never shown publicly unless explicitly confirmed held. Fill in when available. */
  registrationNumbers: {
    gstin: null as string | null,
    iec: null as string | null,
    cin: null as string | null,
  },
};
