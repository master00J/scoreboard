import type { Metadata } from "next";
import Link from "next/link";
import { LicentiePortalClient } from "@/components/licentie-portal-client";

export const metadata: Metadata = {
  title: "Licentiestatus | ArenaCue",
  description: "Bekijk de status van je ArenaCue-licentie en geactiveerde installaties.",
  robots: { index: true, follow: true },
};

export default function LicentiePage() {
  return (
    <main className="app-shell">
      <div className="app-shell-inner">
        <nav className="app-nav" style={{ marginBottom: 22 }}>
          <strong>ArenaCue</strong>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link href="/">Home</Link>
            <Link href="/portal">Klantportaal</Link>
            <Link href="/vereisten">Systeemvereisten</Link>
            <Link href="/#contact">Demo</Link>
          </div>
        </nav>
        <LicentiePortalClient />
      </div>
    </main>
  );
}
