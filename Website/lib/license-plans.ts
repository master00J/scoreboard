/** Historische standaardplannen; nieuwe codes kunnen uit Supabase `license_plans` komen. */
export type LicensePlanCode = "trial" | "starter" | "standard" | "club" | "enterprise";

/** Feature-vlaggen voor desktop/UI; uitbreidbaar zonder DB-migratie. */
export type LicenseFeatures = {
  scoreboard: boolean;
  manual_media: boolean;
  sponsors: boolean;
  automatic_sponsor_rotation: boolean;
  sponsor_budget: boolean;
  sponsor_budget_tracking: boolean;
  sponsor_interrupt_resume: boolean;
  proof_of_play_export: boolean;
  video_assets: boolean;
  player_intros: boolean;
  led_boarding: boolean;
  cloud_control: boolean;
  mobile_control: boolean;
  multi_device: boolean;
};

export type LicenseFeatureKey = keyof LicenseFeatures;

export const LICENSE_FEATURE_DEFINITIONS: Array<{
  key: LicenseFeatureKey;
  label: string;
  description: string;
}> = [
  {
    key: "scoreboard",
    label: "Scorebord & klok",
    description: "Basis scorebord, timer, wedstrijdfases en live bediening.",
  },
  {
    key: "manual_media",
    label: "Media manueel starten",
    description: "Operator kan losse sponsor- of mediaclips handmatig tonen.",
  },
  {
    key: "sponsors",
    label: "Sponsors beheren",
    description: "Sponsors en sponsorbestanden aanmaken/beheren.",
  },
  {
    key: "automatic_sponsor_rotation",
    label: "Automatische sponsorrotatie",
    description: "Scorebord + sponsors automatisch laten roteren volgens de live fase.",
  },
  {
    key: "sponsor_budget",
    label: "Sponsorbudgetten instellen",
    description: "Geplande sponsor-seconden per fase configureren.",
  },
  {
    key: "sponsor_budget_tracking",
    label: "Sponsorbudgetten opvolgen",
    description: "Werkelijk afgespeelde schermtijd vergelijken met geplande sponsorbudgetten.",
  },
  {
    key: "sponsor_interrupt_resume",
    label: "Pauze/hervat bij overlays",
    description: "Sponsorclips pauzeren bij goals, kaarten en wissels en hervatten nadien.",
  },
  {
    key: "proof_of_play_export",
    label: "Proof-of-play export",
    description: "Sponsorrapporten exporteren naar PDF/Excel.",
  },
  {
    key: "video_assets",
    label: "Video-assets",
    description: "Videobestanden gebruiken in media, sponsors en visuals.",
  },
  {
    key: "player_intros",
    label: "Spelerintro's",
    description: "Player intro en lineup visuals gebruiken.",
  },
  {
    key: "led_boarding",
    label: "LED boarding",
    description: "Toegang tot LED boarding downloads/features.",
  },
  {
    key: "cloud_control",
    label: "Cloud/mobile remote",
    description: "Bediening via cloud-bridge buiten het lokale netwerk.",
  },
  {
    key: "mobile_control",
    label: "Mobiele bediening",
    description: "Mobiele operator/viewer bediening gebruiken.",
  },
  {
    key: "multi_device",
    label: "Meerdere installaties",
    description: "Licentie bedoeld voor meerdere geactiveerde machines.",
  },
];

export const DEFAULT_LICENSE_PLAN_CODES: LicensePlanCode[] = [
  "trial",
  "starter",
  "standard",
  "club",
  "enterprise",
];

const ALL_FEATURES_OFF: LicenseFeatures = {
  scoreboard: false,
  manual_media: false,
  sponsors: false,
  automatic_sponsor_rotation: false,
  sponsor_budget: false,
  sponsor_budget_tracking: false,
  sponsor_interrupt_resume: false,
  proof_of_play_export: false,
  video_assets: false,
  player_intros: false,
  led_boarding: false,
  cloud_control: false,
  mobile_control: false,
  multi_device: false,
};

const TRIAL_FEATURES: LicenseFeatures = {
  scoreboard: true,
  manual_media: true,
  sponsors: true,
  automatic_sponsor_rotation: true,
  sponsor_budget: true,
  sponsor_budget_tracking: true,
  sponsor_interrupt_resume: true,
  proof_of_play_export: true,
  video_assets: true,
  player_intros: true,
  led_boarding: false,
  cloud_control: false,
  mobile_control: true,
  multi_device: true,
};

