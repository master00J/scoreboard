# Lokale architectuur vs. cloud (Website)

## Kernprincipe

- **Scorebord-runtime (control + display + database + media)** draait **lokaal op één Windows-pc** per venue in de **Electron-desktopapp**. Geen vereiste dat het wedstrijdbord zelf in de cloud draait.
- De gebundelde **React-UI** (`app/control`, `app/display`) praat in Electron via **IPC** met de ingebouwde API — het is géén klassieke “browser → internet-server”-scoreboardstack voor de live wedstrijd.

## Website-subproject (`Website/`)

- Aparte **Next.js**-toepassing voor o.a. **licenties**, admin/support en downloadinformatie.
- Dit is een **optionele control plane** rond het product (activatie, communicatie), **niet** de plek waar de live timer of het LED-scherm rechtstreeks van afhangt tijdens de match op het stadion.

## Mobiele app

- **Play Store** distribueert de **Expo/React Native**-client (`MobileApp/`).
- Bediening op wedstrijddag: typisch **LAN** naar de **mobile bridge** op de desktop-pc (`MOBILE_BRIDGE_*`), of een optionele cloud-route als die bij jullie is ingericht.

## Kort gezegd

| Onderdeel              | Waar het draait        | Internet nodig?      |
|------------------------|------------------------|----------------------|
| Control + display + DB | Lokale pc (Electron)   | Nee (kernpad)        |
| Website                | Hosting naar keuze    | Ja, voor sitebezoek  |
| Mobiele app            | Telefoon               | Alleen voor download / optioneel cloud-pad |
