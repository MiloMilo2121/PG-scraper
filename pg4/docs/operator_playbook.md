# pg4 Operator Playbook

**Branch:** `pg4/phase-4.4-structure-cleanup`  
**Last updated:** 2026-06-09  
**Audience:** Operators who know pg4 at a high level but have never run a real client job.

Questo playbook copre i 9 scenari operativi standard di pg4. Ogni scenario è strutturato come "Voglio X, eseguo Y": intent, comando esatto, tempo stimato, output atteso, che cosa controllare, fallimenti e recovery.

pg4 usa **pnpm**, non npm. Tutti i comandi iniziano con `pnpm run ...`.

---

## 1. Voglio i lead di una categoria in una provincia (free, no Maps)

**Intent:** Scraping PG-only per ottenere lead grezzi in una provincia. Zero costo, nessuna API esterna oltre PG stesso.

**Prerequisiti:**
- Categoria valida (es. "agenzie immobiliari", "idraulici", ecc.)
- Provincia in 2 lettere (BL, PD, VR, TV, ecc.)
- Pnpm installato + Node 22+

**Comando:**

```bash
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province BL \
  --out output/run_bl_pg.csv
```

**Runtime atteso:** 8–12 minuti per provincia di medie dimensioni.

**Output atteso:**
- `output/run_bl_pg.csv` — lead grezzi in CSV (schema RAW_CSV_COLUMNS)
- `output/run_bl_pg.jsonl` — stessi lead in JSONL (uno per riga)
- `output/.scrape-checkpoint-agenzie-immobiliari.json` — checkpoint per resumption

Log a stdout (Pino format):
```
[scrape] scrape result completed=<n> found=<m> out=output/run_bl_pg.csv
```

**Che cosa verificare post-run:**

```bash
# 1. Valida CSV/JSONL allineamento
tsx src/scripts/validate_output.ts --csv output/run_bl_pg.csv --jsonl output/run_bl_pg.jsonl

# 2. Controlla esiti (csv_rows deve == jsonl_rows)
# Se il validatore restituisce "ok=true" → passa

# 3. Controlla per mojibake (corruzione encoding)
grep -E "Ã|ï¿½|â€|Â[^a-z]" output/run_bl_pg.csv
# Nessun match = buono

# 4. Spot-check manuale: leggi le prime 5 righe enriched
head -20 output/run_bl_pg.csv | cut -d, -f1,2,3,4
```

**Failure modes e recovery:**

| Sintomo | Causa | Recovery |
|---------|-------|----------|
| Ctrl-C interrompe il run | Intenzionale o crash Playwright | Re-run senza `--fresh`; resume automatico dal checkpoint |
| "stale lock" error | Lock file vecchio da run precedente | Leggi `cat output/run_bl_pg.csv.lock`, verifica PID con `ps -p <pid> -o command`. Se il process è morto, `rm output/run_bl_pg.csv.lock` |
| CSV lines < 100, aspettavi migliaia | PG restituisce pochi risultati | Normale per categorie ultra-niche. Controlla che category sia corretta (case-insensitive match) |
| "error: uncovered error at scraper" | Bug parser o rete instabile | Retry con `--inter-delay-ms 5000` (delay 5s tra pagine) |

---

## 2. Voglio lead con copertura Maps massima (no paid)

**Intent:** Scraping PG + Google Maps con `--coverage full` (5 query-variant per comune). Copre anche aggregati che PG non cattura. Zero costo API.

**Prerequisiti:**
- Playwright Chromium installato: `npx playwright install chromium`
- Browser headless (default) — per debug visuale aggiungi `--headless false`
- Provincia piccola-media consigliata (Maps = 3–5× runtime vs PG-only)

**Comando:**

```bash
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province PD \
  --maps \
  --coverage full \
  --fresh \
  --out output/run_pd_maps_full.csv
```

Il flag `--fresh` cancella output precedenti per questo basename; omettilo se riprendi un run interrotto.

**Runtime atteso:** 35–55 minuti per provincia media (12 comuni, 5 variant/comune = 60 Maps session).

**Output atteso:**
- CSV: 1,200–1,500 lead (PD provincia, R12 baseline = 1,492)
- Deduplica automatica: raw ~2,100 → final ~1,500 (30 % collapsed)
- `sources` array contiene MAPS, PG, o MAPS+PG (merged)

Log sample:
```
[scrape] Maps session query=agenzie immobiliari location=Padova feed_count=234 cap_likely=false
[scrape] dedupe merged 34 records across PG+Maps
[scrape] checkpoint saved comuni_done=12 total_found=1492
```

