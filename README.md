# Stadium Scoreboard

Production-grade football stadium display control system. **Desktop-app (Electron)** — draait volledig offline; geen LAN-webserver meer nodig voor bediening.

## Architecture

- **Electron main process** — SQLite-database in de gebruikersmap (`userData/data/stadium.db`), IPC-bridge voor veilige `/api`-achtige calls, twee vensters (control + display).
- **`/control`** — operatorpanel (laptop / tablet).
- **`/display`** — fullscreen-output voor het grote scherm (canvas 1920×1080, schaalt naar 16:9).
- **Renderer** — React UI uit `app/` wordt met esbuild naar `renderer-dist/` gebundeld (geen klassieke Next.js-devserver in productie).
- **Prisma + SQLite** — lokaal bestand, geen externe database vereist.

## Stack

Electron · React · TypeScript · Tailwind · shadcn/ui · Framer Motion · Prisma · Zod · Zustand · esbuild

## Setup

```bash
npm install
npm run db:push         # databasepad wordt bij eerste start door Electron gezet (zie logs)
npm run db:seed         # optioneel: default playlists + demo match
npm run dev             # Electron development build
```

Daarna opent de app het control- en displayvenster lokaal.

## Production build

```bash
npm run build
```

Produceert Windows-artifacts onder `dist/` (o.a. portable / NSIS via electron-builder).

## Systeemvereisten (productie / wedstrijddag)

Richtlijn voor clubs en operators: typisch **4–6 uur** continue gebruik met **timer, regie en video** (sponsorrotatie, clips). Zie de publieke pagina **[arenacue.be/vereisten](https://arenacue.be/vereisten)** voor minimale vs. aanbevolen hardware (Windows 64-bit, RAM, SSD, GPU/drivers, tweede scherm). Kort samengevat:

- **Minimum:** Windows 10/11 64-bit, **8 GB RAM**, quad-core CPU, **SSD**, GPU met hardware videodecode, drivers up-to-date; bediening min. 1920×1080 + videouitgang voor het stadionscherm.
- **Aanbevolen voor zware video:** **16 GB RAM**, 6+ cores of recente mid-range CPU, dedicated GPU of sterke iGPU, NVMe SSD, wedstrijddag zonder energiebesparing/achtergrondstress.

Test altijd op de **werkelijke wedstrijd-PC** vóór de eerste live inzet.

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
