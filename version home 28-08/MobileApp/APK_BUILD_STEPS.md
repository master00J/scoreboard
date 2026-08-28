# ArenaCue Control Android build stappen

Deze checklist is bedoeld voor een andere pc waar je via Cursor/terminal de Android build wilt maken.

## 0) Vereisten

- Node.js LTS geinstalleerd
- npm beschikbaar
- Expo account
- EAS CLI (wordt via npm script gebruikt)
- Toegang tot deze repo

## 1) Repo binnenhalen

```bash
git pull
```

Ga daarna naar de mobiele app map:

```bash
cd MobileApp
```

## 2) Dependencies installeren

```bash
npm install
```

## 3) Inloggen op Expo/EAS

```bash
npm run eas:login
```

Volg de login prompts in de terminal.

## 4) APK build starten (interne distributie)

```bash
npm run build:apk
```

Dit start een EAS cloud build en geeft een build URL.

## 5) APK downloaden

- Open de build URL uit de terminal
- Download het `.apk` bestand zodra de build op `finished` staat

## 6) APK uploaden voor klanten

Aanbevolen: upload naar jullie Supabase `releases` bucket, vergelijkbaar met de `.exe`.

Voorbeeld bestandsnamen:

- `ArenaCue-Mobile-v1.0.0.apk` (archief)
- `ArenaCue-Mobile-latest.apk` (vaste klantlink)

## 7) Portal downloadknop (website)

Zet in Vercel env vars:

- `NEXT_PUBLIC_PORTAL_MOBILE_DOWNLOAD_URL=<publieke APK URL>`
- optioneel `NEXT_PUBLIC_PORTAL_MOBILE_DOWNLOAD_LABEL=ArenaCue mobiele app (Android)`

Daarna redeployen.

## 8) Snelle test na build

- Installeer APK op Android toestel
- Open app
- Koppel via cloud flow
- Controleer of commando's op desktop aankomen

## 9) Productie via Play Store

Gebruik voor Play Store:

```bash
npm run build:aab
```

Dat levert een `.aab` voor Google Play Console.

Play Console app details:

- App name: `ArenaCue Control`
- Package name: `be.arenacue.control`
- Default language: `Dutch – nl-NL`
- App or game: `App`
- Free or paid: `Free`
- Privacy policy: `https://arenacue.be/privacy`

Belangrijk: upload naar Google Play altijd de `.aab`, niet de interne `.apk`.