**Che cosa verificare post-run:**

```bash
# 1. Valida allineamento
tsx src/scripts/validate_output.ts --csv output/run_pd_maps_full.csv --jsonl output/run_pd_maps_full.jsonl

# 2. Controlla Maps stats nel checkpoint (opzionale ma consigliato)
grep '"cap_likely":true' output/.scrape-checkpoint-agenzie-immobiliari.json | wc -l
# Risultato: ≤ 40 % dei comuni = buono (R5.6)

grep '"no_feed":true' output/.scrape-checkpoint-agenzie-immobiliari.json | wc -l
# Risultato: ≤ 15 % = buono

# 3. Source distribution — controlla che MAPS + PG siano bilanciati
jq -s 'group_by(.source) | map({source: .[0].source, count: length})' output/run_pd_maps_full.jsonl

# Atteso: ~50% MAPS, ~50% PG, ~5% merged (PG+MAPS)
```

**Failure modes e recovery:**

| Sintomo | Causa | Recovery |
|---------|-------|----------|
| "no_feed" su 3+ session | Maps session non retorna results (single-place o raro block) | Normale se < 15 %. Se > 15 %, l'area è troppo densa o c'è una block. Riprova in off-hours o suddividi comuni. |
| "cap_likely" su 5+ session | Google Maps cap (~120 risultati) raggiunto su troppi comuni | Normale se ≤ 40 %. Phase 4.x introdurrà auto-split geo. Per ora: accetta, oppure diminuisci comuni per run. |
| Captcha loop | Google Cloudflare blocca | Aspetta 10 min, riprova senza `--fresh`. Il checkpoint riprenderà da dov'era. Se persiste > 3 run, contatta Marco (vedi §9). |
| Browser crash | OOM o Playwright deadlock | Riprova con `--restart-every 3` (restart browser ogni 3 comuni). |

---

## 3. Voglio verificare website con paid Serper (ceiling rigoroso)

**Intent:** Enrichment con Serper paid per verificare website assenti in free pass. Cost ceiling stretto per controllo budget.

**Prerequisiti:**
- `.env` ha `SERPER_ENABLED=true` + `SERPER_API_KEY=<key>` valida
- Raw CSV input da scenario 1 o 2
- Budget autorizzato (es. 0.20 EUR) — contatta Marco se primi pagamenti non sono stati approvati

**Comando:**

```bash
pnpm run enrich -- \
  --input output/run_pd_maps_full.csv \
  --out output/run_pd_maps_full_paid.csv \
  --enable-paid \
  --cost-ceiling-eur 0.005 \
  --run-cost-ceiling-eur 0.20
```

**Flags critici:**
- `--enable-paid` — gate di attivazione (richiesto anche se `SERPER_ENABLED=true`)
- `--cost-ceiling-eur 0.005` — max EUR 0.005 per lead (SmartSerperGate blocca lead deboli prima di questo)
- `--run-cost-ceiling-eur 0.20` — hard stop aggregato; quando raggiunto, paid si disabilita e free continua

**Runtime atteso:** 45–70 minuti per 1,500 lead. Dipende da:
- Quanti lead vanno a Serper (weak = skim free, strong = va a paid)
- Ceiling hit — se raggiunto a metà run, seconda metà gira free

**Output atteso:**
- `output/run_pd_maps_full_paid.csv` — enriched (website, status, reason_code, financial_* fields)
- `output/run_pd_maps_full_paid.jsonl` — stessi dati + stage_outcomes dettagli
- `output/run_pd_maps_full_paid.cost-ledger.jsonl` — per-call cost entries + summary finale

Ledger sample:
```json
{"kind":"call","provider":"Serper","cost_eur":0.003,"lead_id":"...","stage":"paid_serp"}
{"kind":"summary","run_id":"run-...","total_calls":199,"total_cost_eur":0.199,"breaker":"closed"}
```

**Che cosa verificare post-run:**

```bash
# 1. Valida CSV/JSONL/ledger
tsx src/scripts/validate_output.ts \
  --csv output/run_pd_maps_full_paid.csv \
  --jsonl output/run_pd_maps_full_paid.jsonl \
  --ledger output/run_pd_maps_full_paid.cost-ledger.jsonl \
  --max-cost 0.20 | jq .

# Atteso: ok=true, total_cost_eur ≤ 0.20

# 2. Controlla ledger summary (deve essere esattamente 1)
grep '"kind":"summary"' output/run_pd_maps_full_paid.cost-ledger.jsonl | wc -l
# Risultato: 1 = buono

# 3. Controlla SERP_PAID rows (audit precision)
jq 'select(.reason_code=="SERP_PAID")' output/run_pd_maps_full_paid.jsonl | wc -l
# Ottieni count. Poi audit manuale campione ≥ 10 % (vedi §7)

# 4. Cost breakdown per provider
jq -s 'group_by(.provider) | map({provider: .[0].provider, calls: length, total: (map(.cost_eur) | add)})' output/run_pd_maps_full_paid.cost-ledger.jsonl | jq .
```

