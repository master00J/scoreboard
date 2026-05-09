# Stadium Scoreboard Mobile

Testbare companion-app voor Android (Expo), bedoeld om de desktop-app op afstand te bedienen.

De **wedstrijd-PC** die de display en video draait heeft hogere eisen dan deze telefoon-app. Zie **https://arenacue.be/vereisten** (minimaal vs. aanbevolen voor lange sessies met video).

## 1) Desktop starten

Start de desktop-app zoals normaal. In de boot-log verschijnt daarna o.a.:

- `[mobile-bridge] actief op 0.0.0.0:17890` (of `127.0.0.1` als je `MOBILE_BRIDGE_BIND` zo zet)
- pairing-code (6 cijfers) en operator-PIN (**minstens 6 cijfers**), of vast via env — zie root-`README.md`

Die pairing-code heb je nodig in de mobiele app.

## 2) Mobiele app starten

```bash
cd MobileApp
npm install
npx expo start
```

Scan de QR-code in de terminal met Expo Go op je Samsung Galaxy S24.

## 3) Verbinden

- Zet `Bridge URL` op je pc-IP, bv. `http://192.168.1.10:17890`
- Zet `Pairing code` op de code uit de desktop boot-log
- Klik `Koppel toestel`

Voor cloudmodus (Optie A):

- Zet `Bridge URL` op je website API-host (bv. `https://arenacue.be`)
- Kies `Cloud (Optie A)` in de app
- Vul `Venue ID` in
- Log in als viewer/operator (operator met PIN)

Sneller voor klanten:

- gebruik de `ACPAIR:...` koppelcode uit de desktop `boot.log`
- plak die in de app bij `Klant-koppelcode`
- klik `Gebruik koppelcode`

## Netwerkvoorwaarden

- Pc en telefoon op hetzelfde wifi-netwerk
- Windows firewall moet inkomend verkeer op poort `17890` toestaan

## Operator PIN (aanbevolen)

Start desktop met:

```bash
MOBILE_BRIDGE_OPERATOR_PIN=1234 npm run dev
```

Dan kunnen alleen operator-sessies met juiste PIN commando's sturen.

## Security

De bridge gebruikt:

- pairing-code (eenmalig aanmelden)
- rolkeuze (`viewer` of `operator`)
- optionele operator-PIN (`MOBILE_BRIDGE_OPERATOR_PIN` op desktop)
- tijdelijke sessietoken (`Bearer`) voor alle commando's
- basis rate-limiting op foute loginpogingen

De mobiele app bewaart verbindingsinstellingen en sessie lokaal op het toestel.

## Cloud backend setup

Run in Supabase:

```sql
-- Website/supabase/cloud-control.sql
```

Vereiste Website env vars:

- `CONTROL_SESSION_SECRET` (min. 24 chars)
- `CONTROL_OPERATOR_PIN`
- `CONTROL_DESKTOP_KEY`

Vereiste desktop env vars:

- Geen verplichte env vars per klant-pc als licentie online geactiveerd wordt:
  desktop ontvangt cloud config automatisch via `/api/license/activate` en `/api/license/check`.
- Alleen nodig als override/debug:
  - `CONTROL_CLOUD_BASE_URL`
  - `CONTROL_DESKTOP_KEY`
  - `CONTROL_VENUE_ID`

## APK/AAB build (zonder Expo Go)

```bash
cd MobileApp
npm install
npm run eas:login
npm run build:apk   # interne APK om direct te installeren
# of:
npm run build:aab   # Play Store bundle
```
