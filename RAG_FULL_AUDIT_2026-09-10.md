# RAG ingestion, matching and Total Agentic mode audit

Reviewed 10 September 2026 against the current uncommitted working tree. This supersedes neither the earlier review nor its historical evidence: it records a fresh check of the newer implementation.

**Verdict: substantial implementation is present, but it is not ready to call complete or bug-free.** The existing suite passes while targeted probes expose errors in corpus contracts, hybrid identity handling, freshness filtering and Agentic request state.

## Verification and limits

- Current unit suite: **719 passed, 0 failed**, recorded in `review-results/2026-09-10/full-audit-tests.txt`.
- Production TypeScript and integration TypeScript builds pass (`npm run pretest-integration`).
- `npm run test-integration`: **4 passed**, exit 0, in a real VS Code 1.137.0 Extension Host. These tests cover the registered freshness command, fresh source, drift in an extracted public same-file dependency, and excluding invalid-shaped Markdown from indexing.
- New diagnostic scripts execute compiled application functions and the real Agentic controller with mocked asynchronous boundaries. Their output is recorded alongside the scripts. These are review probes, not additions to the application's test count.
- `git diff --stat -- media/main.js media/main.css` is empty. No application source changes or commits were made by this audit.
- No live Copilot generation, semantic endpoint quality evaluation, browser execution of generated code, or full interactive ingestion-panel walkthrough was performed. Passing four integration tests does not validate these other flows. Real labeled requests remain necessary for real-world accuracy claims.

Reproduce the additional checks after compiling with `npm test`:

```text
node review-results/2026-09-10/full-audit-probes.cjs
node review-results/2026-09-10/agentic-lifecycle-probes.cjs
```

## Implementation trace

**RAG ingestion:** uploaded source/ZIP entries → upload filtering → capability extraction → target resolution → capability prompt → Copilot response → recipe normalization/frontmatter → grounding checks → redaction → frontmatter revalidation → Markdown write/cache invalidation. Rejected responses go to the draft folder. Extraction caps are now reported; generated recipes carry source/hash-scheme provenance.

**Matching:** valid `.github/rag/**/*.md` → TF-IDF index → selected-step/Agentic-segment operation plan → per-operation lexical or optional hybrid retrieval → merged candidates → freshness exclusions → token-budget packing → injected contracts. The order of freshness versus candidate retrieval is a remaining defect below. Semantic retrieval is explicitly configured and off by default.

**Total Agentic mode:** upload and format-specific parsing → selected segment extraction → custom instructions and RAG → `ChatPromptTemplate.pipe(model).pipe(StringOutputParser)` → feature/code panel or normalized CSV file. CSV, text, XLSX, DOCX and PDF extraction modules are connected. The LangChain model adapter translates messages into the VS Code Copilot API and performs final request admission checking.

**Important scope distinction:** Total Agentic mode uses real LangChain composition, but each generation action is a single model invocation. It does not bind tools, run a planning/execution loop, compile generated automation, or invoke `runToolCallingAgent`. The separate `src/agent/verifyFixAgent.ts` provides a bounded tool loop for another flow. Total Agentic's Verify button is deliberately disabled. Do not describe Total Agentic output as automatically executed or verified. If autonomous verification was an intended requirement, that integration is still absent; it is not a defect in the use of `pipe()` itself.

## Findings and copyable remediation instructions

The blocks below are independent prompts for a fixing agent. P1 means a high-impact correctness/data-handling defect; P2 means a functional or reliability defect worth correcting before closeout. Locations refer to this reviewed working tree.

### A01 — P1: raw capability signatures bypass pre-prompt redaction

**Location:** `src/rag/ragCorpusGenerator.ts:232–243` (`buildCapabilityPrompt`). **Evidence:** direct code trace. Only `capability.excerpt` is scrubbed; `capability.signature` is interpolated unmodified. A Python default such as `def login(password="SYNTHETIC_SECRET"):` is part of both values, so redacting the excerpt does not prevent sending the value in the signature.

