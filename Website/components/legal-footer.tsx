import Link from "next/link";
import { CookieSettingsTrigger } from "@/components/cookie-settings-trigger";

export function LegalFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="legal-footer">
      <span>© {year} ArenaCue</span>
      <span className="legal-footer-links">
        <Link href="/">Home</Link>
        <Link href="/functies">Functies</Link>
        <Link href="/portal">Klantportaal</Link>
        <Link href="/changelog">Changelog</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Voorwaarden</Link>
        <CookieSettingsTrigger />
      </span>
    </footer>
  );
}