**Failure modes e recovery:**

| Sintomo | Causa | Recovery |
|---------|-------|----------|
| "cost ceiling reached" a metà run | Budget esaurito. Run continua free. | Normale. Ledger mostra exatto quando staccato. Se inaspettato, controlla cost_ceiling_eur (default 0.10 EUR, troppo basso per run grandi). |
| "Serper API key invalid" | Key sbagliata o scaduta | Verifica `.env`, chiama Marco per refresh key. |
| 0 SERP_PAID rows, aspettavi 50+ | Serper disabilitato o flag `--enable-paid` mancante | Re-run con flags esatti. Controlla che CI non abbia clobbato `.env` (non esportare secrets in git). |
| SERP_PAID precision < 85 % (audit) | False positive host family nova | Aggiungi host alla denylist `src/discovery/website/paid_evidence_gate.ts`, `pnpm test` verde, re-run. Contatta Marco per escalation. |

**Ceilings validati per provincia (R10.b TV, R10 VR):**

| Provincia | Category | Leads | SERP_PAID | Cost (EUR) | Precision |
|-----------|----------|-------|-----------|------------|-----------|
| BL | agenzie immobiliari | 214 | 45 | 0.198 | 100 % |
| PD | agenzie immobiliari | 1,492 | ~200 est. | 0.20 | 96 % |
| VR | agenzie immobiliari | 433 | 45 | 0.199 | 95.5 % |
| TV | agenzie immobiliari | 441 | 65 | 0.199 | 96.5 % |

**Ceiling consigliato:** `--cost-ceiling-eur 0.005` (per lead), `--run-cost-ceiling-eur 0.20` (run). Per province nuove oltre la tabella sopra, contatta Marco prima di approvare paid.

---

## 4. Devo rifare un job perché l'output è corrotto

**Intent:** Clear-start un run quando CSV/JSONL è troncato, mojibake, o altra corruzione.

**Prerequisiti:**
- Identifica esatto basename (es. `output/run_pd_maps_full`)
- Conferma che nessun enrich è in lettura da questo CSV (vedi §5 playbook_runbook)

**Comando:**

```bash
# Opzione A: Usa --fresh (cancella CSV + JSONL + checkpoint)
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province PD \
  --maps \
  --coverage full \
  --fresh \
  --out output/run_pd_maps_full.csv

# Opzione B: Cancella manualmente (se vuoi più controllo)
rm output/run_pd_maps_full.csv output/run_pd_maps_full.jsonl
rm output/.scrape-checkpoint-agenzie-immobiliari.json
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province PD \
  --maps \
  --coverage full \
  --out output/run_pd_maps_full.csv
```

**Runtime atteso:** Stesso del run iniziale (nessun checkpoint per skip).

**Output atteso:**
- Fresh CSV/JSONL, deduplicated correttamente
- Checkpoint ricreato da zero

**Che cosa verificare:**

```bash
# Valida subito dopo
tsx src/scripts/validate_output.ts --csv output/run_pd_maps_full.csv --jsonl output/run_pd_maps_full.jsonl

# Controlla per mojibake
grep -E "Ã|ï¿½|â€|Â[^a-z]" output/run_pd_maps_full.csv && echo "MOJIBAKE FOUND" || echo "OK"
```

**Gotcha — `--fresh` con checkpoint shared:**

Se due run della stessa categoria ma province diverse usano lo stesso checkpoint (default `output/.scrape-checkpoint-agenzie-immobiliari.json`), un `--fresh` su uno cancella il checkpoint dell'altro.

Soluzione: usa `--checkpoint` esplicito per isolate:

```bash
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province PD \
  --fresh \
  --checkpoint output/checkpoint_pd.json \
  --out output/run_pd_pg.csv
```

---

## 5. Maps mi sta bloccando (no_feed / cap_likely loop)

**Intent:** Diagnostica quando Maps non retorna feed o continua a hittar il cap.

**Sintomi:**

