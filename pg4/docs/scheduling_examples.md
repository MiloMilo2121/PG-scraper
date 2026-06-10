# Scheduling pg4 — esempi pronti (NON attivi)

pg4 è scheduler-ready ma nessuno scheduler è installato di default
(decisione operatore — vedi `docs/decision_log.md`). I CLI non fanno
mai prompt interattivi e hanno exit code deterministici:

| code | significato |
|-----:|---|
| 0 | ok |
| 1 | partial (enrich con row errors) |
| 2 | fatal |
| 3 | preflight fallito (markup PG/Maps cambiato o IP bloccato) |
| 130 | interrotto (SIGINT/SIGTERM) |

Ogni run produce da solo: log file `<out>.log.jsonl`, record in
`<outdir>/_runs.jsonl`, notifica locale a fine run (NOTIFY=local).
Per run non presidiati conviene `LOG_FORMAT=json`.

## launchd (macOS) — esempio settimanale

Salva come `~/Library/LaunchAgents/com.axend.pg4.weekly-pd.plist`,
poi `launchctl load ~/Library/LaunchAgents/com.axend.pg4.weekly-pd.plist`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.axend.pg4.weekly-pd</string>
  <key>WorkingDirectory</key>
  <string>/Users/marcomilanello/Documents/_PROGETTI_SOFTWARE/PG_Scraper_Omega/pg4</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/pnpm</string>
    <string>run</string><string>run</string><string>--</string>
    <string>--category</string><string>agenzie immobiliari</string>
    <string>--province</string><string>PD</string>
    <string>--maps</string>
    <string>--coverage</string><string>full</string>
    <string>--fresh</string>
    <string>--out</string><string>output/weekly_pd</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LOG_FORMAT</key><string>json</string>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardErrorPath</key>
  <string>/tmp/pg4-weekly-pd.stderr.log</string>
</dict>
</plist>
```

Nota: verifica il path di pnpm con `which pnpm` (Homebrew Apple Silicon:
`/opt/homebrew/bin/pnpm`).

## cron — riga equivalente

```cron
# Lunedì 03:00 — campagna PD settimanale (free only, no paid)
0 3 * * 1 cd /Users/marcomilanello/Documents/_PROGETTI_SOFTWARE/PG_Scraper_Omega/pg4 && LOG_FORMAT=json /usr/local/bin/pnpm run run -- --category "agenzie immobiliari" --province PD --maps --coverage full --fresh --out output/weekly_pd >> /tmp/pg4-weekly-pd.cron.log 2>&1
```

## GitHub Actions — workflow schedulato (DISATTIVATO)

Salvare come `.github/workflows/scheduled-scrape.yml` SOLO quando si
decide di attivarlo. Caveat seri prima di farlo:

- i runner GitHub hanno IP datacenter → Maps/PG li bloccano più
  facilmente del laptop; aspettarsi più preflight failure (exit 3);
- i secrets (.env) vanno migrati a GitHub Secrets;
- gli output vanno uploadati come artifact (i runner sono effimeri).

```yaml
# name: scheduled-scrape
# on:
#   schedule:
#     - cron: '0 3 * * 1'   # lunedì 03:00 UTC
#   workflow_dispatch: {}
# jobs:
#   weekly-pd:
#     runs-on: macos-latest
#     timeout-minutes: 120
#     steps:
#       - uses: actions/checkout@v4
#       - uses: pnpm/action-setup@v4
#         with: { version: 10.33.2 }
#       - uses: actions/setup-node@v4
#         with: { node-version: 22, cache: pnpm, cache-dependency-path: pg4/pnpm-lock.yaml }
#       - run: pnpm install --frozen-lockfile
#         working-directory: pg4
#       - run: pnpm exec playwright install chromium
#         working-directory: pg4
#       - run: |
#           LOG_FORMAT=json pnpm run run -- \
#             --category "agenzie immobiliari" --province PD \
#             --maps --coverage full --fresh --out output/weekly_pd
#         working-directory: pg4
#       - uses: actions/upload-artifact@v4
#         if: always()
#         with:
#           name: weekly-pd-${{ github.run_id }}
#           path: |
#             pg4/output/weekly_pd*
#             pg4/output/_runs.jsonl
```

## Gestione degli exit code nello scheduler

- `3` (preflight) → NON riprovare in loop: il markup è cambiato o l'IP è
  bloccato; serve intervento umano. launchd/cron di default non
  riprovano — bene così.
- `130` → run interrotto; il checkpoint è resume-ready, il prossimo run
  schedulato riprende da dove era (senza `--fresh`).
- `1` (partial) → output utilizzabile ma con righe in errore: controlla
  `_runs.jsonl` e il log del run.
