import ClassicHome, { metadata as classicMetadata } from "./page-classic";
import ProfessionalHome, { metadata as professionalMetadata } from "./page-professional";

const USE_PROFESSIONAL_HOMEPAGE = true;

export const metadata = USE_PROFESSIONAL_HOMEPAGE ? professionalMetadata : classicMetadata;

export default function Home() {
  return USE_PROFESSIONAL_HOMEPAGE ? <ProfessionalHome /> : <ClassicHome />;
}
