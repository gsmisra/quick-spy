# RAG hybrid retrieval evaluation — dataset v1

Generated: 2026-09-10T00:25:11.896Z

Provider: `char-ngram-stand-in-v1:n3:d256`

⚠ **This run used the deterministic, NON-SEMANTIC character-hashing stand-in provider** (`ragCharNgramStandInProvider.ts`) because no real semantic embedding provider was configured. It proves the hybrid retrieval/RRF-fusion MECHANISM works correctly end-to-end against real data — it is **NOT evidence that real semantic embeddings would improve retrieval accuracy**. To evaluate a real provider, set `SOFTPLAY_RAG_EVAL_ENDPOINT` and `SOFTPLAY_RAG_EVAL_MODEL` (and optionally `SOFTPLAY_RAG_EVAL_API_KEY`) before running `npm run rag:evaluate-hybrid`.

**PROVISIONAL — this dataset includes SYNTHETIC labels** (see benchmarks/rag/HUMAN_LABELING_GUIDE.md).

### Split: development (10 queries)

| | Recall@k | Precision@k | No-match FP rate | Abstention rate |
| --- | --- | --- | --- | --- |
| Lexical-only | 87.5% (n=8) | 50.0% (n=8) | 50.0% (n=2) | 0.0% (n=8) |
| Hybrid (RRF-fused) | 75.0% (n=8) | 43.8% (n=8) | 50.0% (n=2) | 0.0% (n=8) |

### Split: holdout (5 queries)

| | Recall@k | Precision@k | No-match FP rate | Abstention rate |
| --- | --- | --- | --- | --- |
| Lexical-only | 100.0% (n=4) | 62.5% (n=4) | 100.0% (n=1) | 0.0% (n=4) |
| Hybrid (RRF-fused) | 100.0% (n=4) | 62.5% (n=4) | 100.0% (n=1) | 0.0% (n=4) |

### Split: all (15 queries)

| | Recall@k | Precision@k | No-match FP rate | Abstention rate |
| --- | --- | --- | --- | --- |
| Lexical-only | 91.7% (n=12) | 54.2% (n=12) | 66.7% (n=3) | 0.0% (n=12) |
| Hybrid (RRF-fused) | 83.3% (n=12) | 50.0% (n=12) | 66.7% (n=3) | 0.0% (n=12) |

This report is a comparison only — it never selects a configuration or writes anything back to production code.
