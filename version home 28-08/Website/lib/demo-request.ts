export type DemoRequestInput = {
  name: string;
  email: string;
  club: string;
  phone?: string;
  message?: string;
  website?: string;
};

export type DemoRequestErrors = Partial<Record<keyof DemoRequestInput, string>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateDemoRequest(input: unknown): {
  ok: true;
  value: DemoRequestInput;
} | {
  ok: false;
  errors: DemoRequestErrors;
} {
  const source = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const value: DemoRequestInput = {
    name: clean(source.name),
    email: clean(source.email).toLowerCase(),
    club: clean(source.club),
    phone: clean(source.phone),
    message: clean(source.message),
    website: clean(source.website),
  };

  const errors: DemoRequestErrors = {};

  if (value.website) {
    errors.website = "Spam gedetecteerd.";
  }
  if (value.name.length < 2) {
    errors.name = "Vul je naam in.";
  }
  if (!emailPattern.test(value.email)) {
    errors.email = "Vul een geldig e-mailadres in.";
  }
  if (value.club.length < 2) {
    errors.club = "Vul je club of organisatie in.";
  }
  if (value.phone && value.phone.length > 40) {
    errors.phone = "Telefoonnummer is te lang.";
  }
  if (value.message && value.message.length > 1200) {
    errors.message = "Bericht mag maximaal 1200 tekens bevatten.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value };
}
