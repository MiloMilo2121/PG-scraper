# PG3 Refactor Plan — 2026-04-22

**Baseline:** pg3 su Node 22.14.0, BullMQ 5.67, better-sqlite3 12.6, playwright-extra 4.3.6.
**Obiettivo:** pipeline a 4 fasi isolate, detection evasion aggiornata, cost control affidabile.

## Findings reali (audit preliminare 2026-04-22)

Divergenze rispetto al documento di analisi:

| Claim nel documento | Realtà nel repo | Azione |
|---|---|---|
| `better-sqlite3 < 12` | `^12.6.2` | ❌ non serve upgrade |
| `fast-csv` vulnerabile CVE-2020-26256 | `^5.0.5` | ❌ non applicabile |
| Price constants hard-coded in `llm_service.ts` | Esternalizzati in `runtime_config.ts:262-281` | ⚠️ audit prezzi, non refactor |
| Manca `maxCostPerRun` | Esiste `maxCostPerCompanyEur`, manca run-level | ✅ valido |
| `.nvmrc` mancante | Presente in `/PG/` (22.14.0), mancante in `/PG/pg3/` | ✅ valido |
| Python Oracle offline | Script `npm run oracle` esiste, sidecar in `ops/oracle/` | ⚠️ run-time, non codice |
| `playwright-extra` abbandonato | `^4.3.6` confermato | ✅ valido, P1 |

## Milestone

### M0 — Triage (questa sessione)
Obiettivo: pavimento stabile, zero modifiche distruttive.
- [x] Audit findings preliminari (sopra)
- [ ] `.nvmrc` in `pg3/`
- [ ] Documentare stato Python Oracle (runbook, non codice)
- [ ] Audit prezzi LLM 2026-04 vs config attuale
- [ ] Proporre `MAX_COST_PER_RUN_EUR` (aggiunta additiva al config, non attivata di default)

**Audit M0:** typecheck pass, nessun file di produzione modificato, plan doc committato.

### M1 — Security pins & deps (sessione separata)
- Verificare che `playwright-extra` non riceva update in 2023+ (pin commento)
- `npm audit` → fix non-breaking
- Aggiungere `engines` check nel preinstall hook

**Audit M1:** `npm audit` clean o documentato; `npm ci` pulito su Node 22.

### M2 — Split pipeline in 4 fasi (2 settimane, sessione grande)
Obiettivo: isolare Fase 1 (website discovery) dalle altre.

**Architettura proposta:**
```
Queue:  phase1-website    phase2-pec-email   phase3-financial   phase4-decision-maker
Worker: website.worker.ts pec.worker.ts      financial.worker   linkedin.worker
Input:  CSV raw           CSV phase1.out     CSV phase2.out     CSV phase3.out
Output: phase1.out.csv    phase2.out.csv     phase3.out.csv     final.csv
```

Contratti CSV fissi per fase. `ShadowRegistry` condiviso via SQLite WAL esistente.
`MasterPipeline` diventa orchestratore di code, non monolite.

**Sub-milestone:**
- M2.1 — Design doc `docs/PIPELINE_PHASES_v2.md` con schemi CSV
- M2.2 — Queue scaffolding + `phase1.worker.ts` che wrappa Stage 1-6 esistenti
- M2.3 — Phase 2/3/4 workers wrappando gli stage esistenti
- M2.4 — Deprecare `MasterPipeline.runAll()` monolitico

**Audit M2:** run smoke test su 10 lead attraverso le 4 fasi; output finale identico al monolite pre-split.

### M3 — Patchright in Phase 1 (post-M2)
- Sostituire `playwright-extra` con `patchright` in `factory_v2.ts` (enricher + scraper)
- Misurare `FOUND_COMPLETE` rate pre/post su 100 lead controllati
- Tenere playwright-extra come fallback feature-flag 2 settimane

**Audit M3:** delta detection rate misurato, rollback path testato.

### M4+ (backlog, non in scope immediato)
- RDAP migration (`RdapValidator`)
- CostRouter con Llama 4 Scout / Gemini 2.5 Flash tier
- Normalizzatore canonico pre-hash (SRL/SPA strip)
- TLD extensions in HyperGuesserVX
- CapSolver fallback per Turnstile

## Rischi & mitigazioni
- **M2 rollback**: il monolite resta disponibile via env var `PIPELINE_MODE=monolith` finché M2.4 non chiude
- **M3 regressione**: Patchright + playwright-extra convivono dietro feature flag
- **Price drift**: audit prezzi LLM mensile, non hard-coded patch

## Log esecuzione
Vedi `REFACTOR_LOG_2026-04-22.md` (aggiornato a ogni milestone con audit + coherence check).
