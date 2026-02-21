## Hypotheses for the Missing Run

The user provided `DISCOVERY_INPUT_2026-02-19.csv` today. However, no logs or output relate to this file on either the local machine or the Hetzner server. 

### Hypothesis 1: The Loop Script is Pointing to the Wrong Input File
**Description**: The `ops/loop_meccatronica.sh` script running on the Hetzner server is currently hardcoded and designed to process the output of Phase 2 (`BOARD_ENRICHED_PHASE2.csv` or `campaign_COMBINED_*.csv`). 
*   **Evidence**: The server's `remote_manager.log` explicitly states: `[LOOP] AUTO-DETECTED LATEST CAMPAIGN: output/campaigns/campaign_COMBINED_2026-02-11T18-13-17.csv` and then gets killed. It relies on `ls -t output/campaigns/*.csv 2>/dev/null | head -n 1`. If `DISCOVERY_INPUT_2026-02-19.csv` was scp'd but didn't match the expected naming convention, the loop might pick up an older file or get stuck in a bad state.

### Hypothesis 2: The Script Was Run Locally but Crashed Silently (OOM or V8 Memory Issue)
**Description**: The user may have attempted to run a runner script locally (e.g. `npx ts-node src/enricher/runner.ts output_server/campaigns/DISCOVERY_INPUT_2026-02-19.csv`). However, if the process hit a memory limit (common with heavy JS arrays/Playwright instances) or if there was an unhandled promise rejection in the Node process immediately, it would exit silently without writing to the `.log` files (since the user likely didn't redirect `> log.txt`). 
*   **Evidence**: I found a dangling local headless Playwright process (`ts-node` or `node cli.js run-driver`), indicating a script *started* but the parent Node.js process died, leaving the browser orphaned.

### Hypothesis 3: The Deploy Script (ops/deploy.sh) Was Never Run for the New File
**Description**: The file `DISCOVERY_INPUT_2026-02-19.csv` was created inside `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output_server/campaigns/`. However, the `ops/deploy.sh` script specifically EXCLUDES the `output_server/` directory:
```bash
    --exclude 'output_server' \
```
*   **Evidence**: If the user generated the input file locally in `output_server` and then ran `deploy.sh` expecting it to be sent to Hetzner, the deploy script actually skipped it entirely. Thus, the file is not on the server, and the server loop has nothing to execute.

---

### Chosen Hypothesis and Solution
**Hypothesis 3** is the most likely root cause. The input file was generated locally inside `output_server/`, but `ops/deploy.sh` completely excludes this directory from the `rsync` upload to Hetzner. 

Furthermore, even if the file was on the server, the main runner script (`src/enricher/runner.ts` or a custom rescue mission script) needs an explicit instruction to parse *this specific file* instead of the generic auto-detected ones.

**Plan of Action**:
1. Create a dedicated execution script (`src/scripts/run_discovery_csv.ts`) that takes the input CSV path as an argument.
2. Synchronize the `DISCOVERY_INPUT_2026-02-19.csv` file directly to the Hetzner server.
3. SSH into the Hetzner server.
4. Run the new script on the Hetzner server, targeting the uploaded CSV file.
5. Monitor the output for errors and ensure it completes.
