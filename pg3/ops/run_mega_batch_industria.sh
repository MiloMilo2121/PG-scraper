#!/bin/bash
# 🚀 OMEGA V7 - MEGA BATCH: CUORE INDUSTRIALE NORD ITALIA
# TARGET: MECCANICA, MANIFATTURA, SERVIZI B2B
# PROVINCES: MI, BG, BS, MN, CR, VR, VI, PD, TV, BO, MO, RE, PR
# 
# FEATURES: Checkpoint automatico per riprendere il salvataggio

set -e

echo "=========================================================="
echo "🏭 STARTING MEGA BATCH: INDUSTRIA NORD ITALIA"
echo "=========================================================="

# Il cuore produttivo italiano
PROVINCES="MI,BG,BS,MN,CR,VR,VI,PD,TV,BO,MO,RE,PR"
CHECKPOINT_FILE="/tmp/mega_batch_checkpoint.txt"

KEYWORDS=(
    # ⚙️ Meccanica e Lavorazioni
    "Officine meccaniche"
    "Tornerie metalli"
    "Carpenterie metalliche"
    "Lavorazioni meccaniche di precisione"
    "Fonderie"
    "Trattamenti termici metalli"
    "Saldature industriali"

    # 🏭 Manifattura e Plastica
    "Stampaggio materie plastiche"
    "Lavorazione materie plastiche"
    "Imballaggi in plastica"
    "Cartotecnica"
    "Scatolifici"

    # 🏗️ Edilizia, Impianti e Materiali
    "Imprese edili"
    "Installatori impianti elettrici industriali"
    "Installatori impianti termoidraulici"
    "Serramenti ed infissi alluminio"
    "Lavorazione marmi e graniti"
    "Prefabbricati in cemento"

    # 🛠️ Servizi B2B e Logistica Avanzata
    "Pulizie industriali"
    "Smaltimento rifiuti industriali"
    "Corsi sicurezza sul lavoro"
    "Noleggio macchine operatrici"
    "Autotrasporti conto terzi"
    "Spedizioni internazionali"
)

TOTAL_KEYWORDS=${#KEYWORDS[@]}

START_IDX=0
if [ -f "$CHECKPOINT_FILE" ]; then
    START_IDX=$(cat "$CHECKPOINT_FILE")
    echo "📌 CHECKPOINT FOUND: Resuming from keyword index $START_IDX / $TOTAL_KEYWORDS"
fi

mkdir -p output/campaigns

IDX=0
for KEYWORD in "${KEYWORDS[@]}"; do
    if [ $IDX -lt $START_IDX ]; then
        echo "⏭️  [$((IDX + 1))/$TOTAL_KEYWORDS] Skipping: $KEYWORD"
        IDX=$((IDX + 1))
        continue
    fi

    echo "----------------------------------------------------------"
    echo "▶️  [$((IDX + 1))/$TOTAL_KEYWORDS] RUNNING: $KEYWORD in $PROVINCES"
    echo "----------------------------------------------------------"
    
    npx ts-node src/scraper/generate_campaign_v2.ts --query="$KEYWORD" --provinces="$PROVINCES" || true
    
    echo $((IDX + 1)) > "$CHECKPOINT_FILE"
    echo "⏱️ Waiting 10 seconds..."
    sleep 10
    
    IDX=$((IDX + 1))
done

rm -f "$CHECKPOINT_FILE"
echo "✅ MEGA BATCH COMPLETE!"
