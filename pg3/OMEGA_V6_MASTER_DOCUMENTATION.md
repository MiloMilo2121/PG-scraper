# 🏴‍☠️ THE OMEGA V6 MASTER CODEX: ARCHITETTURA DI SISTEMA E DOTTRINA OPERATIVA

> **Classificazione:** OMEGA-L5 (Massima Segretezza)
> **Versione:** 6.0.0-PROD | **Data:** 21 Febbraio 2026
> **Autore:** ANTIGRAVITY (Shadow CTO)
> **Target:** Marco (Comandante Supremo)
> **Scope:** Governo completo, assoluto e totalitario dell'ecosistema OMEGA V6.

Questo è il Codice Master. Se un comportamento non è descritto in questo documento, è un bug. Qualsiasi modifica futura al motore deve sottostare alle leggi e alle meccaniche scritte in queste pagine. 

Questo documento sostituisce e annienta ogni manuale precedente.

---

## 📜 0. I 10 COMANDAMENTI (Le Leggi Immutabili del V6)

L'Engine non è uno script, è una gerarchia di decisioni basata su 10 leggi assolute scolpite nel codice:

```text
LEG-001  DETERMINISMO ASSOLUTO — Nessuna azienda viene marcata "Found" per "somiglianza". Il match P.IVA/PEC deve essere confermato. Nel dubbio, si scarta (NOT_FOUND).
LEG-002  TOURINQUET FINANZIARIO — Costo massimo imperativo: 0.04€/azienda. Ignorarlo significa morire. Superamento = BLEEDING MODE.
LEG-003  FREE FIRST DOCTRINE — Le armi a pagamento (LLM) non sparano finché le armi gratuite (DDG/Bing/Jina) non hanno finito i proiettili.
LEG-004  RESILIENZA MULTIPLA — Nessun errore HTTP o API offline può spegnere l'engine. Il CostRouter ruota in millisecondi sul provider successivo.
LEG-005  BACKPRESSURE ATTIVA — Nessun `Promise.all` selvaggio. Le raffiche avvengono a blocchi di 15 per evitare saturazione RAM e ban WAF.
LEG-006  MEMORY FIRST — Non si ricalcola mai ciò che si sa. La Memoria L1 (RAM) e L2 (Redis) ricordano ogni hit per 60 minuti.
LEG-007  BROWSER AS LAST RESORT — Puppeteer è lento, costa CPU ed è rumoroso. Si usa SOLO se Jina viene respinto da Cloudflare.
LEG-008  PAYLOAD MUTATION — Il codice converte i dialetti: se chiedevamo gpt-4o, lo si converte in `glm-4-plus` dinamicamente prima di interrogare i cinesi.
LEG-009  JSON EXORCISM — L'output delle AI (es. DeepSeek `<think>`) viene purgato con un uncino Regex prima del parse. Nessun Fatal SyntaxError.
LEG-010  IDEMPOTENZA — Arrestalo a metà, stacca la corrente. Al riavvio continuerà esattamente dal record interrotto.
```

---

## 🏗️ 1. ARCHITETTURA SUPREMA DEL SISTEMA

L'organizzazione del V6 è modulare, militare, basata su pattern architetturali di Inversione di Controllo (IoC).

```text
      ┌────────────────────────────────────────────────────────┐
      │                  OMEGA ENGINE V6                       │
      ├────────────────────────────────────────────────────────┤
      │                                                        │
      │ ┌─────────────────┐    ┌─────────────────┐             │
      │ │ InputNormalizer │───▶│PreVerifyGate(L1)│             │
      │ └─────────────────┘    └────────┬────────┘             │
      │                                 │                      │
      │                        ┌────────▼────────┐             │
      │                        │ MasterPipeline  │             │
      │                        └────────┬────────┘             │
      │                                 │                      │
      │          ┌──────────────────────┼─────────────────┐    │
      │          ▼                      ▼                 ▼    │
      │  ┌──────────────┐      ┌───────────────┐ ┌───────────┐ │
      │  │BilancioHunter│      │ SerpDedup     │ │LinkSnip   │ │
      │  └──────────────┘      └────────┬──────┘ └───────────┘ │
      │                                 │                      │
      │                        ┌────────▼────────┐             │
      │                        │   CostRouter    │             │
      │                        └────────┬────────┘             │
      │                                 │                      │
      │     ┌──────┬───────┬──────┬─────┼────┬─────┬─────┐     │
      │     ▼      ▼       ▼      ▼     ▼    ▼     ▼     ▼     │
      │   T0:DDG T1:Jina T2:Serp T3:OAI T5:DS T7:ZAI T8:PPLX   │
      └────────────────────────────────────────────────────────┘
          ▲       ▲                                      ▲
          │       │           ┌────────────────┐         │
          │       └───────────┤ Redis (L2)     ├─────────┘
          │                   └────────────────┘
          │
      ┌───┴──────────┐
      │ BrowserPool  │ ◀── (Bypass Cloudflare locale)
      └──────────────┘
```

