"use client";

import { useMemo, useState } from "react";
import type { LicensePlanRow } from "@/lib/license-plan-admin-data";
import {
  LICENSE_FEATURE_DEFINITIONS,
  normalizeFeatureMap,
  type LicenseFeatures,
  type LicenseFeatureKey,
} from "@/lib/license-plans";

type PlanDraft = {
  code: string;
  name: string;
  description: string;
  priceLabel: string;
  maxActivationsDefault: number;
  sortOrder: number;
  active: boolean;
  features: LicenseFeatures;
};

function draftFromPlan(plan?: LicensePlanRow): PlanDraft {
  return {
    code: plan?.code ?? "",
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    priceLabel: plan?.price_label ?? "",
    maxActivationsDefault: plan?.max_activations_default ?? 1,
    sortOrder: plan?.sort_order ?? 100,
    active: plan?.active ?? true,
    features: normalizeFeatureMap(plan?.features ?? {}),
  };
}

export function AdminLicensePlansClient({ initialPlans }: { initialPlans: LicensePlanRow[] }) {
  const [plans, setPlans] = useState(initialPlans);
  const [selectedCode, setSelectedCode] = useState(initialPlans[0]?.code ?? "");
  const selected = plans.find((plan) => plan.code === selectedCode);
  const [draft, setDraft] = useState<PlanDraft>(() => draftFromPlan(selected));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const featureGroups = useMemo(
    () => [
      LICENSE_FEATURE_DEFINITIONS.slice(0, 4),
      LICENSE_FEATURE_DEFINITIONS.slice(4, 8),
      LICENSE_FEATURE_DEFINITIONS.slice(8),
    ],
    [],
  );

  function selectPlan(code: string) {
    const plan = plans.find((item) => item.code === code);
    setSelectedCode(code);
    setDraft(draftFromPlan(plan));
    setMessage(null);
    setError(null);
  }

  function newPlan() {
    setSelectedCode("");
    setDraft(draftFromPlan());
    setMessage(null);
    setError(null);
  }

  function setFeature(key: LicenseFeatureKey, enabled: boolean) {
    setDraft((prev) => ({ ...prev, features: { ...prev.features, [key]: enabled } }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    const isNew = !selectedCode;
    try {
      const payload = {
        code: draft.code.trim().toLowerCase(),
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        priceLabel: draft.priceLabel.trim() || null,
        maxActivationsDefault: draft.maxActivationsDefault,
        sortOrder: draft.sortOrder,
        active: draft.active,
        features: draft.features,
      };
      const res = await fetch(
        isNew
          ? "/api/admin/license-plans"
          : `/api/admin/license-plans/${encodeURIComponent(selectedCode)}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "Opslaan mislukt.");
        return;
      }

      const refreshed = await fetch("/api/admin/license-plans", { credentials: "include" });
      const json = (await refreshed.json()) as { ok?: boolean; plans?: LicensePlanRow[] };
      if (json.ok && json.plans) {
        setPlans(json.plans);
        setSelectedCode(payload.code);
      }
      setMessage("Plan opgeslagen.");
    } catch {
      setError("Netwerkfout.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="data-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: "1.5rem", letterSpacing: "-0.03em" }}>
            Licentieplannen
          </h1>
          <p className="form-hint" style={{ margin: 0 }}>
            Maak plannen aan en kies welke functies de desktop-app mag tonen of uitvoeren.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={newPlan}>
          + Nieuw plan
        </button>
      </div>

      <div className="data-table-wrap" style={{ marginTop: 18 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Code</th>
              <th>Status</th>
              <th>Features actief</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => {
              const activeCount = Object.values(plan.features).filter(Boolean).length;
              return (
                <tr key={plan.code}>
                  <td>{plan.name}</td>
                  <td style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}>
                    {plan.code}
                  </td>
                  <td>
                    <span className={plan.active ? "badge badge-ok" : "badge badge-warn"}>
                      {plan.active ? "Actief" : "Verborgen"}
                    </span>
                  </td>
                  <td>{activeCount}/{LICENSE_FEATURE_DEFINITIONS.length}</td>
                  <td>
                    <button type="button" className="secondary-button" onClick={() => selectPlan(plan.code)}>
                      Bewerken
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 24, borderTop: "1px solid var(--line)", paddingTop: 20 }}>
        <h2 style={{ margin: "0 0 14px", fontSize: "1.1rem" }}>
          {selectedCode ? "Plan bewerken" : "Nieuw plan"}
        </h2>
        <div className="form-stack" style={{ maxWidth: 760 }}>
          <label>
            Code
            <input
              value={draft.code}
              disabled={Boolean(selectedCode)}
              onChange={(e) => setDraft((prev) => ({ ...prev, code: e.target.value }))}
              placeholder="starter, club-plus, pro"
            />
            <span className="form-hint">Alleen kleine letters, cijfers, _ en -. De code staat op licenties.</span>
          </label>
          <label>
            Naam
            <input value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} />
          </label>
          <label>
            Omschrijving
            <textarea
              value={draft.description}
              onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
            />
          </label>
          <label>
            Prijslabel
            <input
              value={draft.priceLabel}
              onChange={(e) => setDraft((prev) => ({ ...prev, priceLabel: e.target.value }))}
              placeholder="Prijs op aanvraag"
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
            <label>
              Standaard installaties
              <input
                type="number"
                min={1}
                max={500}
                value={draft.maxActivationsDefault}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, maxActivationsDefault: Number(e.target.value) }))
                }
              />
            </label>
            <label>
              Sorteervolgorde
              <input
                type="number"
                min={0}
                max={9999}
                value={draft.sortOrder}
                onChange={(e) => setDraft((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
              />
            </label>
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft((prev) => ({ ...prev, active: e.target.checked }))}
            />
            <span>Beschikbaar bij nieuwe licenties</span>
          </label>

          <div>
            <h3 style={{ margin: "8px 0 12px", fontSize: "1rem" }}>Features</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
              {featureGroups.map((group, index) => (
                <div key={index} style={{ display: "grid", gap: 10 }}>
                  {group.map((feature) => (
                    <label
                      key={feature.key}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "10px 12px",
                        border: "1px solid var(--line)",
                        borderRadius: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={draft.features[feature.key]}
                        onChange={(e) => setFeature(feature.key, e.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <strong style={{ display: "block" }}>{feature.label}</strong>
                        <span className="form-hint">{feature.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-hint" style={{ color: "var(--green)" }}>{message}</p>}
          <button type="button" className="primary-button" disabled={saving} onClick={() => void save()}>
            {saving ? "Opslaan…" : "Plan opslaan"}
          </button>
        </div>
      </div>
    </div>
  );
}
