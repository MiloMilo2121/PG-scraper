# Cleanup — decisioni che aspettano Marco (NON eseguite)

*Marco: "make the best decision … wait until I'm home … don't delete anything, just put it
inside a folder." Quindi: il lavoro sicuro+reversibile è FATTO (merge lead + organizzazione).
Le azioni qui sotto sono **irreversibili o grosse** → restano in attesa. **Nulla è stato
cancellato. Nulla è stato spostato dagli originali.** Sotto, i comandi pronti — tutti in forma
"sposta in una cartella", mai `rm`.*

## Stato attuale (verificato)
- **pg4 NON dipende da pg1/pg3**: zero import a runtime, CI solo-pg4, nessun workspace al root.
  Solo riferimenti in commenti ("adapted from pg3/…"). pg4 builda/gira/passa i test da solo.
- **Codice pg1/pg3 tracciato in git**: pg3 568 file, pg1 58 → recuperabile dalla history.
- **Dati pg3 ~1.2GB**, ma quasi tutto è cache/deps NON tracciata → un `rm` li perderebbe.
  Il **dato lead reale (~35M)** è già stato consolidato in `leads/_MASTER/` (35.222 uniche).

## I 1.2GB di pg3, scomposti
| voce | peso | natura |
|---|---|---|
| testenv | 696M | ambiente test → rigenerabile |
| node_modules | 221M | deps → rigenerabile (`pnpm i`) |
| temp_profiles | 195M | cache browser → rigenerabile |
| logs / dist | ~9M | log/build → rigenerabile |
| data + output (lead) | ~55M | **già consolidato in leads/_MASTER/** |

## DECISIONE 1 — archiviare pg1/pg3 (sposta in cartella, NON cancella)
Opzione consigliata, reversibile, niente `rm`:
```bash
cd /Users/marcomilanello/Documents/_PROGETTI_SOFTWARE/PG_Scraper_Omega
mkdir -p _LEGACY
git mv pg1 _LEGACY/pg1     # se tracciati; preserva history
git mv pg3 _LEGACY/pg3
# i dati untracked (testenv, node_modules, temp_profiles, output) NON seguono git mv:
mv pg1/* _LEGACY/pg1/ 2>/dev/null; mv pg3/* _LEGACY/pg3/ 2>/dev/null  # sposta il resto
git commit -m "chore: archive pg1/pg3 into _LEGACY (superseded by pg4)"
```
Effetto: workspace pulito, dashboard inequivocabilmente su pg4, **tutto recuperabile**.

## DECISIONE 2 — alleggerire i ~1.1GB di cache (sposta in ~/junk/, NON cancella)
Regola Marco: tutto va in `~/junk/`, mai cestino/`rm`.
```bash
mkdir -p ~/junk/pg-legacy-cache
mv pg3/testenv ~/junk/pg-legacy-cache/pg3_testenv
mv pg3/node_modules ~/junk/pg-legacy-cache/pg3_node_modules
mv pg3/temp_profiles ~/junk/pg-legacy-cache/pg3_temp_profiles
# rigenerabili in pg3 con `pnpm i` se mai servisse riaccenderlo
```

## DECISIONE 3 — 3 wrapper pg3-only (se ti servono, li riporto in pg4)
pg4 NON ha: `mcp_server.ts` (espone il motore come MCP) · `agent_tools/` (tool per agente) ·
`LANDING/` (pagina html demo, già sostituita dalla dashboard). Sono wrapper sottili,
re-implementabili in poche ore. Default: restano nell'archivio (recuperabili). Dimmi se
vuoi MCP/agent_tools in pg4 e li porto puliti.

## DECISIONE 4 — push
Il consolidatore + i doc (no PII) sono pronti per il push. La cartella `leads/` è gitignored
(PII) → non finirà mai su GitHub. Le DECISIONI 1–2 (archivio/cache) NON sono nel commit.

---
*Tutto qui è "in attesa". Quando sei a casa: dimmi quali decisioni eseguire e le faccio in
ordine.*
