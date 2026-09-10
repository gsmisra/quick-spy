# RAG retrieval benchmark (LEGACY/BASELINE mode) — dataset v1

Generated: 2026-09-10T01:45:31.579Z

**All queries in this run are SYNTHETIC** — these numbers describe how well retrieval matches a hand-built, deliberately small fixture corpus, NOT real-world accuracy. Treat this as a regression baseline (did a change make the synthetic cases better or worse?), never as a production accuracy claim.

**Operations note (F15):** per-query `operations` (when present) are deliberately IGNORED in this mode — every query here is scored as ONE whole-query `retrieveRagMatches()` call, regardless of how many operations it declares. This is NOT what the real production pipeline does — the real pipeline decomposes a request into per-operation retrieval and real token-budget packing (Phase 3/4, which DO exist). This LEGACY mode is kept deliberately unchanged as a stable regression signal for the underlying retrieval scoring itself; see the separate PRODUCTION-PIPELINE mode report (`*.production.latest.md`) for a run that actually exercises the real end-to-end path.

| Segment | Queries | Positive | Negative | Recall@k | Precision@k | Precision (returned) | MRR | No-match FP rate | Abstention rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Overall | 15 | 12 | 3 | 91.7% (n=12) | 54.2% (n=12) | 54.2% (n=12) | 87.5% (n=12) | 66.7% (n=3) | 0.0% (n=12) |
| Java | 12 | 10 | 2 | 90.0% (n=10) | 55.0% (n=10) | 55.0% (n=10) | 85.0% (n=10) | 50.0% (n=2) | 0.0% (n=10) |
| Python | 3 | 2 | 1 | 100.0% (n=2) | 50.0% (n=2) | 50.0% (n=2) | 100.0% (n=2) | 100.0% (n=1) | 0.0% (n=2) |
| UI mode | 2 | 1 | 1 | 0.0% (n=1) | 0.0% (n=1) | 0.0% (n=1) | 0.0% (n=1) | 100.0% (n=1) | 0.0% (n=1) |
| API mode | 13 | 11 | 2 | 100.0% (n=11) | 59.1% (n=11) | 59.1% (n=11) | 95.5% (n=11) | 50.0% (n=2) | 0.0% (n=11) |
| Development split | 10 | 8 | 2 | 87.5% (n=8) | 50.0% (n=8) | 50.0% (n=8) | 81.3% (n=8) | 50.0% (n=2) | 0.0% (n=8) |
| Holdout split | 5 | 4 | 1 | 100.0% (n=4) | 62.5% (n=4) | 62.5% (n=4) | 100.0% (n=4) | 100.0% (n=1) | 0.0% (n=4) |
| Synthetic origin | 15 | 12 | 3 | 91.7% (n=12) | 54.2% (n=12) | 54.2% (n=12) | 87.5% (n=12) | 66.7% (n=3) | 0.0% (n=12) |
