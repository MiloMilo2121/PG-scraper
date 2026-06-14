# Plan B — official Italian company-data sources, on the redistribution axis

*Prepared in parallel so the next step is ready whatever the Openapi ToS says.
Web-researched 2026-06-14, €0, no code. Tags: [PUB] publicly stated · [CONFIRM]
must verify in the contract/license tier.*

## The reframe that sharpens the clause you're about to read
"Can I redistribute the data?" is the wrong granularity. As a LICENSED InfoCamere
reseller, Openapi's whole business is selling official data for commercial use —
"database enrichment / marketing" is its stated use case [PUB]. The real question
splits by pg4's PRODUCT MODEL:

| pg4 product model | what the data does | license risk |
|---|---|---|
| **Enrichment tool** — customer brings their own leads, pg4 fills fields (VAT, PEC, revenue, decision-maker) from Openapi | data enriches the CUSTOMER's records | LOW — this is the reseller's advertised use ("database enrichment") |
| **List factory** — pg4 SELLS the company lists themselves (the Expansionist's "all 68.31 in PD with PEC") | the records ARE the product | HIGH — onward REDISTRIBUTION of the raw records; needs an explicit license tier |

So when you read the Openapi PDF (or email them), ask the model-specific question,
not the generic one. The enrichment model is almost certainly fine; the list-resale
model is the one that needs the explicit grant.

## The source landscape (all complete sources are paid — by market construction)
| source | what it is | redistribution-in-SaaS | covers ditte individuali? | cost | node to resolve |
|---|---|---|---|---|---|
| **Openapi** | Licensed InfoCamere reseller; ANCIC member, code-of-conduct [PUB] | enrichment: likely OK [PUB]; list-resale: license tier [CONFIRM] | ✅ full (InfoCamere Registro: 6M cos, 5M PEC) [PUB] | self-serve per-call (IT-pec €0.03, IT-advanced €0.10); free tier | read the redistribution/commercial-use clause for YOUR model |
| **InfoCamere direct** (registroimprese.it; `accessoallebanchedati.registroimprese.it/abdo/api`) | THE authoritative operator (Chambers of Commerce consortium) | open-data layer = **CC-BY 4.0 → redistributable w/ attribution** [PUB]; per-company commercial layer = contract [CONFIRM] | ✅ full + authoritative | open-data free; commercial per-doc / contract | which layer has the fields you need; the commercial contract terms |
| **Cerved / Atoka (SpazioDati)** | Official Registro distributor; Atoka = 6M cos, REST by VAT [PUB] | enterprise license — redistribution negotiable [CONFIRM] | ✅ full | custom/enterprise (no public price → likely higher) [PUB] | custom quote + explicit redistribution grant |
| **CRIF / CRIBIS** | Major business-info group | enterprise license [CONFIRM] | ✅ full | enterprise | custom; overkill for pg4's stage |
| **PDND** (Piattaforma Digitale Nazionale Dati) | National data platform | mostly PA-to-PA e-services | — | — | not aimed at private SaaS — skip |
| ~~free scraping~~ | — | — | — | — | **measured exhausted** (scraping_pass_report.md) |

## Recommendation (the two-branch next step)
1. **Openapi stays the best FIRST option** — self-serve, cheapest, free tier, already
   InfoCamere-sourced + ANCIC-compliant (so the provenance/moat story holds: it IS
   official data, just resold). The €0 free-tier slice is specced
   (`openapi_slice_comparison.md`). The ONLY gate is the redistribution clause for
   YOUR product model.
2. **If Openapi's clause permits your model** → run the €0 slice, decide on the numbers.
3. **If it forbids / is ambiguous for the list-resale model** → two fallbacks, in order:
   a. **Ask Openapi sales for a redistribution-permitted tier** — resellers usually
      HAVE one; it's literally their business. Often just a different contract, same API.
   b. **InfoCamere direct** — authoritative; check whether the CC-BY open-data layer
      already carries the fields you need (redistributable free!), else their
      commercial API contract. Heavier onboarding, but the cleanest provenance.
   c. **Cerved/Atoka** only if you reach enterprise scale (custom price, overkill now).

## The exact questions to ask (clean yes/no)
To Openapi (PDF §commercial-use/redistribution, or sales email):
> "Posso usare i dati delle vostre API (anagrafica, PEC, bilanci, rappresentante
> legale) (a) per ARRICCHIRE i record che i miei clienti caricano nel mio SaaS, e
> (b) per VENDERE liste di aziende estratte dai vostri dati come prodotto del mio
> SaaS a clienti terzi? Quale tier/licenza copre ciascuno dei due usi?"

To InfoCamere (if fallback):
> "Il layer open-data CC-BY del Registro Imprese include P.IVA, ATECO, forma
> giuridica, PEC per azienda? E qual è il contratto per l'accesso commerciale ai
> dati per-azienda (bilanci, rappresentante legale) da rivendere in un SaaS?"

## Honest confidence
[PUB] = stated on the providers' public pages (Openapi=InfoCamere reseller/ANCIC;
InfoCamere CC-BY on open-data; Atoka=Cerved/Registro distributor). [CONFIRM] = the
actual redistribution grant per tier — NONE of these is readable without the contract
/ a sales answer. This doc narrows WHICH question to ask and in WHAT ORDER; it does
NOT assert a license ruling I couldn't verify. The next step is one clause / one email.
