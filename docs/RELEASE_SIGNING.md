# Windows-code signing & release-integriteit

## Code signing (EV)

- Voor **Windows SmartScreen-vertrouwen** en professionele uitrol heb je een **EV Code Signing Certificate** (vaak via een hardware token) nodig.
- **electron-builder** ondersteunt signing via omgevingsvariabelen (o.a. `CSC_LINK`, `CSC_KEY_PASSWORD`) of een `win.certificateFile` in `package.json` — exacte invulling hangt af van je certificaatleverancier.
- In deze repo staat `forceCodeSigning: false` en `sign: null` zodat **lokale builds** zonder certificaat blijven werken. Zet signing aan wanneer jullie een certificaat en CI-secrets hebben.

## Checksums

- Na een build: `npm run release:checksums` — schrijft `dist/SHA256SUMS.txt` met SHA-256 over `.exe` / `.zip` / `.blockmap` in `dist/`.
- Publiceer die checksums **naast** de download (website, release notes) zodat clubs integriteit kunnen verifiëren.

## ASAR

- `package.json` → `build.asar: true` met `asarUnpack` voor **`node_modules/.prisma/**`** zodat de Prisma query engine buiten de asar blijft (vereist op Windows).

## Supply chain

- Houd **npm audit** en dependency-updates in de releasecyclus; de GitHub Actions-workflow draait `npm test`, renderer-build en Electron-`tsc` bij elke push/PR.
