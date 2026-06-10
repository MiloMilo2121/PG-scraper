# pg4 — Discovery Questions Ledger (2026-06-10)

Ranked questions surfaced by the forensic discovery pass. Each: the
decision, why it matters, what's needed to answer, a recommended default,
impact rank. Tags: **MEASURED** (we ran it), **READ** (inferred from
code/docs), **CLAIMED** (docs assert it).

---

## BLOCKER

### Q1 — Are dns_mx / crtsh / ddg_lite worth keeping in the catalog at all?
**MEASURED.** Across all 41 historical ledgers: dns_mx = 0 successes in
12,728 calls, crtsh = 0 in 12,728, ddg_lite = 16 in 12,728 (0.13%). In
isolation today: dns_mx returns a result **only for a domain-shaped
query** (`immobiliare.it` → 1) but the SerpStage hands it **company-name
queries** → structural 0 yield; crt.sh returned ECONNRESET / 0 (endpoint
flaky/blocking from this IP); ddg_lite returns 12 results but they are
ad-redirect junk (`duckduckgo.com/y.js?ad_domain=…`) that the dedup/filter
strips.
- **Why it matters:** R14/R15 already gate these OFF for real-estate
  ("0 recall loss" — **MEASURED correct**, confirmed by the A/B and by
  this pass). But they remain in the catalog and fire on every
  non-real-estate category, adding latency and 0 value. This is the one
  genuinely systemic silent waste the readiness pass did NOT address.
- **To answer:** decide whether to (a) delete dns_mx/crtsh entirely,
  (b) fix dns_mx to receive domain candidates instead of name queries
  (it could be useful that way), (c) leave gated. ddg_lite needs an
  ad-result filter or removal.
- **Recommended default:** delete dns_mx + crtsh from the catalog
  (they have never produced a single useful result in a month of runs);
  keep ddg_lite gated. Re-evaluate dns_mx only if someone wires it to
  the HyperGuesser candidate domains.
- **Impact:** BLOCKER for any "add category #2" work — otherwise the new
  category inherits 3 dead providers firing per lead.

### Q2 — The entire firmographic half of the schema is 0.00% filled. Ship it or cut it?
**MEASURED.** In the 3 largest enriched CSVs (r12 1492 / r11 maps 520 /
r11 pg 253): `vat_code_final`, `pec`, `email_inferred`, `revenue`,
`employees`, `decision_maker_name`, `lead_score` are **literally 0.00%**
populated. Only `phone` (92-99%) and `official_website` (21-44%) carry data.
- **Why it matters:** the readiness report's own "known limitations"
  admitted email/decision_maker/revenue empty, but MEASURED reality is
  worse — it's the whole back half including `lead_score` and
  `vat_code_final` (despite a wired FinancialStage). A client CSV today
  delivers name + address + phone + maybe website. Nothing else.
- **To answer:** operator decides the product. Either (a) integrate the
  enrichment providers that fill these (DropContact email, a financial
  source for revenue/PIVA, a scorer for lead_score) — see the integration
  menu discussed earlier; or (b) cut the dead columns so the CSV stops
  promising data it never delivers.
- **Recommended default:** keep the columns (append-only contract) but
  add a one-line note in the operator playbook: "today pg4 delivers
  phone + website only; firmographic columns are reserved." Prioritize
  DropContact (email) as the first real filler — email is what makes the
  lead actionable for outreach.
- **Impact:** BLOCKER for "is pg4 a sellable lead product" — phone+website
  alone may or may not clear the bar depending on the client.

---

## HIGH

