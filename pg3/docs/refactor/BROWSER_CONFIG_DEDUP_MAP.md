# Browser And Config Dedup Map

Status date: 2026-04-28

Purpose: identify remaining browser/config duplication after `ua_db` was moved
to `src/shared-runtime/browser/ua_db.ts`.

## Current Shared State

| Module | Current state | Action |
|---|---|---|
| `src/shared-runtime/browser/ua_db.ts` | Canonical user-agent database | Keep |
| `src/scraper/core/browser/ua_db.ts` | Re-export shim | Keep until import paths are migrated |
| `src/enricher/core/browser/ua_db.ts` | Re-export shim | Keep until import paths are migrated |
| `src/scraper/config.ts` | Re-export shim to shared runtime config | Keep |
| `src/enricher/config.ts` | Re-export shim to shared runtime config | Keep |

## Browser File Comparison

| Module | Scraper/enricher comparison | Shared candidate | Risk | Priority |
|---|---|---|---|---|
| `genetic_fingerprinter.ts` | Identical | `src/shared-runtime/browser/genetic_fingerprinter.ts` | Medium: imports and singleton behavior need validation | High |
| `human_behavior.ts` | Identical | `src/shared-runtime/browser/human_behavior.ts` | Low: pure behavior helper | High |
| `proxy_manager.ts` | Identical | `src/shared-runtime/browser/proxy_manager.ts` or route into `CostRouter`/proxy tier | Medium: singleton + env/config behavior | High |
| `request_interceptor.ts` | Identical | `src/shared-runtime/browser/request_interceptor.ts` | Medium: request routing side effects | Medium |
| `tor_browser.ts` | Identical | `src/shared-runtime/browser/tor_browser.ts` | High: singleton, Tor control port, scraper/enricher imports | Medium |
| `cookie_consent.ts` | Differs | No immediate move | Low/medium: compare heuristics first | Medium |
| `evasion.ts` | Differs | No immediate move | High: stealth scripts diverged | Low until audited |
| `factory_v2.ts` | Differs | No immediate move | High: launch/proxy/memory behavior differs | Low until audited |
| `human_mouse.ts` | Differs | No immediate move | Medium: behavior timing may be target-specific | Medium |

## Scraper-Only Browser Modules

| Module | Reason to keep local | Action |
|---|---|---|
| `diagnose_browser.ts` | Diagnostic script/tooling | Keep local |
| `factory_v9.ts` | Scraper-specific newer browser factory | Keep local |
| `proxy_manager_v9.ts` | Tested scraper V9 proxy behavior | Keep local; already shares `ProxyTier` |
| `request_interceptor_v9.ts` | Scraper-specific V9 routing | Keep local |
| `xhr_interceptor.ts` | Scraper-specific XHR capture, unit-tested | Keep local |

## Cross-Boundary Import Risk

`src/enricher/core/discovery/searxng_provider.ts` imports
`../../../scraper/core/browser/tor_browser`. This is the clearest remaining
runtime boundary leak.

Proposed migration:

1. Move identical `tor_browser.ts` into `src/shared-runtime/browser/tor_browser.ts`.
2. Replace scraper/enricher files with re-export shims.
3. Update `searxng_provider.ts` to import from shared runtime.
4. Add/extend a boundary test to reject `enricher -> scraper/core/browser`.

Do not do this inside the MCP/runtime lockdown commit; it deserves its own
focused commit because Tor runtime has external service assumptions.

## Next Dedup Order

1. `human_behavior.ts`: lowest risk identical helper.
2. `genetic_fingerprinter.ts`: identical but larger; add unit import boundary check.
3. `request_interceptor.ts`: identical but request side effects need tests.
4. `proxy_manager.ts`: identical, but config/proxy singleton behavior needs proxy tests.
5. `tor_browser.ts`: identical, but high operational risk due to Tor dependency.
