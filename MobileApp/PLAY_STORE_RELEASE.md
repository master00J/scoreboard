# ArenaCue Control - Google Play invulgegevens

## App aanmaken

- App name: `ArenaCue Control`
- Package name: `be.arenacue.control`
- Default language: `Dutch - nl-NL`
- App or game: `App`
- Free or paid: `Free`

Gebruik exact deze package name. Na de eerste upload kan Google Play dit niet meer wijzigen.

## Store listing

- Short description:
  `Bedien ArenaCue op de wedstrijd-pc vanaf je Android-toestel.`

- Full description:
  `ArenaCue Control is de mobiele afstandsbediening voor de ArenaCue desktopsoftware. Operators kunnen een toestel koppelen via QR-code of koppelcode en daarna de wedstrijdweergave op de pc bedienen, zoals score, timer, wedstrijdstatus en live-commando's. De app is bedoeld als companion app voor clubs en organisatoren die ArenaCue op een wedstrijd-pc gebruiken.`

- App category: `Sports`
- Tags: `sports`, `productivity`, `events` indien beschikbaar
- Contact email: `info@arenacue.be`
- Website: `https://arenacue.be`
- Privacy policy: `https://arenacue.be/privacy`
- Play Store app icon: `MobileApp/assets/play-store-icon.png` (512x512 PNG)
- Feature graphic: `MobileApp/assets/feature-graphic-real-ui-1024x500.png` (1024x500 PNG)
- Android launcher icon source: `MobileApp/assets/icon.png`

## App Access

Kies dat sommige functies beperkt zijn, omdat bediening alleen werkt met een ArenaCue desktopinstallatie en een QR-/koppelcode.

Suggested instructions for Google review:

`ArenaCue Control is a companion remote for the ArenaCue desktop application. The app can be opened without an account, but controlling a scoreboard requires pairing with the desktop software using a QR code or pairing code. For review, use the visible manual input fields and the demo/local pairing instructions supplied in the release notes, or contact info@arenacue.be for a temporary review pairing code.`

## Data Safety

Gegevens die de app lokaal op het toestel bewaart:

- serveradres of cloud-URL
- venue ID / koppelcode
- tijdelijke sessietoken
- operator/viewer rol

De app gebruikt de camera alleen om een ArenaCue QR-koppelcode te scannen. De app neemt geen foto's of video's op en uploadt geen camerabeelden.

Netwerkverkeer gaat naar de ArenaCue desktop bridge op het lokale netwerk of naar de ArenaCue cloud API wanneer cloudbediening actief is.

Praktische Play Console-antwoorden:

- Does your app collect or share user data? `Yes`, als cloudbediening actief is. `No` voor camerabeelden.
- Data types: `App activity` of `App info and performance` alleen indien Google daarom vraagt voor remote-control state; geen contacten, locatie, foto's, audio of advertentie-ID.
- Data is encrypted in transit: `Yes` voor cloud via HTTPS. LAN-bediening volgt het lokale netwerk van de klant.
- Users can request deletion: `Yes`, via `info@arenacue.be`; lokale app-data kan de gebruiker zelf wissen via Android app settings.

## Policy-vragen

- Ads: `No`
- Financial features: `No`
- Health: `No`
- News: `No`
- Government: `No`
- COVID/contact tracing: `No`
- Target audience: volwassen operators/clubs, kies niet specifiek kinderen.
- Content rating: waarschijnlijk `Everyone`, geen geweld, gokken, user-generated content of sociale functies.

## Permissions

- Camera: QR-code scannen voor koppeling
- Internet/network: verbinding met desktop bridge of ArenaCue cloud API

## Build

```bash
cd MobileApp
npm install
npm run eas:login
npm run build:aab
```

Upload de productie `.aab` uit EAS naar Google Play Console.
