# Stadium Scoreboard

Production-grade football stadium display control system. **Desktop-app (Electron)** — draait volledig offline; geen LAN-webserver meer nodig voor bediening.

## Architecture

Zie ook `docs/ARCHITECTURE_LOCAL.md` (lokaal scorebord vs. optionele Website/cloud-randen).

- **Electron main process** — SQLite-database in de gebruikersmap (`userData/data/stadium.db`), IPC-bridge voor veilige `/api`-achtige calls, twee vensters (control + display).
- **`/control`** — operatorpanel (laptop / tablet).
- **`/display`** — fullscreen-output voor het grote scherm (canvas 1920×1080, schaalt naar 16:9).
- **Renderer** — React UI uit `app/` wordt met esbuild naar `renderer-dist/` gebundeld (geen klassieke Next.js-devserver in productie).
- **Prisma + SQLite** — lokaal bestand, geen externe database vereist.

## Stack

Electron · React · TypeScript · Tailwind · shadcn/ui · Framer Motion · Prisma · Zod · Zustand · esbuild

## Setup

```bash
npm install --legacy-peer-deps
npm test                 # Vitest (timer, commands, sponsor-klok)
npm run db:push         # databasepad wordt bij eerste start door Electron gezet (zie logs)
npm run db:seed         # optioneel: default playlists + demo match
npm run dev             # Electron development build
```

Daarna opent de app het control- en displayvenster lokaal.

## Production build

```bash
npm run build
```

Produceert platform-specifieke artifacts onder `dist/`:

- **Windows** (op een Windows-pc): portable + NSIS-installer (`Stadium-Scoreboard.exe`, …).
- **macOS** (op een Mac of via GitHub Actions): DMG + ZIP per architectuur (`Stadium-Scoreboard-<versie>-arm64.dmg`, `-x64.zip`, …). Zie `docs/MAC_BUILD.md`.

```bash
npm run build              # huidig besturingssysteem
npm run electron:build:win # alleen Windows
npm run electron:build:mac # alleen macOS (vereist Mac of CI)
```

Daarna optioneel: `npm run release:checksums` voor `dist/SHA256SUMS.txt`.

### Update-melding voor bestaande desktop-apps

De desktop checkt bij het openen van het control panel `https://arenacue.be/api/app/release`.
Als `APP_RELEASE_VERSION` op Vercel hoger is dan de versie in de lokale `.exe`, toont de app een updatebanner met downloadknop.

Release-stappen:

1. Verhoog `version` in `package.json` voordat je bouwt, bv. `0.1.1`.
2. Windows: `npm run electron:build:win` → upload `dist/Stadium-Scoreboard.exe` naar Supabase Storage.
3. macOS: GitHub Actions **Build macOS** → download `Stadium-Scoreboard-<versie>-arm64.dmg` → upload als canonieke `Stadium-Scoreboard-arm64.dmg` (zie `docs/MAC_BUILD.md`).
4. Zet op Vercel minstens:
   - `APP_RELEASE_VERSION=0.1.1`
   - `DOWNLOAD_STADIUM_EXE_REDIRECT_URL=<publieke Supabase-URL>`
   - `NEXT_PUBLIC_PORTAL_MAC_DOWNLOAD_URL=/downloads/Stadium-Scoreboard-arm64.dmg`
   - `DOWNLOAD_STADIUM_MAC_DMG_REDIRECT_URL=<publieke Supabase-URL van de DMG>` (of `PORTABLE_MAC_DMG_FETCH_URL` bij prebuild)
5. Redeploy de website op Vercel.
6. Als automatische update-mails actief zijn, verstuurt de Vercel Cron-route daarna één mail naar actieve licentiehouders voor deze versie.

Optioneel kun je `APP_RELEASE_DOWNLOAD_URL` zetten als de updatebanner een andere URL moet gebruiken dan de download-redirect. Zonder die override gebruikt `/api/app/release` automatisch `NEXT_PUBLIC_PORTAL_DOWNLOAD_URL`, daarna `DOWNLOAD_STADIUM_EXE_REDIRECT_URL`, en anders de standaard `/downloads/Stadium-Scoreboard.exe` URL.

Voor automatische update-mails moet de website `CRON_SECRET`, `RESEND_API_KEY`,
`RESEND_FROM`, `SUPABASE_SERVICE_ROLE_KEY` en de Supabase-tabel uit
`Website/supabase/app-release-notifications.sql` hebben. De mail wordt alleen
verstuurd voor unieke actieve licentiehouders (`owner_email`) en per versie maar
één keer.

