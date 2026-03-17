#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(/usr/bin/dirname -- "$0")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

INPUT_CSV="${1:-}"
LIMIT="${2:-100}"
TEST_PREFIX="${3:-e2e_sample}"

if [[ -z "$INPUT_CSV" || ! -f "$INPUT_CSV" ]]; then
  echo "Usage: zsh scripts/run_e2e_sample_enrichment.zsh <input.csv> [limit] [test_prefix]" >&2
  exit 1
fi

SAMPLE_DIR="output/e2e_samples"
mkdir -p "$SAMPLE_DIR"

SAMPLE_CSV="${SAMPLE_DIR}/$(/usr/bin/basename "${INPUT_CSV%.*}")_${LIMIT}_rows.csv"

npx ts-node scripts/sample_e2e_csv.ts "$INPUT_CSV" "$SAMPLE_CSV" "$LIMIT"
exec zsh scripts/run_e2e_enrichment.zsh "$SAMPLE_CSV" "$TEST_PREFIX"