### Q3 — The dedup-review feature has never fired. Is dedup leaking same-entity rows?
**MEASURED.** Zero `*.dedup-review.jsonl` files exist anywhere — the
Phase-C near-duplicate review path has never produced output in a real
run. Yet r12 has 25 shared-host collisions / 50 rows, of which ~15-20 are
the SAME legal entity written twice ("Agedi Case S.r.l." / "Agedicase
S.r.l.", "Liviana Immobiliare S.R.L." / "Liviana Immobiliare"). The
deduper misses Srl/SRL/punctuation/name-variant matches when addresses
differ.
- **Why it matters:** ~3-4% duplicate leak in the flagship validated run.
  A client paying per-lead is double-charged; outreach hits the same
  agency twice.
- **To answer:** sample 50 multi-host rows across runs, measure true
  duplicate rate, decide if the token-sort review (which exists but never
  triggered because it only fires on exact token-set match) needs a
  fuzzier rule.
- **Recommended default:** lower the dedup-review trigger to also flag
  shared-registrable-host across different name-keys; keep it review-only
  (don't auto-merge). Quick win.
- **Impact:** HIGH — directly affects deliverable quality + per-lead billing.

### Q4 — Which provinces are actually precision-validated, and on what sample?
**CLAIMED vs READ.** Docs claim "4 validated provinces (BL/PD/VR/TV) @
91.8-96.5% paid precision." The category-coupling agent found: PD free
evidence is strong (R12 ledger + R14 A/B); VR/TV **free** audits are
detailed (manual WebFetch on 6-15 stems); but the **paid** precision
numbers (BL 91.8%, VR 75.9%, TV >85%) live only as **code comments** in
paid_evidence_gate.ts with no backing audit doc carrying TP/FP row counts
for BL and VR. There is no single doc tabulating all 4 provinces.
- **Why it matters:** "validated" is doing a lot of work in the readiness
  story. Free-tier validation is real and reproducible; paid-tier
  precision is partly asserted.
- **To answer:** publish the per-province paid audit tables (or re-run the
  audits) with explicit TP/FP counts, OR downgrade the language from
  "validated 91.8-96.5%" to "free-tier validated; paid-tier spot-checked."
- **Recommended default:** treat PD as fully validated, BL/VR/TV as
  free-validated + paid-spot-checked, until the audit docs are published.
- **Impact:** HIGH — governs how confidently the operator can quote
  precision to a client.

### Q5 — Cost ceilings were verified by READ, not by spending. Confirm with one tiny paid run?
**READ.** The per-lead and per-run ceiling logic in provider_router.ts is
sound on inspection (filter at 294/313-319, atomic reservation, latched
event) and unit-tested. But this discovery pass spent €0 by mandate, so
the ceilings were never exercised against a real Serper bill.
- **Why it matters:** the one safety mechanism that protects real money
  was not exercised end-to-end in this audit.
- **To answer:** one deliberate tiny paid run with `--run-cost-ceiling-eur
  0.02` on ~30 leads; confirm it halts at the cap and the ledger total
  never exceeds it.
- **Recommended default:** run it once before the first real paid client
  job; €0.02 is a rounding error.
- **Impact:** HIGH but cheap to close.

---

## MEDIUM

### Q6 — Preflight canary is hardcoded to one category/comune. New category = preflight blind spot?
**READ.** `PREFLIGHT_CANARY = {agenzie immobiliari, Padova}` is hardcoded.
A run for any other category still preflights against real-estate/Padova —
so it verifies PG/Maps markup is alive but NOT that the new category
returns results. Fine today (one category), a gap the moment category #2
ships.
- **Recommended default:** when category #2 is validated, move the canary
  to per-category config; until then, document that preflight only proves
  markup-liveness, not category-liveness.
- **Impact:** MEDIUM, tied to Q-category-pack.

### Q7 — Category #2 real cost: build the "category pack" or hardcode again?
**READ.** The coupling agent traced 6 blocking hardcode sites for a new
category (Maps variants, SERP profile regex, denylist ~72 RE-specific
hosts, semantic sector vocab, paid-gate sector regex+density, preflight
canary) + 2 already-parameterized (category_match tokens, province lists).
Estimated effort for category #2: **M-L** (1-2 weeks two operators with
parallel audits), most of it the manual denylist/sector audits, not code.
- **Recommended default:** ship category #2 hardcoded once to learn the
  real shape; extract the `CategoryPack` abstraction only when #3 is on
  the roadmap (avoid premature abstraction).
- **Impact:** MEDIUM — only bites when expanding beyond real estate.

### Q8 — crt.sh blocks this IP (ECONNRESET). Does it matter?
**MEASURED.** Live probe: crt.sh → ECONNRESET. Historically 0/12,728
success anyway. So no functional loss, but if crtsh is ever wanted it
needs a different access path (rate-limit, User-Agent, or the JSON API).
- **Recommended default:** subsumed by Q1 (delete crtsh).
- **Impact:** MEDIUM (LOW if Q1 deletes it).

---

## LOW / STANDING OPERATOR DECISIONS (carried from readiness report)

### Q9 — The 8 standing operator decisions remain open.
Deploy target · secrets manager · scheduler activation · GDPR legal basis
+ retention period · alert channel · SLA · next Maps categories ·
vitest 2→3 bump. All have conservative defaults already shipped; none
block unattended single-operator use. **READ** — unchanged by this pass.
- **Impact:** LOW individually; the GDPR legal-basis one is HIGH if pg4
  output is delivered to paying clients (mechanics exist — suppression,
  retention, lookup all MEASURED working — but legal basis is a human call).

### Q10 — SIGKILL mid-write leaves a truncated CSV + orphan lock. Acceptable?
**MEASURED (by design).** Graceful SIGINT drains cleanly (verified: 1.7s,
partial outputs, lock released, record interrupted/130). But SIGKILL (-9)
or power loss mid-write can leave a partial CSV and an orphan `.lock` —
the lock auto-heals after 12h or on next run if the pid is dead.
- **Recommended default:** accept it; document "if a run was -9'd, delete
  the stale .lock manually or wait for auto-heal." Already the documented
  behavior.
- **Impact:** LOW — rare, recoverable, documented.
