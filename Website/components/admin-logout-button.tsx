"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAdminPathPrefix } from "@/lib/admin-url";

export function AdminLogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
      router.push(`${getAdminPathPrefix()}/login`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" className="secondary-button" disabled={loading} onClick={() => void logout()}>
      {loading ? "…" : "Uitloggen"}
    </button>
  );
}
