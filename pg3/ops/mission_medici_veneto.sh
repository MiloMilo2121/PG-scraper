#!/bin/bash
# Missione semplice: estrazione medici in Veneto + filtro finale solo province venete

set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p output output/campaigns

# Province Veneto
PROVINCES="BL,PD,RO,TV,VE,VI,VR"

# Specializzazioni mediche principali
QUERY="cardiologo,dermatologo,oculista,psichiatra,ginecologo,ortopedico,neurologo,urologo,endocrinologo,pediatra"

LOG_FILE="output/veneto_medici_scraping.log"

echo "=== AVVIO ESTRAZIONE MEDICI VENETO ==="
echo "Query: $QUERY"
echo "Provinces: $PROVINCES"
echo "Log: $LOG_FILE"

npx ts-node src/scraper/generate_campaign_v2.ts \
  --query="$QUERY" \
  --provinces="$PROVINCES" \
  | tee "$LOG_FILE"

LATEST_COMBINED="$(ls -t output/campaigns/campaign_COMBINED_*.csv 2>/dev/null | head -n 1 || true)"
if [ -z "$LATEST_COMBINED" ]; then
  echo "❌ Nessun file campaign_COMBINED trovato."
  exit 1
fi

FINAL_OUT="output/campaigns/veneto_medici_only.csv"

python3 - "$LATEST_COMBINED" "$FINAL_OUT" <<'PY'
import csv
import sys

src = sys.argv[1]
dst = sys.argv[2]
allowed = {"BL", "PD", "RO", "TV", "VE", "VI", "VR"}

written = 0
with open(src, "r", encoding="utf-8", newline="") as fin, open(dst, "w", encoding="utf-8", newline="") as fout:
    reader = csv.DictReader(fin)
    if not reader.fieldnames:
        print("❌ CSV sorgente senza header.")
        sys.exit(1)
    writer = csv.DictWriter(fout, fieldnames=reader.fieldnames)
    writer.writeheader()

    for row in reader:
        province = (row.get("province") or "").strip().upper()
        if province in allowed:
            writer.writerow(row)
            written += 1

print(f"✅ Righe Veneto scritte: {written}")
PY

echo "=== COMPLETATO ==="
echo "Input combinato: $LATEST_COMBINED"
echo "Output finale:   $FINAL_OUT"
