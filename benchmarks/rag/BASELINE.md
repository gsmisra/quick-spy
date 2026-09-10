# RAG pipeline baseline (Phase 0)

Recorded 2026-09-09, base commit `f7d0e0565852c7b2db79e2c6d7ee281da879c9c6` (worktree dirty — this
session's own uncommitted RAG changes are layered on top; see `git status`/`git diff` for the exact set).
Package version at recording time: `0.1.75`.

This document is a **measurement**, not a design spec — it records what the pipeline actually does today,
traced through the real code, and the first real benchmark numbers produced against it. Update it whenever
retrieval/generation behavior changes materially; do not let it silently go stale.

## Pre-existing test/compile state

- `npm run compile` (`tsc -p ./`): clean, zero errors.
- `npx tsc -p tsconfig.test.json --noEmit`: clean, zero errors.
- `npm test`: 364/364 passing, zero pre-existing failures to record separately.
- `npm run rag:benchmark`: runs end-to-end, produces `benchmarks/rag/results/synthetic-v1.latest.{json,md}`.

## Pipeline trace — Standard (Control Panel) mode

1. **Query construction** (`objectSpyPanel.ts`'s `buildRagSection()`): `[linkedScenario?.rawText,
   customInstructions, isApiMode ? (method+URL + sanitized body field names) : playwrightCode]`, joined and
   filtered for non-empty parts. No character-length truncation on this path today.
2. **Retrieval** (`ragRetriever.ts`'s `retrieveRagMatches()`): embeds the query via `TfIdfEmbeddings`
   (`ragIndexBuilder.ts`'s fitted instance), scores EVERY language-compatible recipe in the index (no fixed
   candidate-pool cap — `index.store.size` is passed as `k` to the flat vector store), applies a `0.4`×
   penalty to automationMode-mismatched recipes (soft preference, not a hard filter), drops any
   zero-or-negative score, sorts, and returns the top `topK` (default **2**).
3. **Formatting** (`formatRagPromptSection()`): packs each returned match's body against a
   1,500-char-per-recipe cap (fence-safe — never slices through a code block or its imports), then adds
   whole recipes to the prompt section, best-scored first, only while the running total stays under a
   4,000-char hard cap; a recipe that would push the total over is dropped WHOLE, never truncated further.
   Returns `includedMatches` — the subset that actually made it in — distinct from the full retrieved list.
4. **Prompt assembly**: `buildLlmPrompt()`/`buildApiLlmPrompt()` concatenate built-in instructions + selected
   `.github/*.md` custom instruction files + the RAG section + the recorded code/API details + the linked
   scenario.
5. **Token admission** (`llm/copilotClient.ts`'s `sendPrompt()` → `assertMessagesFitModel()`): counts the
   ACTUAL assembled message(s) via the resolved model's own `countTokens()`, compares against
   `maxInputTokens * 0.9` (`PROMPT_TOKEN_SAFETY_MARGIN`), and throws `PromptTooLargeError` (with the exact
   token count and concrete levers) BEFORE the request ever reaches Copilot if it's over budget. An
   unmeasurable count (the tokenizer call itself failing) lets the request through rather than blocking it.
6. **Traceability** (`ragTraceabilityBanner.ts`'s `prependRagTraceabilityBanner()`): after the response comes
   back, checks each INCLUDED match for real evidence of use (the "RAG match: `<id>`" comment the model was
   asked to add, OR one of its declared import symbols appearing in the generated code) and lists ONLY the
   verified-used ones in the banner — inclusion in the prompt is explicitly not treated as proof of use.

## Pipeline trace — Total Agentic Mode

Same retrieval/formatting/token-admission machinery (`ragRetriever.ts`, `llm/copilotClient.ts`) via
`agenticModeController.ts`'s own `buildRagSection()`. The query text is `[lastUserRequest, ...perFileExcerpts]`
where each ingested file contributes up to 600 chars (`RAG_QUERY_CHARS_PER_FILE`) — NOT a blind slice of the
whole concatenated context, so a file ingested later in the list still contributes some retrieval signal. The
LangChain adapter (`agent/vscodeCopilotToolCallingModel.ts`) runs the SAME `assertMessagesFitModel()` token
check before `sendRequest`, so both Standard and Agentic paths share one admission-control choke point.

## Exact current constants

| Constant | Value | File |
| --- | --- | --- |
| Default `topK` | 2 | `ragRetriever.ts` |
| `AUTOMATION_MODE_MISMATCH_PENALTY` | 0.4 | `ragRetriever.ts` |
| Candidate pool size | `index.store.size` (unbounded — exact linear scan) | `ragRetriever.ts` |
| `RAG_MAX_RECIPE_BODY_CHARS` | 1,500 | `ragRetriever.ts` |
| `RAG_MAX_TOTAL_SECTION_CHARS` | 4,000 | `ragRetriever.ts` |
| `PROMPT_TOKEN_SAFETY_MARGIN` | 0.9 | `llm/tokenBudget.ts` |
| Agentic per-file query excerpt | 600 chars | `agenticModeController.ts` |
| Recipe token target (Phase 2, per-capability generation) | 250–450 (soft, informational only) | `ragCorpusGenerator.ts` |
| Max capabilities extracted per file | 20 | `ragCapabilityExtraction.ts` |

No corpus fingerprint is recorded here — this workspace has no real `.github/rag/` corpus (only the stray,
non-recipe-shaped `.github/rag/bdd-java-framework-guide.md` left by a separate concurrent session, and it has
no YAML frontmatter so `ragIndexer.ts` skips it entirely). The benchmark below uses its OWN small synthetic
corpus instead, built and torn down in-memory per run — nothing here depends on this workspace's real corpus
state.

## First recorded benchmark run (`benchmarks/rag/datasets/synthetic-v1.json`)

Produced by `npm run rag:benchmark`; full artifacts at
`benchmarks/rag/results/synthetic-v1.latest.{json,md}`. **All 15 queries are SYNTHETIC** — see that file's own
header for why these numbers describe fixture behavior, not real-world accuracy.

| Segment | Queries | Positive | Negative | Recall@k | Precision@k | Precision (returned) | MRR | No-match FP rate | Abstention rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Overall | 15 | 12 | 3 | 91.7% | 54.2% | 54.2% | 87.5% | 66.7% | 0.0% |
| Java | 12 | 10 | 2 | 90.0% | 55.0% | 55.0% | 85.0% | 50.0% | 0.0% |
| Python | 3 | 2 | 1 | 100.0% | 50.0% | 50.0% | 100.0% | 100.0% | 0.0% |
| UI mode | 2 | 1 | 1 | 0.0% | 0.0% | 0.0% | 0.0% | 100.0% | 0.0% |
| API mode | 13 | 11 | 2 | 100.0% | 59.1% | 59.1% | 95.5% | 50.0% | 0.0% |
| Development split | 10 | 8 | 2 | 87.5% | 50.0% | 50.0% | 81.3% | 50.0% | 0.0% |
| Holdout split | 5 | 4 | 1 | 100.0% | 62.5% | 62.5% | 100.0% | 100.0% | 0.0% |

### Two genuine findings this first run already surfaced

1. **`dev-misleading-shared-vocab-cassandra` misses entirely (recall 0) in this corpus, despite the query
   literally containing the word "cassandra".** The narrower unit test in `test/rag/ragRetriever.test.ts`
   ("a recipe is matchable purely by its FOLDER name") proves the underlying folder-path-matching mechanism
   genuinely works — but that test's corpus has only 2 recipes with nothing else competing for
   "database/query/validate" vocabulary. Once postgres and mysql helpers using that SAME generic vocabulary
   are added to the corpus, they currently outrank the cassandra recipe (whose only distinguishing signal is
   its folder name, not its title/tags/body) for the top-2 slots. This is a real, present-day limitation —
   candidate territory for Phase 3 (operation-level retrieval may isolate the "cassandra" intent better) and/or
   Phase 4 (an explicit symbol/path-match boost as a calibration parameter). Not something this baseline
   attempts to fix — recording it honestly is the point.
2. **No-match false-positive rate is 66.7%** (2 of 3 negative queries in this run returned SOMETHING). The
   retrieval pipeline has NO minimum-score/abstention threshold today — `retrieveRagMatches()`'s only filter
   is `score > 0`, so even a genuinely unrelated query can surface a low-scoring spurious match purely from
   residual stopword overlap with the corpus. This is exactly the gap Phase 4 (relevance/abstention
   calibration) exists to close; it is NOT evidence of a bug in this session's retrieval-quality fixes
   (field weighting, camelCase splitting, all-candidate reranking) — those all measurably help RECALL/ranking
   among candidates that already score above zero; none of them add an absolute floor below which a query
   should return nothing at all.

Both findings are preserved as deliberately non-brittle tests in `test/rag/benchmark/ragBenchmarkRunner.test.ts`
(they verify the METRIC computes correctly, not that today's specific numbers are good) — re-run
`npm run rag:benchmark` after any retrieval change to see whether these numbers moved, and update this file's
recorded values (and, if they meaningfully improve, tighten the corresponding test) at that point.

## What already works (confirmed by this baseline, not merely claimed)

- Hard language filtering (Java query never surfaces a Python-only recipe or vice versa) — confirmed via
  `dev-language-incompatibility`/`holdout-language-incompatibility-python`.
- Vendor names are never conflated (mysql query never surfaces the postgres helper) — confirmed via
  `dev-vendor-mismatch`.
- Compound-identifier sub-word tokenization (`PostgresHelper.queryOne` in a query still finds the recipe) —
  confirmed via `dev-identifier-reference`.
- Empty/whitespace queries return zero matches without erroring — confirmed via `dev-empty-query`.
- Alternative-helper groups are satisfied by either member — confirmed via `holdout-alternative-helpers`.
- End-to-end token admission never lets a known-oversized request reach `sendRequest` (see
  `test/llm/tokenBudget.test.ts` and the `PromptTooLargeError` wiring in `copilotClient.ts` and
  `vscodeCopilotToolCallingModel.ts` — not re-verified by this benchmark, which only exercises retrieval, not
  the full generation call).

## What's intentionally NOT measured yet

- **Operation-level retrieval/packing** (Phase 3) — every query above is scored as ONE whole-query retrieval
  call. `dev-multiple-required-operations` and `dev-repeated-operation` exist in the dataset specifically to
  be re-measured once a shared operation planner exists; today they document the pre-Phase-3 shape honestly
  rather than being skipped.
- **Capability-level corpus generation quality** — this benchmark's recipes are hand-authored fixtures, not
  recipes produced by `ragCorpusGenerator.ts`'s real per-capability pipeline. Measuring THAT pipeline's output
  quality needs either a fake-model harness around `generateRagCorpus()` or a real Copilot call, neither of
  which this Phase 1 deliverable attempts.
- **Any hybrid/semantic signal** — Phase 6 is unimplemented; this baseline is lexical-only by construction.
- **Human-labeled accuracy** — every query above is synthetic. See `HUMAN_LABELING_GUIDE.md` for the labeling
  template and instructions; until real labels exist, no claim here should be read as a production accuracy
  number.