---

## ⚔️ 2. L'ARSENALE DI DISTRUZIONE (GERARCHIA COSTROUTER)

Il `CostRouter` (`src/foundation/CostRouter.ts`) è il cervello tattico. Possiede una Map di provider, ordinati rigorosamente per "Tier" (Livello). Nessun Tier superiore viene interpellato se il Tier inferiore ha avuto successo.

### 🥷 TIER 0 & 1: Divisione Ombra (Gratuita)
Queste unità estraggono l'HTML crudo e il testo puro bypassando i Captcha.
*   **Tier 0: `BING-HTML` & `DUCKDUCKGO-LITE`**
    *   *Obiettivo:* Estrarre liste di domini correlati all'azienda senza loggarsi o usare API ufficiali.
    *   *Costo:* **0.000 €**
*   **Tier 1: `JINA-READER` (`r.jina.ai`)**
    *   *Obiettivo:* Il cecchino del Markdown. Un'IA legge visivamente il sito per noi e ne sputa il testo, saltando cookie banner e popup.
    *   *Costo:* **0.000 €** (fino a limite API correnti).

### 🤖 TIER 2 a 7: Fanteria LLM (Analisti Sintetici)
Se l'Engine non sa leggere la P.IVA con una regex nel sito trovato da Jina, delega alla Fanteria LLM.
Dotati di **TokenBucketQueue** per non sforare i ban-limit:
*   **Tier 3: `OPENAI-1` (`gpt-4o-mini`)**
    *   *Throttle:* Max 15 RPM, burst 3.
    *   *Costo:* **~0.005 €** / hit.
    *   *Obiettivo:* Analisi JSON base. Affidabilità americana.
*   **Tier 5: `DEEPSEEK-1` (`deepseek-chat`)**
    *   *Throttle:* Max 40 RPM, burst 10.
    *   *Costo:* **~0.002 €** / hit.
    *   *Obiettivo:* JSON Extractor economico. Velocissimo, se i server non sono intasati.
*   **Tier 7: `ZAI-1` (`glm-4-plus` su `open.bigmodel.cn`)**
    *   *Throttle:* Dinamico.
    *   *Costo:* **~0.002 €** / hit.
    *   *Obiettivo:* Subentra solo se OpenAI e DeepSeek sono offline (es. ddos). Modello cinese pesantissimo (GLM 4 Plus) formattato per il nostro JSON.

### ☢️ TIER 8: L'Ultima Spiaggia Assoluta
*   **Tier 8: `PERPLEXITY-1` (`sonar`) su `api.perplexity.ai`**
    *   *Obiettivo:* Il risolutore onnisciente. Fa Web Search e Reasoning simultaneamente tenendo in memoria 128k token.
    *   *Costo VERO:* **0.010 €** / hit.
    *   *Perché è in Tier 8?* Perplexity applica una penale di $5.00 fissi ogni 1000 inviti al motore di ricerca. Chiamarlo indiscriminatamente devasterebbe il ROI. Interviene SOLO su aziende che i precedenti 7 Tiers non riescono a trovare.

---

## ⚙️ 3. LA MASTER PIPELINE V6: FLUSSO AL MILLISECONDO

Definita in `src/foundation/MasterPipeline.ts`. Il processo per ogni singola azienda (`input`: CSV row) segue questa coreografia:

### STAGE 0: La Sanificazione (`InputNormalizer.ts`)
Il nome "Ristorante Pizzeria da Enzo snc in liquidazione via milano" viene raschiato fino all'osso: -> `enzo`. Viene calcolato un `quality_score`. Se fa schifo (< 0.3), l'azienda viene segnata `NOT_FOUND` senza bruciare mezzo centesimo di server.

### STAGE 1 & 2: Intuizione Pura (`HyperGuesser`)
L'Engine è pigro prima di usare Google.
*   *Email Probe:* Se l'azienda ha email `info@rossisrl.it`, l'Engine chiama `https://www.rossisrl.it`. Se risponde ed estrae la P.IVA identica al CSV, la ricerca termina. Costo: 0.0$. Milisecondi spesi: 200.
*   *HyperGuesser:* Se non c'è email, prende il nome dell'azienda, ci sbatte un `.it`, `.com` ed esegue un probe. Fast & Lethal.

