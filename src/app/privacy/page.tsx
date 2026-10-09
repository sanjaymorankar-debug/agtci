import type { Metadata } from "next";

import { COMPANY } from "@/lib/company";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Privacy</h1>
      <p>When you send an enquiry we keep what you type in the form (name, company, email, phone, country and your requirement) to reply to you and to handle the trade you ask about. We do not sell it or use it for advertising.</p>
      <p>The client area is signed in through your bkesari.com account; the bkesari.com privacy notice covers that account. This site keeps only a session (one strictly necessary cookie) and the access rights bkesari.com reports for you.</p>
      <p>To see, correct or delete what we hold about you, write to {COMPANY.supportEmail}.</p>
    </div>
  );
}
