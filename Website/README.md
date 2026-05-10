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
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
RESEND_API_KEY=<resend-api-key>
RESEND_FROM="ArenaCue <info@arenacue.be>"
CRON_SECRET=<lange-random-secret>
```

## Supabase

Run `supabase/schema.sql` in de Supabase SQL Editor om de tabel en RLS-policy
voor demo-aanvragen aan te maken.

Run `supabase/reviews.sql` om de reviewmodule (inzendingen + gepubliceerde reviews)
te activeren.

Run `supabase/cloud-control.sql` om de cloud control relay-tabellen te maken
(mobile remote control buiten lokaal netwerk).

Run `supabase/app-release-notifications.sql` om automatische update-mails
idempotent te maken. Deze tabel onthoudt welke `APP_RELEASE_VERSION` al naar
actieve licentiehouders is gemaild.

## Automatische Update-mails

`vercel.json` draait elk uur `/api/cron/app-release-notify`. Die route leest
`APP_RELEASE_VERSION`, checkt `app_release_notifications` en stuurt via Resend
een mail naar unieke `owner_email`-adressen met minstens één actieve licentie.
Website-demo-trials worden standaard niet meegenomen.

Vercel stuurt bij cron-runs `Authorization: Bearer <CRON_SECRET>` mee. Zet dus
`CRON_SECRET` op Vercel, naast `RESEND_API_KEY`, `RESEND_FROM`,
`SUPABASE_SERVICE_ROLE_KEY` en de release-variabelen.

Release-flow:

1. Upload de nieuwe desktop-build naar Supabase Storage.
2. Zet `APP_RELEASE_VERSION` op de nieuwe versie en update de download-URL indien nodig.
3. Redeploy de website.
4. De cron-route mailt de actieve licentiehouders één keer voor die versie.
