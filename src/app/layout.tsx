import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteHeader } from "@/components/site-header";
import { COMPANY } from "@/lib/company";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: `${COMPANY.tradeName} · Import, export and trade consultancy`, template: `%s · ${COMPANY.tradeName}` },
  description: `${COMPANY.fullName}: sourcing, import-export and trade consultancy.`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
        <footer className="border-t border-black/10 px-4 py-6 text-center text-xs opacity-70 dark:border-white/10">
          © {COMPANY.legalName} · <Link href="/privacy">Privacy</Link>
        </footer>
      </body>
    </html>
  );
}
