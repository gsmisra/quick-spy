# Labeling real requests for the RAG benchmark

This is guidance for turning 30–50 REAL, representative requests from your own team's actual usage into a
`human-labeled` dataset the benchmark harness (`npm run rag:benchmark`) can score alongside the synthetic
baseline in `benchmarks/rag/BASELINE.md`. **These counts (30–50 total, ~20–30% negative) are a collection
target, not a statistical guarantee** — they give the calibration work in Phase 4 something real to compare
against; they do not by themselves make any accuracy claim "production-tuned." The benchmark harness and
metrics work today with zero human labels (see `benchmarks/rag/datasets/synthetic-v1.json`) — this is how you
add real evidence on top of that, not a prerequisite for anything else in this repo to function.

## What to collect

For each real request:

1. **The exact query text** your team actually typed — the linked Gherkin scenario text, the chat-box free
   text, or whatever the real "Instant instructions to LLM" content was for a real generation. Redact/replace
   anything sensitive (see "Handling sensitive content" below) before it goes in this file.
2. **Which `.github/rag/` recipe ID(s), if any, SHOULD have matched.** Look at your own real corpus
   (`.github/rag/**/*.md`, each file's own `id:` frontmatter field) and decide, independently of what the
   system actually returned, which recipe(s) a well-functioning system OUGHT to surface for this request.
   - An **empty list** is a deliberate, valid label — "nothing in the corpus should match this request."
     Include some of these on purpose (roughly 20–30% of your total, per the collection target above);
     dataset without negative examples can't measure false-positive/abstention behavior at all.
   - If TWO OR MORE different capabilities are genuinely equally acceptable for the same need (interchangeable
     helpers), use `alternativeGroups` (see the template) instead of listing them all as independently
     required in `relevantIds`.
   - If the request genuinely needs MULTIPLE DIFFERENT capabilities (not alternatives — all of them are
     actually needed), list them all in `relevantIds`.
3. **A one-sentence rationale** — why you labeled it that way. This is required by the schema
   (`ragBenchmarkTypes.ts`) specifically so a labeling decision is never a bare, unexplained ID list; a future
   reviewer (including a future you) should be able to tell WHY without re-deriving the judgment call from
   scratch.

## What NOT to do

- **Do not look at what the current system actually retrieves before labeling.** Label what SHOULD match
  based on your own understanding of the corpus and the request, independently of today's behavior — labeling
  based on current output would just measure "does the system agree with itself," not real accuracy.
- **Do not put real secrets, customer data, or anything your organization would consider sensitive into this
  file.** See "Handling sensitive content" below.
- **Do not split near-duplicate paraphrases of the same underlying request across development and holdout.**
  Keep an entire "family" of closely related wordings in the SAME split, or you risk the holdout split
  silently leaking information the development split already saw (this is called out explicitly in Phase 1's
  own dataset-construction rules).
- **Do not use the holdout split for iterative tuning.** It exists to be evaluated ONCE, at the end, for a
  final honest comparison. If you find yourself re-running against holdout repeatedly while adjusting
  something, you've turned it into a second development split — rename it and create a genuinely fresh holdout
  before claiming an independent result.

## Handling sensitive content

Source excerpts and query text are DATA, not something to trust blindly — the same deterministic scrubbing
this repository already applies elsewhere (`ragSecretScrubber.ts`, `chatInstructionRedactor.ts`) should be
applied to anything going into this file too. If a real request contains a real credential, customer
identifier, internal hostname, or anything else you wouldn't want in a committed fixture file, replace it with
an obvious placeholder (`<REDACTED>`, `<CUSTOMER_ID>`) before adding the record — never rely on this guide or
the schema to catch that for you; there is no automated scrubbing pass over hand-authored labels today.

## Template

Copy `benchmarks/rag/datasets/human-labeled-template.json` (an empty, schema-valid skeleton — zero queries,
zero recipes) to a new file (e.g. `benchmarks/rag/datasets/human-labeled-v1.json`), then:

1. Populate `recipes` with your REAL `.github/rag/*.md` corpus — one entry per recipe, using its real `id`,
   `title`, `tags`, `automationMode`, `language`, `relativePath` (this recipe's actual path under
   `.github/rag/`), and `body` (the file's content after its frontmatter). This lets the benchmark build a
   real index that matches your actual corpus, not a synthetic stand-in.
2. Populate `queries` with your labeled real requests, per the format above. Set `origin: "human-labeled"` and
   pick a `datasetVersion` you'll bump if you relabel or add more later.
3. Validate the file: `parseBenchmarkDataset()` (see `ragBenchmarkTypes.ts`) checks schema shape plus
   cross-references (duplicate IDs, dangling references, contradictory no-match labels) — the easiest way to
   validate is to point `npm run rag:benchmark <path-to-your-file>` at it directly; a malformed file reports
   every error found, not just the first.
4. Run it: `npm run rag:benchmark benchmarks/rag/datasets/human-labeled-v1.json` — this produces the same
   report shape as the synthetic baseline, with each query's own `origin` field visible in the JSON output so
   synthetic and human-labeled numbers are never silently conflated in a single claimed accuracy figure.

Keep this file OUT of any location that would leak it somewhere it shouldn't go if it contains anything
sensitive despite the guidance above — treat it with the same care as any other file containing real
production-adjacent request text.
