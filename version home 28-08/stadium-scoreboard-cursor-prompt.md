# Stadium Scoreboard & Display Control System — Cursor Build Spec

Build a production-grade football stadium display control system. This will run live during matches, so reliability and smooth performance are non-negotiable. Read this entire spec first, then build in the phases listed at the bottom.

---

## 1. High-Level Concept

Two synchronized browser windows on two separate outputs:

- **`/control`** — Operator panel (laptop/tablet, touch-friendly). Run the match from here.
- **`/display`** — Fullscreen output shown on the big scoreboard screen(s) in the stadium.

State changes on the control panel appear instantly on the display (<100 ms). The display is dumb/reactive — all logic lives in the control panel and the server.

The app must run **fully offline/local** — the stadium may have unreliable internet. No cloud dependencies.

---

## 2. Tech Stack (use exactly this)

- **Next.js 15** (App Router, TypeScript strict mode)
- **Tailwind CSS** + **shadcn/ui** for operator UI components
- **Framer Motion** for all display animations
- **Socket.IO** (server + client) for real-time sync between control and display
- **Prisma** + **SQLite** (local file `./data/stadium.db`) for persistence
- **Zod** for runtime validation of all socket events and API input
- **Zustand** for client-side UI state (control panel only)
- **react-hook-form** for forms
- **next/image** for photos, native `<video>` for video playback
- File uploads stored in `./public/uploads/` (videos, images, logos, player photos)

No external APIs. No auth (single-trusted-operator on LAN). Bind Socket.IO to `0.0.0.0` so the display machine on the same network can connect.

---

## 3. Data Model (Prisma)

```prisma
model Team {
  id          String   @id @default(cuid())
  name        String
  shortName   String   // max 3-4 chars, e.g. "RSC"
  logoPath    String?
  primaryColor String  // hex
  secondaryColor String // hex
  players     Player[]
  homeMatches Match[]  @relation("HomeTeam")
  awayMatches Match[]  @relation("AwayTeam")
}

model Player {
  id        String   @id @default(cuid())
  teamId    String
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  number    Int
  firstName String
  lastName  String
  position  String?  // GK, DEF, MID, FWD
  photoPath String?
  isCoach   Boolean  @default(false)
}

model Match {
  id              String        @id @default(cuid())
  homeTeamId      String
  awayTeamId      String
  homeTeam        Team          @relation("HomeTeam", fields: [homeTeamId], references: [id])
  awayTeam        Team          @relation("AwayTeam", fields: [awayTeamId], references: [id])
  kickoffAt       DateTime?
  halfDurationSec Int           @default(2700) // 45min
  halfBreakSec    Int           @default(900)  // 15min
  status          String        @default("SETUP") // SETUP | PREMATCH | FIRST_HALF | HALF_TIME | SECOND_HALF | EXTRA_TIME | FULL_TIME | POST_MATCH
  homeScore       Int           @default(0)
  awayScore       Int           @default(0)
  events          MatchEvent[]
  createdAt       DateTime      @default(now())
}

model MatchEvent {
  id         String   @id @default(cuid())
  matchId    String
  match      Match    @relation(fields: [matchId], references: [id], onDelete: Cascade)
  type       String   // GOAL | SUB | CARD_YELLOW | CARD_RED | HALFTIME | FULLTIME | CUSTOM
  minute     Int
  addedTime  Int      @default(0)
  teamId     String?
  playerInId String?
  playerOutId String?
  note       String?
  createdAt  DateTime @default(now())
}

model MediaItem {
  id          String   @id @default(cuid())
  type        String   // VIDEO | IMAGE
  path        String
  title       String
  durationSec Int      // for images: display duration; for video: playback length or auto
  sponsorName String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
}

model Playlist {
  id          String            @id @default(cuid())
  name        String            // "Pre-match", "Half-time", "Post-match", "Idle"
  slot        String            @unique // PREMATCH | HALFTIME | POSTMATCH | IDLE
  items       PlaylistItem[]
}

model PlaylistItem {
  id          String   @id @default(cuid())
  playlistId  String
  playlist    Playlist @relation(fields: [playlistId], references: [id], onDelete: Cascade)
  mediaId     String
  media       MediaItem @relation(fields: [mediaId], references: [id])
  order       Int
  durationOverrideSec Int?
}

// Single-row table holding the current live display state.
model DisplayState {
  id              Int      @id @default(1)
  mode            String   // IDLE | TEAM_INTRO | PLAYER_INTRO | MATCH | SPONSOR_ROTATION | GOAL | SUBSTITUTION | CARD | HALFTIME | FULLTIME | SPONSOR | BLACKOUT | CUSTOM
  matchId         String?
  activePlayerId  String?  // for PLAYER_INTRO
  activeSubOutId  String?
  activeSubInId   String?
  activeGoalScorerId String?
  activeMediaId   String?
  timerRunning    Boolean  @default(false)
  timerStartedAt  DateTime?
  timerBaseSec    Int      @default(0) // accumulated seconds when paused
  updatedAt       DateTime @updatedAt
}
```

