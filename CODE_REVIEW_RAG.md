# SoftPlay code review and RAG improvement prompts

Reviewed 9 September 2026, version 0.1.75. No application code was changed.

## Scope and requirement understanding

SoftPlay records Playwright interactions, links selected Gherkin steps, and generates Java/Python UI or API automation through Copilot. Agentic Mode also generates artifacts from selected document content. RAG is intended to supply existing team helpers with correct imports and invocation examples, rather than have the model invent replacements.

The current RAG pipeline converts one uploaded source/config file per model request into Markdown, validates YAML metadata, indexes the whole recipe using local TF-IDF (unigrams, bigrams, stemming and aliases), filters by language, penalizes automation-mode mismatches, and injects two matches. It is lexical retrieval, not a neural semantic embedding system. Body limits are 1,500 characters per recipe and 4,000 characters for the assembled RAG section.

Review focused on that pipeline, its Settings and generation integration, prompt assembly, and Gherkin parsing; this is not an exhaustive audit of every execution/security path. `npm test` compiled the TypeScript and passed all 149 tests. Additional local probes reproduced filename collisions, empty recipe acceptance, import loss from truncation, and both Gherkin issues below. Live Copilot and Extension Host interactions were not exercised. Other findings below are based on traced code paths.

## Copyable bug-fix prompts

Each block is independent. P1 means address first; P2 means a functional correctness issue. Locations refer to the reviewed version.

### 1. P1 — Different inputs silently overwrite the same recipe

```text
Fix RAG output path collisions in src/rag/ragRecipeNormalizer.ts:34 and src/rag/ragCorpusGenerator.ts:73-114.

ragTargetRelPath drops the source extension and slugifies path segments. helper.java and helper.py both produce helper.md; foo_bar.py and foo-bar.py also collide. The generator checks only files existing before the batch, so two new inputs with the same target overwrite each other and both count as successes.

Precompute an unambiguous source-to-target mapping before generation. Preserve source extension and add a stable source-path hash where needed; detect duplicate normalized targets, including case-insensitive collisions. Deduplicate identical inputs or report conflicting inputs explicitly. Never silently overwrite an earlier batch result. Preserve the existing confirmation behavior for existing recipes. Make IDs stable and distinguish same-named helpers from different source paths.

Add regressions for same basename/different extensions, slug collisions, duplicate uploads, and same names in different directories. Assert every distinct source retains its own output and counts match actual outputs.
```

### 2. P1 — RAG truncation destroys examples and drops imports

```text
Fix formatRagPromptSection in src/rag/ragRetriever.ts:140-174.

Bodies are sliced at character 1,500 without respecting code fences or API signatures. Imports are appended after all bodies, then the entire section is sliced at 4,000 characters. A local reproduction with two 1,700-character fenced bodies lost every import. The final truncation notice also makes the supposed 4,000-character limit exceed 4,000 (4,135 in the probe).

Pack complete recipe units: ID, source, required imports, exact signature, and a complete minimal invocation. Reserve overhead before adding content. Shorten optional prose or omit the lowest-ranked whole recipe when it cannot fit; never cut through code or imports. Return the list of actually included recipes along with the section so traceability does not list omitted matches. Cover both normal and Agentic Mode callers.

Add tests for oversized bodies, long imports/metadata, two competing recipes, valid fence boundaries, and an actual final-size limit including notices.
```

### 3. P1 — ZIP limits are applied after unbounded decompression

```text
Fix src/rag/zipReader.ts:56-114 and src/panel/settingsPanel.ts:146-160.

handleExpandRagZip first calls unzip, which synchronously inflates every archive entry into memory, then excludes noise directories, unsupported files, and entries over 200 KB. Consequently a small compressed archive or a large irrelevant generated file can consume excessive memory and block the extension before those limits help. The 25 MB UI upload limit does not bound expanded data.

Read and validate directory metadata first. Apply allowed-path/type and declared-size checks before extraction. Enforce maximum entry count, actual per-entry decompressed bytes, aggregate decompressed bytes, and compressed upload bytes in the extension host. Use bounded inflate output and validate sizes/offsets. Avoid synchronous bulk decompression on the extension event loop for large archives. Preserve support for ordinary stored and deflated archives.

Add small bounded fixtures testing highly compressible oversized entries, aggregate limits, ignored directories, invalid offsets and normal archives. Do not create a real resource-exhausting fixture.
```

