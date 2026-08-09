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

Output in `dist/` (`artifactName`: `Stadium-Scoreboard-${version}-${arch}.${ext}`):

| Bestand | Doel |
|--------|------|
| `Stadium-Scoreboard-<versie>-arm64.dmg` | Apple Silicon (M1/M2/M3/…) — **primair voor MacBooks** |
| `Stadium-Scoreboard-<versie>-x64.dmg` | Intel Mac |
| `…-arm64.zip` / `…-x64.zip` | Zelfde builds als ZIP |
| `SHA256SUMS.txt` | Checksums (`npm run release:checksums`) |

Installeer via DMG: sleep **Stadium Scoreboard** naar **Applications**. Bij eerste start kan macOS waarschuwen dat de app “van een niet-geïdentificeerde ontwikkelaar” komt — normaal voor **niet-gesigneerde** builds (zie hieronder).

## GitHub Actions

Workflow **Build macOS** (`.github/workflows/build-mac.yml`):

- Handmatig: **Actions → Build macOS → Run workflow**
- Of push een tag `v*` (bv. `v0.1.14`) — dan ook een GitHub Release met de artifacts

Artifacts: DMG/ZIP + `SHA256SUMS.txt` (retention 30 dagen). De job faalt als er geen `.dmg` in `dist/` staat.

```bash
# lokaal (met gh auth):
gh workflow run "Build macOS" --repo master00J/scoreboard
```

## Distributie (naast Windows)

Canonieke portal-/site-naam voor Apple Silicon (zonder versie in het pad):

- **Site-pad:** `/downloads/Stadium-Scoreboard-arm64.dmg`
- **Env (Arenacue / Vercel):**
  - `NEXT_PUBLIC_PORTAL_MAC_DOWNLOAD_URL=/downloads/Stadium-Scoreboard-arm64.dmg`
  - `PORTABLE_MAC_DMG_FETCH_URL=<HTTPS naar de DMG>` (prebuild fetch)
  - `DOWNLOAD_STADIUM_MAC_DMG_REDIRECT_URL=<HTTPS>` (runtime 307 als bestand niet in deploy zit)

### Supabase Storage (zelfde bucket-patroon als Windows)

1. Download CI-artifact `Stadium-Scoreboard-0.1.x-arm64.dmg` (en optioneel x64).
2. Upload naar dezelfde public bucket als `Stadium-Scoreboard.exe`, bv.:
   - `releases/Stadium-Scoreboard-arm64.dmg` (canonieke naam voor portal)
   - of versiegebonden: `releases/Stadium-Scoreboard-0.1.13-arm64.dmg`
3. Zet op Vercel de redirect/fetch-URL naar de publieke Supabase-object-URL (zoals `DOWNLOAD_STADIUM_EXE_REDIRECT_URL` voor de `.exe`).
4. Intel-klanten: aparte x64-DMG-URL of ZIP; portal-knop wijst standaard naar **arm64**.

## Code signing & notarisatie (optioneel, later)

Standaard staat `identity: null` en `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI — **geen** Apple Developer-signing. Voor club-distributie zonder Gatekeeper-waarschuwing:

1. Apple Developer-account + **Developer ID Application**-certificaat in Keychain
2. Zet in CI secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, en voor notarisatie `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
3. Verwijder `"identity": null` uit `package.json` → `build.mac` en zet `CSC_IDENTITY_AUTO_DISCOVERY=true`

Zonder signing: gebruikers openen via **Rechtsklik → Openen** of **Systeeminstellingen → Privacy en beveiliging → Toch openen**.

## Smoke-test (eerste MacBook)

1. **Openen:** DMG → Applications; bij Gatekeeper: rechtsklik → Openen (unsigned build).
2. **Vensters:** control + display starten; display naar tweede scherm / fullscreen; bediening blijft op laptop.
3. **Licentie:** activeer met bestaande licentiecode; controleer dat machine-label de Mac-hostnaam toont.
4. **Wedstrijd:** korte timer + sponsorclip; quit-waarschuwing bij afsluiten met lopende wedstrijd.

## Mac-specifiek gedrag

- **Schermopname / camera**: macOS vraagt aparte toestemming voor display-capture en camera (Systeeminstellingen).
- **Back-ups**: ZIP-back-up gebruikt het systeemcommando `zip` (niet 7-Zip).
- **Licentie-apparaatlabel**: standaard hostnaam van de Mac.
- Display-fullscreen/taakbalk-logica is historisch Windows-gericht — na smoke-test eventueel bijstellen.

## Release naar klanten

1. Verhoog `version` in `package.json`.
2. Bouw Windows (`.exe`) en macOS (DMG/ZIP) artifacts (Windows lokaal; Mac via Actions).
3. Upload naar Supabase Storage / CDN (zie hierboven).
4. Op Vercel (Arenacue): `APP_RELEASE_VERSION`, Windows-download-URL(s), en Mac-env (`NEXT_PUBLIC_PORTAL_MAC_DOWNLOAD_URL` e.d.). De in-app updatebanner blijft vooral Windows (`.exe`); Mac-download via het klantportaal.