```text
Fix buildCapabilityPrompt so every source-derived part sent to Copilot is sanitized, including the signature. Preserve the original source only for local provenance hashing. Add a generator-boundary test using a synthetic password default and inspect the complete outgoing prompt: the sentinel must occur nowhere. Preserve callable syntax while replacing sensitive literals. Do not log the raw value.
```

### A02 — P1: grounding accepts wrong calls and even recipes with no usage example

**Location:** `src/rag/ragSourceGrounding.ts:327–337, 420–466`. **Reproduced:** `API: public int find(int id)` plus `Owner: Helper` and a fenced `Fake.find()` returns `{ok:true}`. A body consisting only of that API declaration and owner also passes. Scanning the whole body counts the declaration as an invocation; any matching argument count wins. An owner mention elsewhere does not establish the example's receiver.

```text
Separate declaration validation from usage-example validation. Require a complete executable example and inspect actual call expressions in that example; declarations, comments and prose must never satisfy the invocation check. Match owner/receiver evidence and expected argument shape, with explicit unverifiable handling where static analysis cannot establish it. Test correct API metadata plus a wrong-arity call, a fabricated receiver, no example, and multiple examples containing an invalid call. Include constructor examples and Python instance/static methods. Do not advertise type/order validation without implementing it.
```

### A03 — P1: redaction still corrupts valid Python contracts

**Location:** `src/rag/ragSecretScrubber.ts:80` and post-scrub validation in `ragCorpusGenerator.ts`. **Reproduced:** `def login(password: str, user: str):` becomes `def login(password: <REDACTED>, user: str):`. Keeping the comma fixed one symptom; treating a type annotation as a credential value remains wrong. Frontmatter parsing does not validate Python syntax.

```text
Make secret scrubbing distinguish type annotations and parameter declarations from assigned secret values. Preserve language syntax and sanitize literal values instead. Add typed/defaulted Python signatures, dictionary credentials and ordinary password variables as tests. Validate the final contract/example after redaction, not only its YAML envelope; reject or quarantine a structurally broken contract.
```

### A04 — P2: required-import rendering emits invalid code

**Location:** `src/rag/ragRetriever.ts:273–295`. **Reproduced:** Python `from framework.db import fetch_rows` becomes `import from framework.db import fetch_rows`; Java `import static acme.Helper.find;` becomes `import acme.Helper.find;`. The generated prompt explicitly asks the LLM to copy these exact imports.

```text
Use language-aware import normalization and rendering. Preserve Python from-imports, aliases and full import statements, and Java static imports. Keep support for existing bare Java paths. Add round-trip tests through formatRagPromptSection for Python from/import/as forms and Java ordinary/static/wildcard imports. Separate package validation from display normalization so validation cannot erase required syntax.
```

### A05 — P1: methods with the same name in different owners still share source identity

**Location:** `src/rag/ragCapabilityExtraction.ts` disambiguation; `src/rag/ragCorpusGenerator.ts:214,319`; `ragRecipeNormalizer.ts:resolveRagTargets`. **Reproduced extraction:** `A.run` and `B.run` in one Python file both have `name:run` and no `namingId`. The generator therefore supplies the same file/capability identity to target resolution, which treats different excerpts as a conflict. One legitimate capability cannot be generated. Across separate uploads this also makes identity/freshness ambiguous.

```text
Give every capability a stable identity including its qualified owner, name and normalized signature, independent of whether another overload happens to be present. Use it consistently for target paths, sourcePath and freshness rematching. Preserve compatibility with existing recipes through an explicit migration or legacy lookup. Test two classes with run(), nested owners, overload additions/removal, and repeat uploads. Both owners must produce distinct retrievable recipes.
```

### A06 — P1: duplicate IDs make hybrid retrieval return another recipe's body

**Location:** `src/rag/ragIndexBuilder.ts:77–88`; `src/rag/ragHybridRetriever.ts:172–199`. **Reproduced:** two recipes have `id:same`, one alpha lookup and one beta delete. Lexical retrieval correctly returns alpha under its suffixed ID. Hybrid retrieval for alpha instead returns beta's body under `same`. Index metadata uses deduplicated IDs; semantic recipes/maps still use the original IDs. The alpha ranking gets joined to beta content and lexical suffixed candidates are discarded.

