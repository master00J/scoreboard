export type ReviewInput = {
  name: string;
  club: string;
  role?: string;
  rating: number;
  quote: string;
  website?: string;
};

export type ReviewErrors = Partial<Record<keyof ReviewInput, string>>;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateReview(input: unknown):
  | { ok: true; value: ReviewInput }
  | { ok: false; errors: ReviewErrors } {
  const source = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const ratingRaw = source.rating;
  const rating = typeof ratingRaw === "number" ? ratingRaw : Number.parseInt(clean(ratingRaw), 10);

  const value: ReviewInput = {
    name: clean(source.name),
    club: clean(source.club),
    role: clean(source.role),
    rating: Number.isFinite(rating) ? rating : 0,
    quote: clean(source.quote),
    website: clean(source.website),
  };

  const errors: ReviewErrors = {};

  if (value.website) {
    errors.website = "Spam gedetecteerd.";
  }
  if (value.name.length < 2) {
    errors.name = "Vul je naam in.";
  }
  if (value.club.length < 2) {
    errors.club = "Vul je club in.";
  }
  if (value.role && value.role.length > 80) {
    errors.role = "Functie is te lang.";
  }
  if (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5) {
    errors.rating = "Kies een score tussen 1 en 5.";
  }
  if (value.quote.length < 20) {
    errors.quote = "Schrijf minstens 20 tekens.";
  } else if (value.quote.length > 1200) {
    errors.quote = "Review mag maximaal 1200 tekens bevatten.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value };
}
