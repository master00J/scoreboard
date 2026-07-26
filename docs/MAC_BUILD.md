# macOS-build (Stadium Scoreboard)

De desktop-app is Electron + SQLite (Prisma). De **zelfde codebase** draait op macOS; alleen het **packagen** gebeurt op Apple-hardware (lokaal of CI).

## Vereisten

- macOS 12+ (Monterey of nieuwer aanbevolen)
- Node.js 22 LTS
- Xcode Command Line Tools: `xcode-select --install`

## Lokaal bouwen

```bash
npm install --legacy-peer-deps
npm run electron:build:mac
```

Output in `dist/`:

| Bestand | Doel |
|--------|------|
| `Stadium-Scoreboard-<versie>-arm64.dmg` | Apple Silicon (M1/M2/M3/…) |
| `Stadium-Scoreboard-<versie>-x64.dmg` | Intel Mac |
| `…-arm64.zip` / `…-x64.zip` | Zelfde builds als ZIP |

Installeer via DMG: sleep **Stadium Scoreboard** naar **Applications**. Bij eerste start kan macOS waarschuwen dat de app “van een niet-geïdentificeerde ontwikkelaar” komt — normaal voor **niet-gesigneerde** builds (zie hieronder).

## GitHub Actions

Workflow **Build macOS** (`.github/workflows/build-mac.yml`):

- Handmatig: **Actions → Build macOS → Run workflow**
- Of push een tag `v*` (bv. `v0.1.5`)

Artifacts: DMG/ZIP + `SHA256SUMS.txt`.

## Code signing & notarisatie (optioneel)

Standaard staat `identity: null` en `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI — **geen** Apple Developer-signing. Voor club-distributie zonder Gatekeeper-waarschuwing:

1. Apple Developer-account + **Developer ID Application**-certificaat in Keychain
2. Zet in CI secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, en voor notarisatie `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
3. Verwijder `"identity": null` uit `package.json` → `build.mac` en zet `CSC_IDENTITY_AUTO_DISCOVERY=true`

Zonder signing: gebruikers kunnen openen via **Rechtsklik → Openen** of **Systeeminstellingen → Privacy en beveiliging → Toch openen**.

## Mac-specifiek gedrag

- **Schermopname / camera**: macOS vraagt aparte toestemming voor display-capture en camera (Systeeminstellingen).
- **Back-ups**: ZIP-back-up gebruikt het systeemcommando `zip` (niet 7-Zip).
- **Licentie-apparaatlabel**: standaard hostnaam van de Mac.

## Release naar klanten

1. Verhoog `version` in `package.json`.
2. Bouw Windows (`.exe`) en macOS (DMG/ZIP) artifacts.
3. Upload naar Supabase Storage / CDN.
4. Op Vercel (Arenacue): `APP_RELEASE_VERSION` en download-URL(s). De desktop-update-API wijst nu vooral naar de Windows `.exe`; macOS-download kan via het klantportaal of een aparte URL (bijv. `/downloads/Stadium-Scoreboard-0.1.5-arm64.dmg`).
