# Agent instructions: complete SoftPlay RAG accuracy and compact-corpus work

## Mission

Implement the remaining RAG improvements in this repository end to end. Produce working code, meaningful tests, a reproducible benchmark, and an accurate completion report. Do not stop at a proposal, disconnected utilities, schema additions, or prompt wording alone.

Deliver these five workstreams:

1. A labeled-retrieval benchmark harness and baseline.
2. Capability-level corpus generation, operation-level retrieval, and token-budgeted packing.
3. Relevance/abstention calibration using positive and negative examples.
4. Active source-staleness detection and a usable inspection action.
5. An optional hybrid lexical/semantic retrieval implementation and an honest evaluation against the lexical baseline.

Preserve Java/Python support, UI/API automation, selected Gherkin-step semantics, normal and Agentic Mode generation, existing corpus compatibility, local lexical retrieval, and the existing Copilot integration.

This is an implementation assignment. Read the current code and proceed autonomously through work that does not require unavailable information. Missing real labeled requests must not prevent building the harness or other workstreams. Missing an embedding provider must not be concealed by calling a mock a real semantic evaluation.

## Working rules

- Read applicable AGENTS.md instructions first. Inspect git status and the current diff. This workspace contains substantial existing uncommitted changes: preserve them. Do not reset, overwrite, commit, publish, or deploy unrelated work.
- Establish the current behavior with code and tests; this document is a specification, not proof of the current implementation. Prefer function names over potentially stale line numbers.
- Reuse existing modules and patterns. Avoid introducing a second token-budget system, parallel source-identity format, or separate retrieval logic for each UI.
- Keep pure extraction, scoring, planning and packing logic testable without VS Code. Inject filesystem, tokenizer and embedding boundaries into integration code where appropriate.
- Do not require a new hosted vector database. Keep lexical mode functional offline. Semantic mode must be explicitly configured; never silently upload the corpus to a new service or download a model.
- Do not send real credentials in embedding requests, prompts, benchmark artifacts or logs. Reuse the existing source scrubbing and credential handling; source excerpts are data, not instructions.
- Avoid destructive automatic corpus migration. Do not remove hand-authored recipes. Make cancellation and partial failures recoverable and reported accurately.
- Ask only for genuinely missing external inputs; continue independent work. Do not ask for permission again for work already authorized by this assignment.
- Keep a short implementation checklist updated. Report each item as implemented-and-tested, implemented-but-not-live-validated, evaluated, or blocked by a named external input. Never describe provenance fields alone as staleness detection or an adapter alone as evaluated hybrid retrieval.

## Inspect and preserve the existing foundation

Start with these files and their tests:

| Area | Files |
| --- | --- |
| Corpus generation | `src/rag/ragCorpusGenerator.ts`, `prompts/generate-rag-recipe.md`, `src/panel/settingsPanel.ts` |
| Extraction and validation | `src/rag/ragCapabilityExtraction.ts`, `ragSourceGrounding.ts`, `ragSecretScrubber.ts`, `ragRecipeNormalizer.ts` |
| Schema and identity | `src/rag/ragTypes.ts`, `ragFrontmatter.ts`, `ragSourceIdentity.ts` |
| Index and retrieval | `src/rag/ragIndexer.ts`, `ragIndexBuilder.ts`, `tfidfEmbeddings.ts`, `flatVectorStore.ts`, `ragRetriever.ts` |
| Generation consumers | `src/panel/objectSpyPanel.ts`, `src/agentic/agenticModeController.ts`, `src/panel/ragTraceabilityBanner.ts` |
| Token accounting | `src/llm/tokenBudget.ts`, `copilotClient.ts`, `src/agent/vscodeCopilotToolCallingModel.ts` |
| Scenario boundaries | `src/bdd/gherkinParser.ts`, `src/panel/featureFilePanel.ts` |
| Settings and commands | `src/settings/settingsStore.ts`, `src/extension.ts`, `package.json` |
| Verification | `test/rag/`, `test/llm/`, `test/panel/`, `test/bdd/`, `scripts/run-tests.js` |