```text
Establish one canonical unique recipe identity at index construction and carry it through lexical metadata, index.recipes, semantic rankings, RRF, gates, packing and traceability. Never join ranking evidence to content by a nonunique original ID. Add the alpha/beta duplicate-ID probe as a regression test and verify both identity and returned body/path. Also test collisions between an existing ID and a generated suffixed ID.
```

### A07 — P1: upload-only sources are classified missing and their new recipes excluded

**Location:** `src/rag/ragFreshnessService.ts:85–91,178,247–250`; `agenticModeController.ts:571–577`; `objectSpyPanel.ts:2042–2060`. **Evidence:** end-to-end code trace. Corpus upload retains source provenance but does not install the original source into the open workspace. Freshness searches the source path under workspace roots; an externally uploaded file/ZIP absent there becomes missing. Both generation flows exclude it. The user can successfully create a recipe which immediately becomes unavailable for reuse.

```text
Distinguish an explicitly mapped source that disappeared from an uploaded source that has never been mapped into this workspace. Implement explicit source-root mapping/provenance and an honest unverifiable state for unmapped external uploads. Continue excluding genuinely stale or mapped-but-deleted sources. Test direct external upload and ZIP upload through generation, indexing, freshness and packing: a new valid unmapped recipe must not silently become unusable.
```

### A08 — P2: freshness filtering after top-k hides usable recipes

**Location:** `agenticModeController.ts:558–577`; `objectSpyPanel.ts:2024–2060`; `ragOperationRetrieval.ts:DEFAULT_PER_OPERATION_K`. **Reproduced:** four equally matching recipes, the retrieved top three stale, fourth fresh. After filtering, no candidate remains although a fresh indexed helper exists. Hybrid also embeds stale candidates before excluding them.

```text
Apply freshness eligibility before per-operation top-k and before semantic embedding, or replenish retrieval from eligible candidates until the requested pool is filled. Use the same eligibility policy in both modes and production evaluation. Test stale top-three/fresh fourth and verify that the fourth is packed; verify that excluded source content is not sent for semantic embedding.
```

### A09 — P2: the new dependency hash misses normal private-helper changes

**Location:** `src/rag/ragSourceIdentity.ts:271–347`; `ragCapabilityExtraction.ts:capabilitiesForFile`. **Reproduced:** changing private `adjust(id)` from `id + 1` to `id + 99` leaves the public caller's hash input identical under `sha256-with-same-file-deps-v1`. The dependency search receives only extracted public/capped capabilities. Fields, imports and other omitted dependencies also remain outside the hash. The live test passes because its dependency is extractable, which does not cover this case.

```text
Build dependency discovery from the complete source structure, separately from the public recipe-generation list and its cap. Include private/package helpers and relevant class state/imports. If completeness cannot be established, use a conservative whole-source hash or report limited verification instead of implying comprehensive freshness. Version any changed scheme and test private helpers, fields, constructors and dependencies beyond the recipe cap.
```

### A10 — P2: semantic failures abort generation and have no bounded wait

**Location:** `ragHybridRetriever.ts:158`; `ragHybridConfig.ts:resolveHybridRetrieveMatches`; `ragHttpEmbeddingProvider.ts:101`. **Reproduced:** a provider rejection escapes hybrid retrieval instead of returning available lexical hits. Code inspection confirms HTTP fetch has neither timeout nor cancellation signal. With hybrid enabled, an endpoint outage blocks a previously usable lexical generation flow.

```text
Add a bounded HTTP timeout and request cancellation through the embedding interface and callers. On non-cancellation semantic failures, return lexical results and report the fallback once per generation. Cancellation must stop work rather than start a fallback request. Test provider rejection, stalled fetch, cancellation, malformed response, and a subsequent successful retry.
```

### A11 — P2: incompatible vector dimensions are silently accepted

**Location:** `src/rag/ragHybridRetriever.ts:37–46,86`; `ragHttpEmbeddingProvider.ts` response validation. **Reproduced:** query vector [1,0] and document vector [1] receive similarity 1 because cosine uses the minimum length. This manufactures ranking evidence from incompatible vectors.

