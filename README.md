# Matlager

Matlager er en enkel nettapp som holder oversikt over maten i **fryseren**, **kjøleskapet** og **tørrvarene**. Du ser hva du har og hva som snart går ut på dato. Du kan også få forslag til hva du kan lage av det du har.

Den publiserte appen ligger her: **https://arveadnanes.github.io/matlager/**

Appen virker på mobil og PC, og kan installeres på hjemskjermen som en vanlig app (PWA).

## Prøv appen

Logg inn med demobrukeren for å se hvordan appen ser ut når den er i bruk:

| Brukernavn | Passord |
| --- | --- |
| `demo` | `matlager` |

Demobrukeren har kategorier og varer i alle tre stedene, noen varer som går ut snart, og tre favorittoppskrifter. Du kan se deg rundt og prøve «Hva kan jeg lage?», men **endringer lagres ikke**. Vil du bruke appen selv, lager du din egen bruker på innloggingssiden.

## Hva appen gjør

- **Oversikt per sted:** Varene ligger i Fryser, Kjøleskap eller Tørrvarer. Hver vare har antall, enhet, utløpsdato, notat og kategori. Med + og − justerer du antallet.
- **Kategorier:** Du lager egne kategorier per sted, f.eks. «Fisk» eller «Hermetikk». Varer kan dras mellom kategorier, og kategoriene kan sorteres og foldes sammen.
- **Bruk snart:** Kort øverst viser varer som har gått ut, eller som går ut innen tre dager, fra alle steder.
- **Søk** i alle varer på tvers av steder.
- **Legg til fra bilde (AI):** Ta bilde av varer eller en kvittering, eller velg en PDF. AI-en finner varene og foreslår antall, sted, kategori og utløpsdato. Du går gjennom én og én vare før den legges inn.
- **Hva kan jeg lage? (AI):** Du får forslag til middag, lunsj, frokost eller dessert ut fra det du har. Valgene i appen:
  - Ønsker som «Rask», «Vegetar», «Bare det jeg har» og «Bruk det som snart går ut»
  - Antall porsjoner
  - Varer du alltid har hjemme
  - Et eget ønske i fritekst

  Hvert forslag viser hva du mangler. Du kan lagre retter som favoritter. «Jeg lagde denne» trekker ingrediensene fra lageret.
- **Innlogging** med brukernavn og passord. Hver bruker ser bare sine egne varer, og dataene synkes mellom enheter.
- **Virker uten nett:** Endringer lagres lokalt og sendes når nettet er tilbake. AI-funksjonene krever nett.
- **Lyst og mørkt tema.**

## Hvordan den er bygget

Appen er ren HTML, CSS og JavaScript. Den har ingen byggesteg, npm eller rammeverk.

| Fil | Innhold |
| --- | --- |
| `index.html` | All HTML: innlogging, listen, dialoger og oppskriftsiden |
| `style.css` | Alt utseende. Mobil først, to kolonner på PC (fra 900 px) |
| `app.js` | Hovedlogikken: listen, legg til og endre, kategorier, søk og tema |
| `recipes.js` | «Hva kan jeg lage?» – AI-forslag, favoritter og «Jeg lagde denne» |
| `scan.js` | «Fra bilde» – bilde eller kvittering til varer med AI |
| `firebase.js` | All kontakt med Firebase: innlogging, database, AI og App Check |
| `sw.js` | Service worker som lagrer appfilene, så appen åpner uten nett |
| `manifest.json`, `icons/` | App-ikon og oppsett for å installere på hjemskjermen |

Tjenester appen bruker (Firebase JS SDK lastes fra Googles CDN):

- **Firebase Authentication:** Brukernavnet gjøres om til en falsk e-postadresse bak kulissene (`navn@matlager.example.com`). Det sendes aldri e-post.
- **Cloud Firestore** lagrer dataene under `users/{uid}/…`:
  - `items` – varene
  - `categories` – kategoriene
  - `history` – varenavn du har brukt før
  - `favorites` – lagrede retter
  - `settings` – innstillinger
  - `usage` – AI-bruk per dag
- **Firebase AI Logic** med Gemini (`gemini-3.5-flash-lite`) gir oppskriftsforslag og leser bilder.
- **App Check** med reCAPTCHA Enterprise sørger for at bare denne nettsiden kan bruke AI-kvoten.