At instruction-authoring time, the code contains lexical field weighting and compound-identifier tokenization, all-candidate mode reranking, richer query construction, sourcePath/sourceHash metadata, included-match tracking, abstention instructions, and token preflight helpers. Preserve these improvements unless evidence supports a correction.

There is also a best-effort capability extraction module. Its existence does not establish integration: trace imports, callers, generated outputs, counts and UI behavior. Check its 20-capability cap, owner resolution, overload identity and unsupported-syntax handling. Do not silently lose capabilities or infer correctness from its comments.

## Phase 0 — Establish a reproducible baseline

1. Run the repository's existing test and compile commands. Record pre-existing failures separately.
2. Trace an uploaded source through generation, normalization, saving, indexing, retrieval, packing and final prompt assembly in both generation modes.
3. Identify exact current query inputs, truncation points, filters, score adjustments, token checks and traceability claims.
4. Record a small baseline configuration: corpus fingerprint, retrieval parameters, tokenizer version, commit identifier when available, and whether the worktree is dirty. Do not put machine-specific absolute paths in shared benchmark data.
5. Create implementation notes showing which requirements already work, which are partial, and the intended changes. Do not rewrite already-working quick wins merely to match suggested filenames below.

## Phase 1 — Build the benchmark before tuning

### Dataset and harness

Add a versioned JSON/JSONL fixture format, a validator, pure metric functions, and a command such as `npm run rag:benchmark`. Supply a small deterministic synthetic corpus and queries so the command works immediately without credentials or VS Code. Clearly label every synthetic record and report.

Each query record should carry:

- Stable query ID, language, automation mode and split (`development` or `holdout`).
- Query text and, where available, operation IDs with their own intent/context.
- Relevant recipe/capability IDs; an empty list means a deliberate no-match case.
- Optional graded relevance and alternative-equivalent helpers; distinguish alternatives from capabilities that are all required.
- Origin (`synthetic` or `human-labeled`), dataset version and a short labeling rationale.

Validate duplicate IDs, unresolved references, contradictory no-match labels and malformed records. Keep paraphrases and closely related scenario families in the same split to avoid leakage. Fit TF-IDF on the corpus only, not on evaluation queries. Do not optimize on holdout results.

Include positive cases, paraphrases, identifier references, Java/Python incompatibility, vendor mismatches, misleading shared vocabulary, multiple required operations, repeated operations, empty queries, and no-match cases.

### Metrics and conventions

Implement and test:

- Recall@k = relevant unique IDs retrieved in the first k / total relevant IDs, for positive queries.
- Precision@k = relevant unique IDs retrieved in the first k / k. Also report precision among returned results when fewer than k are returned, so abstention is visible rather than hidden.
- MRR for positive queries, using the first relevant rank, and zero for a miss.
- No-match false-positive rate = negative queries returning any accepted result / negative query count.
- Positive-query abstention rate = positive queries with no accepted result / positive query count.
- Operation coverage before and after packing: required operations with at least one sufficient included contract / required operations. Respect alternative helper labels.
- Included context tokens (mean and p95) where measured, plus measurement method; mark estimates and unavailable counts explicitly.
- Retrieval latency (mean/p95), corpus size and warm/cold semantic-cache state. Avoid brittle timing assertions in CI.

Use explicit zero-denominator behavior: emit null/not-applicable with counts rather than misleading perfect scores. Report macro averages and separate Java/Python, UI/API, and positive/negative subsets. Export per-query ranked/accepted/included IDs, scores, reasons and aggregate JSON plus a readable Markdown summary. Do not store raw secret-bearing inputs in diagnostics.

### Real-data onboarding

