# Stadium Scoreboard Mobile

Testbare companion-app voor Android (Expo), bedoeld om de desktop-app op afstand te bedienen.

## 1) Desktop starten

Start de desktop-app zoals normaal. In de boot-log verschijnt daarna:

- `[mobile-bridge] actief op poort ... (token=...)`

Die token heb je nodig in de mobiele app.

## 2) Mobiele app starten

```bash
cd MobileApp
npm install
npx expo start
```

Scan de QR-code in de terminal met Expo Go op je Samsung Galaxy S24.

## 3) Verbinden

- Zet `Bridge URL` op je pc-IP, bv. `http://192.168.1.10:17890`
- Zet `Bridge token` op de token uit de desktop boot-log
- Klik `Ping` en daarna `Snapshot`

## Netwerkvoorwaarden

- Pc en telefoon op hetzelfde wifi-netwerk
- Windows firewall moet inkomend verkeer op poort `17890` toestaan

## Security

De bridge vereist een token via `X-Scoreboard-Token`. Zonder token zijn opdrachten geblokkeerd.