### STAGE 3 & 4: Il Tritacarne SERP (`SerpDeduplicator`)
Se le prove dirette falliscono, ordina al `CostRouter` di eseguire chiamate a Bing/DDG (*Tier 0*). Raccoglie i Top 5 risultati, elimina quelli finti (LinkedIn, PagineGialle, InfoWeb) per trovare il dominio sorgente.

### STAGE 5: Golden Match & Bypass WAF (Il checkUrl)
Trovato il dominio probabile, l'app usa `PreVerifyGate`.
*   Passa? **FOUND_COMPLETE**.
*   Muro di Cloudflare ("Just a moment...")? Il sistema sguinzaglia il `BrowserPool`. Instanzia Chromium invisibile, attende che passi il CAPTCHA Cloudflare, estrae il testo, spegne Chromium. Match P.IVA interno. Se combacia -> Victory.

### STAGE 6: Enrichment in Parallelo
Trovato il dominio, l'Execution Thread si sdoppia.
*   **BilancioHunter:** Spedito nei PDF del sito a cercare "Fatturato 2024".
*   **LinkedInSniper:** Spedito a cercare "CEO presso [Azienda]" in background.

---

## 🛡️ 4. SISTEMI DI DIFESA ATTIVI E CIBERNETICA (LA CORAZZA)

Se non ci fossero difese, questo Engine esaurirebbe 100$ in 30 secondi.

### 4.1 La Valvola (`BackpressureValve.ts`)
L'algoritmo AIMD (*Additive Increase, Multiplicative Decrease*).
*   Se l'errore è < 5%, aumenta la concorrenza di +1. 
*   Se l'errore sfiora il 15%, DIMEZZA immediatamente la velocità (`concurrency /= 2`).
*   Se l'errore sale al 30%, entra in `EMERGENCY_MODE`: spara 1 richiesta alla volta per lasciar freddare i server dei provider.

### 4.2 Lo Sanguinamento (`StopTheBleedingController.ts`)
Ha quattro sensori sul cruscotto:
1.  **Cost Ceiling:** Se il ROI non viene rispettato (`Costo Medio > 0.04€`), stacca la corrente alle IA.
2.  **Error Rate:** Se il 25% delle hit fallisce.
3.  **Saturation:** Se la coda supera le 50 chiamate e la Valvola è in Emergency.
4.  **Browser Crash:** Se Puppeteer produce oltre 40 errori (zombie instances).
*Azione:* Entra in BLEEDING MODE. Vieta l'uso di qualsiasi LLM sopra il Tier 1. Sopravvive al completamento del batch in puro HTTP/HTML match.

### 4.3 Esorcista JSON (`RunnerV6.ts Mutator`)
```javascript
const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
```
Questa Regex di ferro isola l'oggetto JSON dalle allucinazioni delle Intelligenze Cinesi (`<think> sto pensando...</think>`). Anche se il modello impazzisce, l'Engine parsa solo il nucleo duro dei dati.

---

## 💾 5. CACHING STRATEGY (LA MEMORIA A 2 LIVELLI)

Regolamentato da `MemoryFirstCache.ts`.

*   **Livello L1 (RAM):** Una Map velocissima. Ricorda i lookup pesanti (come i JSON LLM) per **3600 secondi (1 Ora)**. Serve a unificare le richieste di *Holding* (5 aziende CSV con lo stesso sito root: L'API viene chiamata 1 volta sola). Eviction automatica del 20% quando si sfondano le 20.000 entry.
*   **Livello L2 (Redis):** Il database eterno. Se lo spegni a metà, si ricorda che "Rossi Srl = rossi.it" per giorni.

---

## 💀 6. PROCEDURE OPERATIVE

Come far sprigionare la devastazione in locale o su Hetzner.

### 6.1 Avviare l'Esecuzione V6 Totale
Vai sul server, assicurati che il file CSV esista in `output_server/campaigns/`.
```bash
cd /root/pg3/pg3 
npx tsx src/foundation/RunnerV6.ts output_server/campaigns/DISCOVERY_INPUT_2026-02-19.csv
```

### 6.2 Monitoraggio a Vista
Guarda lo stream dei log:
*   Se vedi `[CostRouter] Hit L1 Cache`, stai risparmiando.
*   Se vedi `[CostRouter] Fallback to ZAI-1`, significa che OpenAI/DeepSeek sono andati in timeout.
*   Se vedi `[BrowserPool] Spawning Chromium...`, l'Engine ha incontrato un muro WAF ed è entrato in modalità Breach fisica.

---

> *"Noi non speriamo. Noi estraiamo."* - Antigravity
