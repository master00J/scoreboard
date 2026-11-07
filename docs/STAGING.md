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

## Een staging-build ophalen en installeren

Vaste link naar de lijst, nieuwste bovenaan — zet die in je favorieten:

**https://github.com/master00J/scoreboard/actions/workflows/preview-win.yml?query=branch%3Astaging+is%3Asuccess**

1. Klik de bovenste run aan
2. Onderaan bij **Artifacts**: `Stadium-Scoreboard-staging-<nummer>` → downloaden
3. Zip uitpakken. Er zitten twee bestanden in:

| Bestand | Wat het doet |
|---|---|
| `Stadium-Scoreboard-Setup-0.1.54-staging.23.exe` | **Installeert** de app: menu-item, snelkoppeling, verwijderen via Windows. Dit is wat je wil om echt te testen. |
| `Stadium-Scoreboard.exe` | Draagbaar: dubbelklikken en het draait, zonder te installeren. Handig om even iets te proberen. |

4. Windows SmartScreen waarschuwt: **Meer informatie** → **Toch uitvoeren**

Die waarschuwing hoort erbij. Een staging-build wordt niet gesigneerd; alleen Release
Windows signeert met het Azure-certificaat. Zie je die waarschuwing níet bij een bestand
dat je van een club krijgt, dan is het een echte release.

Het downloaden vraagt een GitHub-login. Dat is bewust: de repo is publiek, maar
Actions-artefacten zijn dat niet, en een ongesigneerde build met de productnaam hoort niet
vrij rond te zwerven.

Artefacten blijven 7 dagen staan.

### Naast je echte installatie?

Dat kan niet: een staging-build gebruikt dezelfde app-id en dezelfde gegevensmap als de
versie die clubs draaien. Installeer je staging op een pc waar de echte versie op staat,
dan vervangt hij die, en ze delen één database.

Dat is meestal juist wat je wil — testen met echte wedstrijden en indelingen. De app maakt
vóór elke schema-wijziging een kopie van de database (`backupDatabaseBeforeUpgrade`), dus
teruggaan naar de release kan. Wil je zeker spelen, test dan op een aparte pc.

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
