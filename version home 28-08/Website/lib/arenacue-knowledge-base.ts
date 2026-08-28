// Auto-onderhouden kennisbank voor de ArenaCue support-chatbot.
// Deze tekst wordt als system prompt meegestuurd naar Claude (Haiku).
// Houd het feitelijk en compact maar volledig genoeg om operationele
// vragen van klanten correct te beantwoorden.

export const ARENACUE_KNOWLEDGE_BASE = `# ArenaCue – complete kennisbank voor support

ArenaCue bestaat uit drie delen die samenwerken:
1. **ArenaCue Scoreboard** – Windows desktop-app voor live wedstrijdregie en het hoofdstadionscherm.
2. **ArenaCue LED boarding** – Windows desktop-app voor perimeter-/lint-/tribunescherm met meerdere outputs en zones.
3. **ArenaCue Mobile** – Android-app om vanaf de telefoon de desktop te bedienen via LAN of cloud.
4. De **website arenacue.be** met klantportaal, demo-aanvragen, licentie-API en changelog.

De Electron-build heet intern soms nog "Stadium Scoreboard" (oude productnaam in package.json/installer); commercieel heet alles ArenaCue.

---

## ArenaCue Scoreboard (desktop)

### Wat doet het?
Twee vensters: een **Control Panel** voor de operator en een **Display** dat fullscreen op het stadionscherm draait. De logica draait lokaal: SQLite-database via Prisma, een ingebedde HTTP-server, en synchronisatie tussen vensters via Electron IPC. Alles werkt zonder internet – behalve de eerste licentie-activatie, periodieke licentie-check, en de optionele cloud-bediening voor de mobiele app op afstand.

### Installatie
- Vereist Windows 10/11.
- Download de installer of portable .exe via het klantportaal (na licentie-activatie). Bij de eerste start vraagt de app je licentiesleutel; daarna registreert hij zich aan een machine-id en werkt hij offline tot 7 dagen tussen online verifications (grace period).
- Na installatie zie je twee vensters: links/control panel, rechts/display. Sleep het display naar je tweede monitor (stadionscherm) en zet hem fullscreen.

### Control panel – tabs
Het control panel heeft drie hoofdtabs.

**1. Match-tab (live wedstrijdregie)**
Een aanpasbare grid van panelen die je zelf kunt herschikken (drag-and-drop, opslaan in localStorage):
- **Timer** – start/pauze, tijd corrigeren, kickoff zetten.
- **Display & modus** – kies handmatig de display-modus, blackout aan/uit, externe capture-bron.
- **Sponsor HUD** – compacte status: welke sponsor zou nu in beeld moeten zijn, hoeveel tijd heeft de huidige clip nog, wanneer komt de volgende sponsor.
- **Sponsors live** – overzicht: hoeveel seconden van het budget van elke sponsor is werkelijk getoond per fase.
- **Speler-intro** – knop "Start RAFC", lijst met spelers in volgorde (drag-and-drop herschikken). "Auto" loopt de hele rij door en gaat daarna terug naar match.
- **Externe capture** – kies een bron (camera, scherm, venster) en duw die door naar het stadionscherm.
- **Live preview** – exact hetzelfde als wat op het stadionscherm te zien is, dezelfde sponsorvideo gesynchroniseerd via "follow mode".
- **Wedstrijd live** – score-knoppen +1 per ploeg, doelpuntenflow, kaarten, wissels.
- **Logboek** – alle gebeurtenissen.
- **Matchstatus** – zet handmatig de fase: Voor wedstrijd / Eerste helft / Rust / Tweede helft / Verlenging / Na wedstrijd.

**2. Setup-tab**
Wedstrijden, teams en spelers aanmaken; logo's en kleuren; thuisploeg kiezen; algemene GOAL-intro video; bulk-import van speler-visuals; **GOAL +1 gedrag per ploeg** (voor thuis en uit afzonderlijk: visual tonen of alleen score), scorebord-thema (kleuren, layout); kickoff-tijd en match-sponsor (deze laatste verschijnt automatisch fullscreen vanaf 5 minuten voor kickoff in Setup/Voor wedstrijd).

**3. Media-tab**
Onderverdeeld in vier sub-tabs:
- **Sponsors** – per sponsor: actief/inactief; budget in seconden voor *Voor wedstrijd*, *Rust*, *Eerste helft*, *Tweede helft*; gekoppelde mediabestanden; per medium optionele fase-tags (alleen tonen tijdens specifieke fasen).
- **Bibliotheek** – upload/import van foto's en video's, met automatische duurdetectie en zoekveld.
- **Playlists** – slots IDLE, PREMATCH (Voor wedstrijd), HALFTIME (Rust), POSTMATCH (Na wedstrijd) en GOAL.
- **Scheduled** (geplande cues) – tijdgebonden media-overlays op een exact wedstrijdtijdstip.

### Display-modi
Het display kent o.a. deze modi: IDLE, TEAM_INTRO, PLAYER_INTRO, MATCH, SPONSOR_ROTATION, GOAL, GOAL_INTRO_VIDEO, GOAL_PLAYER_VIDEO, SUBSTITUTION, CARD, HALFTIME, FULLTIME, BLACKOUT, CUSTOM. Tijdens speelhelften kan de layout met een **scorebord-strip links** en sponsor/overlay rechts staan; in andere fasen vaker fullscreen.

### Sponsoring – hoe werkt het exact?
Het belangrijkste concept van ArenaCue. Sponsors krijgen een budget per fase (in seconden). Het systeem rekent dat om naar **vertoningen** (geen losse seconden):
- Een sponsor met 60s budget en clipduur 30s krijgt 2 vertoningen, geen 60 losse flashes.
- Vertoningen worden verdeeld in **rondes (blokken)** over de hele fase: meerdere clips opeenvolgend in een blok, dan een **scorebord-pauze**, dan een volgend blok. Dit geeft "even distribution" — niet alles aan het begin, ook niet aan het eind.
- Een sponsor met meer budget komt in meer rondes terug.
- Binnen een blok mogen verschillende sponsors elkaar **direct** opvolgen (geen kunstmatige pauze van 1 seconde).
- De clip speelt altijd **volledig** uit voordat de volgende start.

**Onderbreking en hervatting (interrupt resume)**
Wanneer er een goal-animatie, speler-video, kaart, wissel, halftime/fulltime-graphic of geplande media-cue komt, gebeurt er twee dingen:
1. De **slotmap-klok** (welke sponsor mag nu starten) wordt bevroren.
2. De **hang-klok** (resterende clipduur van de sponsor die net liep) wordt bevroren.
Na de overlay gaat de sponsor verder waar hij gebleven is – ook midden in zijn video. De HUD toont deze paused-state correct: progressbalk staat stil, "nog X seconden" telt niet af.

**Telemetry vs roster**
- **Telemetry** = wat werkelijk te zien was op het scherm (clip start/end events vanuit het display).
- **Roster** in de Media-tab = verwacht verbruik volgens de slotmap.
- "Sponsors live" toont per sponsor het werkelijk verbruikte aantal seconden, met een carry-floor zodat de UI niet terug springt bij budgetwijzigingen.

**Beside scoreboard vs fullscreen**
- Tijdens **Eerste/Tweede helft/Verlenging** met sponsorbudget: sponsorrotatie verschijnt **naast het scorebord** in de rechter helft.
- Tijdens **Voor wedstrijd / Rust / Na wedstrijd**: meestal fullscreen, met playlist-fallback als er geen budget is.

### GOAL +1 – met of zonder visual
In Setup zit per ploeg een toggle:
- **Visuals AAN voor die ploeg**: knop "GOAL +1" op control panel of mobiel triggert eerst een prepare (kies scorer/assist), dan toont het scherm de algemene goal-intro video, gevolgd door een persoonlijke speler-video als die bestaat, of een tekstoverlay met scorer-naam. Score gaat +1.
- **Visuals UIT voor die ploeg**: knop verandert in "(alleen score)". Score gaat +1, maar het display blijft in zijn huidige modus (vaak SPONSOR_ROTATION). Geen video, geen overlay.
Deze instelling werkt server-side; ook de mobiele app respecteert hem automatisch zonder extra knoppen.

### Geplande media-cues (Scheduled)
Voor exact getimede momenten zoals "speel deze film op 25:00 in de eerste helft" of "blok-reclame op exact 10 minuten in de tweede helft":
- Maak een cue aan in Media → Scheduled met: medium, fase (Eerste helft / Tweede helft / Verlenging) en triggerseconde.
- Tijdens de wedstrijd wordt de cue **één keer** afgespeeld als de timer loopt en de wedstrijdfase klopt. Het venster is ±2s om dubbelvuren te vermijden.
- Tijdens een speelhelft toont de cue als overlay **bovenop** het rechter sponsorpaneel; het scorebord blijft links zichtbaar.
- Buiten een speelhelft: fullscreen.
- Tijdens een actieve cue pauzeert sponsoring (interrupt resume).

### Speler-intro (Start RAFC)
- Klik "Start RAFC" → het display schakelt naar speler-intro modus, **maar toont nog niemand**.
- Compacte lijst met de aanwezige spelers; herschik via drag-and-drop.
- Klik per speler om hem te tonen, of klik **Auto** voor lineair afspelen (één keer per speler, daarna terug naar MATCH).

### Wissels
"Wissel toevoegen" zet een wisselrij klaar (in/uit). Bij triggeren toont het display ongeveer 6 seconden de twee spelers; daarna automatisch naar SPONSOR_ROTATION en wordt de volgende uit de queue afgewerkt.

### Kaarten
"Geel/Rood" met spelerkeuze. Tijdens een speelhelft is de overlay een paneel naast de score (~5 seconden); buiten een speelhelft fullscreen.

### Halftime / Fulltime
- **Rust**: het display wisselt automatisch tussen een halftime-graphic en sponsor-/playlist-content op basis van het halftime-budget en de pauzeduur.
- **Einde wedstrijd**: postmatch playlist en/of FULLTIME-graphic.

### Externe capture
Onder "Externe capture" kies je een camerabron of een scherm/venster (bijv. een replay-PC). Door te schakelen verschijnt die feed fullscreen op het stadionscherm.

### Mobiele bridge – LAN
- De desktop start een lokale server (poort 17890 standaard) met **pairing code** (6 cijfers) en **operator-PIN** (4 cijfers), beide automatisch gegenereerd of via env vastgezet.
- In het control panel zie je een QR-code in formaat \`ACPAIR:local|<bridge-url>|<pairing-code>|<operator-pin>\`.
- Mobiel scant en kan dan score, timer, status, kaarten, wissels, doelpunten en speler-intro bedienen.

### Mobiele bridge – Cloud (buiten LAN)
- Vereist een geldige licentie met cloud-control bundel.
- De desktop pollt en pusht state naar arenacue.be (\`/api/control/desktop/state\` en commands queue).
- QR-code formaat: \`ACPAIR:cloud|<base-url>|<venueId>|<pairToken>\`. Operator-toegang gaat via een venue-specifiek pair-token (geen losse PIN nodig).
- Werkt zo'n beetje overal met internet, ook 4G/5G van de telefoon.

### Live timer in mobiel
De desktop stuurt mee: timer-elapsed-seconden + tijdstempel. De telefoon klokt lokaal mee tussen polls (elke 500ms zelfstandig optellen, elke 2.5s synchroniseren). Geen drift.

### Update-notificatie
Het control panel checkt elke 6 uur arenacue.be/api/app/release. Als er een nieuwere versie is, verschijnt een banner met downloadlink. Per versie kun je de melding sluiten.

### Database & licentie
- Lokale SQLite via Prisma; wedstrijden en media zijn **lokaal** opgeslagen (niet in de cloud).
- Licentie-API: arenacue.be. Offline grace 7 dagen.
- Crash-recovery banner als er een wedstrijd halverwege werd onderbroken.

---

## ArenaCue LED boarding

### Wat doet het?
Een aparte Electron-app voor perimeter-LED, lint-LED en tribunescherm met **meerdere outputs** tegelijk. Elke output is een venster dat je naar een aparte monitor (LED-controller) sleept.

### Belangrijkste begrippen
- **Output / scherm** – één fysiek LED-paneel of een groep panelen die samen één video-signaal krijgen.
- **Zone / region** – een rechthoekig deelvlak binnen een output. Een breed perimeterscherm kan opgesplitst worden in bv. drie zones (links, midden, rechts), elk met eigen content.
- Per zone kies je: foto of video, **fit-modus** (cover, contain, stretch), eigen playlist en eigen rotatie-tempo.

### Installatie
Aparte installer (download via klantportaal of meegeleverd door ArenaCue). De app is bedoeld om naast Scoreboard te draaien op dezelfde of een aparte computer.

### Setup-panel
Tabbed interface om outputs te configureren:
- Outputs definiëren (positie, grootte, doel-monitor).
- Per output zones tekenen.
- Per zone media en playlist koppelen.

### Stadionopstelling en playout
- **Perimeter playlist** is meestal het lange veldbord rond het terrein. Gebruik hiervoor een eigen zone/output met een vaste playlist en korte sponsorblokken van vaak 10-15 seconden.
- **Mid-tier / luifel playlist** is een tweede LED-laag of tribunescherm. Die kan synchroon dezelfde index volgen, maar met een andere sponsorlijst of andere media.
- In de **Playout Console** ziet de operator bij voorkeur perimeter en mid-tier naast elkaar, met centrale Play/Pause/Next-bediening, timer, brightness en blackout/testbeeld.
- Zones kunnen een vast segment krijgen (bijvoorbeeld perimeter volgt "Volledige wedstrijd", mid-tier volgt "Rust / pauze") of het globale actieve segment volgen.
- Voor live stadiongebruik: test eerst elk outputvenster met testbeeld, controleer resolutie/processorlabel, zet brightness voorzichtig, open daarna pas fullscreen op de juiste LED-controller.
- Gebruik **Blackout** alleen bewust: dit stuurt zwart beeld naar de output. Testbeeld is veiliger voor het afregelen van processors.

### Media en playlists snel opbouwen
- Importeer sponsorbeelden en video's via de app zodat bestanden naar de lokale app-bibliotheek worden gekopieerd. Vermijd losse verwijzingen naar USB-sticks of tijdelijke downloadmappen.
- Maak sponsoritems eerst met herkenbare namen, daarna sleep je de playlistvolgorde goed.
- Gebruik vaste duur per item (bijvoorbeeld 15 seconden) als operators een voorspelbare playout nodig hebben.
- Voor budgettracking: zet doelminuten per sponsor alleen waar een sponsorcontract dat vraagt; anders laat je dit op 0.
- Voor video op LED boarding: test H.264/MP4 vooraf op de stadion-PC en vermijd extreem zware codecs tijdens wedstrijddagen.

### AI setupassistent
- De AI setupassistent mag operators helpen met zones, perimeter/mid-tier playlists, segmenten, sponsoritems, timing, brightness en outputchecks.
- De AI mag alleen gecontroleerde voorstellen doen die de operator bevestigt. Destructieve acties zoals alles wissen of resetten horen niet in de eerste versie.
- Als een operator vraagt om "maak een basisopstelling", is een veilige default: twee zones (Perimeter en Mid-tier), beide 1920x256 of de opgegeven processorresolutie, scroll/hold afhankelijk van het gebruik, 10-15 seconden per sponsoritem en brightness 100% voor test.

### Synchronisatie met Scoreboard
Optioneel kun je sponsorrotatie laten meelopen met de Scoreboard-app zodat de hoofd- en perimeterschermen niet dezelfde sponsor tegelijk tonen.

---

## ArenaCue Mobile (Android)

### Wat doet het?
Externe controller op je telefoon. Pairing via QR (LAN of Cloud). Twee tabs:
- **Operator**: score, timer (start/pauze), wedstrijdstatus, doelpunt voorbereiden + bevestigen, kaarten, wissels.
- **Instellingen**: QR-scanner, modus LAN/Cloud, pairing code/PIN, debug snapshot.

### Pairing-formaten
- LAN: \`ACPAIR:local|<url>|<pairingCode>|<operatorPin>\` – PIN bepaalt operator vs viewer.
- Cloud: \`ACPAIR:cloud|<baseUrl>|<venueId>|<pairToken>\` – token bepaalt rol.
- Legacy: \`ACPAIR:<baseUrl>|<venueId>\` (alleen viewer).
\`arenacue.com\` wordt automatisch genormaliseerd naar \`arenacue.be\`.

### Installatie van de APK
Download de Android APK via de licentie/portaal. Toestaan dat onbekende bronnen installeren (Android beveiliging). Open de app, scan QR vanuit het control panel.

---

## Website arenacue.be

### Pagina's
- **/** – landingspagina met productoverzicht en demo-formulier.
- **/functies** – diepe feature-uitleg per product.
- **/licentie** – licentiemodellen en koop-uitleg.
- **/portal** – klantportaal: log in met je licentie-e-mail, ontvang een **magic link** (15 minuten geldig), download installer/APK, beheer cloud-bediening.
- **/changelog** – release notes.
- **/privacy**, **/licenties** (zelfde inhoud als het pad /licenses) en **/terms** – juridisch (incl. cookie-, licentie- en gegevensverwerking).
- **/vereisten** – minimale en aanbevolen Windows-hardware voor wedstrijddagen (lange sessies, video).
- **/admin** – intern beheer (afgeschermd).

### Demo aanvragen
Op de homepagina invullen → e-mail wordt via Resend bezorgd, aanvraag opgeslagen in Supabase. Eén demo per e-mailadres en per device.

### Cookies
Cookie-banner met categorieën: noodzakelijk (altijd), voorkeur (\`localStorage\` sleutel \`arenacue_cookie_consent_v1\`), statistiek en marketing (alleen na expliciete toestemming – momenteel laden we geen analytics-scripts standaard).

---

## Veel gestelde vragen / how-to

**Welke hardware raden jullie aan voor 4–6 uur matchday met video?**
- **Minimum (kleinere clubs):** i5 10e gen of Ryzen 5 3600+, liefst 6c/12t; **16 GB RAM**; SSD (min. 256 GB, liefst NVMe); recente iGPU kan, maar dedicated GPU (bv. GTX 1650-klasse) is robuuster; 2 video-uitgangen.
- **Aanbevolen (prof / zware video):** i7 12e gen+ of Ryzen 7 5700X/7700X+; **32 GB RAM**; RTX 3060/4060-klasse of gelijkwaardig; 1 TB NVMe (eventueel tweede SSD voor media); 3+ video-uitgangen waar nodig.
- **OS:** Windows 10/11 64-bit, met **Windows 11 Pro** als standaard voor nieuwe B2B-installaties.
- **Matchday hardening:** UPS/noodstroom sterk aanbevolen, Ethernet voor de wedstrijd-PC, GPU-drivers vooraf testen en updates buiten wedstrijdvensters plannen.

**Hoe start ik een wedstrijd?**
Setup-tab → maak/activeer match → Match-tab → zet status op Voor wedstrijd → start timer wanneer je wil. Schakel daarna naar Eerste helft.

**Een sponsor verschijnt niet op het scherm**
Check in deze volgorde: 1) sponsor staat op "actief"; 2) er is budget voor de huidige fase (>0); 3) gekoppelde media zijn actief en niet beperkt door fase-tags die de huidige fase uitsluiten; 4) display staat op SPONSOR_ROTATION (tijdens helft is dat de "naast scorebord" modus).

**Doelpunt zonder animatie voor één ploeg**
Setup → "GOAL +1 gedrag" → vink visual uit voor die ploeg. Bevestigen. Vanaf dan voegt "GOAL +1" alleen score toe en blijft het scherm in sponsorrotatie.

**Sponsorvideo blijft hangen / hapert aan het einde**
Sinds de laatste update wordt de clip 200ms voor het einde als afgelopen gemeld om compositor-hapering te voorkomen. Update naar de nieuwste versie (banner verschijnt automatisch).

**Mobiele app vindt de desktop niet (LAN)**
- Telefoon en computer op hetzelfde Wi-Fi-netwerk?
- Firewall blokkeert poort 17890? Toestaan voor private netwerk.
- Pairing-code en operator-PIN exact zoals weergegeven op de desktop QR.

**Mobiele app op 4G/5G verbinden**
Gebruik de **Cloud** QR (niet de Local). Vereist een licentie met cloud-control. Werkt overal met internet.

**Geplande cue verschijnt niet**
- Timer **moet** lopen.
- Wedstrijdstatus moet exact overeenkomen (Eerste helft / Tweede helft / Verlenging).
- Triggerseconde moet binnen ±2 seconden van de huidige tijd vallen wanneer hij voor het eerst voorbij komt; cues worden niet retroactief getriggerd als je later opstart.
- Cue moet enabled zijn en het medium ook actief.

**Licentie zegt offline / vervallen**
De app heeft een online check nodig om de 7 dagen. Verbind de PC even met internet en herstart het control panel.

**Externe replay-feed op het scherm**
Match-tab → Externe capture → kies bron → "Toon op display". Schakel uit met dezelfde knop.

**Speler-intro stopt niet automatisch**
Bij Auto-modus eindigt de rij vanzelf na de laatste speler en gaat het display terug naar MATCH. Klik anders op "Stop intro" of switch handmatig naar SPONSOR_ROTATION.

**Sponsor pauzeert niet bij overlays**
Overlays (goal, kaart, wissel, halftime/fulltime, geplande cue) bevriezen automatisch zowel de slotmap als de hang. Als dit niet zo lijkt, controleer of je de nieuwste versie hebt; in oudere builds was dit een bug.

**Welke versie heb ik?**
Onderaan het control panel staat de huidige versie. De update-banner toont de nieuwste beschikbare versie naast de huidige.

---

## Begrippen-glossary
- **Sponsorblok / ronde**: cluster van clips die elkaar opvolgen, gevolgd door een scorebord-pauze.
- **Slotmap**: tijdlijn die per seconde aanduidt of er sponsoring of scorebord moet staan.
- **Hang / hold**: de resterende afspeelduur van een lopende sponsorclip.
- **Interrupt resume**: bevriezen van slotmap én hang tijdens overlays, daarna verder gaan.
- **Follow mode (preview)**: control-preview dat de exacte clipsynchronisatie van het echte scherm overneemt.
- **Beside scoreboard**: layout met scorebord-strip links en sponsor/cue rechts tijdens speelhelft.
- **Match sponsor venster**: 5 minuten voor kickoff toont automatisch een fullscreen reclame van de match-sponsor.
- **Fase-tag op media**: beperking dat een mediabestand alleen in bepaalde fasen telt (bv. alleen Voor wedstrijd).

---

## Belangrijk voor support
- Voor LED-boarding-vragen specifiek: dit is een aparte applicatie, **niet** ingebouwd in Scoreboard.
- Voor cloud-bediening op afstand: vereist licentie met cloud-control en een desktop die bereikbaar is voor de relay (gewone internetverbinding volstaat).
- Logbestanden: in %APPDATA%/ArenaCue (Windows) staan logs en de SQLite-database.
- Demo-aanvragen, prijzen, betaling, juridische vragen: door naar info@arenacue.be — die mag je in een antwoord vermelden als de vraag commercieel of juridisch is.
`;