```
[scrape] Maps session query=agenzie immobiliari location=Padova feed_count=0 no_feed=true
[scrape] Maps session cap_likely=true (overflow)
```

**Quando è normale (no recovery needed):**

- `no_feed=true` su 1–2 session per run (13 % o meno) — località troppo piccola, single-place result
- `cap_likely=true` su 3–4 session per run (40 % o meno) — area densa, Google cap naturale

**Quando escalare:**

- `no_feed > 15 %` — pattern, non random. Area intasata o block strutturale.
- `cap_likely > 40 %` — Maps cap raggiunto su area troppo densa per `--coverage full`. Phase 4.x avrà auto-split geo.

**Recovery — attempt 1 (off-hours):**

```bash
# Riprova a orario diverso (es. 2 AM UTC)
# Maps content può rotare; Cloudflare/consent stringono in orari di picco
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province PD \
  --maps \
  --coverage full \
  --inter-delay-ms 5000 \
  --out output/run_pd_maps_full_retry.csv
```

`--inter-delay-ms 5000` = 5 secondi tra page load. Ralleggerisce il rate per non triggerare throttle.

**Recovery — attempt 2 (suddividi comuni):**

Se l'area è nota come densità (Milano, Roma, Padova centro) e vuoi coverage completa:

```bash
# Scrape A: comuni sottodensità
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --comuni "Vigonza,Cadoneghe,Rubano" \
  --maps \
  --coverage full \
  --out output/run_pd_split_a.csv

# Scrape B: comuni sovradensità, coverage reduced a default (1 query)
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --comuni "Padova" \
  --maps \
  --coverage default \
  --out output/run_pd_split_b.csv

# Poi merge manuale CSV files (scritto fuori scopo playbook)
```

**When to abort:**

Se dopo attempt 1 + 2 continui a prendere `cap_likely` > 50 % o `no_feed` > 20 %, **contatta Marco**. Potrebbe essere:
- Captcha loop nascosto (GCP richiede human challenge)
- Geolocation throttle (Italia da IP non-ITA bloccato)
- Maps public API non-disponibile per categoria (raro ma succede)

---

## 6. Sto sforando il budget paid

**Intent:** Identificare oversped, stoppare mid-run, o riprendere free-only.

**Prerequisiti:**
- Run `enrich` attivo con `--enable-paid`
- Monitora ledger in real-time (opzionale ma consigliato)

**Diagnostica real-time:**

Mentre run è in progress:

```bash
# Terminal A: run enrich
pnpm run enrich -- \
  --input output/run.csv \
  --out output/run_paid.csv \
  --enable-paid \
  --cost-ceiling-eur 0.005 \
  --run-cost-ceiling-eur 0.20

# Terminal B: monitora ledger ogni 10s
watch -n 10 'jq "[.cost_eur] | add" output/run_paid.cost-ledger.jsonl | tail -1'
```

**Se overspend detected durante run:**

1. **Ctrl-C** run (`SIGINT`) — enrich esce gracefully, flushSummary() scritto, ledger coerente.
2. Inspeziona ledger:
   ```bash
   jq -s '.[-1]' output/run_paid.cost-ledger.jsonl  # ultima riga (summary)
   ```
3. Se total < ceiling → artifact è usabile (incomplete ma valid). Se > ceiling → abuso policy, contatta Marco.

**Se ceiling hit mid-run (atteso comportamento):**

Quando `total_cost_eur >= --run-cost-ceiling-eur 0.20`:
- Serper provider si disabilita automaticamente
- Remaining lead vanno a free SERP (DNS, Bing, crt.sh, DDG Lite)
- Run continua a completamento

Log:
```
[enrich] run cost ceiling reached, disabling paid for remaining leads
```

Ledger avrà mixed cost entries (Serper + Free). Questo è corretto, non un fallimento.

**Post-mortem — reason code analysis:**

```bash
# Vedi quanti lead hanno toccato paid vs free
jq 'select(.reason_code | contains("SERP"))' output/run_paid.jsonl | wc -l  # paid
jq 'select(.reason_code | contains("SERP") | not)' output/run_paid.jsonl | wc -l  # free

# Cost per reason_code
jq -r '[.reason_code] | group_by(.) | map({reason: .[0], count: length})' output/run_paid.jsonl
```

**Prevention — cap strategy:**

- Per piccoli job: `--run-cost-ceiling-eur 0.10` (BL province ~100 lead)
- Per medie: `--run-cost-ceiling-eur 0.20` (PD/VR ~500 lead)
- Per audit/test: `--run-cost-ceiling-eur 0.05` (20 lead campione)