Provide an empty human-label template and instructions for labeling 30–50 representative requests, including roughly 20–30% negative cases as an initial collection target. Those counts are collection guidance, not a statistical guarantee. Do not require those labels to finish the harness.

Acceptance: a fresh checkout can run the synthetic benchmark; hand-calculated metric fixtures pass; repeated runs produce the same rankings/configuration outputs apart from timing; reports clearly state synthetic versus human evidence. Save the baseline before changing ranking behavior.

## Phase 2 — Generate compact recipes per capability

### Versioned contract and identity

Design a backward-compatible schema version. Continue reading existing file-level recipes without automatically rewriting them. New records must represent one public callable capability or one coherent non-callable configuration capability.

Represent, in validated metadata or a structured contract:

- Stable ID, concise intent/title/tags, language and supported automation modes.
- Exact source-relative path, symbol identity, owner/module and signature.
- Source hash and hash algorithm/normalization version where needed.
- Exact imports, invocation kind (static/instance/function/constructor), parameters, return shape when observable, and essential preconditions/setup/cleanup.
- One complete minimal usage example, plus validation status and reason when unresolved.

Prefer a separate sourceSymbol field over mixing `#symbol` into a filesystem path. Support legacy sourcePath values with such fragments carefully. Identity must distinguish overloaded methods and same-named methods in different owners/modules. IDs must remain stable across unchanged reuploads and must not depend on model wording, batch order or timestamp.

Unknown source facts must remain unknown. A signature and a short excerpt do not prove undocumented behavior or a guessed return shape. Validate all newly added fields through parse/serialize/index paths; Zod may strip fields not declared in the schema.

### Extraction and source context

Wire extraction into actual batch generation. Improve or replace the best-effort extractor where required, documenting any dependency tradeoff. Cover multiline signatures, decorators/annotations, async functions, nested owners, constructors, overloads and methods with supporting fields. Exclude private/internal methods unless they are demonstrably intended for external use.

For each capability, provide source-grounded package/import information, owner declaration, required constructor/factory, relevant fields and a bounded excerpt. Shared setup can be referenced by a stable dependency ID or repeated minimally; packing must include necessary setup so a method contract is callable.

Do not silently drop methods after an arbitrary cap. Use a generation plan with bounded batches, visible counts and cancellation; report unsupported or deferred capabilities explicitly. If parsing is incomplete, flag it for review. Do not label a whole-file fallback as verified capability extraction.

### Generation and saving

- Change the generation prompt to request intent, prerequisites, exact signature and minimal invocation, never the helper's implementation or a full generated test class.
- Start with a configurable 250–450-token target per capability, measured with the selected model where available. This is a tuning target, not a universal correctness limit.
- Preserve critical imports, preconditions, setup and examples when a larger complete contract is necessary. Split distinct capabilities instead of slicing code or deleting essential context.
- Use deterministic source scrubbing before model input, source grounding after output, and bounded repair for invalid responses. Keep unresolved drafts out of the indexed corpus.
- Plan output paths for the entire batch, including overloads and slug/case collisions. Validate source-to-target mapping before writes. Preserve overwrite behavior and avoid duplicate model requests for identical inputs.
- Make partial success counts unambiguous: separately report source files considered, capabilities planned, written, failed, skipped and deferred. Ensure cancellation does not write a late response or erase a newer operation's UI state.
- Track generator-owned outputs in a manifest if needed. Regeneration must identify obsolete generated capabilities without automatically deleting user-authored or edited recipes. Report or explicitly migrate obsolete records.

Acceptance: a fixture with several public methods produces distinct grounded recipes through the real generation orchestration with a fake model; overloads do not collide; required constructors are available; legacy recipes remain readable; invalid responses remain unindexed; no capability disappears without a reported reason.

## Phase 3 — Retrieve per operation and pack by token budget

### Shared operation planner

Introduce a shared request-to-operations layer used by normal and Agentic generation. A useful operation record includes stable ID, intent, explicit arguments/types when known, selected source references, and necessary local context.