## Systeemvereisten (productie / wedstrijddag)

Richtlijn voor clubs en operators: typisch **4–6 uur** continue gebruik met **timer, regie en video** (sponsorrotatie, clips). Zie de publieke pagina **[arenacue.be/vereisten](https://arenacue.be/vereisten)** voor minimale vs. aanbevolen hardware (Windows 64-bit, RAM, SSD, GPU/drivers, tweede scherm). Kort samengevat:

- **Minimum:** Windows 10/11 64-bit of macOS 12+ (Apple Silicon aanbevolen), **8 GB RAM**, quad-core CPU, **SSD**, GPU met hardware videodecode, drivers up-to-date; bediening min. 1920×1080 + videouitgang voor het stadionscherm.
- **Aanbevolen voor zware video:** **16 GB RAM**, 6+ cores of recente mid-range CPU, dedicated GPU of sterke iGPU, NVMe SSD, wedstrijddag zonder energiebesparing/achtergrondstress.

Test altijd op de **werkelijke wedstrijd-PC** vóór de eerste live inzet.

## Security hardening (snelle notities)

- Cloud control viewer-sessies vereisen een venue-scoped pair token (geen anonieme read-only tokens).
- Gevoelige secrets (licentie/cloud keys) worden in `userData` versleuteld opgeslagen wanneer Windows encryptie beschikbaar is.
- Openbare website endpoints hebben basis rate limiting (anti-spam / anti-abuse).
- Excel export (proof-of-play) gebruikt **ExcelJS** (write-only `.xlsx`), geen import van spreadsheets in de app.
- **Mobiele LAN-bridge** (optioneel): omgevingsvariabelen `MOBILE_BRIDGE_PORT`, `MOBILE_BRIDGE_BIND` (`0.0.0.0` of `127.0.0.1`), `MOBILE_BRIDGE_PAIRING_CODE`, `MOBILE_BRIDGE_OPERATOR_PIN` (6–12 cijfers), `MOBILE_BRIDGE_SESSION_TTL_MS`. Operator-PIN is minstens 6 cijfers.

## Build phases (functioneel)

- [x] **Phase 1** — scaffold + timer sync backbone
- [x] **Phase 2** — teams, players, match setup
- [x] **Phase 3** — score, goals, subs, cards, event log with undo
- [x] **Phase 4** — media library + playlists (drag-to-reorder, play now)
- [x] **Phase 5** — team intro + player intro (manual / auto-advance)
- [x] **Phase 6** — framer motion transitions, keyboard shortcuts, crash recovery banner, display watchdog, blackout
- [x] **Phase 7** — match summary export (JSON + printable HTML)

## File layout

```
electron/        Electron main process, preload, IPC
scripts/         dev server, renderer bundle, build helpers
app/             React routes (control + display)
components/      UI (ScaleContainer, shadcn, …)
lib/             prisma client usage, schemas, sponsor/timer helpers
prisma/          schema.prisma + seed.ts
renderer-dist/   build output (gitignored)
public/uploads/  user media (gitignored)
```

## Keyboard shortcuts (control panel)

- `Space` — start / pause timer

## Reliability

- Commands validated with Zod before mutating state
- IPC handlers guarded — een foutmelding crash’t de app niet volledig
- Mutaties naar SQLite; timer server-side / authoritative waar van toepassing
- **Wedstrijddag:** backup/restore-checklist in `docs/MATCHDAY.md`

## Cloud remote control (Optie A)

Desktop kan optioneel cloud-gestuurd draaien (mobiel hoeft dan niet op hetzelfde netwerk):

- **Auto-provisioned via licentie-activatie** (aanbevolen; geen handmatige desktop-config per klant).
- Optioneel overriden met env:
  - `CONTROL_CLOUD_BASE_URL` (bijv. `https://arenacue.be`)
  - `CONTROL_DESKTOP_KEY`
  - `CONTROL_VENUE_ID`

De desktop-agent pusht state naar de cloud en voert gequeue’de commando’s uit.

## Dubbele marketingwebsite

Er staat ook een `Website/`-submap (ArenaCue-site). De levende marketingbron staat in de aparte repo **Arenacue**; houd releases synchroon of verwijder een van de twee om drift te voorkomen.
