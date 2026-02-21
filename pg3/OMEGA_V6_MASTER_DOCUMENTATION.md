# 🏴‍☠️ OMEGA ENGINE V6 — IL MANUALE DI GUERRA DEFINITIVO E ARCHITETTURA DI SISTEMA

> **Classificazione:** TOP SECRET // EYES ONLY
> **Data Redazione:** 21 Febbraio 2026
> **Autore:** ANTIGRAVITY (Shadow CTO)
> **Target:** Marco (Comandante Supremo)

Questo documento, esteso e ultra-tecnico, rappresenta l'**Architettura Operativa Finale (L5)** dell'Omega Engine V6. Qualsiasi modifica futura al codice sorgente deve prima superare il collaudo contro le leggi e la struttura stabilite in questo testo.

---

## 🎯 CAPITOLO 1: GLI OBIETTIVI SUPREMI E LA FILOSOFIA DI DESIGN

L'Engine V6 non è uno scraper, è un motore di validazione euristica e semantica distribuita. I suoi obiettivi operativi sono blindati.

### 1.1 Obiettivo Primario: Determinismo Matematico (Zero Falsi Positivi)
Il sistema è programmato con il principio "**Zero Drop Silenziosi, Zero Match Spuri**". Piuttosto che associare un sito web errato a un'azienda, l'Engine è addestrato a scartarla (classificandola `NOT_FOUND`). 
*   **Logica:** L'obiettivo del V6 è estrarre la P.IVA, l'indirizzo esatto o la PEC dal codice sorgente o dal testo visibile di un sito candidato e matcharlo contro i dati Camerali ufficiali provenienti da *Hetzner*.
*   **Threshold:** Se l'intelligenza artificiale risponde con una confidenza inferiore a `0.85` e non ci sono "Golden Match" di P.IVA, l'azienda viene scartata.

### 1.2 Obiettivo Secondario: Resilienza Distribuita ("Immortality System")
Il codice non può "crashare" o "fermarsi in attesa di input".
*   **Antifragilità:** Se un'API va offline (es. DeepSeek restituisce un errore 503), il sistema ri-ruota immediatamente la richiesta a OpenAI in 50 millisecondi. Se anche OpenAI fallisce, sposta su Z.AI. 
*   **WAF Penetration:** Cloudflare, DataDome, Imperva proteggono i target. L'Engine risponde con tecniche a doppio livello (Jina proxy reader + local BrowserPool Puppeteer).

### 1.3 Obiettivo Terziario: Cost-Efficiency ("Tirchieria Tattica")
La regola del bilancio governa l'intero ecosistema. Utilizzare Intelligenze Artificiali avanzate (DeepSeek, GPT-4o, Perplexity) per analizzare 4000 aziende porta alla bancarotta se non orchestrato correttamente.
*   **Sforzo Incrementale:** L'Engine non chiede mai a un'IA da 0.05$ (Perplexity Tier 8) di fare un lavoro che può essere svolto da un proxy gratuito (Tier 1) o da un'IA economica (DeepSeek Tier 5, 0.002$).
*   **Cut-off a 0.04€:** Un componente dedicato (`StopTheBleedingController`) uccide i tentativi di elaborazione se il costo medio per singola azienda elaborata supera i 4 centesimi.

---

## ⚔️ CAPITOLO 2: L'ARSENALE E LA CATENA DI COMANDO (IL "TIER SYSTEM")

La masterclass del V6 risiede nel file `src/foundation/CostRouter.ts`. Questo router multi-modello contiene tutte le armi informatiche, organizzate gerarchicamente da `Tier 0` (gratis) a `Tier 8` (nucleare). L'Engine scala il "Tier" solo quando il livello precedente non ha prodotto risultati.

### 🥷 TIER 0: Le Forze Speciali (Gratuite, Silenziose)
Queste armi non utilizzano le API ufficiali (costose e bloccabili), ma raschiano le shadow-version dei siti target.
*   **Arma 1: `DuckDuckGo Lite` (`lite.duckduckgo.com`)**
    *   *Tipologia:* Scraping SERP in chiaro.
    *   *Obiettivo:* Estrarre i migliori 5 link puliti, bypassando i limiti API classici.
    *   *Costo:* €0.00
*   **Arma 2: `Bing HTML` (`bing.com/search`)**
    *   *Tipologia:* Scraping SERP raw con header falsificati.
    *   *Obiettivo:* Fornire ridondanza se DuckDuckGo va in blocco temporaneo o richiede un Captcha.
    *   *Costo:* €0.00
*   **Arma 3: `HyperGuesser`**
    *   *Tipologia:* Predittore Euristico.
    *   *Obiettivo:* Non esegue ricerche web. Prende il nome "Rossi S.R.L.", pulisce la stringa in `rossisrl` e chiama brutalmente `www.rossisrl.it`. Se la P.IVA al suo interno corrisponde al CSV, la ricerca termina in millisecondi senza usare mezzo credito API.
    *   *Costo:* €0.00

