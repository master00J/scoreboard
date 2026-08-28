import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-auth";
import { getAdminPathPrefix } from "@/lib/admin-url";
import { AdminLogoutButton } from "@/components/admin-logout-button";
import { AdminLicensePlansClient } from "@/components/admin-license-plans-client";
import { adminListLicensePlans, fallbackLicensePlans } from "@/lib/license-plan-admin-data";

export default async function AdminLicensePlansPage() {
  const tok = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifyAdminToken(tok))) {
    redirect(`${getAdminPathPrefix()}/login`);
  }

  const plans = (await adminListLicensePlans()) ?? fallbackLicensePlans();

  return (
    <div className="app-shell">
      <div className="app-shell-inner">
        <nav className="app-nav">
          <strong>Licentieplannen</strong>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <Link href={getAdminPathPrefix()}>Licenties</Link>
            <Link href={`${getAdminPathPrefix()}/licenses/new`}>+ Nieuwe licentie</Link>
            <AdminLogoutButton />
          </div>
        </nav>
        <AdminLicensePlansClient initialPlans={plans} />
      </div>
    </div>
  );
}