The timer is computed: `elapsed = timerBaseSec + (timerRunning ? (now - timerStartedAt) : 0)`. This way the display calculates time locally and stays smooth even if a socket message is delayed.

---

## 4. Display Modes (what `/display` shows)

The display uses a **two-layer model** during a match:

- **Scoreboard strip** — a persistent 1920×180 bar along the bottom edge (configurable to top). Always shows home logo, home short name, home score, **live timer**, period indicator, added time badge, away score, away short name, away logo. Uses club-themed dark background with team color accents. Visible in every mode that is part of active match play (MATCH, SPONSOR_ROTATION, GOAL, SUBSTITUTION, CARD).
- **Content area** — the remaining 1920×900 area above the strip. This is where sponsor media, player photos, goal celebrations, and substitution overlays render.

In non-match modes (IDLE, TEAM_INTRO, PLAYER_INTRO, HALFTIME, FULLTIME, BLACKOUT), the scoreboard strip is **hidden** and sponsor content / animations use the full 1920×1080 canvas.

Every mode is a React component with Framer Motion enter/exit animations (crossfade, 400–600ms). Never flash white or go black between modes (except explicit BLACKOUT).

| Mode | Scoreboard strip | Content area |
|---|---|---|
| `IDLE` | hidden | Sponsor playlist auto-rotating full-screen (pre-match warmup) |
| `TEAM_INTRO` | hidden | Both team logos + names full-screen, club-colored gradient background |
| `PLAYER_INTRO` | hidden | One player at a time: big jersey number → slide in name → photo. Operator clicks "next" or auto-advance (3s/player). |
| `MATCH` | **visible** | Big central scoreboard (focus mode) — large score, large timer, team names. Used at kickoff, after key moments, or whenever operator wants full focus. |
| `SPONSOR_ROTATION` | **visible** | Sponsor playlist auto-rotating in 1920×900. Default in-match state — scoreboard strip keeps timer + score always visible while ads play. |
| `GOAL` | **visible** | Celebration in content area: scorer photo + name + number, team color flooding, "GOAL!" text. Scoreboard strip updates to new score. Auto-return to `SPONSOR_ROTATION` after 8s. |
| `SUBSTITUTION` | **visible** | Content area shows split: red arrow + outgoing player, green arrow + incoming player, team crest, minute. Auto-return after 6s. |
| `CARD` | **visible** | Yellow or red card graphic + player photo/name in content area. Auto-return after 5s. |
| `HALFTIME` | hidden | "RUST / HALF-TIME" + current score full-screen for 10s, then transitions to half-time sponsor playlist full-screen |
| `FULLTIME` | hidden | Final score emphasized full-screen for 15s, then post-match sponsor playlist |
| `SPONSOR` | hidden | Specific sponsor item full-screen, manually triggered (interrupt) |
| `BLACKOUT` | hidden | Club logo on solid background (emergency fallback) |
| `CUSTOM` | configurable | Operator-entered message (announcements) — operator chooses whether strip stays visible |

