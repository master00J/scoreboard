# Officiële klok volgen

ArenaCue kan meelezen met de console van de jurytafel en zijn eigen wedstrijdklok en shotclock daarmee gelijkzetten. De jury bedient de officiële klok zoals altijd; het stadionscherm, de livestream en de mobiele app tonen dezelfde tijd zonder dat iemand in ArenaCue op start of stop drukt.

- Het staat standaard **uit**. Zonder deze functie werkt alles zoals voorheen.
- ArenaCue **leest alleen**. Er gaat nooit iets terug naar de console.
- Valt het signaal weg, dan telt ArenaCue op zijn eigen klok verder en werken alle knoppen zoals altijd. Komt het signaal terug, dan neemt de console het weer over.
- Score, fouten, time-outs en het periodenummer bedien je nog steeds in ArenaCue. Alleen de tijd wordt gevolgd.

## Instellen

**Voorbereiden → Officiële klok volgen**

1. Kies het merk van de console en de verbinding (netwerk of seriële kabel).
2. Vink **Officiële klok volgen** aan en klik **Toepassen**.
3. Kijk in het blok **Signaal**: daar staat wat ArenaCue van de console leest. Laat de klok op de console lopen en vergelijk met het bord.
4. Zet in ArenaCue de wedstrijd klaar met dezelfde periodeduur als op de console.

Onder de klok in het bedieningspaneel staat tijdens de wedstrijd **● Volgt officiële klok**. Staat er *geen signaal* of *niet gevolgd*, dan loopt ArenaCue op zijn eigen klok.

De instellingen horen bij de pc, niet bij de wedstrijd: ze staan in `official-clock.json` in de gebruikersmap van de app en gaan niet mee in de venue-backup.

## Ondersteunde consoles

| Merk | Verbinding (standaard) | Waarop gebouwd |
| --- | --- | --- |
| Bodet Scorepad, ook Mobatime | Netwerk, console belt in op poort 4001; of serieel 9600 | Handleiding van de fabrikant (réf. 608264A), nagekeken met een opname van een echte wedstrijd |
| Stramatel | Serieel 19200 | Opname van een echte wedstrijd; de fabrikant publiceert het formaat niet |
| Swiss Timing | Serieel 9600 | Opname van een echte wedstrijd; de fabrikant publiceert het formaat niet |
| Daktronics All Sport 5000 (RTD-uitgang) | Serieel 19200 | Open broncode van anderen; nog niet nagekeken met een echte console |
| Elk ander merk | Netwerk, UDP poort 4010 | Het open ArenaCue-formaat hieronder |

Geen van deze koppelingen is al in een zaal getest. Probeer ze uit op een training of vóór de wedstrijd, niet voor het eerst tijdens een wedstrijd.

De snelheden voor Stramatel en Swiss Timing zijn een aanname: klopt het signaal niet, probeer dan een andere snelheid in het keuzelijstje. Voor Favero, Nautronic, Mondo en Westerstrand bestaat geen openbaar formaat; gebruik daarvoor het ArenaCue-formaat of stuur een opname in (zie onderaan).

### Verbinding

- **Netwerk: de console belt in op deze pc.** Zet in de console (of in haar netwerkmodule) het IP-adres van de ArenaCue-pc en de poort. Geef de pc een vast IP-adres. Windows vraagt de eerste keer om toegang tot het netwerk: sta dat toe.
- **Netwerk: deze pc belt in op een omvormer.** Voor een serieel-naar-netwerkkastje aan de console. Vul het adres en de poort van het kastje in.
- **Netwerk: UDP.** ArenaCue luistert op de gekozen poort.
- **Seriële kabel (COM-poort).** Een USB-naar-serieel-kabel aan de data-uitgang van de console. Kies de COM-poort; de snelheid volgt het merk tenzij je ze zelf kiest. Welke uitgang en welke kabel je nodig hebt, staat in de handleiding van de console (vaak de uitgang voor tv-graphics of een tweede bord).

Sluit ArenaCue aan op een uitgang die bedoeld is om mee te lezen, nooit tussen de console en het officiële bord.

## Hoe het zich gedraagt