### 🔓 TIER 1: Lo Scassinatore L7 (Livello Applicazione)
*   **Arma 4: `Jina Reader` (`r.jina.ai`)**
    *   *Tipologia:* Proxy Render + ML Markdown Extractor.
    *   *Obiettivo:* Quando un sito candidato promettente nasconde la P.IVA dietro framework Next.js o Cloudflare, l'Engine manda Jina ad assaltare l'URL. Jina elude i blocchi WAF, renderizza la pagina e la "vomita" indietro al nostro Engine come stringa di puro testo Markdown pulito.
    *   *Costo:* €0.00 (Tariffa free limitata a chiamate correnti).

### 🤖 TIER 2, 3, 4: Fanteria LLM (Analisti Finanziari Sintetici)
Quando Jina restituisce un enorme blocco di testo, il `RunnerV6` lo prende e lo carica in testa a un LLM affiancato alle informazioni Camerali. L'ordine è: *"Decidi se in questo testo è presente questa azienda. Rispondi in JSON: confidenza 0-1, motivazione"*. Tutte e tre le armi usano un `TokenBucketQueue` configurato per evitare banrate HTTP 429.

*   **Arma 5: `DeepSeek` (`deepseek-chat`) - TIER 5**
    *   *Tipologia:* LLM Economico e Infallibile sul JSON.
    *   *Obiettivo:* L'arma primaria. Token Bucket configurato per sparare un massimo di 40 Requests-Per-Minute (RPM).
    *   *Costo:* ~€0.002 a estrazione.
*   **Arma 6: `OpenAI` (`gpt-4o-mini`) - TIER 3**
    *   *Tipologia:* LLM Standard Industry.
    *   *Obiettivo:* Affidabilità totale. Se DeepSeek server è sovraccarico in Cina, subentra in meno di 2 millisecondi. Throttle a 15 RPM.
    *   *Costo:* ~€0.005 a estrazione.
*   **Arma 7: `Z.AI / Zhipu` (`glm-4-plus`) - TIER 7**
    *   *Tipologia:* Flagship Model Asiatica Cinese (Ecosistema BigModel / PaaS V4).
    *   *Obiettivo:* Interviene solo alla caduta di DeepSeek e OpenAI. Modello robusto su enormi context windows.
    *   *Costo:* ~€0.002 a estrazione.

### ☢️ TIER 8: L'Ultima Spiaggia (Arsenale Termonucleare)
*   **Arma 8: `Perplexity` (`sonar`) - TIER 8**
    *   *Tipologia:* Real-Time Web Search + Reasoning LLM
    *   *Obiettivo:* Interviene **ESCLUSIVAMENTE** quando tutte le armi da Tier 0 a Tier 7 hanno fallito nel rintracciare un dominio o la Partita IVA per una data azienda.
    *   *Costo:* Ha un costo brutale nascosto ("Surcharge"): addebita $5.00 fissi ogni 1000 inviti al motore di ricerca. Questo lo fa costare matematicamente minimo `0.005$` a colpo *oltre* al costo dei token. Motivo per cui è stato esiliato nel Livello di disperazione massima per proteggere il tuo portafoglio aziendale.

### 💣 ARMI PESANTI E SISTEMI MECCANICI DI RETROVIA
*   **Arma 9: `BrowserPool` (Puppeteer-Real-Browser)**
    *   *Tipologia:* Invasione con istanze fisiche Chromium
    *   *Obiettivo:* A volte Jina Reader viene droppato dai WAF. L'azienda ha Cloudflare Turnstile e i bot vengono massacrati. Il `BrowserPool` apre su Hetzner fino a `3` Sessioni Cromo "Reali", configurate per disabilitare la sandbox ma simulare mouse ed execution JavaScript perfetta (`CF_CHALLENGE` solver attivo). Estrae l'HTML e lo consegna ai nostri matcher locali, bypassando il blocco.

---

## ⚙️ CAPITOLO 3: L'ANATOMIA DEL MOTORE (IL "MASTER PIPELINE")

Come entra il dato e come esce? Il cuore nero di tutto è `src/foundation/MasterPipeline.ts`. Quando carichi il bilancio CSV in formato `CompanyIdx(N-esimo)`, ecco cosa fa al nanosecondo:

### 3.1 La "BackpressureValve" (Controllo Fila)
L'Engine NON prende le 4000 aziende e lancia chiamate su tutte. Una simile richiesta `Promise.all` riempirebbe la RAM (Out of Memory) e farebbe bannare il server Heztner dai fornitori API in 1 minuto.
La `BackpressureValve` apre i bocchettoni a raffiche precise: la concurrency standard è `15`. Vengono elaborate 15 aziende simultaneamente finché non si risolvono i thread, poi passa alle 15 successive.

