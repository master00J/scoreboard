# Stadium Scoreboard

Production-grade football stadium display control system. Runs fully offline on LAN.

## Architecture

- **`/control`** — operator panel (laptop / tablet)
- **`/display`** — fullscreen output for the big screen (fixed 1920×1080 canvas, auto-scales to any 16:9 screen)
- Custom Next.js 15 server + Socket.IO for <100 ms state sync
- Prisma + SQLite (local file, `./data/stadium.db`) — zero external deps

## Stack

Next.js 15 · TypeScript · Tailwind · shadcn/ui · Framer Motion · Socket.IO · Prisma · Zod · Zustand

## Setup

```bash
npm install
npm run db:push         # creates data/stadium.db from prisma schema
npm run db:seed         # creates default playlists + a demo match
npm run dev
```

Then:
- Control panel: http://localhost:3000/control (on operator laptop)
- Big screen:    http://<host-ip>:3000/display (on display machine, fullscreen browser)

Because the server binds to `0.0.0.0`, the display machine on the same LAN can connect over Wi-Fi or ethernet. No internet required.

## Build phases

- [x] **Phase 1** — scaffold + timer sync backbone
- [x] **Phase 2** — teams, players, match setup
- [x] **Phase 3** — score, goals, subs, cards, event log with undo
- [x] **Phase 4** — media library + playlists (drag-to-reorder, play now)
- [x] **Phase 5** — team intro + player intro (manual / auto-advance)
- [x] **Phase 6** — framer motion transitions, keyboard shortcuts, crash recovery banner, display watchdog, blackout
- [x] **Phase 7** — match summary export (JSON + printable HTML)

## File layout

```
app/             Next.js App Router (control + display pages)
components/      UI components (incl. ScaleContainer, shadcn)
lib/             prisma, socket client, timer math, zod schemas
server/          custom Next.js server + Socket.IO handlers
prisma/          schema.prisma + seed.ts
data/            stadium.db (gitignored)
public/uploads/  user-uploaded media (gitignored)
logs/            rotating command log (gitignored)
```

## Keyboard shortcuts (control panel)

- `Space` — start / pause timer
- more coming in later phases

## Reliability

- Every command is validated with Zod before mutating state
- Socket handlers wrapped in try/catch — one bad event cannot crash the server
- Every mutation is written to SQLite immediately (no in-memory drift)
- Command log streamed to `logs/commands.log` for post-match audit
- Timer is computed authoritatively on the server; display interpolates locally for smoothness