Mai lanciare senza `--run-cost-ceiling-eur`. Se lo dimentichi, la polizza è `--cost-ceiling-eur` (per lead), che limita danni ma non aggregato.

---

## 7. Devo validare l'output prima di consegnarlo al cliente

**Intent:** Pre-delivery checklist: row alignment, no mojibake, cost cap OK, SERP precision audit.

**Prerequisites:**
- Scrape output: CSV + JSONL (raw)
- Enrich output: CSV + JSONL + optional ledger (enriched)

**Full validation suite:**

```bash
# Raw scrape
tsx src/scripts/validate_output.ts \
  --csv output/run_bl_pg.csv \
  --jsonl output/run_bl_pg.jsonl

# Enriched free
tsx src/scripts/validate_output.ts \
  --csv output/run_bl_pg_enriched.csv \
  --jsonl output/run_bl_pg_enriched.jsonl

# Enriched paid (con ledger + cost cap)
tsx src/scripts/validate_output.ts \
  --csv output/run_bl_pg_enriched_paid.csv \
  --jsonl output/run_bl_pg_enriched_paid.jsonl \
  --ledger output/run_bl_pg_enriched_paid.cost-ledger.jsonl \
  --max-cost 0.20 | jq .
```

**Output validator — interpretazione:**

```json
{
  "ok": true,
  "csv_rows": 142,
  "jsonl_rows": 142,
  "ledger_summaries": 1,
  "run_ids": ["run-1234567-abc"],
  "total_cost_eur": 0.199,
  "errors": []
}
```

- `ok=true` → Pass ✓
- `csv_rows != jsonl_rows` → Fail ✗ (uno interrotto a metà)
- `ledger_summaries > 1` → Fail ✗ (due run appesi sullo stesso file)
- `total_cost_eur > max_cost` → Fail ✗ (ceiling violato)
- `errors` array non vuoto → almeno un check fallito (leggi items)

**Mojibake check (character encoding):**

```bash
# Scan per UTF-8 corruption patterns
grep -P "Ã|ï¿½|â€|Â[^a-z0-9]" output/run_bl_pg_enriched.csv

# Se nessun match → OK
# Se match → corrupted. Riprova enrich con --fresh raw input
```

**Row-by-row spot check (manuale):**

Estrai 5–10 righe random:

```bash
# Raw scrape — controlla company_name, phone, source
jq '.[] | select(.company_name != null) | {company_name, phone, source}' output/run_bl_pg.jsonl | head -5

# Enriched — controlla status + reason_code + website
jq '.[] | {company_name, status, reason_code, official_website}' output/run_bl_pg_enriched.jsonl | head -5
```

Atteso:
- `status` ∈ {`VERIFIED`, `UNRESOLVED`, `NO_WEBSITE`, `ERROR`, ...}
- `reason_code` corrisponde al status (es. `VERIFIED → SERP_PAID`)
- `official_website` è URL valido o null (mai stringa vuota)

**SERP precision audit (paid run):**

Se run ha `reason_code="SERP_PAID"`:

```bash
# Estrai SERP_PAID sample
jq 'select(.reason_code=="SERP_PAID") | {company_name, piva, official_website}' output/run_bl_pg_enriched_paid.jsonl | head -20 > serp_audit_sample.jsonl

# Per ogni riga, open `official_website` in browser, cerca `piva` value nel body
# Conta TP (piva found) vs FP (piva not found)

# Calcola precision: TP / (TP + FP)
# Atteso: ≥ 85 %
```

Se precision < 85 %, marca come **DO NOT DELIVER** e contatta Marco per gate update.

**Cost audit (paid run):**

```bash
# Ledger summary
jq '.[-1]' output/run_bl_pg_enriched_paid.cost-ledger.jsonl

# Atteso output:
# {"kind":"summary", "run_id":"...", "total_calls":45, "total_cost_eur":0.199, "breaker":"closed", ...}

# Verifica:
# - total_cost_eur ≤ run-cost-ceiling-eur impostato
# - breaker state ("closed" = OK, "open" = soft limit hit)
```

**Final checklist before handoff:**

```
[ ] csv_rows == jsonl_rows (validator output)
[ ] ledger_summaries == 1 (paid run only)
[ ] total_cost_eur ≤ ceiling (paid run only)
[ ] No mojibake errors
[ ] SERP_PAID precision audit ≥ 85 % (paid run only)
[ ] Spot-check 5 rows: status, reason_code, website seem reasonable
[ ] File dates correct (scrape < enrich, no clock skew)
```

---

