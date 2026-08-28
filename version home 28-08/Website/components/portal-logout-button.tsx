"use client";

import { useRouter } from "next/navigation";

export function PortalLogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <button type="button" className="secondary-button" onClick={() => void logout()}>
      Uitloggen
    </button>
  );
}
