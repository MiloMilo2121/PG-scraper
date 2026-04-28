# Pipeline Phases v2 — Design Doc (2026-04-22)

## Stato attuale (v1, monolite)
- `MasterPipeline.processCompany()` = **1 metodo, 943 righe**, esegue Stage 1 → 6 + PostDiscovery in serie per ogni lead.
- Un lead con website già presente in input fa comunque passare **tutti gli stage di discovery** (1-6) prima di arrivare a PostDiscovery (PEC/email/financial/DM).
- Costo medio stimato su 1.395 lead con ~30% website mancante: ~60-90s/lead, €0.008 LLM/lead, 40-55% FOUND_COMPLETE rate.

## Target v2 (split in 4 fasi)

```
CSV raw (1395)
    │
    ▼
┌─────────────────────────────┐
│ Phase 1 — Website Discovery │  solo lead SENZA website
│  Stage 1,1.5,1.6,2,3,4,4b,5,6│  concurrency: 4-6
│  Output: CSV con website    │  timeout: 90s/lead
└─────────────────────────────┘
    │
    ├── lead con website iniziale → bypass direct ───┐
    │                                                 │
    ▼                                                 ▼
┌─────────────────────────────┐       ┌─────────────────────────────┐
│ Phase 2 — PEC + Email       │       │ (stessa Phase 2)            │
│  PecHunter + HunterClient    │◀──────│                             │
│  Concurrency: 12-16 (fast)  │       └─────────────────────────────┘
│  Timeout: 20s/lead          │
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│ Phase 3 — Financial         │  opzionale, richiede P.IVA
│  BilancioHunter             │  concurrency: 6-8
│  Timeout: 40s/lead          │
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│ Phase 4 — Decision Maker    │  opzionale, costoso
│  LinkedInSniper             │  concurrency: 4
│  Timeout: 60s/lead          │
└─────────────────────────────┘
    │
    ▼
CSV final
```

## Contratti CSV tra fasi

Schema stabile, colonne additive. Ogni fase legge il CSV precedente e aggiunge colonne senza mai rimuoverne.

### Input (CSV raw — contratto esistente, invariato)
```
company_id, company_name, phone, city, address, category, website?, piva?, email?
```

### Phase 1 output (`phase1.out.csv`)
Aggiunge:
```
p1_website           — URL scoperto (o vuoto)
p1_website_source    — STAGE_1_SHADOW | STAGE_1_5_INPUT | STAGE_3_HYPER | STAGE_4_SERP | STAGE_6_LLM | NOT_FOUND
p1_piva              — P.IVA confermata (spesso trovata in Stage 4/5)
p1_confidence        — 0.0-1.0
p1_stages_attempted  — comma-separated
p1_cost_eur          — cost accumulato
p1_duration_ms
```

### Phase 2 output (`phase2.out.csv`)
Aggiunge:
```
p2_pec              — email PEC (o vuoto)
p2_email_generic    — email generica (info@, contact@, ...)
p2_email_source     — PECHUNTER_INIPEC | HUNTER_API | WEBSITE_SCRAPE | NOT_FOUND
p2_duration_ms
```

### Phase 3 output (`phase3.out.csv`)
Aggiunge:
```
p3_fatturato_eur
p3_dipendenti
p3_anno_bilancio
p3_source           — BILANCIO_HUNTER | REGISTRO_IMPRESE | NOT_FOUND
p3_duration_ms
```

### Phase 4 output (`phase4.out.csv` = final)
Aggiunge:
```
p4_dm_name
p4_dm_role
p4_dm_linkedin_url
p4_dm_source        — LINKEDIN_SNIPER_SERP | NOT_FOUND
p4_duration_ms
```

## Architettura queues (BullMQ)

```typescript
// src/foundation/phases/queues.ts
export const PHASE_QUEUES = {
  phase1: new Queue('phase1-website-discovery', { connection }),
  phase2: new Queue('phase2-contacts',          { connection }),
  phase3: new Queue('phase3-financial',         { connection }),
  phase4: new Queue('phase4-decision-maker',    { connection }),
};
```

