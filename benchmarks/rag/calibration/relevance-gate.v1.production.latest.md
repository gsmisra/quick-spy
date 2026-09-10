# RAG relevance-gate calibration (PRODUCTION-PIPELINE mode) — dataset v1

Generated: 2026-09-10T02:07:27.167Z

**PROVISIONAL — this calibration run includes SYNTHETIC labels, AND its retrieval/packing runs through the REAL production pipeline against an ESTIMATED (never measured) token budget.** The selected configuration below is a candidate recommendation only; it has NOT been promoted to the production default (`DEFAULT_RELEVANCE_GATE` in rag/ragRelevanceGate.ts remains the conservative, backward-compatible "any positive score" behavior). Promoting a different default requires real, non-synthetic evidence — see benchmarks/rag/HUMAN_LABELING_GUIDE.md.

## Reproducibility metadata

Corpus fingerprint (SHA-256 of recipe content): `36ee7bc90d743ead457eb145097d0c29e99a5cc53bfe5c29254adc4df8ab5c5d`

Git: `f7d0e0565852c7b2db79e2c6d7ee281da879c9c6` (DIRTY working tree — uncommitted changes were present when this ran)

Config: perOperationK=3, estimatedMaxInputTokens=128,000, estimatedMandatoryTokens=2,000

## Development-split parameter grid (scored through real operation decomposition + per-operation retrieval + packing)

| Configuration | Recall@k | Precision@k | No-match FP rate | Abstention rate | Objective score |
| --- | --- | --- | --- | --- | --- |
| default (any positive score) | 100.0% (n=8) | 37.5% (n=8) | 50.0% (n=2) | 0.0% (n=8) | 0.7500 |
| minLexicalScore=0.05 | 100.0% (n=8) | 45.8% (n=8) | 50.0% (n=2) | 0.0% (n=8) | 0.7500 |
| minLexicalScore=0.1 | 100.0% (n=8) | 50.0% (n=8) | 0.0% (n=2) | 0.0% (n=8) | 1.0000 |
| requireSymbolEvidence | 100.0% (n=8) | 56.3% (n=8) | 0.0% (n=2) | 0.0% (n=8) | 1.0000 |
| requireModeCompatibility | 100.0% (n=8) | 43.8% (n=8) | 50.0% (n=2) | 0.0% (n=8) | 0.7500 |
| minLexicalScore=0.05 + requireSymbolEvidence | 100.0% (n=8) | 56.3% (n=8) | 0.0% (n=2) | 0.0% (n=8) | 1.0000 |

**Selected (development split):** `requireSymbolEvidence` — objective score 1.0000.

```json
{
  "minLexicalScore": 0,
  "requireSymbolEvidence": true,
  "requireModeCompatibility": false
}
```

## Final holdout evaluation (evaluated ONCE)

| Recall@k | Precision@k | No-match FP rate | Abstention rate |
| --- | --- | --- | --- |
| 100.0% (n=4) | 70.8% (n=4) | 0.0% (n=1) | 0.0% (n=4) |

This holdout number must not be used to select a DIFFERENT configuration — doing so would make this split development data going forward, requiring a fresh holdout before any future "independent result" claim.
