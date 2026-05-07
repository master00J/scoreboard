# Soak test (onbemand)

Gebruik dit om zonder handmatige monitoring een lange stabiliteitstest te doen.

## 1) Start desktop met vaste mobile bridge credentials

Op je test-pc:

- Zet environment variabelen:
  - `MOBILE_BRIDGE_PAIRING_CODE`
  - `MOBILE_BRIDGE_OPERATOR_PIN`
  - optioneel `MOBILE_BRIDGE_PORT` (default `17890`)
- Start ArenaCue desktop zoals normaal.

Voorbeeld (PowerShell):

```powershell
$env:MOBILE_BRIDGE_PAIRING_CODE = "123456"
$env:MOBILE_BRIDGE_OPERATOR_PIN = "4321"
$env:MOBILE_BRIDGE_PORT = "17890"
npm run dev
```

## 2) Run soak test script

In een tweede terminal:

```powershell
$env:SOAK_BASE_URL = "http://127.0.0.1:17890"
$env:SOAK_PAIRING_CODE = "123456"
$env:SOAK_OPERATOR_PIN = "4321"
$env:SOAK_DURATION_MIN = "90"
npm run soak:test
```

## 3) Resultaten

Na afloop krijg je bestanden in `soak-results/<run-id>/`:

- `events.jsonl` — ruwe tijdlijn
- `summary.json` — machine-readable pass/fail + metrics
- `report.md` — korte menselijke samenvatting

Het script faalt met exit code `1` als:

- te veel opeenvolgende fouten,
- error rate boven drempel,
- of p95 latency boven drempel.

## 4) Belangrijke env opties

- `SOAK_DURATION_MIN` (default `60`)
- `SOAK_COMMAND_INTERVAL_MS` (default `1500`)
- `SOAK_SNAPSHOT_INTERVAL_MS` (default `5000`)
- `SOAK_MAX_CONSECUTIVE_FAILURES` (default `10`)
- `SOAK_MAX_ERROR_RATE` (default `0.03`)
- `SOAK_MAX_P95_MS` (default `1500`)
- `SOAK_INCLUDE_BLACKOUT` — zet op `1` om in de command-cyclus weer `display:blackout` te sturen (standaard **niet**: blackout maakt het scherm zwart en stoort sponsor-/scoreboard-test).

## Opmerking

Deze soak test valideert end-to-end command/snapshot stabiliteit via de mobile bridge.
Voor diepe GPU/decoder analyse (dropped frames, VRAM leaks) combineer je dit best met OS monitoring op de test-pc.

## Sponsorrotatie (ingestelde tijden vs. werkelijkheid)

Het endpoint `GET /mobile/snapshot` bevat naast display state ook **`sponsorLedger`** (zelfde bron als het control-scherm): welke clip speelt, `expectedPlaySec`, en per sponsor verbruikte seconden na afloop van clips.

Script `npm run soak:sponsor` pollt die snapshot en schrijft per voltooide clip `expectedSec` vs. gemeten duur naar `soak-results/sponsor-<run-id>/`.

Voorwaarden op de test-pc:

- Actieve wedstrijd met status **eerste helft** (of zet `SOAK_SPONSOR_MATCH_ID` naar een bestaande match en laat het script `match:setActive` sturen).
- **Sponsorbudget-rotatie** actief: sponsors met media + budget voor de wedstrijdfase; display in **SPONSOR_ROTATION** (het script probeert `FIRST_HALF` + `SPONSOR_ROTATION` + `timer:start` tenzij `SOAK_SPONSOR_SKIP_SETUP=1`).
- Zelfde bridge-credentials als bij `soak:test`.

Voorbeeld:

```powershell
$env:SOAK_BASE_URL = "http://127.0.0.1:17890"
$env:SOAK_PAIRING_CODE = "123456"
$env:SOAK_OPERATOR_PIN = "4321"
$env:SOAK_SPONSOR_DURATION_MIN = "20"
npm run soak:sponsor
```

Env: `SOAK_SPONSOR_POLL_MS` (default `400`), `SOAK_SPONSOR_LATE_SLACK_SEC` / `SOAK_SPONSOR_EARLY_SLACK_SEC` (tolerantie t.o.v. `expectedPlaySec`), `SOAK_SPONSOR_SKIP_SETUP=1` als je de wedstrijd al handmatig klaarzet, `SOAK_SPONSOR_REQUIRE_CLIP=1` om te **falen** wanneer er geen enkele clip is gemeten (handig in CI).

**Let op:** dit meet **telemetrie-timing** (renderer → desktop), geen pixel-frame-analyse. Voor “vlot op het scherm” blijft visuele controle op het fysieke output of screen recording aanbevolen; dit script vangt vooral te korte/te lange clip-rondes.