Jobs idempotenti via `jobId = `${phase}:${company_id}``.

## Workers

```
src/foundation/phases/
  phase1_worker.ts    — wrappa Stage 1..6 esistenti da MasterPipeline
  phase2_worker.ts    — wrappa PecHunter + HunterClient
  phase3_worker.ts    — wrappa BilancioHunter
  phase4_worker.ts    — wrappa LinkedInSniper
  orchestrator.ts     — legge/scrive CSV, enqueue job, attende completamento per fase
```

## Modalità di esecuzione

```bash
# Esegue tutte le 4 fasi in sequenza (sostituisce monolite)
PIPELINE_MODE=phased npm start -- --input bz.csv

# Esegue singola fase (debugging / rerun)
npm start -- --phase 1 --input bz.csv
npm start -- --phase 2 --input phase1.out.csv
npm start -- --phase 3 --input phase2.out.csv
npm start -- --phase 4 --input phase3.out.csv

# Modalità legacy (monolite) — feature flag per rollback
PIPELINE_MODE=monolith npm start -- --input bz.csv
```

## ShadowRegistry cross-fase

Il registry SQLite esistente rimane autoritativo. Fase 2/3/4 leggono `company_id` dal CSV e fanno `registry.getLatestVerified(company_id)` per recuperare P.IVA/website già verificati in Fase 1. Zero duplicazione di lookup.

## Sub-milestone M2 proposti

| M2.n | Scope | Durata stimata | Output |
|---|---|---|---|
| M2.1 | Questo design doc | fatto | PIPELINE_PHASES_v2.md |
| M2.2 | Estrarre `phase1_worker` dal monolite (wrapping) | 3-5 giorni | Phase 1 smoke test su 50 lead |
| M2.3 | `phase2/3/4 workers` | 3-5 giorni | End-to-end smoke test |
| M2.4 | `orchestrator` + CSV I/O | 2-3 giorni | `PIPELINE_MODE=phased` funziona |
| M2.5 | Misurazione A/B vs monolite su 200 lead | 1 giorno | Report delta costi + tempi |
| M2.6 | Deprecate `MasterPipeline.processCompany()` | 1 giorno | Flag `monolith` come fallback, non default |

## Rischi

1. **Ordine degli effetti**: nel monolite, alcune decisioni tra Stage 4 e 6 dipendono da stato condiviso in-memory. Estrarre ogni fase richiede un'analisi riga-per-riga del metodo da 943 righe prima di spezzare.
2. **BullMQ backpressure**: 4 code su 1 Redis richiedono tuning di `lockDuration` per fase (Phase 1 ha job da 90s, Phase 2 da 20s — una singola lockDuration=180s è sovradimensionata per Phase 2 ma necessaria per Phase 1). Soluzione: lockDuration per-queue.
3. **Rollback path**: finché M2.6 non chiude, il monolite deve restare funzionante come fallback. Significa che il codice di Stage 1-6 viene **duplicato logicamente** (wrappato dai worker di Phase 1, e ancora presente in `MasterPipeline`) per ~2 settimane. Accettabile come costo transitorio.
4. **CSV I/O grande scala**: su 1.395 lead i CSV intermedi sono piccoli (~500KB cad). Su 100k lead servirebbe streaming. Non in scope v2.

## Non-obiettivi v2

- Non tocchiamo il `CostRouter` (rimane in Phase 1).
- Non tocchiamo `RdapValidator` (migrazione RDAP va in M4 backlog).
- Non cambiamo il formato del registry SQLite.
- Non cambiamo i prezzi LLM (M0 ha confermato che sono corretti).

## Decisione richiesta prima di iniziare M2.2

1. **OK al design dei 4 CSV prodotti?** (vedi sezione "Contratti CSV")
2. **OK al feature flag `PIPELINE_MODE=phased|monolith` per il rollback?**
3. **Phase 4 (LinkedIn Sniper) è obbligatoria o opt-in?** (il documento originale suggeriva opt-in — qui è tratta come step normale. Se opt-in, Phase 3 diventa terminale di default.)
