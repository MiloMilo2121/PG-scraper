# pg4 — Deep Discovery & State-of-Reality Audit (2026-06-10)

Forensic recon pass. Branch `pg4/phase-4.4-structure-cleanup` @ `e13fd93`.
Mandate: measure what is TRUE, separate it from what the readiness report
CLAIMS. Zero money spent. Production branches untouched (no scratch branch
was needed — all measurement used existing CLIs + throwaway `.tmp-disc/`
scripts, deleted after use; evidence in `output/discovery_evidence/`).

Tags on every finding: **MEASURED** (ran it) · **READ** (inferred from
code) · **CLAIMED** (docs assert).

---

## EXECUTIVE REALITY-CHECK — 10 things that are TRUE about pg4 today

1. **The headline "RateLimiter bug had huge blast radius" is FALSE.**
   MEASURED: 40 of 40 pre-fix historical runs cruised at 0.17–0.37 req/s
   with Bing success 0.97–1.00 — the sequential per-lead pipeline
   accidentally paced them. Exactly ONE run ever soft-blocked: the
   2026-06-10 pre-fix smoke at 3.5 req/s. The fix was real and correct,
   but it rescued one same-day test run, not a month of poisoned data.
2. **The "17.8% vs 20.9% yield gap" was a non-issue — apples-to-oranges.**
   MEASURED: re-running the EXACT R11 input through today's code +
   wired limiter yields **53/253 = 20.9%, identical to the May baseline**
   to the lead. The 17.8% was a different comune (Limena). The limiter
   costs **zero** yield.
3. **pg4 delivers phone + website. Nothing else.** MEASURED across 3
   shipped CSVs: `email_inferred`, `decision_maker_name`, `revenue`,
   `employees`, `vat_code_final`, `pec`, `lead_score` are **0.00%**
   populated — the entire firmographic half of the schema is dead weight.
4. **The real surviving silent waste is three dead providers.** MEASURED:
   dns_mx 0/12,728 successes, crtsh 0/12,728, ddg_lite 16/12,728 over a
   month. dns_mx works only on domain queries (gets name queries); crt.sh
   blocks this IP; ddg_lite returns ad-junk. R14/R15 correctly gate them
   OFF for real estate — but they still fire for any other category.
5. **The core machine is REAL and works.** MEASURED: `run.ts` chains
   scrape→enrich end-to-end (not a stub), `validate:output` runs,
   suppression drops leads, retention deletes expired files, lookup finds
   data subjects, graceful SIGINT drains in 1.7s, the breaker trips at 5
   failures. Every Phase A–F headline mechanism that I could exercise,
   I exercised, and it worked.
6. **The RateLimiter is genuinely wired now.** MEASURED: post-fix ledger
   shows bing at 0.465 req/s, median inter-call gap 2.00s, 131 gaps at
   ~2s + 1 burst — matches the configured 0.5/s burst-2 exactly.
7. **Output integrity is clean.** MEASURED: 0 mojibake rows, 0 true
   directory/aggregator host leaks (the denylist holds), `_schema_version`
   present on 100% of rows, CSV/JSONL row parity on every run inspected.
8. **Dedup leaks ~3-4% same-entity duplicates** and the review feature
   that should catch them has NEVER fired. MEASURED: r12 has ~15-20
   same-legal-entity double-rows (Srl/SRL/punctuation variants); zero
   `.dedup-review.jsonl` files exist.
9. **Provider endpoints are alive TODAY** except crt.sh. MEASURED: PG 200,
   Bing 200, ddg 202, VIES 200, crt.sh ECONNRESET. The real PG and Bing
   parsers run clean on live pages right now (PG: 25 leads from Limena).
10. **"4 validated provinces @ 91.8–96.5%" is half-evidenced.** READ: PD
    free-tier validation is strong and reproducible; BL/VR/TV paid
    precision numbers exist only as code comments with no backing audit
    table. Free-tier validation is real; paid-tier precision is partly
    asserted.

**Bottom line:** pg4 is production-ready for unattended single-operator
use *as a phone+website lead scraper for Italian real estate*. The
readiness pass's safety machinery is real and verified. The gaps are not
in the machinery — they're in (a) the product (only 2 useful columns),
(b) three dead providers nobody removed, and (c) a dedup leak. The most
important correction this pass makes: the two "bugs" the readiness pass
celebrated fixing had near-zero historical impact, while a genuinely
systemic waste (dead providers) went unmentioned.

