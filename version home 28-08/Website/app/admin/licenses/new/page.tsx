import { AdminNewLicenseForm } from "@/components/admin-new-license-form";
import { adminListActiveLicensePlans } from "@/lib/license-plan-admin-data";

export default async function AdminNewLicensePage() {
  const plans = await adminListActiveLicensePlans();
  return (
    <div className="app-shell">
      <div className="app-shell-inner">
        <nav className="app-nav" style={{ marginBottom: 22 }}>
          <strong>Nieuwe licentie</strong>
        </nav>
        <AdminNewLicenseForm plans={plans} />
      </div>
    </div>
  );
}