- Gherkin: derive operations from the user's selected steps. Preserve relevant selected Background and Examples/placeholder context according to existing selection behavior. Never reintroduce deselected steps through full-scenario text.
- API without Gherkin: use explicit actions/assertions and sanitized request field names. Do not invent assertions or send secret values for retrieval.
- Agentic Mode: represent each selected input segment and explicit user instruction; do not take only a leading character slice that hides later requirements. Use deterministic segmentation first. If optional model planning is introduced, validate its output and retain a deterministic fallback.
- Unstructured requests: one explicit fallback operation is acceptable. Do not claim semantic operation decomposition when only sentence splitting occurred.

Retrieve candidates independently for operations. Preserve hard language compatibility, existing mode preference and lexical improvements. Keep per-operation scores and reasons. Deduplicate by stable capability identity while retaining all covered operation IDs. Do not enforce a global two-helper ceiling when three or more operations require different helpers.

### Complete-contract packing

Make packing consume the actual resolved model/tokenizer and the assembled non-RAG input. Reuse current token admission checks as the final guard.

1. Build mandatory request messages and measure them.
2. Compute remaining RAG allowance using the existing model input limit and documented safety margin. Treat maxInputTokens according to the provider's input-limit semantics; do not assume a second fixed output reserve is always required.
3. Allocate space by operation coverage, relevance and contract cost. Prefer covering an uncovered operation before adding redundant examples for an already-covered operation when relevance is comparable. Define deterministic tie-breaking.
4. Add complete contracts, required setup/dependencies and deduplicated imports. Never cut signatures, code fences, preconditions or setup merely because they are outside a code block.
5. Recount the exact final assembled messages; token counts across fragments are not necessarily additive. Remove whole optional units if necessary.
6. If mandatory context already exceeds the budget, surface the existing actionable size error. If counting is unavailable, follow and clearly report the explicit unmeasured policy; do not claim token-safe packing.

Return structured diagnostics: retrieved, accepted, included, omitted IDs; operation coverage; omission reason (irrelevant, incompatible, stale, budget, duplicate); counted tokens or unmeasured status. Keep implementation diagnostics in logs/inspection UI rather than adding verbose prose to every model prompt.

Preserve the explicit permission for the model to use none of the retrieved helpers. Traceability must not claim actual use simply because a helper was retrieved or a model emitted a comment. Label comment-based or static call detection as observed/heuristic unless verification establishes more.

Acceptance: a three-operation fixture can include three necessary helpers when space permits; repeated operations reuse one contract; tight budgets omit complete units and show coverage loss; selected-segment and deselected-step boundaries are honored; all final measured requests fit; normal and Agentic call sites use the shared pipeline.

## Phase 4 — Calibrate relevance and abstention

Separate candidate ranking from acceptance. Make the gate configurable and testable, with documented defaults and score provenance. Possible parameters include minimum lexical/semantic score, explicit symbol evidence, mode compatibility and score separation; do not add every signal without evidence.

Use the development split to compare a small documented parameter grid. Report recall/precision and no-match false positives together; abstaining on everything is not a successful improvement. Select a configuration using an explicit objective and tie-break policy. Evaluate holdout once for the final comparison; if holdout influences later tuning, label it development and create a new holdout before claiming an independent result.

Keep source compatibility and unmet known preconditions distinct from statistical thresholds. Do not blindly hard-filter unknown metadata, especially for legacy recipes. Do not reuse TF-IDF thresholds for fused hybrid scores.

If only synthetic labels exist, implement the calibration command and report synthetic calibration as provisional. Retain a conservative backward-compatible production default unless real evidence justifies promotion. The lack of real labels blocks a production accuracy claim, not the calibration machinery.

Acceptance: deterministic parameter runs and saved config; explicit no-match tests; tradeoff report with dataset provenance; no unjustified statement that thresholds are production-tuned.

