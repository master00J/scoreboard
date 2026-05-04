import { AdminNewLicenseForm } from "@/components/admin-new-license-form";

export default function AdminNewLicensePage() {
  return (
    <div className="app-shell">
      <div className="app-shell-inner">
        <nav className="app-nav" style={{ marginBottom: 22 }}>
          <strong>Nieuwe licentie</strong>
        </nav>
        <AdminNewLicenseForm />
      </div>
    </div>
  );
}
