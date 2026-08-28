import { Suspense } from "react";
import { AdminLoginForm } from "@/components/admin-login-form";

export default function AdminLoginPage() {
  return (
    <div className="app-shell">
      <div className="app-shell-inner">
        <Suspense fallback={<p className="form-hint">Laden…</p>}>
          <AdminLoginForm />
        </Suspense>
      </div>
    </div>
  );
}