## Phase 5 — Detect and surface stale recipes

Implement an active checker, integrated with indexing/retrieval and a command or Settings action such as `SoftPlay: Check RAG Source Freshness`.

States must distinguish:

- `fresh`: source was resolved, read and hash matched.
- `stale`: source was read and hash differs.
- `missing`: a previously mapped/resolvable source is absent.
- `unverifiable`: source mapping/provenance is unavailable (common for an uploaded archive).
- `error`: permission/read/other check failure.

sourcePath describes an uploaded source identity; it is not automatically a valid workspace path. Resolve against an explicit source root/mapping, support multi-root workspaces without always using folder zero, and use VS Code URI/filesystem APIs. Do not search arbitrary machine directories. Reject path traversal, absolute-path escapes and mapped-root escapes; consider symlinks on local filesystems. Never label an unmapped uploaded source fresh or stale by guessing a basename match.

Use exactly the hash semantics used at generation time, including text decoding and line endings; add a version if these semantics change. Compare the full original source when that is what the stored hash represents, not a capability excerpt. Handle legacy `#symbol` identities without treating the fragment as a literal filename suffix.

Cache checks by recipe/source identity and observed source state, with bounded invalidation and a force-refresh action. Watch changes where supported; manual refresh must re-read and recompute, not trust mtime/size alone. A check can become stale during a later edit, so diagnostics should include last-check time rather than promise perpetual freshness.

Default policy: exclude known stale and mapped-missing generated recipes from normal reuse and explain why. Keep legacy/unverifiable recipes usable with an explicit unverified status, preserving existing libraries. Provide a documented policy override if product requirements need one; no silent treatment of read errors as freshness.

The UI must show recipe, source, status and actionable next step, with links where resolvable. Do not auto-regenerate on file changes or issue surprise model calls. User-invoked regeneration may reuse the existing generation action. Invalidate index/status caches appropriately after regeneration.

Acceptance: matching/changed/deleted/unmapped/permission-failed fixtures yield distinct states; source changes affect retrieval without changing recipe Markdown; manual refresh bypasses cached hash results; legacy records work; no out-of-root reads; cancelled checks terminate cleanly.

## Phase 6 — Implement optional hybrid retrieval and evaluate

### Provider and cache

Keep lexical-only as the default. Add an embedding-provider interface supporting document/query embedding, provider/model identity, vector dimension, cancellation and clear failure states. Implement one real configurable adapter using an existing approved local or organizational endpoint when available. Do not claim Copilot chat models automatically expose embedding APIs.

If no real provider can be configured in this environment, still implement/test the interface, adapter contract, cache, fusion and opt-in wiring. Mark the live semantic run as blocked by a concrete provider/model configuration. Provide exact setup/run instructions. Fake vectors validate plumbing only.

Cache vectors using source/contract content hash, schema/embedding-text version, provider/model ID and dimension. Separate caches by workspace/corpus as needed. Reject non-finite values, wrong dimensions and model-version mismatch. Avoid committing vectors or private source text. Do not embed unknown/stale content or secrets without the same policy checks used elsewhere. Document data sent to a configured remote endpoint.

### Fusion

Retrieve lexical and semantic ranked lists for the same operation and eligible recipe set. Fuse unique IDs using reciprocal rank fusion:

`fusedScore(d) = sum(weight_i / (rrfK + rank_i(d)))`

Ranks are one-based; absent documents contribute zero; use a configurable positive rrfK, deterministic ties, and rank each branch after its documented eligibility/mode policy. Do not add incomparable raw cosine and TF-IDF scores. Expose branch ranks/scores for diagnosis. Apply an acceptance policy calibrated for the hybrid pipeline, not the old lexical threshold.

Provider failure must fall back to lexical results with a clear diagnostic and cancellation must not become a normal failure-triggered retry. Bound latency, batching and concurrency. A lexical-only run must perform zero embedding network requests.

### Evaluation and promotion