Hver bruker kan gjøre **15 AI-søk per dag**, og oppskrifter og bilder deler på dem. Grensen settes i `AI_DAILY_LIMIT` i `firebase.js`. Brukere i `AI_UNLIMITED_USERS` har ingen grense.

## Kjøre appen lokalt

Firebase lastes som JavaScript-moduler. De virker **ikke** hvis du dobbeltklikker `index.html` (`file://`). Appen må derfor åpnes via en lokal webserver.

**Med VS Code (enklest):**

1. Installer utvidelsen **Live Server**.
2. Høyreklikk `index.html` og velg **Open with Live Server**.
3. Siden åpnes på `http://127.0.0.1:5500`.

**Uten VS Code:** Start en hvilken som helst enkel webserver i mappen, for eksempel:

```
python -m http.server 8000
```

Åpne deretter `http://localhost:8000`.

**AI lokalt (App Check):** På `localhost` og `127.0.0.1` bruker appen en *debug-token* i stedet for reCAPTCHA.

1. Åpne appen og se i nettleserkonsollen (F12). Der står en debug-token første gang.
2. Legg den inn i Firebase-konsollen: **App Check → Apps → ⋮ → Manage debug tokens**.

Uten debug-token virker alt unntatt AI-funksjonene.

**Etter endringer:** Service workeren kan vise gamle filer. Øk tallet i `CACHE` i `sw.js` (f.eks. `matlager-v11` → `matlager-v12`) når du endrer appfilene, og last siden på nytt med Ctrl+F5.

## Sette opp et eget Firebase-prosjekt

Dette trengs bare hvis du vil kjøre din egen kopi med egen database.

1. Lag et prosjekt i [Firebase-konsollen](https://console.firebase.google.com) og legg til en **web-app**. Lim inn `firebaseConfig` i `firebase.js`.
2. **Authentication:** Slå på **Email/Password**. Under *Settings → Authorized domains* legger du til domenet appen skal ligge på, f.eks. `brukernavn.github.io`.
3. **Firestore Database:** Opprett databasen i en europeisk region og lim inn disse reglene. De gjør dette:
   - Hver bruker kan bare lese og skrive sine egne data.
   - Demobrukeren kan bare lese, bortsett fra AI-telleren, som må kunne oppdateres for at AI-forslag skal virke.

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       function isOwner(userId) {
         return request.auth != null && request.auth.uid == userId;
       }
       function isDemo() {
         return request.auth.token.email == "demo@matlager.example.com";
       }

       match /users/{userId}/{document=**} {
         allow read: if isOwner(userId);
         allow write: if isOwner(userId) && !isDemo();
       }

       // AI-telleren (dagsgrensen) – også for demobrukeren
       match /users/{userId}/usage/{doc} {
         allow write: if isOwner(userId);
       }
     }
   }
   ```

4. **AI Logic:** Slå på *Gemini Developer API*.
5. **App Check:**
   - Lag en reCAPTCHA Enterprise-nøkkel for domenet ditt i Google Cloud.
   - Registrer den under *App Check*.
   - Sett `RECAPTCHA_SITE_KEY` i `firebase.js`.
   - Slå på håndheving for AI Logic.

Verdiene i `firebaseConfig` og reCAPTCHA-nøkkelen er ikke hemmelige. Det er Firestore-reglene og App Check som beskytter dataene og kvoten.

## Publisering

Appen publiseres på **GitHub Pages** med arbeidsflyten i `.github/workflows/static.yml`. Hver push til `main` legger ut den nye versjonen automatisk.

## Kjente begrensninger

- **Glemt passord:** Det finnes ingen tilbakestilling på e-post. Passordet kan endres i appen når du er innlogget, eller brukeren kan slettes i Firebase-konsollen.
- **Brukernavn** kan bare inneholde a–z, 0–9, `.`, `_` og `-`. Bokstavene æ, ø og å går ikke.
- **AI-kvoten** telles i appen. En bruker som går rundt appen og skriver direkte til sin egen database, kan i prinsippet nullstille sin egen teller. Googles daglige grense for prosjektet gjelder uansett.
- **Demobrukeren** er sperret for endringer i databasen, men Firebase kan ikke hindre noen i å bytte passordet til selve kontoen. Slutter `demo` / `matlager` å virke, settes passordet tilbake i Firebase-konsollen under *Authentication → Users*. Demobrukeren deler også én AI-grense på 15 søk per dag med alle som prøver den.
- **Utløpsdatoer fra bilde** er anslag når datoen ikke står på bildet. De er merket «anslått», så sjekk dem.
