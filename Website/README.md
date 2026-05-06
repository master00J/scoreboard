# ArenaCue Website

Professionele marketingwebsite voor ArenaCue, gebouwd met Next.js en klaar voor Vercel.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
```

## Deployment

Deploy naar Vercel en koppel de repository `https://github.com/master00J/Arenacue`.

Zet in Vercel deze environment variables. De canonieke live-site is **https://arenacue.be** (vast in `lib/site-url.ts`).

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

## Supabase

Run `supabase/schema.sql` in de Supabase SQL Editor om de tabel en RLS-policy
voor demo-aanvragen aan te maken.

Run `supabase/reviews.sql` om de reviewmodule (inzendingen + gepubliceerde reviews)
te activeren.

Run `supabase/cloud-control.sql` om de cloud control relay-tabellen te maken
(mobile remote control buiten lokaal netwerk).