Run lexical baseline, improved lexical operation retrieval, semantic-only and hybrid on the same versioned data/splits when a real provider exists. Compare relevance, no-match errors, packed operation coverage, latency, token cost, cold/warm cache and dependency footprint. Keep defaults unchanged if evidence does not support promotion. A result showing no gain is valid; do not force a win by changing labels or tuning on holdout.

Acceptance: real adapter plus deterministic contract/fusion/cache tests; lexical fallback works; settings are wired to execution; an actual provider evaluation is recorded or explicitly unavailable. Do not mark live hybrid evaluation complete based on mocked vectors.

## Required regression matrix

Add focused tests as part of the owning phases, not just broad snapshots:

| Area | Required cases |
| --- | --- |
| Metrics | hand-calculated ranks, misses, fewer-than-k, duplicates, negatives, empty subsets, alternative helpers |
| Corpus | multi-method source, overloads, same names in different owners, constructor dependencies, multiline syntax, cap/deferred reporting, config recipe |
| Compatibility | old frontmatter/body, new schema round-trip, unknown provenance, stable IDs and reupload |
| Generation | malformed/empty output, grounding failure, partial writes, cancellation, per-capability counts, no collisions |
| Planning | selected/deselected steps, relevant Background/Examples, API field names without values, later Agentic segments, unstructured fallback |
| Packing | three operations, duplicated helpers, dependencies, huge imports/prose, exact final token boundary, unmeasured tokenizer, mandatory-input overflow |
| Gate | relevant query, deceptive overlap, no-match, out-of-vocabulary, language/vendor mismatch, provisional thresholds |
| Freshness | fresh/stale/missing/unmapped/error, forced refresh, multi-root, path escapes, hash-semantic compatibility |
| Hybrid | one-based RRF math, branch-only match, duplicate IDs, deterministic ties, wrong vectors, cache invalidation, timeout/fallback/cancellation |
| Integration | normal and Agentic consumers, settings propagation, freshness command registration, accurate traceability and terminal UI states |

Use fake model/filesystem/tokenizer/provider boundaries for deterministic unit and orchestration tests. Label manual Extension Host tests and live provider tests separately. Do not run generated examples against real databases/APIs just to validate this assignment; use compile checks or controlled fixtures where appropriate.

## Deliverables and definition of done

Provide:

1. Integrated implementation and compatible settings/commands, with no disconnected feature claimed as complete.
2. Synthetic benchmark corpus, human-label template, metric/calibration commands and reproducible baseline/comparison artifacts.
3. Versioned compact corpus documentation and explicit legacy/migration behavior.
4. User documentation for source mapping/freshness checks and optional semantic-provider setup.
5. A concise implementation report listing changed behavior, meaningful checks run, numerical results with dataset provenance, remaining limitations and exact external blockers.

Run `npm test` and `npm run compile` after relevant changes, plus the benchmark/calibration commands you add. Add package scripts to invoke the actual implementation, not placeholder commands. Verify public UI wiring in an Extension Host when available; otherwise describe the untested interactions explicitly.

The final status table must contain separate rows for benchmark harness, human-data validation, capability generation, operation planning/retrieval, token packing, calibration machinery, production threshold validation, active freshness checking, hybrid implementation and live hybrid evaluation.

Do not conclude with “all done” if human-data validation or a live semantic evaluation is still unavailable. Finish all independently executable work and state precisely what input remains, how to supply it, and the command that will complete the evaluation. Do not repeatedly ask for labels while leaving implementable code unfinished.

## Suggested execution order

Baseline and harness → capability contracts/generation → operation retrieval and token packing → provisional calibration → source freshness integration → optional hybrid implementation/comparison → integration checks and documentation.

Make reasonable implementation choices consistent with this specification. Where a choice changes user-visible behavior, document the chosen policy and test it. Preserve correctness and truthful evidence over claims of accuracy unsupported by measurements.