### 4. P2 — Empty or invalid model output becomes an indexed success

```text
Fix normalizeGeneratedRecipe in src/rag/ragRecipeNormalizer.ts:77, parseRagFile in src/rag/ragFrontmatter.ts, and the success path in src/rag/ragCorpusGenerator.ts:105-122.

normalizeGeneratedRecipe('helper.java', '') currently creates valid frontmatter with an empty body; parseRagFile accepts it. Malformed output is wrapped wholesale as a broadly applicable recipe and written directly into .github/rag. The warning requests review but does not prevent retrieval. A response with valid metadata and no usable API example is also accepted.

Reject empty responses/bodies. For malformed output, attempt one bounded repair using validation errors; if still invalid, report failure or save a draft outside the indexed corpus. Do not mark it as a normal successful recipe. Validate required callable content for helper recipes and loading instructions for config recipes. Keep schema validity separate from verified source/API correctness.

Test empty output, whitespace, refusal prose, malformed YAML, empty body, and a valid compact recipe. Assert rejected/draft responses never enter normal retrieval.
```

### 5. P2 — RAG preparation failures can leave generation stuck

```text
Fix runLlmRefinement in src/panel/objectSpyPanel.ts:1438-1505, computeFingerprint/getOrBuildRagIndex in src/rag/ragIndexer.ts:43-73, and handleGenerateRagCorpus in src/panel/settingsPanel.ts:209-228.

postLlmStart runs before redaction, index building and prompt construction, but the try/catch starts only around streaming. A recipe deleted between findFiles and stat rejects computeFingerprint's Promise.all, propagates through buildRagSection, and bypasses the code-generation error UI. Corpus generation also has setup work outside per-file catches; failure creating .github/rag can bypass ragGenerationDone and leave the Generate button disabled.

Put preparation and sending inside a common guarded request lifecycle. Handle per-file stat/read races with warnings and skip only the affected file. Ensure every started operation reaches a terminal success/error/cancelled state, using request identity so stale requests cannot reset a newer request's UI. Do not silently swallow failures. Send the corpus terminal message even when batch setup fails.

Test stat/read disappearance, directory permission failure, redaction failure, cancellation, and overlapping requests; the UI must remain recoverable.
```

### 6. P2 — Corpus generation discards the source module path

```text
Fix the corpus-generation input prompt at src/rag/ragCorpusGenerator.ts:101 and prompts/generate-rag-recipe.md.

UploadedFile.relativePath is used for the output directory but not sent to the model. A Python file such as framework/db/client.py is presented only as client.py. Python source usually does not declare its own import path, so the model cannot reliably satisfy the instruction to preserve the exact module path. The same ambiguity affects config resource paths and same-named modules.

Include normalized source-relative path and verified project/source-root metadata in the generation input. Derive Python module imports from the actual package root/package layout, not by blindly converting every path segment to dots. Extract Java package declarations directly. If importability cannot be established, flag the recipe for review rather than inventing an import. Include source identity in saved metadata and preserve it through validation/serialization.

Test nested packages, src-layout projects, same-named modules, config resources, and standalone files with unknown package roots.
```

### 7. P2 — Token monitoring does not enforce prompt limits

```text
Add model-aware input budgeting to src/llm/copilotClient.ts:59-73, src/rag/ragCorpusGenerator.ts:101, and the normal/Agentic generation prompt assembly paths.

sendPrompt sends the complete prompt without a token-limit preflight. countModelTokens is a monitoring helper, not an admission check. A permitted 200 KB corpus source is sent whole; normal prompts can also exceed the model's limit through selected instructions, recordings and document content even when RAG is character-capped. Retrying without RAG only on an empty-response error does not handle explicit over-limit errors or oversized non-RAG input.

Resolve the model once per request, count the actual assembled messages with that model, and compare against maxInputTokens with a documented safety margin. Budget source input, instructions and complete RAG units before sending. For oversized corpus files, split by symbols with required declaration context; for oversized mandatory user context, provide an actionable size error instead of silently discarding requirements. Apply equivalent accounting to the LangChain/Copilot adapter path. Treat unavailable token counts explicitly and avoid claiming a measured guarantee when counting failed.

Test a fake small-context model, exact boundary, oversized source, oversized custom instructions, model fallback, and unavailable token counting. Assert no known-over-limit request reaches sendRequest.
```

