# 💣 THE HYPERGUESSER VX PROTOCOL (The Nuclear Option)
**VERSION:** OMEGA-1.0 (GOD MODE)
**AUTHOR:** ANTIGRAVITY (The Shadow CTO)

---

## 📜 PREAMBLE & OBJECTIVE
Il sistema **HyperGuesser VX** è un motore di deduzione autonoma progettato per scovare il sito web ufficiale di un'azienda (PMI, ditte individuali, etc.) **senza l'ausilio di alcun motore di ricerca tradizionale (Google, Bing, DuckDuckGo)**. 

È la contromisura assoluta contro blocchi IP, captchas, proxy banning e manipolazioni SEO. Non cerca: *deduce, spara, verifica e conferma.*

Tutto il processo si svolge localmente in parallelo, massimizzando il ROI (Law 004) azzerando i costi delle API di ricerca (Law 501) ed eliminando l'overhead di RAM e CPU richiesto dall'avvio di browser headless (Law 601). Tempo di esecuzione medio: **~5-7 secondi ad azienda**.

L'architettura si divide in **4 Fasi Operative Brutali** (Generazione, Risoluzione, Estrazione, Triage AI), orchestrate da un file principale.

---

## ⚙️ FASE 1: THE CORE GENERATOR (`generator.ts`)
*Obiettivo: Generare una mole massiccia di possibili domini dal nome di input, sfidando la statistica.*

1. **Sanitizzazione Input (Law 306):** Il nome dell'azienda viene purgato da forme giuridiche (srl, snc, sas, spa) e caratteri speciali (punteggiatura, accenti convertiti). Tutto viene passato in minuscolo.
2. **Estrazione Token:** Il nome pulito viene splittato in blocchi semantici. (Es. "Autofficina Coffani" -> `['autofficina', 'coffani']`).
3. **Matrice di Permutazione:** Vengono applicate 6 strategie aggressive che combinano i token con estensioni TLD comuni (`.it`, `.com`, `.eu`, `.net`):
   - **Direct Join:** Tutti i token uniti (es. `autofficinacoffani.it`).
   - **Spaced/Hyphened:** Join con trattini (es. `autofficina-coffani.it`).
   - **Acronyms:** Solo le iniziali di tutti i token + estensione (es. `ac.it`).
   - **Core Entity Isolation:** Identificazione della parola chiave principale (il cognome o il brand, spesso il token più lungo) e test isolato (es. `coffani.it`).
   - **City Appending:** Nome azienda + Città. Utile per le carrozzerie e gommisti locali (es. `autofficinacoffanibrescia.it`, `coffanibrescia.it`).
   - **Abbreviazioni Radicali:** Se il nome è lungo, generiamo sigle fonetiche (es. Autofficina -> `auto`, `car`, `garage`).
4. **Scarto Duplicati:** Ogni dominio generato viene verificato, deduplicato (utilizzando Set) e limitato a estensioni plausibili. In media, un singolo input genera **tra i 60 e i 150 domini**.

---

## 📡 FASE 2: THE DNS RESOLVER (`resolver.ts`)
*Obiettivo: Scremare i 150 domini generati in meno di 2 secondi, eliminando quelli inesistenti senza avviare costose richieste HTTP.*

1. **Risoluzione Parallela (Node `dns.resolve4`):** Node.js bussa ai server DNS per verificare l'esistenza del Record A (Indirizzo IP) per tutti i 150 domini **in parallelo**.
2. **Gating della Concorrenza:** Per evitare errori `EMFILE` o blocchi del router/sistema operativo locale, il processo è chunkizzato a gruppi definiti (es. 50 domini alla volta). 
3. **Timeout Brutale:** Se un DNS non risponde entro un tempo limite stringente (es. 2 secondi), il dominio viene marchiato come morto (`alive: false`).
4. **Output:** Alla fine di questa fase, 140 domini morti vengono scartati all'istante (costo: 0, ram: 0). Rimangono solo i domini **"Alive"** (es. i 5-10 domini che effettivamente risolvono ad un server online).

---

## 👻 FASE 3: THE GHOST FETCHER (`fetcher.ts`)
*Obiettivo: Scaricare il contenuto testuale della homepage dei domini sopravvissuti, eludendo anti-bot, senza usare Puppeteer (Law 601).*