**Critical in-match behavior:** The default live-play state is `SPONSOR_ROTATION`, NOT `MATCH`. This means during normal 2×45 minutes the big screen is actively monetized (sponsors rotating in the 1920×900 content area) while players, staff, and fans can always glance up and see the score/time in the persistent strip. The operator can tap a "Focus" button to switch to `MATCH` mode anytime for a big central scoreboard display, then tap again to return to `SPONSOR_ROTATION`.

**Sponsor media sizing:** Uploaded at 1920×1080. When shown in `IDLE`/`HALFTIME`/`FULLTIME`/`SPONSOR` they fill the full canvas. When shown in `SPONSOR_ROTATION` (during match) they are rendered inside the 1920×900 content area with `object-fit: cover` — the top portion of the sponsor image is visible, bottom is covered by the persistent strip. Since most sponsor designs have safe-zone padding, this usually works; for sponsors who care, offer an optional "in-match crop preview" in the media settings showing how their 1920×1080 file will look with the bottom 180px covered.

**Target display is fixed 16:9.** Design every mode on a **1920×1080 canvas** with absolute pixel values for typography and positioning. Wrap the entire display in a `<ScaleContainer>` component that:

- Measures window dimensions on mount + resize
- Applies `transform: scale(min(width/1920, height/1080))` to a fixed 1920×1080 inner div
- Centers the scaled canvas (letterbox with club color or black if the window isn't exactly 16:9)

This means the same design renders pixel-perfect at 1920×1080, scales cleanly to 4K (3840×2160), and stays identical on any 16:9 output. Designers work against one canvas, no responsive breakpoints needed.

All sponsor media should be delivered at **1920×1080**. In the media upload UI, check dimensions on upload: if not 1920×1080, show a warning with options (letterbox with black bars / cover and crop / stretch). Default to letterbox.

---

## 5. Control Panel (`/control`)

Layout: left sidebar (match state), center (live preview of display), right sidebar (action buttons). Bottom: event log / timeline.

Must include:

- **Timer controls** (always visible in sidebar — primary operator tool):
  - **Start / Pause** — big button, toggles state. Spacebar shortcut. When paused, button shows "Start" with green accent; when running, shows "Pause" with amber accent.
  - **Fine adjustment** (active any time, works while paused or running): `-10s` / `+10s` / `-1min` / `+1min` — single click applies immediately.
  - **Set exact time** — modal with minute/second input. Available at any time.
  - **Reset presets** — row of quick buttons that set the timer to a specific kickoff value *and* pause it:
    - `Start 1st half` → 00:00, period = `FIRST_HALF`
    - `Start 2nd half` → 45:00, period = `SECOND_HALF`
    - `Start ET 1` → 90:00, period = `EXTRA_TIME` (if used)
    - `Start ET 2` → 105:00, period = `EXTRA_TIME`
  - **Behavior rules:**
    - Adjusting the timer (any method) while it is running **does not pause it** — the adjustment applies live. This lets the operator nudge the clock during play without breaking visible flow.
    - Reset presets **always pause** the timer and require an explicit `Start` press to begin running again. This prevents accidental jumps.
    - The display timer keeps advancing from the new value if the timer was running before the adjustment.
    - Every adjustment is logged to `MatchEvent` with type `TIMER_ADJUST` and old/new values in `note`, for post-match audit.
  - **Confirmation on destructive actions:** pressing a reset preset while the timer is running and non-zero shows an inline 3-second undo toast ("Timer reset to 45:00. Undo?") in case of mis-click.
- **Score controls**: Home +1 / -1, Away +1 / -1. Clicking +1 opens a quick modal: select scorer (grid of player cards from that team) + optional assist. Confirm triggers GOAL mode on display.
- **Period control**: dropdown to move between SETUP → PREMATCH → FIRST_HALF → HALF_TIME → SECOND_HALF → EXTRA_TIME → FULL_TIME → POST_MATCH. Also quick button "End first half" etc.
- **Added time**: input "+X minutes" that shows on the display
- **Substitutions panel**: pick team → pick player out (current XI) → pick player in (bench) → confirm triggers SUB mode
- **Cards**: yellow/red card buttons → pick player → logged in events
- **Player intro launcher**: "Start lineup presentation" → auto-walks through each player with configurable interval, or manual next/prev
- **In-match display toggle** (one of the most-used buttons during a match):
  - `Focus` button — switches display to `MATCH` mode (big central scoreboard, no sponsors in content area). Use at kickoff, after important moments, final whistle countdown.
  - `Sponsors` button — switches display to `SPONSOR_ROTATION` (scoreboard strip visible, sponsors rotating in 1920×900 content area). This is the default live-play state.
  - Current state clearly indicated with a colored pill and pulsing dot.
  - Keyboard shortcut: `F` toggles between Focus and Sponsors.
- **Sponsor controls**:
  - Playlist tabs (IDLE / PREMATCH / HALFTIME / POSTMATCH)
  - Drag-to-reorder, per-item duration override
  - "Play now" button for any media item (interrupts current mode for that item's duration, then returns)
  - Active playback indicator showing current item + time remaining
- **Mode override**: direct buttons for every display mode (for emergencies)
- **Blackout button**: big red button, top right, one-click safety
- **Preview panel**: iframe of `/display?preview=1` showing exactly what's on the big screen now
- **Keyboard shortcuts** (show cheat-sheet overlay on "?"):
  - `Space` — start/pause timer
  - `H` — home goal, `A` — away goal
  - `F` — toggle Focus / Sponsors during match
  - `S` — substitution modal
  - `B` — blackout
  - `1/2/3/4` — switch to period 1st half / half-time / 2nd half / full-time
  - `Esc` — close any modal

---

## 6. Real-Time Sync

Custom Socket.IO server attached to Next.js. Channels:

- `display:state` — broadcast full `DisplayState` on any change
- `display:command` — operator → server (start_timer, pause_timer, add_time, set_score, set_mode, trigger_goal, trigger_sub, play_media, blackout, etc.)
- `tick` — server emits every 250ms with authoritative current timer seconds (so display doesn't drift)

Every command is validated with Zod before applying. Server is source of truth. Display is read-only. Control panel also reads state from socket (never from its own optimistic state for critical values like score).

Reconnect logic: if display reconnects, it requests full state snapshot and resumes. Timer must not jump visually on reconnect — interpolate.

---

## 7. Media Upload & Playback

- Upload endpoint: `POST /api/media/upload` — accepts mp4, webm, mov, jpg, jpeg, png, webp. Max 500MB. Saves to `./public/uploads/`, creates `MediaItem` row.
- For videos: read duration via `ffprobe` (or HTML5 video metadata on upload in the browser), auto-fill `durationSec`.
- Video playback on display: muted by default (stadium has its own audio), `playsInline`, preload the next item in the playlist to avoid gaps.
- Crossfade between playlist items (200ms) — no black flash between items.
- If a video ends before its `durationSec`, hold last frame; if `durationSec` < video length, cut early with fade.
- Playlists loop by default.

---

## 8. Reliability Rules

- Persist every state change immediately to SQLite (write-through, not just in-memory).
- On app startup, restore `DisplayState` — if a match was mid-play when the app crashed, show a recovery banner on the control panel: "Restore match XYZ in progress?" → Resume or Start Fresh.
- Wrap every socket handler in try/catch — never let one bad event crash the server.
- Log all commands to a rotating file (`./logs/commands.log`) with timestamp, for post-match review.
- Display page: add a `watchdog` that reloads itself if it loses socket connection for >30s and the mode was SPONSOR/IDLE (safe auto-recovery).
- Never show raw error messages on `/display`. Any error → fall back to BLACKOUT mode silently and alert operator panel with a toast.

---

## 9. UI/UX Rules for the Display

- Typography: use a bold, geometric sans (Inter, Archivo, or Barlow). Scores in tabular nums.
- Design canvas is fixed 1920×1080 — use absolute `px` values, not `rem` or `clamp()`. Example: score digits at `420px`, timer at `280px`, team names at `96px`. These scale proportionally via the `<ScaleContainer>` wrapper for 4K and other 16:9 resolutions.
- High contrast. Dark base, light text. Team colors used as accents and for goal celebrations.
- No text shadows unless over video. Pure colors, no gradients except behind player photos.
- All animations: ease-out, 300–600ms, 60fps. Never spring-bounce score changes — clean flip or count-up.
- Always guarantee at least one frame of valid content on screen — never unmount a mode before the next one has mounted.

## UI/UX Rules for the Control Panel

- Dense but readable. Buttons are large (min 48px touch target), labeled, color-coded.
- Red = destructive/emergency (blackout, reset). Green = confirm. Neutral = normal actions.
- Current display mode prominently shown at top, with an indicator dot pulsing when LIVE.
- Undo-friendly: every goal/sub shown in event log with an "undo last event" button.

---

## 10. File Structure

```
/app
  /control
    page.tsx
    _components/
  /display
    page.tsx
    _modes/            (one file per display mode)
  /api
    /media/upload/route.ts
    /media/[id]/route.ts
/lib
  socket.ts            (server init)
  socket-client.ts
  timer.ts             (authoritative timer math)
  prisma.ts
  validation/          (Zod schemas for every event)
/server
  index.ts             (custom Next.js server with Socket.IO)
  handlers/            (one file per command domain)
/components/ui         (shadcn)
/prisma
  schema.prisma
  seed.ts              (creates default playlists, a demo team)
/public/uploads
/data
  stadium.db
/logs
```

Use a **custom Next.js server** (`server/index.ts`) so Socket.IO and Next share one HTTP port. Script: `npm run dev` runs it.

---

## 11. Build Phases — Do these in order, complete each before starting the next

**Phase 1 — Scaffold & sync backbone**
- Init Next.js 15 + TS + Tailwind + shadcn/ui
- Prisma + SQLite, migrate, seed playlists
- Custom server with Socket.IO
- Minimal `/control` with Start/Pause timer button
- Minimal `/display` showing timer, synced live via socket
- Verify two browser windows stay in sync perfectly for 10 minutes

**Phase 2 — Teams, players, match setup**
- CRUD UI for teams and players (with photo upload for players, logo upload for teams)
- Match creation wizard
- Display MATCH mode: logos + score + timer

**Phase 3 — Score, events, goals, subs, cards**
- Goal flow (score +1 → scorer modal → GOAL display mode → auto-return)
- Substitution flow
- Card flow
- Event log with undo

**Phase 4 — Media library & playlists**
- Media upload endpoint + UI
- Playlist builder (drag-to-reorder)
- IDLE mode with sponsor rotation
- HALFTIME and POSTMATCH playlist auto-activation based on match status
- Manual "play now" interrupt

**Phase 5 — Team/player intro mode**
- Full squad intro animation
- Individual player walk-through (manual + auto)

**Phase 6 — Polish & reliability**
- Framer Motion transitions between all modes
- Keyboard shortcuts
- Crash recovery
- Command log file
- Watchdog reconnect
- Blackout safety button
- Preview iframe in control panel

**Phase 7 — Finishing**
- Settings page: goal celebration duration, auto-advance player intro interval, timer font, etc.
- Club theming (upload club logo as blackout fallback, set accent colors)
- Match summary export (JSON + printable HTML of events)

---

## 12. Deliver

After each phase, run the app, test the specific phase flow end-to-end in two browser windows, and only then proceed. Do not skip phases. Do not add features not in this spec until phase 7 is done.

Start with Phase 1 now.