### 8. P2 — Multiple Examples tag lines lose scenario data

```text
Fix Examples tag handling in src/bdd/gherkinParser.ts:172-206.

An outline with @one and @two on separate lines before Examples has zero parsed examples; both tags attach to the following scenario. The lookahead reads only one tag line and blank lines. buildFilteredScenarioText then omits the Examples table, so generated tests lose their parameter values.

Consume the complete sequence of tag lines, blank lines and comments into a lookahead buffer. Commit those tags only if the next block is Examples; otherwise leave them for the next scenario. Preserve raw Examples text and boundaries.

Add regressions for multiple tag lines, intervening comments, multiple Examples blocks, EOF, and tags belonging to the next scenario. Verify filtered scenario text retains its Examples.
```

### 9. P2 — Escaped pipes corrupt Gherkin table cells

```text
Fix consumeTable in src/bdd/gherkinParser.ts:332-343.

It splits on every pipe before unescaping. The valid row | a\|b | c | currently produces three cells instead of ['a|b', 'c']. This corrupts data-table/Examples structure used by downstream processing.

Implement an escape-aware Gherkin table scanner (or use a supported Gherkin parser). Split only on unescaped delimiter pipes and decode the defined table escapes correctly, including escaped backslashes and newlines. Preserve original rawText.

Test escaped pipes, backslashes before delimiters, newline escapes, empty cells and ordinary tables.
```

## Improving retrieval accuracy

These are recommended enhancements, not claims that each current design choice is a bug.

