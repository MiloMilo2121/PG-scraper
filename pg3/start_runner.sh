#!/bin/bash
cd /root/PG-scraper/pg3
# Ensure we have the latest dependencies
npm install --omit=dev
# Run the discovery/enrichment runner (current active entrypoint)
npx tsx src/foundation/RunnerV6.ts output_server/campaigns/DISCOVERY_INPUT_2026-02-19.csv
