export type PublicReview = {
  id: string;
  createdAt: string;
  name: string;
  club: string;
  role: string | null;
  rating: number;
  quote: string;
};

type SupabaseReviewRow = {
  id: string;
  created_at: string;
  name: string;
  club: string;
  role: string | null;
  rating: number;
  quote: string;
};

export async function getPublishedReviews(limit = 6): Promise<PublicReview[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) return [];

  const endpoint =
    `${url}/rest/v1/reviews?` +
    `select=id,created_at,name,club,role,rating,quote&status=in.(published,approved)&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 20))}`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      next: { revalidate: 60 },
    });

    if (!response.ok) return [];

    const rows = (await response.json()) as SupabaseReviewRow[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      name: row.name,
      club: row.club,
      role: row.role ?? null,
      rating: row.rating,
      quote: row.quote,
    }));
  } catch {
    // Bij Supabase netwerk-/beschikbaarheidsfout: homepage blijft renderen zonder reviews.
    return [];
  }
}
