import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-auth";
import { getAdminPathPrefix } from "@/lib/admin-url";
import { adminGetLicense, adminListInstallations } from "@/lib/license-admin-data";
import { adminListActiveLicensePlans } from "@/lib/license-plan-admin-data";
import { AdminLicenseDetailClient } from "@/components/admin-license-detail";
import { AdminLogoutButton } from "@/components/admin-logout-button";

export default async function AdminLicenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tok = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifyAdminToken(tok))) {
    redirect(`${getAdminPathPrefix()}/login`);
  }

  const lic = await adminGetLicense(id);
  if (!lic) {
    notFound();
  }
  const installations = (await adminListInstallations(id)) ?? [];
  const plans = await adminListActiveLicensePlans();

  return (
    <div className="app-shell">
      <div className="app-shell-inner">
        <nav className="app-nav">
          <strong>Licentie bewerken</strong>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <Link href={getAdminPathPrefix()}>Overzicht</Link>
            <AdminLogoutButton />
          </div>
        </nav>
        <AdminLicenseDetailClient license={lic} installations={installations} plans={plans} />
      </div>
    </div>
  );
}
