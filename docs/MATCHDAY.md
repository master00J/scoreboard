# Wedstrijddag: backup en herstel

## Backup maken

1. **Desktop-app** — menu **Bestand → Exporteer venue-backup (ZIP)…** of in **Setup** het blok **Venue-backup**.
2. Kies een veilige locatie (USB-stick, netwerkschijf). De ZIP bevat:
   - `stadium-backup/data/stadium.db` — SQLite-database
   - `stadium-backup/uploads/` — mediabestanden die de app zelf beheert
   - `stadium-backup/files/` — media die elders op de pc stond (sponsorvideo's, logo's, foto's)
   - `stadium-backup/config/` — indeling van het Live-tabblad en livestream-instellingen (zonder streamsleutels)
3. Krijg je na het exporteren een lijst met bestanden die niet mee konden (verwijderd of groter dan 2 GB), zet die dan apart op de stick.

## Back-up terugzetten

Niet tijdens een wedstrijd: de app weigert dat zolang er een wedstrijd bezig is.

1. Menu **Bestand → Venue-backup terugzetten (ZIP)…** of in **Setup** de knop **Back-up terugzetten (ZIP)…**.
2. Kies de ZIP. De app pakt hem uit en kijkt hem na (zit er een database in, komt hij niet van een nieuwere versie).
3. Bevestig **Terugzetten en herstarten**. De app herstart en wisselt de gegevens om vóór de database open gaat. Wat er stond, gaat naar `restore-safety/` naast de database (alleen de laatste kopie blijft bewaard).
4. Na de herstart rondt de app het terugzetten af:
   - media uit `files/` die op deze pc niet op de oude plek staat, komt in `uploads/` en de database wijst ernaar;
   - daarna kijkt de app na of elk actief mediabestand, elk teamlogo, elke spelersfoto en -video en de goal-intro echt opent.
5. Alleen als beide lukken, verschijnt **Back-up teruggezet**.
6. Lukt het niet volledig, dan toont de app een venster met wat misliep en de namen van de media die niet opent. Je kiest:
   - **Verdergaan** — de teruggezette back-up blijft; voeg de ontbrekende bestanden opnieuw toe in **Media** vóór de wedstrijd. Konden de verwijzingen niet in de database, dan probeert de app dat bij de volgende start opnieuw en krijg je het venster dan weer.
   - **Terug naar vorige toestand** — de app herstart met de gegevens van vóór het terugzetten (uit `restore-safety/`). Op een pc waar nog niets stond, is er geen vorige toestand en ontbreekt deze knop.
7. Controleer daarna **Setup**, **Media** en een **testwedstrijd** (timer, display).

## Restore-drill (oefenen vóór live)

Oefen het terugzetten op een tweede pc of in een tweede gebruikersmap, niet op de wedstrijd-pc vlak voor een wedstrijd.

1. Maak een back-up op de wedstrijd-pc.
2. Zet hem terug op de reserve-pc via het menu hierboven en wacht op **Back-up teruggezet**.
3. Speel een sponsorclip en een goal-intro af en start een testwedstrijd.
4. Krijg je het venster met ontbrekende media, kopieer die bestanden mee en herhaal de oefening tot de melding **Back-up teruggezet** verschijnt.

> De database draait in WAL-modus met `synchronous=NORMAL`: bij een stroomonderbreking kunnen de laatste seconden aan wijzigingen verloren gaan, de database zelf blijft consistent. De venue-backup doet vooraf een `wal_checkpoint` zodat de kopie compleet is.

## Mobiele app

- Standaard toont het control-panel een **viewer-only** LAN-QR (zonder operator-PIN). Operator-koppelcode en PIN alleen tonen in een **vertrouwde** omgeving (checkbox in de UI).
