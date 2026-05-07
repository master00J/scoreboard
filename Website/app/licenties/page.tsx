import { permanentRedirect } from "next/navigation";

/** Nederlandstalige URL; inhoud staat op `/licenses` (canonical). */
export default function LicentiesRedirectPage() {
  permanentRedirect("/licenses");
}
