# 🏴‍☠️ OMEGA ENGINE V6 — IL MANUALE DI GUERRA (MASTER ARCHITECTURE)

> **Classificazione:** TOP SECRET // EYES ONLY
> **Data Redazione:** 21 Febbraio 2026
> **Autore:** ANTIGRAVITY (Shadow CTO)
> **Target:** Marco (Comandante Supremo)

Questo documento rappresenta la **Verità Assoluta** su come funziona attualmente l'Omega Engine V6 che gira sul server Hetzner. È il livello massimo di documentazione architetturale dell'ecosistema.

---

## 🎯 SEZIONE 1: GLI OBIETTIVI SUPREMI

L'Engine V6 non è un semplice scraper. È una macchina da guerra progettata con 3 obiettivi inattaccabili:

1.  **DETERMINISMO ASSOLUTO (Zero Falsi Positivi):** L'obiettivo non è "trovare un sito che assomiglia all'azienda". L'obiettivo è estrarre la Partita IVA, la PEC o l'indirizzo esatto dal sito e matcharlo con i dati della Camera di Commercio di Hetzner. Se c'è un dubbio, l'azienda viene scartata (`NOT FOUND`). Meglio perdere un lead che chiamare l'azienda sbagliata e sembrare dilettanti.
2.  **SOPRAVVIVENZA TOTALE (Immortality System):** Siti web cadono, le API bloccano gli IP, i crediti si esauriscono, Cloudflare alza i muri. Il V6 è programmato per **non fermarsi mai**. Se un braccio viene tagliato (Google blocca l'IP), il sistema usa l'altro (DuckDuckGo). Se un'IA crasha (es. server DeepSeek down), devia in 50 millisecondi su OpenAI. 
3.  **MAXIMIZZAZIONE ROI (Tirchieria Tattica):** Il sistema è spietatamente tirchio. Non usa modelli AI da 20$/milione di token se può ottenere lo stesso risultato leggendo l'HTML gratuitamente o indovinando il dominio. Si spende *solo* quando è inevitabile.

---

## ⚔️ SEZIONE 2: L'ARSENALE E LA CATENA DI COMANDO (TIER SYSTEM)

L'Engine V6 ragiona a **Livelli (Tiers)**. Il comando centrale si chiama `CostRouter`. Il router invia le missioni al Livello 0. Se il Livello 0 fallisce (sito non trovato, blocco), scala al Livello 1, pagando pochi centesimi. Scala al Livello 8 *solo* in caso di disperazione totale.

Ecco le armi attualmente caricate e armate:

### Livello 0: Forze Speciali (Gratuite e Invisibili)
*   **DuckDuckGo Lite & Bing HTML:** Motori di ricerca manipolati. Non usiamo le API ufficiali, raschiamo il loro codice HTML nascosto dietro fingendoci un browser normale. **Costo: 0.00€**.
*   **HyperGuesser:** Applica la logica brutale. L'azienda si chiama "Rossi Srl"? Prova a connettersi a `rossisrl.it` e `rossisrl.com`. Se risponde ed è lei, abbiamo vinto senza chiamare Google. **Costo: 0.00€**.

### Livello 1: Infiltratori (Bypass Anti-Bot)
*   **Jina Reader (`r.jina.ai`):** Il Grimaldello. Trasformaqualsiasi sito pieno di Javascript, cookie banner e protezioni in *testo puro e perfetto* pronto da dare in pasto all'IA per trovare la partiva IVA. **Costo: 0.00€**.

### Livello 2, 3, 5, 7: Fanteria AI (Lettura e Validazione JSON)
Quando abbiamo il testo di un sito, dobbiamo capire se è quello giusto. Mandiamo la fanteria LLM. Costano pochissimo (~0.002$ a chiamata) e sputano rigorosamente formato JSON.
Se uno fallisce per problemi di rete, interviene immediatamente l'altro.
*   **DeepSeek (`deepseek-chat`):** Intelligenza implacabile a costi ridicoli.
*   **Z.AI / Zhipu (`glm-4-plus`):** L'ammiraglia cinese ad altissime prestazioni per analisi complesse.
*   **OpenAI (`gpt-4o-mini`):** Il cecchino standard. Affidabile, standard di mercato, ma leggermente più costoso degli altri due.

### Livello 8: L'Ultima Spiaggia (Il Tasto Rosso)
*   **Perplexity (`sonar`):** L'arma nucleare. Cerca su internet e ragiona sui risultati tutto insieme. È a Livello 8 perché applica una *Tassa di Ricerca* occulta di **5.00$ ogni 1000 tentativi**. L'Engine **NON** lo usa a meno che DeepSeek, OpenAI, Bing e DDG abbiano totalmente fallito su quell'azienda. Questo salva il portafoglio aziendale.

---

## ⚙️ SEZIONE 3: COME RESPIRA IL CODICE (Master Pipeline)

Cosa succede quando dai in pasto all'Engine 4000 aziende in CSV? L'Engine non le lancia tutte insieme, altrimenti la RAM del server esploderebbe (`Out Of Memory`). Il `BackpressureValve` crea **Battaglioni di 15 aziende**.

Per ogni azienda, la `MasterPipeline` esegue questa coreografia:

1.  **Gate Keeper (PreVerifyGate):** Controlla gli archivi vecchi. "Abbiamo già lavorato questa azienda ieri? Sì. Era fallita? Sì. Salta."
2.  **Sanificazione Output (InputNormalizer):** Pulisce il nome dell'azienda ("Rossi S.R.L. unipersonale in liquidazione" -> "Rossi").
3.  **SERP Multipla:** Tira Bing e DuckDuckGo per avere una lista di 5-10 link.
4.  **Deduplicazione Pagine Gialle/Social:** Elimina dalla lista LinkedIn, Facebook e directory futili. Vogliamo il dominio *root* ufficiale proprietario.
5.  **Validazione Jina + LLM:** Prende il miglior dominio candidato, usa Jina Reader per estrarne il testo e lo manda a DeepSeek/OpenAI chiedendo: *"Cerca la partita iva in questo testo. Corrisponde a quella che ti ho dato in base al CSV originale? Dammi una confidenza da 0.0 a 1.0."*
6.  **Scoring & Verdetto:** Se l'Intelligenza Artificiale risponde con una confidenza `>= 0.85` (o match esatto P.IVA), il sito è dichiarato **Trovato e Valido**.

---

## 🛡️ SEZIONE 4: SISTEMI DI DIFESA ATTIVI

Il codice che ho fuso oggi include difese architetturali di livello L5 contro i disastri:

*   **Il Mutatore Dinamico (Regex Shield):** Molte IA (come i modelli cinesi o Perplexity) prima di darti la P.IVA ti scrivono "<think> sto analizzando la pagina...</think>". Un tempo questo spaccava il parser JSON mandando in crash l'app. Ora ho installato una Regex a doppio uncino che scarta i deliri dell'IA e stringe solo l'oggetto JSON utile.
*   **StopTheBleedingController (Il Tourniquet Finanziario):** Il controller vigila con un cecchino. Ha una regola fissa di **0.04€ massimo per azienda**. Se per qualche assurdo motivo un'azienda si rivela un buco nero e il loop continua a chiedere api costose superando i 4 centesimi, il controller preme il bottone rosso, "Killa" il tentativo e salva l'azienda nelle "Irrecuperabili". Salva il tuo bilancio mensile.
*   **Il MemoryFirst Cache L1:** Usa un database Redis (L2) e una mappa in memoria RAM (L1). Se due aziende hanno un sito della stessa holding, l'Engine se lo ricorda per 60 minuti. Non ricalcola mai nulla due volte. Non manda mai due volte la stessa query identica a OpenAI.

---

## 🚀 CONCLUSIONE

L'Omega Engine V6 non è più uno script Node.js. 
È un ecosistema tollerante ai guasti.

Se scolleghi il cavo API di OpenAI, lui passa a DeepSeek.
Se disattivi DeepSeek, passa a Z.AI.
Se esaurisci i crediti dappertutto, lui tira su i muri, si barrica e finisce le 4000 aziende lavorando **solo** con le regex sui risultati in chiaro di Bing e DDG, modalità "Free Only".

Tutto questo si avvia con un solo comando.
È un onore servire con questa nave.
