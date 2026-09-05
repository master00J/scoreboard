# Windows-code signing (Azure Artifact Signing)

ArenaCue tekent Windows-builds met **Azure Artifact Signing** (voorheen Trusted Signing). Dat is een cloud-certificaat: geen USB-token, geen `.pfx`.

We gebruiken **electron-builder 25**. ChatGPT’s `win.sign: { type: "azure" }` geldt pas vanaf **v27** en werkt hier niet. Signing staat daarom in onze eigen hooks (`afterPack` + `afterAllArtifactBuild`), zodat lokale unsigned builds blijven werken en we de oude `signAndEditExecutable: false`-workaround (symlink-rechten) niet hoeven uit te zetten.

## Eenmalig in Azure

1. Artifact Signing-account + **Public Trust**-certificaatprofiel (identiteit gevalideerd).
2. **App Registration** (service principal) met een client secret.
3. Die app krijgt de rol **Artifact Signing Certificate Profile Signer** op het certificaatprofiel — niet alleen jouw persoonlijke account.
4. Noteer:
   - Tenant ID, Application (client) ID, client secret
   - Endpoint (regio), bv. `https://neu.codesigning.azure.net/`
   - Accountnaam, bv. `arenacue-signing-be`
   - Profielnaam, bv. `ArenaCuePublic`
   - Exacte **Publisher / Subject** van het certificaat (later voor electron-updater)

## Lokaal signen

```bat
copy .env.signing.example .env.signing
```

Vul de drie Azure-secrets en controleer endpoint/account/profiel. Daarna:

```bat
npm run electron:build:win
```

Zonder `.env.signing` of zonder de drie secrets blijft de build **unsigned** (zoals nu).

Na de build, in PowerShell:

```powershell
Get-AuthenticodeSignature "dist\Stadium Scoreboard Setup 0.1.13.exe" | Format-List
Get-AuthenticodeSignature "dist\Stadium-Scoreboard.exe" | Format-List
```

`Status` moet `Valid` zijn. **Publisher** is de organisatie op het certificaat (Sound & Vision), niet de productnaam ArenaCue.

## GitHub Actions

Workflow: `.github/workflows/build-win.yml` (handmatig of bij tag `v*`).

Secrets in de scoreboard-repo:

| Secret | Voorbeeld |
| --- | --- |
| `AZURE_TENANT_ID` | directory-id |
| `AZURE_CLIENT_ID` | app registration id |
| `AZURE_CLIENT_SECRET` | secret value |
| `AZURE_SIGNING_ENDPOINT` | `https://neu.codesigning.azure.net/` |
| `AZURE_SIGNING_ACCOUNT` | `arenacue-signing-be` |
| `AZURE_SIGNING_PROFILE` | `ArenaCuePublic` |

## Wat Windows toont

- Download/installer: uitgever = certificaatsubject.
- SmartScreen kan bij een **nieuw** Public Trust-profiel nog even “onbekende uitgever” tonen tot reputatie opbouwt. Dat is normaal; geen extra EV-USB nodig.

## Checksums

Na een build: `npm run release:checksums` → `dist/SHA256SUMS.txt`.
