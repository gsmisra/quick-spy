# RAG retrieval benchmark (PRODUCTION-PIPELINE mode) — dataset v1

Generated: 2026-09-10T01:45:31.705Z

**PROVISIONAL — this dataset includes SYNTHETIC labels.** These numbers describe how the REAL production pipeline (operation decomposition + per-operation retrieval + packing) behaves against a hand-built fixture corpus, using an ESTIMATED (never measured) token counter — not a production accuracy claim, and not tuned against any real model's real tokenizer.

## Reproducibility metadata

Corpus fingerprint (SHA-256 of recipe content): `36ee7bc90d743ead457eb145097d0c29e99a5cc53bfe5c29254adc4df8ab5c5d`

Git: `f7d0e0565852c7b2db79e2c6d7ee281da879c9c6` (DIRTY working tree — uncommitted changes were present when this ran)

Config: perOperationK=3, estimatedMaxInputTokens=128,000, estimatedMandatoryTokens=2,000, gateConfig=`{"minLexicalScore":0,"requireSymbolEvidence":false,"requireModeCompatibility":false}`

## Retrieval/scoring (post-packing — what a real request would actually include)

| Segment | Queries | Positive | Negative | Recall@k | Precision@k | Precision (returned) | MRR | No-match FP rate | Abstention rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Overall | 15 | 12 | 3 | 100.0% (n=12) | 40.3% (n=12) | 40.3% (n=12) | 90.3% (n=12) | 66.7% (n=3) | 0.0% (n=12) |
| Java | 12 | 10 | 2 | 100.0% (n=10) | 38.3% (n=10) | 38.3% (n=10) | 88.3% (n=10) | 50.0% (n=2) | 0.0% (n=10) |
| Python | 3 | 2 | 1 | 100.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 100.0% (n=2) | 100.0% (n=1) | 0.0% (n=2) |
| UI mode | 2 | 1 | 1 | 100.0% (n=1) | 33.3% (n=1) | 33.3% (n=1) | 33.3% (n=1) | 100.0% (n=1) | 0.0% (n=1) |
| API mode | 13 | 11 | 2 | 100.0% (n=11) | 40.9% (n=11) | 40.9% (n=11) | 95.5% (n=11) | 50.0% (n=2) | 0.0% (n=11) |
| Development split | 10 | 8 | 2 | 100.0% (n=8) | 37.5% (n=8) | 37.5% (n=8) | 85.4% (n=8) | 50.0% (n=2) | 0.0% (n=8) |
| Holdout split | 5 | 4 | 1 | 100.0% (n=4) | 45.8% (n=4) | 45.8% (n=4) | 100.0% (n=4) | 100.0% (n=1) | 0.0% (n=4) |
| Synthetic origin | 15 | 12 | 3 | 100.0% (n=12) | 40.3% (n=12) | 40.3% (n=12) | 90.3% (n=12) | 66.7% (n=3) | 0.0% (n=12) |

## Packing diagnostics

Operation coverage: 94.1% (16/17 operations had at least one included candidate)

Average ESTIMATED tokens per query: 451

Average local retrieval+packing latency: 0.2 ms (excludes any real LLM network call — there is none in this harness)

Omissions by reason (summed across all queries): none

This report never selects or promotes anything — it is a comparison/diagnostic artifact only.
