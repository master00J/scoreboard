import Link from "next/link";
import { CookieSettingsTrigger } from "@/components/cookie-settings-trigger";
import { FooterLegalEntity } from "@/components/footer-legal-entity";

export function LegalFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="legal-footer">
      <FooterLegalEntity className="legal-footer-entity" />
      <div className="legal-footer-meta">
        <span>&copy; {year} ArenaCue</span>
        <span className="legal-footer-links">
          <Link href="/">Home</Link>
          <Link href="/functies">Functies</Link>
          <Link href="/portal">Klantportaal</Link>
          <Link href="/changelog">Changelog</Link>
          <Link href="/vereisten">Systeemvereisten</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/licenties">Licenties</Link>
          <Link href="/terms">Voorwaarden</Link>
          <CookieSettingsTrigger />
        </span>
      </div>
    </footer>
  );
}
