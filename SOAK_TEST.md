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

## Opmerking

Deze soak test valideert end-to-end command/snapshot stabiliteit via de mobile bridge.
Voor diepe GPU/decoder analyse (dropped frames, VRAM leaks) combineer je dit best met OS monitoring op de test-pc.