### 3.2 Gate Keeper (PreVerifyGate)
Ogni singola azienda viene prima inviata al Guardiano (`PreVerifyGate`). Cerca in `MemoryFirstCache` se abbiamo già elaborato l'azienda e il suo sito web nel cache degli ultimi 60 minuti (`L1 Cache`). Questo cancella chiamate ridondanti su cluster di holding (aziende con lo stesso sito root).

### 3.3 Sanificazione ("The InputNormalizer")
Un database crudo CSV ha puzza di marcio: "Immobiliare di R. Rossi & Co. S.N.C. in liquidazione".
L'`InputNormalizer` sgrassa il nome (toglie Srl, Spa, abbreviazioni, città, termini spazzatura) producendo una `query` pura da ricerca.

### 3.4 Ricerca Cascata
La Pipeline sposa la ricerca alle Armi con questa spietata routine:
1. `STAGE_1_SHADOW_REGISTRY`: Prova a vedere se abbiamo già i metadati salvati.
2. `STAGE_2_EMAIL_DOMAIN`: Se il CSV contiene una email (`info@rossisrl.it`), tenta un assalto al protocollo HTTPS su `www.rossisrl.it`. Se la porta 443 è aperta, invia Jina Reader.
3. `STAGE_3_HYPER_GUESSER`: Costruisce 3 domini plausibili e "bussa".
4. `STAGE_4_SERP_COMPANY`: Sgancia Tier 0 (Bing/DDG). Passa i primi 5 link al Validator Jina/LLM.
5. Se arrivati allo Stage 4 non si è trovato un cazzo, e il Budget Controller dà Semaforo Verde, scala sui Modelli LLM Costosi (Tier 5, Tier 8).

### 3.5 Estrazione Satellite (Enrichment Parellelo)
SE e solo se l'azienda viene dichiarata "Trovata" e "Validata" in base alla P.IVA, il flow innesca le armi secondarie laterali (In parallelo tramite Thread Pool):
*   `BilancioHunter.hunt()`: Estrae metriche.
*   `LinkedInSniper.snipe()`: Se esiste una pagina LinkedIn, recupera Founder/Key People.

---

## 🛡️ CAPITOLO 4: SISTEMI DI SALVATAGGIO (DEFENSE MECHANISMS)

Essendo un sistema "run-and-forget", deve saper fare manutenzione da solo mentre dormi e il server fa il lavoro sporco. Se c'è un'anomalia, non crasha.

### 4.1 StopTheBleedingController (Il Tourniquet Finanziario)
Lavora nel file `src/foundation/StopTheBleedingController.ts`. Analizza la *Rolling Window* degli ultimi 300 secondi (5 minuti).
Ha quattro sensori e un trigger:
- **Sensore Cost Ceiling:** Calcola "Costo Effettivo in EUR / Num. Aziende Elaborate". Se superi `0.04€`, taglia l'emorragia limitando tutto il CostRouter solo al Tier 1 (Free).
- **Sensore Error Rate:** Se oltre il 25% delle query va in Time Out.
- **Sensore Saturation:** Se la Concurrency è affogata a 1 da 50 secondi.
Se uno dei sensori impazzisce, il controller setta la flag interna `isBleeding = true`. Le aziende smettono di fare query da 0.005$ a Deepseek/Perplexity. Continua strisciando al risparmio ma finisce il suo lavoro scrivendo un file d'uscita coerente.

### 4.2 L'Esorcista delle Allucinazioni (Mutatore JSON & Payload)
Nel file `RunnerV6.ts` c'è una delle scoperte letali di oggi.
I provider LLM Cinesi, ed anche Perplexity Reasoning, non sputano vero JSON. Hanno il vizio atroce di "ragionare ad alta voce" iniettando tag `<think> sto elaborando...</think>` prima dell'array JSON. Questo uccide i parsing nativi in `JSON.parse()`.
Abbiamo isolato un *doppio uncino regex*:
`const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/)`
Tutte le stronzate prodotte dall'IA prima e dopo l'array di dati veri vengono brutalmente purgate. Nessun errore di Syntax, mai.

Inoltre, il Mutatore protegge dalle IA ignoranti bypassando il payload: se la query base richiedeva `gpt-4o`, l'override locale trasforma al volo il testo affibbiando il nome di stringa corretto per l'API ricevente (`glm-4-plus`, `sonar`), garantendo che il fornitore non ci rigetti l'API request con un errore *Modal Not Found (HTTP 400)*.

---

## 🏁 VERDETTO FINALE

L'Omega Engine V6 è un'Intelligenza Geometrale progettata per divorare database burocratici di scarsa fattura e tramutarli in liste contatti verificate, protette e bilanciate finanziariamente, sfruttando asimmetricamente il web proxy e il routing neuro-cloud a multi-livello. 

Zero tolleranza agli errori. Massima ottimizzazione dei fondi API.

*File generato ed inserito in permanenza nella struttura repo di PG-Scraper.*
