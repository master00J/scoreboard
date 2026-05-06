# Stadium Scoreboard Mobile

Testbare companion-app voor Android (Expo), bedoeld om de desktop-app op afstand te bedienen.

## 1) Desktop starten

Start de desktop-app zoals normaal. In de boot-log verschijnt daarna:

- `[mobile-bridge] actief op poort ... (pairing-code=123456)`

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

## APK/AAB build (zonder Expo Go)

```bash
cd MobileApp
npm install
npm run eas:login
npm run build:apk   # interne APK om direct te installeren
# of:
npm run build:aab   # Play Store bundle
```