```text
Require equal nonzero dimensions and finite vector values across query/documents before cosine scoring. Validate document count and HTTP index correspondence, including duplicate/out-of-range indexes. Treat malformed provider output as a semantic failure handled by the lexical fallback, never truncate vectors into apparent agreement. Add mixed-dimension and misindexed batch tests.
```

### A12 — P2: embedding cache bypasses the provider's query implementation

**Location:** `src/rag/ragEmbeddingCache.ts:83–91`. **Reproduced:** an asymmetric provider whose query and document vectors differ receives zero embedQuery calls; cached.embedQuery returns its document vector. The shipped HTTP adapter currently uses the same operation for both, so this is an interface/capability bug rather than a demonstrated current HTTP quality regression.

```text
Delegate cache misses for queries to inner.embedQuery. Separate query/document cache namespaces so identical text can have different task-specific embeddings. Test an asymmetric provider and repeated hits in both namespaces; preserve provider/model isolation.
```

### A13 — P1: cancelled or superseded Agentic generation can publish late results

**Location:** `src/agentic/agenticModeController.ts:834–846,884–896,943–969`. **Reproduced with real controller/deferred chain:** start feature generation, call reset(), then resolve the old model response. The cleared panel contains the old feature again. There is no request-identity/cancellation check before panel finish. CSV likewise has no check before directory creation/write/success reporting. An old rejection can also update a newer request's panel.

```text
Snapshot each Agentic request's inputs and give it a request identity/session epoch. After asynchronous boundaries and immediately before every output/file/UI side effect, verify that the request is current and not cancelled. Guard errors, status messages and token updates too. Cancellation/reset must not rely on the provider rejecting its stream. Test late resolve, late rejection, regenerate superseding an older request, reset during CSV preparation and reset immediately before write. Dispose completed token sources safely.
```

### A14 — P2: Agentic packing still measures a different request from the one sent

**Location:** `src/agentic/agenticModeController.ts:827–840,877–890,936–947`. **Reproduced at controller boundary:** mandatory-token measurement sees `mandatory` and an empty user request; chain invocation receives an additional feature/code directive and a nonempty fallback request. These additions occur after packing. The final adapter admission check can reject a near-limit request that could have worked with fewer RAG recipes.

```text
Construct the complete immutable AgenticGenerationInput before measuring it, including the action-specific directive and effective fallback user request. Measure and send this same structure, inserting only the packed RAG section. Reconcile the complete final token count and shrink optional RAG if needed. Share this construction with monitoring. Test feature/code/CSV near the safety limit with both empty and nonempty user text, and changing the chat box while preparation is awaiting I/O.
```

### A15 — P2: an in-flight upload repopulates state after Clear Data

**Location:** `src/agentic/agenticModeController.ts:197–245`. **Reproduced with real controller/deferred parser:** start upload, reset(), resolve parse; getFiles() contains the old upload. Promise.all completes and unconditionally inserts parsed files after reset.

```text
Capture an ingestion/session epoch before parsing and discard results if reset/dispose/mode change has invalidated that epoch. Avoid posting acceptance/file-list/token updates for discarded batches. Test reset during each async parser and concurrent upload batches, while preserving legitimate uploads in the current session.
```

## Recommended closeout sequence

1. Fix identity joining, secret handling and invalid-contract acceptance first (A01–A06).
2. Fix freshness eligibility/source mapping and hybrid failure behavior (A07–A12).
3. Fix Agentic lifecycle and exact request construction (A13–A15).
4. Turn the reproduced cases into regression tests, rerun the suite and the four live integration tests, then exercise generation/cancellation with real Copilot in the Extension Host.
5. Run production-pipeline benchmark/calibration on human-labeled requests and a real configured semantic provider before adjusting production defaults or claiming accuracy gains.

Other known limits remain: regex-based extraction is not a complete parser (including multiline Python definitions); per-file and aggregate context limits do not guarantee all long requirements can be used in one request; static argument type/order verification is incomplete. These should remain explicit product limitations until implemented, not be closed based solely on passing tests.