1. **Build a relevance benchmark first.** Label 30–50 real UI/API requests with expected helper IDs, including requests where no helper should be selected. Measure recall@k, precision@k, no-match false positives, exact import/signature correctness, and generated-code compile success. Use held-out queries to choose weights and thresholds.
2. **Retrieve by operation.** One whole source file may contain unrelated helpers. Index one method or coherent capability per recipe, retaining parent class, constructor and dependency information. Retrieve for each selected Gherkin step, then deduplicate and pack the final context by available tokens. A hard global top-two selection cannot cover a scenario needing three distinct helpers.
3. **Improve lexical signals before adding infrastructure.** Split camelCase and snake_case while retaining exact identifiers; weight symbol, title, tags and path separately from explanatory prose and implementation code. The current recipeToEmbeddingText concatenates them without explicit field weights. Preserve vendor distinctions and calibrate aliases against the benchmark.
4. **Improve the query.** Prioritize user intent and selected steps. For API mode, include sanitized body field names and explicit assertions, not just method/URL. Avoid letting recorded boilerplate dominate matching. Agentic Mode currently slices the first 4,000 query characters at several call sites: represent every selected segment so later-file requirements remain searchable.
5. **Allow abstention.** Any positive lexical score currently qualifies, followed by strong instructions to use the helper. Tune a relevance gate with negative examples. Tell the generator to reuse a helper only when the operation, parameters and preconditions fit; do not force an unrelated helper merely because it was retrieved.
6. **Apply mode ranking before candidate truncation.** retrieveRagMatches fetches 20 raw candidates before applying the 0.4 mode penalty. In a larger corpus, a compatible candidate ranked 21st cannot win even if its adjusted score would be highest. For this exact-scan store, score and rerank all language-compatible recipes before selecting, or demonstrate adequate candidate recall with a benchmark.
7. **Evaluate optional hybrid retrieval.** Combine lexical search with code-capable semantic embeddings, then fuse rankings and optionally rerank a small candidate set. RRF combines different ranked result sets without requiring comparable raw scores. This is an experiment to measure, not a reason to require an external vector database. See [Elastic's RRF documentation](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion).
8. **Track provenance and compatibility.** Store source path/hash, symbol, supported framework and version, and validation status. Detect stale recipes when their source changes. Distinguish “retrieved,” “included in prompt,” and “actually called” in the UI; the current unconditional traceability banner establishes retrieval, not verified use.

## Making “Generate RAG Corpus Format” accurate and compact

The main prompt mismatch is that generate-rag-recipe.md requests “the reusable code/config itself,” while retrieval tells the next model to import the helper and call its example. A method implementation is not a usage example. Replace implementation reproduction with a small, source-verified calling contract.

Recommended generation flow:

1. Extract source path, package/module, public symbols, signatures, return types, constructors and relevant dependencies deterministically where feasible. Send only the relevant symbol and necessary surrounding declarations, plus a small project manifest.
2. Ask the model for structured fields: intent, use conditions, prerequisites, signature and minimal invocation. Never infer unobservable APIs or return shapes. If evidence is missing, emit a review-needed result.
3. Validate metadata AND source grounding. Confirm symbols/imports exist, parameter order is exact, example uses the real API, and fences are complete. Validate language metadata against source evidence. Schema-valid YAML alone does not establish correctness.
4. Set an initial target of 250–450 tokens per capability, then tune against real helpers. Keep exact imports, signature, invocation and essential prerequisites; remove prose repetition, implementation bodies, full test classes, logging templates and repeated standards. If a contract cannot fit safely, split the capability or allow a larger complete unit.
5. Measure the final saved recipe and the final assembled model input. Token counts depend on the selected model. VS Code exposes countTokens and maxInputTokens; use those instead of assuming four characters always equal a token. See [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api) and [Language Model guide](https://code.visualstudio.com/api/extension-guides/ai/language-model).
6. Separate source storage from model context. Keep full source available locally for verification; inject only selected calling contracts. Safeguard credentials before sending source to the model and validate generated output before saving: the current corpus route relies on a prompt instruction to remove secrets from output, rather than a deterministic check.

### Compact example compatible with today's required fields

This uses a fictional API to demonstrate structure. Substitute verified signatures and imports from your actual source; do not install this example as a real recipe.

````markdown
---
id: postgres-fetch-rows
title: Query PostgreSQL rows
tags: [postgresql, database, query, rows]
automationMode: [ui, api]
language: [python]
imports:
  python: ["from framework.db.postgres import fetch_rows"]
---
Use: Read PostgreSQL data for test assertions.
Requires: An open connection; caller owns connection cleanup.
API: fetch_rows(conn, sql: str, params: tuple) -> list[dict]

```python
rows = fetch_rows(conn, sql, params)
assert rows[0][column] == expected
```
````

Add provenance/version/validation fields only together with changes to RagFrontmatterSchema, indexing and serialization: unknown keys are currently stripped during schema parsing, so editing the generation prompt alone will not preserve them.

### Copyable corpus-improvement implementation prompt

```text
Improve SoftPlay's RAG corpus generation and retrieval without changing the Java/Python UI/API requirements.

Review prompts/generate-rag-recipe.md, src/rag/ragCorpusGenerator.ts, ragRecipeNormalizer.ts, ragTypes.ts, ragFrontmatter.ts, ragIndexBuilder.ts and ragRetriever.ts plus their normal/Agentic callers.

Implement a backward-compatible compact calling-contract format. Generate one recipe per callable capability, with exact source-derived imports, signature, prerequisites and one minimal invocation; do not reproduce helper implementations or invent missing API facts. Include stable source identity and content hash. Validate output, quarantine unresolved drafts outside .github/rag, and split oversized source by symbols. Start with a configurable 250–450-token target per capability, preserving complete contracts when larger units are necessary.

Preserve provenance in the schema and serialization. Separate search text from prompt text. Improve identifier tokenization, retrieve by selected operation, support no-match results, and pack complete recipes against the resolved model's measured input budget. Preserve existing corpus compatibility. Add a small labeled retrieval benchmark with negative cases and source-grounding regressions; report before/after retrieval quality and prompt-token use. Avoid adding a hosted vector service unless measurements justify it.
```

Suggested order: fix overwrite/decompression/truncation first; address lifecycle and invalid-output handling; establish token budgeting and source grounding; then tune retrieval against the benchmark.
