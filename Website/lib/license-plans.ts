/** Bekende plannen (zie Supabase constraint op licenses.plan). */
export type LicensePlanCode = "trial" | "standard" | "club" | "enterprise";

/** Feature-vlaggen voor desktop/UI; uitbreidbaar zonder DB-migratie. */
export type LicenseFeatures = {
  scoreboard: boolean;
  sponsors: boolean;
  sponsor_budget: boolean;
  video_assets: boolean;
  multi_device: boolean;
};

const TRIAL_FEATURES: LicenseFeatures = {
  scoreboard: true,
  sponsors: true,
  sponsor_budget: true,
  video_assets: true,
  multi_device: true,
};

const STANDARD_FEATURES: LicenseFeatures = {
  scoreboard: true,
  sponsors: true,
  sponsor_budget: false,
  video_assets: false,
  multi_device: false,
};

const CLUB_FEATURES: LicenseFeatures = {
  scoreboard: true,
  sponsors: true,
  sponsor_budget: true,
  video_assets: true,
  multi_device: true,
};

const ENTERPRISE_FEATURES: LicenseFeatures = {
  ...CLUB_FEATURES,
};

const PLAN_FEATURES: Record<LicensePlanCode, LicenseFeatures> = {
  trial: TRIAL_FEATURES,
  standard: STANDARD_FEATURES,
  club: CLUB_FEATURES,
  enterprise: ENTERPRISE_FEATURES,
};

const PLAN_LABELS_NL: Record<LicensePlanCode, string> = {
  trial: "Demo",
  standard: "Essential",
  club: "Club",
  enterprise: "Enterprise",
};

export function normalizePlanCode(raw: string): LicensePlanCode {
  const p = raw.trim().toLowerCase();
  if (p === "trial" || p === "standard" || p === "club" || p === "enterprise") {
    return p;
  }
  return "standard";
}

export function getFeaturesForPlan(plan: string): LicenseFeatures {
  const code = normalizePlanCode(plan);
  return { ...PLAN_FEATURES[code] };
}

export function planDisplayNameNl(plan: string): string {
  return PLAN_LABELS_NL[normalizePlanCode(plan)];
}

export type PublicLicenseSnapshot = {
  organizationLabel: string;
  plan: LicensePlanCode;
  planLabel: string;
  validUntil: string | null;
  features: LicenseFeatures;
};

export function toPublicLicenseSnapshot(row: {
  organization_label: string;
  plan: string;
  valid_until: string | null;
}): PublicLicenseSnapshot {
  const plan = normalizePlanCode(row.plan);
  return {
    organizationLabel: row.organization_label,
    plan,
    planLabel: PLAN_LABELS_NL[plan],
    validUntil: row.valid_until,
    features: { ...PLAN_FEATURES[plan] },
  };
}
