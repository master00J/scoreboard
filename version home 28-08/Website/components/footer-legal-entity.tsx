import { COMPANY_LEGAL } from "@/lib/company-legal";

type Props = {
  className?: string;
};

export function FooterLegalEntity({ className }: Props) {
  return (
    <address className={className}>
      <strong>{COMPANY_LEGAL.legalName}</strong>
      <br />
      {COMPANY_LEGAL.streetLine}
      <br />
      {COMPANY_LEGAL.cityLine}
      <br />
      BTW {COMPANY_LEGAL.vatNumber}
    </address>
  );
}