1. **Stealth HTTP Client (`axios`):** Ogni URL sopravvissuto viene contattato tramite un modulo HTTP leggero, bypassando del tutto l'overhead del browser. Il pacchetto si maschera da un normale utente Chrome tramite injection di intestazioni: `User-Agent`, `Accept-Language`, `sec-ch-ua`.
2. **Bypass Certificati SSL (Law 301):** Molte PMI italiane hanno architetture fatiscenti o certificati scaduti. L'agente disabilita il controllo SSL (`rejectUnauthorized: false`) per entrare comunque e leggere la pagina.
3. **Timeout e Interceptor:** Limite categorico a 5000ms. Se il server non risponde, l'operazione viene abortita. Nessun retry.
4. **Purificazione Semantica (`cheerio`):** Il documento HTML estratto è "inquinato" da codice (Script, CSS, SVG, Immagini, Nav bar, Footer). L'HTML viene "bollito": i tag `<script>`, `<style>`, `<svg>` vengono rimossi brutalmente. L'interno del `<body>` viene convertito in testo puro (`$('body').text()`).
5. **Difesa dai Parked Domains:** Implementato un controllo euristico al layer HTTP per scartare immediatamente siti vetrina (`"This domain is for sale"`, `"Dominio in vendita"`).
6. **Troncamento Token (Law 507):** Preleviamo solo i primi `2500` caratteri. All'AI non serve leggere recensioni a pié di pagina; bastano nome, settore, P.IVA e indirizzo per determinare se è il sito giusto.

---

## 🧠 FASE 4: THE AI TRIAGE VALIDATOR (`validator.ts`)
*Obiettivo: Dare in pasto gli estratti di testo delle 5-6 homepage rimaste al modello AI (DeepSeek / GLM-Flash), ordinandogli di agire da Giudice Esecutore Finale (Law 502, Law 508).*

1. **Costruzione della Lineup:** Il codice prende i testi pre-masticati dal Fetcher e compila un unico enorme "dossier" testuale (la Prompt Array). Ogni sito estratto è etichettato consecutivamente (es. `--- SITO CANDIDATO 1 ---`, `--- SITO CANDIDATO 2 ---`).
2. **Il Comando all'Oracolo:** Viene inviato un Prompt blindato contenente:
   - I dati precisi in nostro possesso (Nome Esatto, P.IVA, Città, Indirizzo).
   - I testi di tutte le homepage catturate.
   - Una direttiva precisa per l'AI: *"Analizza questi frammenti. Trova il sito ufficiale autentico al 100%. Se è un sito di una web agency, un omonimo in altra città o un sito non pertinente, devi rigettarli e restituire NULL. Sii severo."*
3. **Structured Enforced Output (Law 502):** Tramite la funzionalità `json_schema` / `json_object` a basso livello, l'Output dell'AI viene **costretto** matematicamente a restituire un log JSON pre-compilato con 3 field previsti dall'interfaccia:
   - `selected_url`: l'indirizzo vincente (oppure `null`).
   - `confidence`: un float da 0.00 a 1.00 (valutato > 0.90 per l'approvazione).
   - `reason`: un abstract logico stringa del motivo della scelta ("Il sito X riporta esattamente la P.Iva e l'indirizzo a Brescia dell'azienda target" - Law 506).
4. **Ritorno Esito:** Se l'AI conferma con altissima confidenza l'abbinamento (es. 0.95), il sito viene validato, registrato nel pool `DiscoveryResult`, e marchiato col timbro definitivo `HYPERGUESSER_VX_ONLY` .

---

## 🏆 SINTESI DEL PROCESSO
1. L'Azienda è **"Carrozzeria Rossi" (Milano)**.
2. Il **Generator** sputa 100 link: `rossi.it`, `carrozzeriarossimilano.com`, `rossicar.net`, ecc.
3. Il **Resolver** spara i ping DNS in 2 secondi. Purtroppo, `carrozzeriarossimilano.com` e altri 90 sono inesistenti. Rimangono 5 siti "Alive".
4. Il **Fetcher** si collega in stealth mode a questi 5 siti, bypassando Errori SSL. Uno è un parking site, 2 non funzionano. Rimangono 2 testi puri di siti veri.
5. Il **Validator AI** legge simultaneamente il testo dei 2 candiati. Constata che il candidato 1 ("Rossi Giocattoli") non calza col target "Carrozzeria". Il Candidato 2 descrive l'officina a Milano e ha i giusti recapiti.
6. **Esito:** `carrozzeriarossi.it` vince, Confidence **0.95**. Costo computato Search Engine: $0.00. Proxies Bruciati: 0. Operazione completata in ~5s.
