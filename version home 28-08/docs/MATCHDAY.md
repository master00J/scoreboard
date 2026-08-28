# Wedstrijddag: backup en herstel

## Backup maken

1. **Desktop-app** — menu **Bestand → Exporteer venue-backup (ZIP)…** of in **Setup** het blok **Venue-backup**.
2. Kies een veilige locatie (USB-stick, netwerkschijf). De ZIP bevat:
   - `stadium-backup/data/stadium.db` — SQLite-database
   - `stadium-backup/uploads/` — gekopieerde mediabestanden

## Restore-drill (oefenen vóór live)

1. **Sluit de Stadium Scoreboard-app volledig** (anders blijft `stadium.db` gelocked).
2. Pak de ZIP uit in een tijdelijke map.
3. Maak eerst een **kopie** van de huidige gebruikersdata:
   - Open vanuit de app **Bestand → Open log-map** (dit is `%APPDATA%/…` / `userData`).
4. Vervang handmatig:
   - `data/stadium.db` door het bestand uit de backup-zip (`…/stadium-backup/data/stadium.db`).
   - Inhoud van `uploads/` door `…/stadium-backup/uploads/` (of merge voorzichtig als je alleen aanvult).
5. Start de app opnieuw en controleer **Setup**, **Media** en een **testwedstrijd** (timer, display).

> Geautomatiseerde “één klik restore” binnen de draaiende app is bewust nog niet toegevoegd: SQLite moet gesloten zijn om bestanden veilig te overschrijven.

## Mobiele app

- Standaard toont het control-panel een **viewer-only** LAN-QR (zonder operator-PIN). Operator-koppelcode en PIN alleen tonen in een **vertrouwde** omgeving (checkbox in de UI).
