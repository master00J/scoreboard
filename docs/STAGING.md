# Staging

Een plek om een wijziging op een echte machine te proberen voordat clubs hem krijgen.

## De weg van een wijziging

```
feature-branch  ──PR──▶  staging  ──PR──▶  master  ──Release Windows──▶  clubs
                   │        │                 │
                   │        │                 └─ gesigneerde .exe, versie omhoog,
                   │        │                    aangekondigd op arenacue.be
                   │        └─ ongesigneerde test-.exe bij elke push
                   └─ typecheck + tests
```

Niets bereikt een club vanuit staging. Alleen **Release Windows** publiceert, en die
draait alleen op `master` (`if: github.ref == 'refs/heads/master'`).

## Een staging-build ophalen

Elke push naar `staging` start **Preview Windows**. Als die klaar is:

1. GitHub → Actions → Preview Windows → de laatste run
2. Onderaan bij **Artifacts**: `Stadium-Scoreboard-staging-<nummer>`
3. Uitpakken en `Stadium-Scoreboard.exe` draaien

De build is **niet gesigneerd**, dus Windows SmartScreen waarschuwt: "Meer informatie" →
"Toch uitvoeren". Dat hoort zo; alleen de release-build wordt gesigneerd.

Artefacten blijven 7 dagen staan.

## Welke versie draai ik?

Een staging-build krijgt een eigen nummer: `0.1.54-staging.37`, waarbij het laatste deel
het runnummer van de workflow is. Zo kun je een testbuild nooit verwarren met de versie
die klanten draaien, en kan een tester precies zeggen wat hij draaide.

Het echte versienummer wordt pas bepaald door Release Windows, op master.

## Naar master

Als staging goed is: PR van `staging` naar `master`. Die PR draait CI én bouwt nog een
test-.exe. Na de merge start je de echte release vanuit arenacue.be/admin
(Features → Release-build) of via Actions → Release Windows → Run workflow.

Zie `docs/RELEASE_SIGNING.md` voor de signering.

## Staging weer gelijk zetten

Loopt staging achter op master (bijvoorbeeld na een hotfix die rechtstreeks op master
ging), haal master er dan in:

```bash
git checkout staging
git merge origin/master
git push origin staging
```
