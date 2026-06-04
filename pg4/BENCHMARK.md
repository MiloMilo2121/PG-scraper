# Benchmark

This file records only measured or explicitly sourced data. Missing or ambiguous values stay `TBD - to be measured`.

## Source Data

The available pg3 benchmark with a final aggregate summary is `../pg3/benchmark_wave_results.log`, captured on 2026-04-18 against 50 targets. It reports:

- Website discovery: 41/50 (82.0%) in 1369.7 seconds.
- Revenue pass: 41/41.
- Decision-maker pass: 39/41.
- Email/PEC pass: 9/41.
- Total time: 2090.8 seconds.
- Average time: 41.8 seconds per target.

The log does not provide a reliable all-provider cost total or a validated accuracy truth set. It contains paid-provider and LLM traces, but the final aggregate cost is not explicit enough to publish as a benchmark.

## pg3 vs pg4

| Metric | pg3 Omega V8 wave benchmark | pg4 comparable run |
| --- | ---: | ---: |
| Target count | 50 | TBD - to be measured |
| Website found rate | 41/50 (82.0%) | TBD - to be measured |
| Total wall time | 2090.8s | TBD - to be measured |
| Average wall time per target | 41.8s | TBD - to be measured |
| Cost | TBD - ambiguous in pg3 log | TBD - to be measured |
| Accuracy | TBD - no truth set in pg3 log | TBD - to be measured |

## Notes

- The pg3 "website found rate" is not accuracy. It is a hit rate from the benchmark summary.
- pg4 needs a same-class real run before any speed, cost, or accuracy claim is defensible.
- The offline pg4 mock example is useful for setup validation, not for performance benchmarking.
