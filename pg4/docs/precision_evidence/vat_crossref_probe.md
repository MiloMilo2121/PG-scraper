# Gap #1 free cross-reference — measured, adds 0 beyond VIES

*Phase C of the scraping pass. Sampled against the source BEFORE building anything
(the discipline). Result killed the idea — correctly. 2026-06-14, €0.*

## The idea
For the FRAGILE gap (VAT ~60% footer-unconfirmable @0.6, because VIES covers only
intra-EU-registered VATs), use a FREE registry-sourced site to cross-confirm: query
the footer VAT on the site, get the registry NAME, name-match vs the company. Where
two independent sources agree → confidence rises. The free path to gap #1.

## The measurement (15 real PD companies w/ VAT + name, fatturatoitalia name-match vs VIES)
| outcome | count / 15 |
|---|---|
| VIES-confirmed (name match) | 8 |
| fatturatoitalia-confirmed (name match) | 1 |
| **fatturatoitalia adds confirmation BEYOND VIES** | **0** |
| fatturatoitalia name MISMATCH (would flag) | 1 |
| neither could confirm | 7 |

**The cross-reference adds ZERO precision beyond VIES.** The one fatturatoitalia
match was already VIES-confirmed (Leta S.r.l.). The 7 "neither" are S.a.s./S.n.c./
sole-proprietor-shaped firms with NO fatturatoitalia page at all.

## Root cause (why it can't work)
fatturatoitalia only has pages for companies that FILE bilanci (società di capitali).
That set OVERLAPS the companies VIES already confirms, and EXCLUDES the actual gap
(domestic non-filers). Sampled directly: a ditta-individuale VAT (Marengo,
00399020270) returns fatturatoitalia's GENERIC page — title "FatturatoItalia.it - Il
fatturato di tutte le aziende Italiane", the company name appears NOWHERE. No page,
no name, no cross-ref. The free non-captcha source is structurally blind to the gap.

## The source that WOULD cover the gap is captcha-gated
ufficiocamerale.it + infoimprese.it pull from the Registro → they DO have pages for
all companies incl. ditte individuali. But their SEARCH is reCAPTCHA-protected (POST
form with `recaptchaResponse` + token; infoimprese page carries g-recaptcha). You
cannot look up a company by VAT/name programmatically without solving a captcha —
the exact path the owner + the council rejected (dirty provenance for a sellable SaaS).
ufficiocamerale's per-company pages render fine via Playwright (Cloudflare passes),
but you can't REACH a specific one without the gated search.

## Conclusion
The free, captcha-free cross-reference cannot lift gap #1: the non-gated source
(fatturatoitalia) is filer-only and redundant with VIES; the gap-covering sources
(ufficiocamerale/infoimprese) are reCAPTCHA-gated. Gap #1 closes only via the
official paid API (Openapi — deferred for budget) or captcha-solving (rejected).
This loops back to the council verdict. NOT built — a redundant tier adding 0 with
maintenance cost is exactly the anti-pattern. (6th time sampling-against-source
stopped a plausible-but-wrong change before it shipped.)
