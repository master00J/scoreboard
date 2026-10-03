# ArenaCue Scoreboard: notes for coding agents

Electron + React desktop app that sports clubs run live on matchday. A crash or a wrong score on the stadium screen during a match is the worst outcome, so prefer small, safe changes.

## Layout

- `electron/`: main process. IPC handlers are in `main.ts`, the local API and match state in `runtime.ts`.
- `app/control/`: control panel UI. `app/display/`: stadium screen. `app/stream/`: livestream overlay.
- `lib/`: shared logic, with tests next to the code (`*.test.ts`).
- `server/`: command handlers and database setup. `prisma/`: SQLite schema.
- `lib/i18n/locales/{nl,en,fr,it}.json`: UI texts.

## Checks

CI runs these on every pull request; make them pass before you open one.

```bash
npm ci --legacy-peer-deps
npm test
npm run renderer:build
npm run electron:compile
```

## Rules

- Every UI text goes through `t("…")` and exists in all four locale files. `node scripts/verify-i18n-parity.mjs` lists keys that are missing in a language.
- A new persistent field needs both the Prisma schema and an `addColumnIfMissing` line in `server/db-init.ts`, so existing club databases migrate on start.
- Add or update a test in `lib/` or `server/` when you change logic.
- A dialog opened from the control panel header must render outside the header (see `feature-request-button.tsx`): the header's backdrop blur traps `position: fixed` children.
- Do not change `.github/`, the build, signing and release scripts in `scripts/`, `electron/license-service.ts`, or `version` in `package.json`. The Release Windows workflow bumps the version.
- Do not add dependencies or calls to third-party services without saying so in the pull request.
- Pull request title: one sentence that says what changes for the club, for example "Keep the shot clock off by default."
