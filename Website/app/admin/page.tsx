import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-auth";
import { getAdminPathPrefix } from "@/lib/admin-url";
import { AdminLogoutButton } from "@/components/admin-logout-button";
import { adminListLicenses, type LicenseFullRow } from "@/lib/license-admin-data";

function fmtDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return "—";
  }
  return d.toLocaleDateString("nl-BE", { dateStyle: "medium" });
}

function statusBadge(row: LicenseFullRow) {
  if (row.revoked_at) {
    return <span className="badge badge-bad">Ingetrokken</span>;
  }
  if (row.valid_until) {
    const t = new Date(row.valid_until).getTime();
    if (Number.isFinite(t) && t < Date.now()) {
      return <span className="badge badge-warn">Verlopen</span>;
    }
  }
  return <span className="badge badge-ok">Actief</span>;
}

export default async function AdminDashboardPage() {
  const tok = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifyAdminToken(tok))) {
    redirect(`${getAdminPathPrefix()}/login`);
  }

  const rows = await adminListLicenses();
  if (!rows) {
    return (
      <div className="app-shell">
        <div className="app-shell-inner">
          <p>Kon geen gegevens laden. Controleer SUPABASE_SERVICE_ROLE_KEY.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-shell-inner">
        <nav className="app-nav">
          <strong>ArenaCue — Licenties</strong>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/">Website</Link>
            <Link href="/portal">Klantportaal</Link>
            <Link href={`${getAdminPathPrefix()}/licenses/new`}>+ Nieuwe licentie</Link>
            <AdminLogoutButton />
          </div>
        </nav>

        <div className="data-card">
          <h1 style={{ margin: "0 0 6px", fontSize: "1.5rem", letterSpacing: "-0.03em" }}>Overzicht</h1>
          <p className="form-hint" style={{ marginBottom: 16 }}>
            {rows.length} licentie{rows.length === 1 ? "" : "s"}
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Organisatie</th>
                  <th>Sleutel</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Geldig tot</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.organization_label}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}>{r.license_key}</td>
                    <td>{r.plan}</td>
                    <td>{statusBadge(r)}</td>
                    <td>{fmtDate(r.valid_until)}</td>
                    <td>
                      <Link className="secondary-button" href={`${getAdminPathPrefix()}/licenses/${r.id}`}>
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