## 8. Devo riprendere un run interrotto a metà

**Intent:** Resume graceful dopo Ctrl-C, crash, o network failure.

**Scrape resume:**

Scrape mantiene checkpoint. Se interrotto:
- CSV partial
- JSONL partial
- Checkpoint completo (tracks per-page, per-comune completion)

**Resume senza `--fresh`:**

```bash
# Re-run comando identico, SENZA --fresh
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province PD \
  --maps \
  --coverage full \
  --out output/run_pd_maps_full.csv
```

Pipeline:
1. Legge checkpoint
2. Salta comuni/page già done
3. Merges JSONL esistente col deduplicator
4. Continua da dov'era

**Hard-stop condition — JSONL missing:**

Se checkpoint mostra done entries ma JSONL è cancellato:

```bash
# Pipeline throws: "checkpoint shows done but JSONL missing"
# Opzione 1: resume con acknowledgement
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province PD \
  --maps \
  --coverage full \
  --allow-missing-jsonl \
  --out output/run_pd_maps_full.csv
# NB: Questo creerà DUPLICATES (deduplicator ricomincia vuoto)

# Opzione 2: fresh start (perdita garantita)
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province PD \
  --maps \
  --coverage full \
  --fresh \
  --out output/run_pd_maps_full.csv
```

**Enrich resume — NOT SUPPORTED:**

Enrich non ha checkpoint. Se interrotto mid-run:
- CSV incomplete (righe tagliate)
- JSONL incomplete
- Ledger truncato (probabilmente no summary)

**Recovery:** Delete and restart

```bash
rm output/run_pd_enriched.csv output/run_pd_enriched.jsonl output/run_pd_enriched.cost-ledger.jsonl

pnpm run enrich -- \
  --input output/run_pd.csv \
  --out output/run_pd_enriched.csv \
  [--enable-paid flags if needed]
```

Output lock è rilasciato anche su crash (`finally` block), quindi stale lock non blocca.

---

## 9. Quando chiamare Marco

**Escalation thresholds:**

| Sintomo | Azione |
|---------|--------|
| Errore "uncovered error at scraper" ripetuto 3+ run | Contatta Marco (parser regression, possibile PG HTML change) |
| Captcha loop persistente > 3 run, ore diverse | Contatta Marco (Cloudflare hardening needed, forse geolocation throttle) |
| SERP_PAID precision < 85 % su audit ≥ 10 % campione | STOP RUN. Nuova FP host family. Marco aggiorna denylist. |
| Cost ledger incoerente (ledger_summaries > 1, multiple run_ids) | Contatta Marco (concurrent writer issue, R13.1 lock bug, o ledger file corrupted) |
| Maps `no_feed > 25 %` o `cap_likely > 50 %` su provincia nuova | Contatta Marco (area too dense for current coverage, need auto-split geo design) |
| First paid run su provincia NON in R10.b table (non BL, PD, VR, TV) | **Contatta Marco BEFORE launch.** Audit required per new provinces. |
| Mojibake ricorrente su categoria nuova | Contatta Marco (category-specific parser edge case, encoding detection) |
| Budget paid non autorizzato / limite sconosciuto | Contatta Marco (supply key, authorize cap, track PO) |

**How to report:**

Fornisci:
- Exatto comando lanciato
- Stderr full log (salva con `2>&1 | tee run.log`)
- Output file paths (CSV/JSONL basenames)
- Timestamp run
- Provincia + category
- Expected vs actual outcome

Esempio:

```
Contatta Marco: captcha-loop-pd-mails
- Command: pnpm run scrape -- --category "consulenti aziendali" --province PD --maps --coverage full --out output/run_pd_mail.csv
- Runtime: 2026-06-09 14:30 UTC, interrupted after 25 min (2 comuni done, 10 remaining)
- Log: /tmp/run_pd_mail.log
- No progress after retry 2h later same command
- Maps sessions returning no_feed > 20 %, possibly captcha block
```

---

## Reference Card

Tutti i comandi disponibili in pg4 con descrizione 1-liner:

