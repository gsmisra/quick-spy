# RAG relevance-gate calibration — dataset v1

Generated: 2026-09-10T02:07:27.003Z

**PROVISIONAL — this calibration run includes SYNTHETIC labels.** The selected configuration below is a candidate recommendation only; it has NOT been promoted to the production default (`DEFAULT_RELEVANCE_GATE` in rag/ragRelevanceGate.ts remains the conservative, backward-compatible "any positive score" behavior). Promoting a different default requires real, non-synthetic evidence — see benchmarks/rag/HUMAN_LABELING_GUIDE.md.

## Development-split parameter grid

| Configuration | Recall@k | Precision@k | No-match FP rate | Abstention rate | Objective score |
| --- | --- | --- | --- | --- | --- |
| default (any positive score) | 87.5% (n=8) | 50.0% (n=8) | 50.0% (n=2) | 0.0% (n=8) | 0.6250 |
| minLexicalScore=0.05 | 87.5% (n=8) | 50.0% (n=8) | 50.0% (n=2) | 0.0% (n=8) | 0.6250 |
| minLexicalScore=0.1 | 87.5% (n=8) | 50.0% (n=8) | 0.0% (n=2) | 0.0% (n=8) | 0.8750 |
| requireSymbolEvidence | 87.5% (n=8) | 50.0% (n=8) | 0.0% (n=2) | 0.0% (n=8) | 0.8750 |
| requireModeCompatibility | 87.5% (n=8) | 50.0% (n=8) | 50.0% (n=2) | 0.0% (n=8) | 0.6250 |
| minLexicalScore=0.05 + requireSymbolEvidence | 87.5% (n=8) | 50.0% (n=8) | 0.0% (n=2) | 0.0% (n=8) | 0.8750 |

**Selected (development split):** `requireSymbolEvidence` — objective score 0.8750.

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
| 100.0% (n=4) | 50.0% (n=4) | 0.0% (n=1) | 0.0% (n=4) |

This holdout number must not be used to select a DIFFERENT configuration — doing so would make this split development data going forward, requiring a fresh holdout before any future "independent result" claim.
