#!/bin/bash
# 🚀 OMEGA V7 - BATCH DISCOVERY RUNNER
# TARGET: AGROALIMENTARE & MECCANICA (Nord Italia)
# PROVINCES: MN, BS, CR, VR, PR, RE
# 
# FEATURES:
#   - Checkpoint resume: se lo script si ferma, riparte dall'ultima keyword completata
#   - Logging per keyword con timestamp

set -e

echo "=========================================================="
echo "🎯 STARTING BATCH DISCOVERY: AGROALIMENTARE & MECCANICA"
echo "=========================================================="

PROVINCES="MN,BS,CR,VR,PR,RE"
CHECKPOINT_FILE="/tmp/batch_checkpoint.txt"

KEYWORDS=(
    # Settore Carne e Salumi
    "Salumifici"
    "Macelli"
    "Macellazione carni"
    "Lavorazione carni"
    "Prosciuttifici"
    
    # Settore Lattiero-Caseario
    "Caseifici"
    "Latterie Sociali"
    "Confezionamento formaggi"
    
    # Settore Cereali e Panificazione
    "Molini"
    "Moliture cereali"
    "Mangimifici"
    "Panifici industriali"
    "Pastifici"
    
    # Settore Ortofrutta e Conserviero
    "Aziende agricole IV gamma"
    "Conserve alimentari"
    "Centri logistici ortofrutticoli"
    
    # Logistica e Stoccaggio
    "Magazzini refrigerati"
    "Logistica alimentare"
    "Packaging alimentare"
    
    # 🍽️ Ho.Re.Ca. e Ospitalità (Added in Run 2)
    "Ristoranti"
    "Hotel"
    "Alberghi"
    "Trattorie"
    "Pizzerie"
)

TOTAL_KEYWORDS=${#KEYWORDS[@]}

# ─── CHECKPOINT RESUME ────────────────────────────────────────────────
START_IDX=0
if [ -f "$CHECKPOINT_FILE" ]; then
    START_IDX=$(cat "$CHECKPOINT_FILE")
    echo "📌 CHECKPOINT FOUND: Resuming from keyword index $START_IDX / $TOTAL_KEYWORDS"
    echo "   (Skipping $START_IDX already completed keywords)"
fi

mkdir -p output/campaigns

IDX=0
for KEYWORD in "${KEYWORDS[@]}"; do
    # Skip already completed keywords
    if [ $IDX -lt $START_IDX ]; then
        echo "⏭️  [$((IDX + 1))/$TOTAL_KEYWORDS] Skipping (already done): $KEYWORD"
        IDX=$((IDX + 1))
        continue
    fi

    echo "----------------------------------------------------------"
    echo "▶️  [$((IDX + 1))/$TOTAL_KEYWORDS] RUNNING KEYWORD: $KEYWORD in PROVINCES: $PROVINCES"
    echo "   Started at: $(date)"
    echo "----------------------------------------------------------"
    
    npx ts-node src/scraper/generate_campaign_v2.ts --query="$KEYWORD" --provinces="$PROVINCES" || true
    
    # Save checkpoint AFTER successful completion
    echo $((IDX + 1)) > "$CHECKPOINT_FILE"
    echo "✅ [$((IDX + 1))/$TOTAL_KEYWORDS] Completed: $KEYWORD (checkpoint saved)"
    
    # Breve pausa tra un target e l'altro per evitare ban (Law 305)
    echo "⏱️ Waiting 10 seconds before next keyword..."
    sleep 10
    
    IDX=$((IDX + 1))
done

# Cleanup checkpoint on successful completion
rm -f "$CHECKPOINT_FILE"

echo "=========================================================="
echo "✅ BATCH DISCOVERY COMPLETE! All $TOTAL_KEYWORDS keywords processed."
echo "   Finished at: $(date)"
echo "=========================================================="