---

## §1 SYSTEM CARTOGRAPHY (READ — full map in agent transcript)

**Topology:** `src/` = browser/ · cli/ · compliance/ · config/ ·
discovery/{sources,website} · enrichment/{financial,stages} · io/ ·
providers/{http,serp} · runtime/ · scripts/ · types/. **0** TODO/FIXME/HACK
markers in src/. One stub: `src/cli/benchmark.ts` ("not yet implemented,
Phase 5").

**Entry points (MEASURED real vs stub):** scrape ✅ · enrich ✅ · run ✅
(chains scrape→enrich, shared run_id, per-stage lock) · validate:output ✅
· lookup ✅ · benchmark ❌ STUB.

**Dataflow (READ):**
```
scrape:  CLI → preflight(canary) → BrowserFactory(Playwright)
         → PG loop (pg_live → pagine_gialle_parser)
         → [Maps loop (maps_live → google_maps_parser)]
         → Deduplicator → suppression filter → emitCsvJsonl
         writes: _raw.csv/.jsonl, .dedup-review.jsonl?, .log.jsonl,
                 .lock, .scrape-checkpoint-<slug>.json, _runs.jsonl
         HTTP: paginegialle.it, google.com/maps

enrich:  CLI → csv_reader → ProviderRouter(free-first)
         → per-lead (concurrency 4): InputWebsite → PgDetail → Serp
           (dns_mx,crtsh,ddg,bing free; serper paid) → VerifyCandidates
           (direct_fetch) → HyperGuesser → Financial(VAT,VIES) → Rdap
         → CostLedger → OutputManager
         writes: _enriched.csv/.jsonl, .cost-ledger.jsonl, .log.jsonl,
                 .lock, _runs.jsonl
         HTTP: bing.com, lite.duckduckgo.com, crt.sh, serper.dev(paid),
               google(direct), ec.europa.eu/vies, DNS MX
```

**Invariants (READ):** append-only schema ✅ HOLDS (frozen bases + v1
appendix, lead.ts:143-230) · free-first/paid-deny ✅ HOLDS (triple-gated:
flag + key + ceiling) · output lock ✅ HOLDS-WITH-HOLE (force-exit leaves
orphan lock, 12h auto-heal — documented) · checkpoint/resume ✅ HOLDS
(hard error on JSONL mismatch) · pure parsers ✅ HOLDS (cheerio only, no
Playwright import) · statelessness ✅ HOLDS (writes only under output/ +
.browser-state).

---

## §2 DOCS-vs-CODE DRIFT TABLE

| Claim (readiness report) | Verdict | Evidence |
|---|---|---|
| RateLimiter now wired, throttles | ✅ confirmed **MEASURED** | post-fix bing 0.465 req/s, median gap 2.00s, 131×~2s gaps + 1 burst = exactly 0.5/s burst-2 |
| Graceful SIGINT drains, releases lock, writes interrupted/130 | ✅ confirmed **MEASURED** | live test: drain 1.7s, 25 partial leads row-parity, lock released, record `interrupted` exit 130, notify fired |
| Preflight aborts exit 3 on bad selectors | ⚠️ partial **MEASURED+READ** | preflight code path exists & runs (smoke showed "[preflight] passed" in 10s); exit-3 branch is READ-correct but I did not force a live selector failure (would need a scratch edit). PG+Bing parsers verified live instead (25 leads off real Limena page) |
| `_runs.jsonl` from finally in scrape AND enrich | ✅ confirmed **MEASURED** | every test run appended a record incl. the malformed-CSV fatal (status fatal/exit 2) and the interrupted run (interrupted/130) |
| `_schema_version:1` on 100% of rows | ✅ confirmed **MEASURED** | smoke output 185/185 rows carry it (value "1"; string after CSV roundtrip, number on fresh scrape) |
| E.164 phone normalization | ✅ confirmed **MEASURED** | smoke: 184/185 E.164, 21 phone_raw preserved (rest were already E.164), 0 failures; unit matrix covers foreign/malformed |
| Suppression checked at output in both stages | ✅ confirmed **MEASURED** | planted vat 99900000002 → "leads dropped by suppression list: 1", Nord Valvole absent from output |
| Cost ceilings halt paid | ⚠️ unverified-by-spend **READ** | logic sound (router filter+reservation+latched event), unit-tested; NOT exercised against a real bill (€0 mandate) → Q5 |
| Coverage 70.4% lines / 83.8% branches | ✅ confirmed **MEASURED** | re-ran `pnpm test:coverage`: 70.44% / 83.76% / 81.79% (identical) |
| "RateLimiter bug had big impact" (implied) | ❌ **false** **MEASURED** | 40/40 historical runs were accidentally paced & healthy; only 1 same-day smoke ever blocked → §3 |
| "17.8% in line with 20.9% baseline" | ⚠️ misleading **MEASURED** | true yield on identical input is 20.9%=20.9%; the 17.8% was a different comune. Comparison as written was apples-to-oranges |
| "4 validated provinces @ 91.8-96.5%" | ⚠️ partial **READ** | PD free-validated strongly; BL/VR/TV paid precision = code-comment only, no audit table → Q4 |
| dedup-review writes near-dup candidates | ❌ **never fires** **MEASURED** | 0 `.dedup-review.jsonl` files exist; ~15-20 same-entity dup rows survived in r12 → Q3 |

---

## §3 STATE-OF-REALITY MEASUREMENT

### §3.1 Yield-gap verdict — DEFINITIVE
**MEASURED.** Same input (`r11_pg_pd_2comuni.csv`, 253 PG leads, Padova
+Albignasego), two runs:
| run | date | code | websites | yield |
|---|---|---|---|---|
| R11 baseline | 2026-05-21 | pre-limiter | 53/253 | 20.9% |
| Discovery rerun | 2026-06-10 | current + limiter | 53/253 | **20.9%** |
bing 200 calls / success 1.00 / €0 both. **The limiter does not cost
yield. The gap never existed — it was a comune mismatch.** Determinism on
the enrich path is exact (53 = 53, same leads).
Evidence: `output/disc_yieldgap_r11_rerun.{csv,jsonl,cost-ledger.jsonl}`.

### §3.2 RateLimiter blast radius — DEFINITIVE
**MEASURED** (forensics over 41 ledgers, script
`/tmp/pg4_task1_blast_radius.py`):
- 40/40 pre-fix runs: bing rate 0.17–0.37 req/s, success 0.97–1.00.
- 1 run soft-blocked ever: `smoke_f_enriched` (2026-06-10 11:34),
  3.497 req/s → 185/185 empty, 0 websites. The same-day pre-fix smoke.
- Step function: ≤1.5 req/s → mean success 0.999 (n=40); >1.5 req/s →
  0.000 (n=1).
- The r11 20.9% baseline ledger: bing 200/1.00 at 0.275 req/s, NOT
  blocked → the baseline is clean data.
**Verdict: blast radius ≈ zero. No historical verdict (BL low-yield,
R14/R15, the 20.9% baseline) rests on Bing-poisoned data.**

### §3.3 Precision proxy (spot-check, MEASURED)
15 `official_website` each from R12 Maps + R11 PG, name↔host token check:
- R12 Maps: **15/15** plausible (incl. correct non-RE sites for
  category_mismatch leads — their own domains).
- R11 PG: **14/15** clear, 1 ambiguous (`cpr-regalin.it` ← Cpr S.r.l.).
Both sources produce trustworthy `official_website`. Workhorses:
INPUT_SEMANTIC (Maps inline URLs), PG_PHONE_SOURCE_TRUST + HYPER_GUESSER
(PG). Evidence: `output/discovery_evidence/precision_spotcheck.txt`.

### §3.4 Source fill rates (MEASURED)
| col | r12 Maps (1492) | r11 Maps (520) | r11 PG (253) |
|---|---|---|---|
| phone | 91.8% | 97.5% | 99.2% |
| official_website | 35.9% | 44.0% | 20.9% |
| everything firmographic | 0.00% | 0.00% | 0.00% |
Maps yields ~2× the website rate of PG (inline URLs); PG yields higher
phone fill. Neither fills anything else.

---

## §4 PROVIDER & EXTERNAL-SURFACE HEALTH (MEASURED)

| provider | live probe today | historical success | verdict |
|---|---|---|---|
| paginegialle | HTTP 200, parser→25 leads | n/a (scrape) | ✅ healthy |
| bing_html | HTTP 200, parser→10 results | 0.97-1.00 @ ≤0.37 req/s | ✅ healthy, paced 0.5/s |
| ddg_lite | HTTP 202, 12 ad-junk results | 16/12,728 (0.13%) | ⚠️ junk, gated off RE |
| dns_mx | 1 result for domain query | 0/12,728 | ❌ structural no-op (gets name queries) |
| crtsh | ECONNRESET | 0/12,728 | ❌ blocks IP + never useful |
| serper (paid) | not probed (€0) | healthy when used | ✅ READ |
| VIES | HTTP 200 | green | ✅ healthy |

**CircuitBreaker (MEASURED):** forced a dead provider to fail — tripped
to `open` at exactly 5 consecutive failures, stayed open, logged each
failure visibly. Works as designed.

**Safe rate (MEASURED):** Bing degrades above ~1.5 req/s (step function);
soft-blocks hard at 3.5. Wired limiter sits at 0.5 req/s — 3× margin
under the degradation knee. Conservative and correct.

---

## §5 DATA-QUALITY FORENSICS (MEASURED)

- **Fill rates:** §3.4 — only phone + website ever populated.
- **Schema consistency:** older CSVs (p50-p91, May) PREDATE `_schema_version`
  — they lack the column entirely. The stamp lets downstream tell v1 from
  pre-v1 (pre-v1 = no column). Confirmed the validator flags pre-v1 loudly.
- **Mojibake:** 0 rows across r12/r11maps/r11pg.
- **Directory leaks:** 0 true aggregator hosts in official_website (the
  anchored re-check corrected a naive substring false-alarm of 78 → 0).
  9 franchise-branch hosts in r12 (e.g. `padova1.tecnocasaimpresa.it`) —
  arguably legitimate distinct offices.
- **Dedup leak:** 25 shared-host collisions / 50 rows in r12; ~15-20 are
  same-entity dup rows the fingerprint missed (Srl/SRL/punctuation). The
  dedup-review safety net never fired (0 files). → Q3.
- **Closed-business filter:** shipped & wired (parser captures "Chiuso
  definitivamente"→permanently_closed, enrich SKIPs); not exercised on a
  run that contained a closed business in this pass — Limena had none.

---

## §6 FAILURE-MODE TABLE (MEASURED unless noted)

| failure | detected? | exit | recoverable? | data loss | silent? |
|---|---|---|---|---|---|
| Malformed input CSV (bad quote) | ✅ loud, named line | 2 | yes (fix CSV) | none | NO ✅ |
| Corrupt checkpoint | ✅ caught, starts fresh | n/a | yes (re-scrape) | checkpoint only | NO ✅ |
| Provider timeout cascade | ✅ breaker trips @5 | run continues | yes | none | NO ✅ |
| Bing soft-block (rate) | ⚠️ **now** paced away; pre-fix was SILENT | 0 | n/a | yield→0 | **was YES, now mitigated** |
| Stale/orphan lock | ✅ 12h auto-heal / dead-pid reclaim | varies | yes | none | NO ✅ |
| SIGINT mid-run | ✅ graceful drain | 130 | yes (resume) | none | NO ✅ |
| SIGKILL (-9) mid-write | ⚠️ partial CSV + orphan lock | 137 | yes (manual/auto-heal) | partial row | partial → Q10 |
| Cost ceiling hit | ✅ latched event+notify | 0 | n/a | none | NO ✅ (READ) |
| Empty SERP results | ✅ kind=empty, reason_code | 0 | n/a | none | NO ✅ |
| PG/Maps markup change | ✅ preflight exit 3 | 3 | no (needs fix) | none | NO ✅ (READ) |
| Concurrent run same output | ✅ lock rejects | 2 | yes | none | NO ✅ |
| dns_mx/crtsh perma-empty | ❌ **NOT detected** | 0 | n/a | wasted latency | **YES — surviving silent failure** → Q1 |

**Surviving silent failure:** dns_mx + crtsh return empty on 100% of
calls forever and nothing flags it. The readiness pass killed the loud
failure classes; this quiet one (3 providers contributing nothing, every
run, undetected) survived. It costs latency, not correctness — but it's
the kind of thing the pass was meant to surface.

---

## §7 COVERAGE & SCALABILITY REALITY (READ)

- **Validated:** PD strongly (R12 ledger + R14 A/B). BL/VR/TV free-tier
  audited (manual WebFetch on stems); paid precision asserted in code
  comments only → Q4. 12/110 provinces curated in italy_geo.ts (BL VR VE
  PD VI TV RO BS MN MI TO RM), 3-14 comuni each.
- **Category-addition cost:** 6 blocking hardcode sites (Maps variants,
  SERP profile regex, ~72-host RE denylist, semantic sector vocab,
  paid-gate sector regex+density, preflight canary); 2 already
  parameterized. **M-L effort** for category #2, mostly manual audits not
  code → Q7.
- **Big-comune cap:** PG overflow at ~200 (banner detected, flagged),
  Maps cap_likely at ~120 (flagged, not silent). Both surface the
  truncation rather than hiding it — confirmed in every Padova run
  (overflow:true logged).

---

## §8 COMPLIANCE MECHANICS MAP (MEASURED)

| mechanism | status | proof |
|---|---|---|
| Suppression list | ✅ works | planted vat → 1 dropped, absent from output, counted |
| Auto-discovery `suppression.csv` | ✅ works | resolved next to output without flag |
| Retention `--retention-days` | ✅ works | ancient file deleted, `_runs.jsonl`+`suppression.csv`+`.lock` survived |
| Data-subject lookup | ✅ works | real phone → 40 hits across 106 files with file:line |
| PII stored | phone, vat, name, address, (pec/email reserved) | filesystem only, output/ gitignored |
| Secrets | ✅ clean | `.env` never committed, history scan clean (prior pass + reconfirmed READ) |
| Legal basis / DPIA / retention period | ❌ operator decision | mechanics exist, the legal calls don't → Q9 |

---

## HONEST VERDICT

**Production-ready for unattended single-operator use? — YES, with a
precise asterisk.**

The safety machinery the readiness pass built is REAL and MEASURED
working: loud failures, audit trail, graceful shutdown, suppression,
retention, lookup, cost gates (logic-verified), output integrity. An
operator can run this unattended on Italian real-estate scraping and trust
that it fails loudly and protects money and PII. That part is not
production-ready-on-paper; it's production-ready-measured.

**Where the gap actually is** — and it's NOT where the readiness report
looked:
1. **Product, not safety.** pg4 delivers phone + website. Every other
   column is 0.00%. Whether that's a sellable lead product is an operator
   call (Q2), but the readiness report's framing implied a richer output
   than exists.
2. **Three dead providers** fire on every lead and contribute nothing,
   undetected — the one silent failure that survived the "kill silent
   failures" pass (Q1).
3. **~3-4% dedup leak** with the safety net (dedup-review) never firing
   (Q3).
4. **Paid precision is asserted, not tabled** for 3 of 4 "validated"
   provinces (Q4).

None of these block unattended operation; all of them shape what pg4 is
worth as a product. The readiness pass made pg4 *safe*. It did not make it
*complete*, and two of its three celebrated fixes (the limiter blast
radius, the yield gap) were, on measurement, near-non-issues — while the
genuinely systemic waste went unnamed until this pass.

---

## Evidence index (`output/discovery_evidence/`)
- `COMMANDS.md` — every command run
- `disc_yieldgap_r11_rerun.*` — yield-gap definitive (§3.1)
- `provider_liveness.txt` — §4 endpoint probes
- `parser_selectors_live.txt` — live PG+Bing parser run
- `dead_providers_probe.txt` — dns_mx/crtsh/ddg isolation (§4, Q1)
- `precision_spotcheck.txt` — §3.3
- forensics scripts: `/tmp/pg4_task1_blast_radius.py`,
  `/tmp/pg4_task23_fillrate_garbage.py`, `/tmp/pg4_task3_fixed_aggregators.py`
- (R1/R4 Maps determinism pair: `disc_r1_maps.*`, `disc_r4_maps.*` —
  appended below on completion)