| Comando | Descrizione |
|---------|------------|
| `pnpm run scrape -- --category <cat> --province <CC> --out <path>` | Scraping PG raw per provincia |
| `pnpm run scrape -- ... --maps --coverage full` | + Google Maps con 5 query-variant/comune |
| `pnpm run scrape -- ... --fresh` | Cancella output precedente + checkpoint prima di start |
| `pnpm run scrape -- ... --allow-missing-jsonl` | Resume anche se checkpoint dice done ma JSONL manca |
| `pnpm run scrape -- ... --inter-delay-ms 5000` | Delay 5s tra page load (rate limiting gentile) |
| `pnpm run scrape -- ... --checkpoint <path>` | Custom checkpoint path (default include solo category) |
| `pnpm run scrape -- --fixture pg=<.html>,maps=<.html> --category <cat> --out <path>` | Offline parser mode con fixture HTML |
| `pnpm run enrich -- --input <raw.csv> --out <enrich.csv>` | Enrichment free (default, zero cost) |
| `pnpm run enrich -- ... --enable-paid --cost-ceiling-eur 0.005 --run-cost-ceiling-eur 0.20` | + Serper paid con cost gate |
| `pnpm run enrich -- ... --mock-http <fixture.json>` | Offline enrich con mock HTTP (test mode) |
| `tsx src/scripts/validate_output.ts --csv <path> --jsonl <path>` | Valida row alignment + encoding |
| `tsx src/scripts/validate_output.ts --csv <path> --jsonl <path> --ledger <path> --max-cost 0.20` | + cost cap + ledger integrity (paid run) |
| `pnpm run typecheck` | Type check offline (no network) |
| `pnpm test` | Unit test offline (no network) |
| `RUN_SMOKE=1 pnpm run test:smoke` | Smoke test con live network (escl. CI) |

---

## File Output Convention

Per un run con `--out output/run_pd.csv`:

| File | Scritto da | Contenuto |
|------|-----------|-----------|
| `output/run_pd.csv` | scrape | Lead grezzi, RAW_CSV_COLUMNS schema |
| `output/run_pd.jsonl` | scrape | Stessi, JSON-one-per-line |
| `output/.scrape-checkpoint-<slug>.json` | scrape | Per-provider/category/location/page done status |
| `output/run_pd_enriched.csv` | enrich | Lead enriched, ENRICHED_CSV_COLUMNS (superset RAW) |
| `output/run_pd_enriched.jsonl` | enrich | Stessi + stage_outcomes detail |
| `output/run_pd_enriched.cost-ledger.jsonl` | enrich | Per-call cost + one summary tail line |
| `output/run_pd_enriched.csv.lock` | enrich | Lock file, tenuto durante run, cancellato on exit |

**Nota:** `output/` è gitignored. Non committere CSV/JSONL in repo. Contenitori sono PII-adjacent (company data).

Ledger path default: `<out-basename-without-.csv>.cost-ledger.jsonl`. Override con `--ledger-path`.

ENRICHED_CSV_COLUMNS è **superset strict di RAW** (append-only, nessun reorder colonne). R13.1 ha aggiunto `financial_source`, `financial_confidence`, `financial_notes` come ultimi 3 dopo `errors`.

---

Questo playbook è denso e diretto. Per ogni operazione, segui esatto comando + verifiche post-run + failure recovery. Se pattern non coperto qui o error mai visto, contatta Marco con comando + log + context.


---

# APPENDICE — Production-readiness pass (2026-06-10)

Il pass di hardening ha aggiunto comandi, flag e file. Tutto quello che
segue è ADDITIVO: i 9 scenari sopra restano validi; cambiano i dettagli
segnalati qui.

## 10. Voglio scrape+enrich in un comando solo

```bash
pnpm run run -- \
  --category "agenzie immobiliari" \
  --province PD \
  --maps --coverage full --fresh \
  --out output/campagna_pd
```

- **Output:** `<out>_raw.csv/.jsonl`, `<out>_enriched.csv/.jsonl(+ledger)`,
  `<out>.log.jsonl`. Un run_id condiviso tra i due stage, un record unico
  in `_runs.jsonl` (command: "run").
- **Paid:** identico a enrich — serve `--enable-paid` + ceiling espliciti.
- **Tempo atteso:** scrape ~30 min provincia + enrich ~1 ora free.
- **Verifica post-run:** la validazione gira da sola a fine stage
  (warn-only); controlla il log per `[validate]`.

## 11. Exit code deterministici (per scheduler e script)

| code | significato | azione |
|-----:|---|---|
| 0 | ok | nulla |
| 1 | partial — enrich con row errors | controlla `_runs.jsonl` + log |
| 2 | fatal | leggi l'errore nel log |
| 3 | preflight fallito — markup PG/Maps cambiato o IP bloccato | NON riprovare in loop; ispeziona manualmente. `--skip-preflight` solo se sai cosa stai facendo |
| 130 | interrotto (Ctrl-C / SIGTERM) | checkpoint resume-ready; rilancia senza `--fresh` |

