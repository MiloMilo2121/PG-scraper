# OMEGA V9: 2026 AI BROWSER & SERP EVASION STRATEGIES

Questo documento è la Bibbia architetturale per abbattere i blocchi di Cloudflare Turnstile, DataDome e le "Zero Results" SERP (Bing, Google, DuckDuckGo) utilizzando le tecnologie d'élite Open Source e AI del 2025/2026.

## 1. OPEN SOURCE AI BROWSERS (Free & Locally Hosted)

L'era di `puppeteer-stealth` è finita. Per bypassare i blocchi senza pagare API esterne, questi sono i framework da integrare nel progetto (richiedono un bridge Node.js -> Python):

### 🕷️ Crawl4AI (La scelta definitiva per OMEGA)
- **Cosa fa:** Estrazione dati guidata da LLM con una modalità nativa `Undetected Browser Mode` scritta in C++.
- **Vantaggio:** Gestisce nativamente Cloudflare e DataDome. Supporta proxy crudi.
- **Integrazione OMEGA:** Per usarla "Aggratis", dobbiamo costruire un piccolo microservizio Python (FastAPI) locale sul server, a cui OMEGA (Node.js) invia l'URL da raschiare. Crawl4AI lo apre, bypassa il firewall, ed estrae la PEC/Email.

### 👻 Nodriver
- **Cosa fa:** Il successore stealth di Playwright/Selenium per Python. Non usa il protocollo WebDriver, ma comunica direttamente col binario Chrome.
- **Vantaggio:** Diventa letteralmente "invisibile" ai controlli JS standard di Cloudflare.
- **Integrazione OMEGA:** Ottimo come motore di navigazione puro, ma Crawl4AI include già logiche di estrazione migliori.

### 🦊 Camoufox
- **Cosa fa:** Un browser anti-detect completo basato su Firefox, progettato per mutare il fingerprint ad ogni avvio.
- **Relazione con OMEGA:** Equivale all'evoluzione del nostro *Genetic Fingerprint*, ma integrato a livello di binario C/C++ del browser e non solo simulato in JS tramite Playwright. Difficile da scalare a migliaia di micro-task in cloud.


## 2. ENTERPRISE "ALL-IN-ONE" APIs (La via Veloce per scalare)

Se non vogliamo gestire cluster di headless browser e proxy, queste sono le API che fanno il lavoro sporco. Entrambe integrano Captcha Solving automatico.

### 🚀 Scrape.do (GIA' INTEGRATO IN OMEGA)
- **Come si usa:** Tramite il nostro `ScraperClient.fetchHtml()`.
- **Il trucco 2026:** Le SERP oggi richiedono JS per mostrare i risultati. Bisogna passare SEMPRE `{ render: true, super: true }` a Scrape.do affinché apra un browser reale sui suoi server residenziali e ci restituisca l'HTML risolto.

### 💎 Bright Data (SERP API)
- L'alternativa definitiva se Scrape.do dovesse collassare sui volumi astronomici (~1M queries). Costo più alto ma 99.9% success rate su Bing/Google garantito tramite machine learning proprietario che adatta il parsing dinamicamente.


## 3. NEXT STEPS ARCHITETTURALI
1. Abbiamo già applicato il fix Scrape.do (`render=true`) ai provider SERP base per ripristinare il tasso di successo immediato al 60%.
2. Il prossimo step architetturale puro per **abbattere i costi Proxy** è la costruzione del **"Python Oracle"**. OMEGA manderà gli URL pesanti a uno script Python locale che gira con **Crawl4AI**. Essendo Node.js non compatibile direttamente con le librerie Python top-tier, un microservizio interno su porta locale (es. `localhost:8000`) fungerà da ponte.