const STARTER_FEATURES: LicenseFeatures = {
  ...ALL_FEATURES_OFF,
  scoreboard: true,
  manual_media: true,
  sponsors: true,
  video_assets: true,
};

const STANDARD_FEATURES: LicenseFeatures = {
  scoreboard: true,
  manual_media: true,
  sponsors: true,
  automatic_sponsor_rotation: false,
  sponsor_budget: false,
  sponsor_budget_tracking: false,
  sponsor_interrupt_resume: false,
  proof_of_play_export: false,
  video_assets: false,
  player_intros: false,
  led_boarding: false,
  cloud_control: false,
  mobile_control: false,
  multi_device: false,
};

const CLUB_FEATURES: LicenseFeatures = {
  scoreboard: true,
  manual_media: true,
  sponsors: true,
  automatic_sponsor_rotation: true,
  sponsor_budget: true,
  sponsor_budget_tracking: true,
  sponsor_interrupt_resume: true,
  proof_of_play_export: true,
  video_assets: true,
  player_intros: true,
  led_boarding: false,
  cloud_control: false,
  mobile_control: true,
  multi_device: true,
};

const ENTERPRISE_FEATURES: LicenseFeatures = {
  ...CLUB_FEATURES,
  led_boarding: true,
  cloud_control: true,
};

const PLAN_FEATURES: Record<LicensePlanCode, LicenseFeatures> = {
  trial: TRIAL_FEATURES,
  starter: STARTER_FEATURES,
  standard: STANDARD_FEATURES,
  club: CLUB_FEATURES,
  enterprise: ENTERPRISE_FEATURES,
};

const PLAN_LABELS_NL: Record<LicensePlanCode, string> = {
  trial: "Demo",
  starter: "Starter",
  standard: "Essential",
  club: "Club",
  enterprise: "Enterprise",
};

export function isDefaultPlanCode(raw: string): raw is LicensePlanCode {
  const p = raw.trim().toLowerCase();
  return DEFAULT_LICENSE_PLAN_CODES.includes(p as LicensePlanCode);
}

export function normalizePlanCode(raw: string): LicensePlanCode {
  const p = raw.trim().toLowerCase();
  return isDefaultPlanCode(p) ? p : "standard";
}

export function normalizeFeatureMap(raw: unknown, fallback: LicenseFeatures = STANDARD_FEATURES): LicenseFeatures {
  const out: LicenseFeatures = { ...fallback };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const rec = raw as Record<string, unknown>;
  for (const def of LICENSE_FEATURE_DEFINITIONS) {
    const value = rec[def.key];
    if (typeof value === "boolean") {
      out[def.key] = value;
    }
  }
  // Backwards compatibility with older snapshots.
  if (typeof rec.sponsor_budget === "boolean") {
    out.sponsor_budget_tracking = rec.sponsor_budget;
  }
  if (typeof rec.sponsors === "boolean" && rec.sponsors === false) {
    out.automatic_sponsor_rotation = false;
  }
  return out;
}

export function getFeaturesForPlan(plan: string): LicenseFeatures {
  const code = normalizePlanCode(plan);
  return { ...PLAN_FEATURES[code] };
}

export function planDisplayNameNl(plan: string): string {
  const trimmed = plan.trim();
  return isDefaultPlanCode(trimmed) ? PLAN_LABELS_NL[trimmed] : trimmed;
}

export type PublicLicenseSnapshot = {
  organizationLabel: string;
  plan: string;
  planLabel: string;
  validUntil: string | null;
  features: LicenseFeatures;
};

export function toPublicLicenseSnapshot(row: {
  organization_label: string;
  plan: string;
  valid_until: string | null;
  plan_name?: string | null;
  plan_features?: unknown;
}): PublicLicenseSnapshot {
  const plan = row.plan.trim().toLowerCase() || "standard";
  const features = row.plan_features
    ? normalizeFeatureMap(row.plan_features, getFeaturesForPlan(row.plan))
    : getFeaturesForPlan(row.plan);
  return {
    organizationLabel: row.organization_label,
    plan,
    planLabel: row.plan_name?.trim() || planDisplayNameNl(row.plan),
    validUntil: row.valid_until,
    features,
  };
}