- **Start en stop** volgen de console. Bij een fluitsignaal toont ArenaCue daarna exact de stand van het bord.
- **Laatste minuut:** stuurt de console tienden, dan toont ArenaCue die ook. Stuurt de console maar een paar keer per seconde, dan kan het scherm in de tienden tot ongeveer 0,3 s afwijken terwijl de klok loopt; bij stilstand staat het gelijk.
- **Shotclock:** resets (24/14), stilstand en een leeg shotclockscherm worden gevolgd. Zet je de shotclock in ArenaCue uit, dan blijft ze uit.
- **Einde periode:** op nul sluit ArenaCue de periode af zoals anders. Het periodenummer verzet je zelf; de tijd van de volgende periode volgt de console intussen al.
- **Claxon:** de console heeft een eigen claxon. Die van ArenaCue zwijgt voor klokken die gevolgd worden (uit te zetten in de instellingen).
- **Pauzeklok:** toont de console meer tijd dan een periode in ArenaCue duurt, dan wordt de wedstrijdklok niet gevolgd en zegt het paneel waarom. Een pauzeklok die korter is dan een periode kan wel als kloktijd overgenomen worden; zet het volgen in de rust even uit als dat stoort.
- **Consoles die niet meesturen of de klok loopt** (Swiss Timing en Daktronics voor de shotclock, het ArenaCue-formaat zonder `…Running`): ArenaCue leidt dat af uit het tikken en merkt een stop dan tot ruim een seconde later op.

## Het ArenaCue-formaat (andere merken)

Voor een console zonder eigen koppeling kan een tussenprogramma de stand doorsturen: een script aan de seriële uitgang, een Raspberry Pi, cijferherkenning met een camera. Stuur één JSON-regel per stand, via UDP (één bericht per pakket) of TCP (één bericht per regel), liefst vijf tot tien keer per seconde:

```json
{"clock":"8:31","clockRunning":true,"shot":14,"shotRunning":true}
```

| Veld | Betekenis |
| --- | --- |
| `clock` | Wedstrijdklok: seconden als getal (`511`, `45.3`) of de tekst van het bord (`"8:31"`, `"45.3"`) |
| `clockRunning` | `true` of `false`. Mag ontbreken; ArenaCue leidt het dan af uit het tikken |
| `shot` | Shotclock in seconden, of `null` als het shotclockscherm leeg is |
| `shotRunning` | `true` of `false`. Mag ontbreken |

Elk veld mag ontbreken: een regel met alleen `shot` laat de wedstrijdklok ongemoeid.

## Uitproberen zonder console

`scripts/official-clock-sim.mjs` bootst een jurytafel na en stuurt een lopende klok naar ArenaCue:

```
node scripts/official-clock-sim.mjs                                  Bodet, belt in op 127.0.0.1:4001
node scripts/official-clock-sim.mjs --protocol stramatel
node scripts/official-clock-sim.mjs --protocol arenacue --udp --port 4010
node scripts/official-clock-sim.mjs --host 192.168.1.20 --manual     zelf start/stop geven
```

Kies in ArenaCue hetzelfde merk en *de console belt in op deze pc* (of *UDP* met `--udp`).

## Werkt het niet?

| Wat je ziet | Wat te doen |
| --- | --- |
| *Wacht op de console…* | Er komt niets binnen. Controleer kabel, COM-poort, IP-adres en poort, en de firewall van Windows. |
| *Er komen gegevens binnen, maar ze passen niet bij dit merk* | Verkeerd merk of verkeerde snelheid. Probeer een andere snelheid. |
| *Geen verbinding* | De poort is al in gebruik door een ander programma, of het adres klopt niet. De melding erachter zegt welke fout. |
| Veel afgekeurde berichten | Storing op de kabel of verkeerde snelheid. |
| De klok wordt niet gevolgd | Lees de reden in het paneel: geen actieve wedstrijd, of de console toont meer tijd dan een periode duurt. |

**Datastroom opnemen.** Staat jouw merk er niet bij of klopt de koppeling niet, klik dan **Opname starten** terwijl de klok op de console loopt, laat een minuut lopen (met een start, een stop en een shotclockreset) en stuur het bestand naar ArenaCue. Met zo'n opname kunnen we een merk toevoegen of verbeteren. Een opname stopt vanzelf na 10 minuten.

## Voor ontwikkelaars

- Decoders per merk: `lib/official-clock/protocols/`. Een nieuw merk is één bestand plus een regel in `protocols/index.ts` en de vertaling van de naam.
- `lib/official-clock/tracker.ts` schat wat de console nu toont; `lib/official-clock/sync.ts` beslist wanneer ArenaCue's klok bijgestuurd wordt. Beide zijn zuiver en getest zonder hardware.
- `electron/official-clock.ts` opent de verbinding; `electron/runtime.ts` (`syncOfficialClock`) voert de bijsturing uit via de gewone commandowachtrij, zodat start en stop hetzelfde doen als de knoppen.
- Tests: `lib/official-clock/*.test.ts` en `server/official-clock-follow.test.ts` (hele keten met een nagebootste console over TCP).