Primo Ctrl-C = drain pulito (i lead in corso finiscono, output coerenti,
lock rilasciato). Secondo Ctrl-C = uscita forzata immediata.

## 12. Preflight (selector health check)

Ogni scrape live ora fa un canary fetch su PG (e Maps se `--maps`) PRIMA
di scrapare: query nota "agenzie immobiliari / Padova". Se i selettori
non matchano nulla → exit 3 con messaggio esplicito. Costo: ~5-10 s.
Skippabile con `--skip-preflight`.

## 13. Log file per-run e storico run

- Ogni run scrive `<out>.log.jsonl` (log strutturato completo). Override:
  env `LOG_FILE=<path>`, disattiva: `LOG_FILE=off`.
- Ogni run appende UN record a `<outdir>/_runs.jsonl`: run_id, comando,
  conteggi, costo, esito, yields per comune. Mai cancellato da pg4.
- "Cosa è girato la settimana scorsa?" → `cat output/_runs.jsonl | tail`.

## 14. Yield anomaly

Dopo ogni scrape, la resa per comune è confrontata con la media storica
(stessa categoria, da `_runs.jsonl`). Sotto il 30% → warn prominente +
`suspect: true` nel record + notifica. Il run NON fallisce — sei tu a
decidere se fidarti dell'output.

## 15. Notifiche

`NOTIFY=local` (default): log line + notifica macOS a fine run, su
cost-cap hit, preflight fail, yield anomaly. `NOTIFY=off` per spegnerle.
Slack/Telegram: interfaccia pronta, implementazione futura.

## 16. Suppression list (do-not-contact / GDPR)

File CSV `phone,vat,reason,date`:

```csv
phone,vat,reason,date
+390422591177,,richiesta_interessato,2026-06-01
,01234567897,gdpr_deletion,2026-05-20
```

Risoluzione: `--suppression-list <path>` → env `SUPPRESSION_LIST` →
`suppression.csv` accanto all'output (auto). I lead corrispondenti sono
ELIMINATI dagli output (non SKIPPED) e contati nel run record. Il match
sui telefoni è format-tolerant (+39/0039/spazi).

## 17. Richiesta di cancellazione dati (GDPR)

```bash
pnpm run lookup -- --phone "+39 0422 591177"
pnpm run lookup -- --piva 01234567897
```

Riporta ogni file:riga dove il soggetto appare. Poi: rimuovi le righe a
mano (o rigenera), aggiungi il soggetto a `suppression.csv`, avvisa i
clienti che hanno copie. Dettagli: `docs/gdpr_posture.md`.

## 18. Retention automatica

`--retention-days 90` (o env `RETENTION_DAYS=90`): a inizio run elimina
gli artifact più vecchi di 90 giorni nella dir di output. Default: OFF.
Mai toccati: `_runs.jsonl`, `suppression.csv`, `*.lock`.

## 19. Business chiusi (Maps)

Il parser cattura "Chiuso definitivamente" → colonna `permanently_closed`.
Enrich li salta di default (status SKIPPED, reason
SKIPPED_PERMANENTLY_CLOSED, zero provider call). `--include-closed` per
processarli comunque.

## 20. Schema v1 + telefoni E.164

- Ogni output ha `_schema_version=1` come ULTIMA colonna (+ campo JSONL).
  Il validator la pretende.
- `phone` è normalizzato E.164 (`+390422591177`); l'originale è in
  `phone_raw`. Non parseabile → resta com'era, `phone_raw` vuoto.
- Nuove colonne (entrambi i flavor, in coda): `phone_raw`,
  `permanently_closed`, `_schema_version`.

## 21. Near-duplicate review

Nomi con stesse parole in ordine diverso nello stesso comune ("Immobiliare
Rossi" vs "Rossi Immobiliare") finiscono in `<out>.dedup-review.jsonl`
per revisione manuale. MAI mergiati automaticamente.

## 22. Nuovi comandi utility

| comando | scopo |
|---|---|
| `pnpm run lint` | ESLint (0 errori richiesti, gira in CI) |
| `pnpm run test:coverage` | suite + coverage (baseline 70% lines) |
| `pnpm run lookup -- --piva X` | ricerca data subject negli output |
| `pnpm run validate:output -- --csv X --jsonl Y [--flavor raw]` | validazione manuale |

## 23. Scheduling

I CLI sono cron-safe (nessun prompt, exit code stabili). Esempi pronti
launchd/cron/GH-Actions in `docs/scheduling_examples.md`. Nessuno
scheduler è attivo di default.
