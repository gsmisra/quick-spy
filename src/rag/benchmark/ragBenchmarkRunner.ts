import * as crypto from 'crypto';
import { BenchmarkDataset, BenchmarkQuery, BenchmarkRecipeFixture } from './ragBenchmarkTypes';
import { scoreQuery, aggregateBenchmarkMetrics, AggregateMetrics, PerQueryMetrics } from './ragBenchmarkMetrics';
import { buildRagIndex } from '../ragIndexBuilder';
import { retrieveRagMatches } from '../ragRetriever';
import { retrieveForOperations, RetrieveMatchesFn } from '../ragOperationRetrieval';
import { packOperationCandidates, OmissionReason } from '../ragOperationPacking';
import { RagOperation } from '../ragOperationPlanner';
import { DEFAULT_RELEVANCE_GATE, RelevanceGateConfig } from '../ragRelevanceGate';
import { RagRecipe } from '../ragTypes';

/**
 * Orchestrates a full benchmark run against a labeled `BenchmarkDataset`,
 * scored by ragBenchmarkMetrics.ts. Two DISTINCT, clearly-labeled modes
 * (F15):
 *
 *  - LEGACY/BASELINE mode (`runBenchmarkOnDataset()`) — one whole-query
 *    `retrieveRagMatches()` call per query, exactly the shape this
 *    benchmark has always used. Kept, unchanged, for continuity with every
 *    historical baseline number already recorded against it (BASELINE.md,
 *    earlier calibration runs) — a regression signal ("did retrieval
 *    itself get better or worse on these fixtures") remains meaningful
 *    precisely because its own methodology never moves.
 *  - PRODUCTION-PIPELINE mode (`runProductionPipelineOnDataset()`) —
 *    the REAL end-to-end path a live request actually takes: operation
 *    decomposition (`operationsForBenchmarkQuery()`, using a query's own
 *    optional `operations` field when the dataset author provided one),
 *    per-operation retrieval (`retrieveForOperations()`), and real
 *    token-budget packing (`packOperationCandidates()`) — the same three
 *    functions objectSpyPanel.ts/agenticModeController.ts call in
 *    production. This is what can actually detect a packing/coverage
 *    regression (the classes of bug this review's own F10/F11/F13 findings
 *    describe) that whole-query-only scoring structurally cannot see.
 *
 * Neither mode calls a real LLM or measures real tokens against a real
 * model — `runProductionPipelineOnDataset()`'s own token counts are an
 * explicitly-labeled character-based ESTIMATE (`estimateTokenCount()`),
 * never presented as a real tokenizer's measurement; see
 * `ProductionModeReportMeta`'s own doc comment for why this still reports
 * itself as provisional/non-production-tuned wherever tokens or a specific
 * gate configuration are involved.
 *
 * Every exported function up to (not including) `main()` takes
 * already-parsed, in-memory data — no file I/O, no `vscode` — so this is
 * directly testable end-to-end; only `main()` at the bottom does file I/O,
 * git provenance lookup, and CLI argument parsing, invoked via
 * `npm run rag:benchmark`.
 */

/** Converts a benchmark fixture into the real `RagRecipe` shape
 * `buildRagIndex()` expects — a deliberately synthetic `filePath` (this
 * recipe never actually lives on disk) rooted under a clearly-fake
 * `/benchmark/` prefix so it could never be confused with a real
 * workspace path if it ever leaked into a log. */
export function toRagRecipe(fixture: BenchmarkRecipeFixture): RagRecipe {
  return {
    filePath: `/benchmark/.github/rag/${fixture.relativePath}`,
    relativePath: fixture.relativePath,
    frontmatter: {
      id: fixture.id,
      title: fixture.title,
      tags: fixture.tags,
      automationMode: fixture.automationMode,
      language: fixture.language,
      imports: fixture.imports
    },
    body: fixture.body,
    mtimeMs: 0
  };
}

export interface QueryRunResult extends PerQueryMetrics {
  returnedIds: string[];
  language: string;
  automationMode: string;
  split: string;
  origin: string;
}

/** LEGACY/BASELINE mode (F15 — see this file's own top-level doc comment
 * for why this is kept, unchanged, alongside the newer production-pipeline
 * mode). Runs every query in `dataset` against a freshly-built index of
 * its own `recipes` and scores the result via ONE whole-query
 * `retrieveRagMatches()` call — `k` should match that function's own
 * default `topK` (currently 2) for continuity with prior baseline numbers.
 * A query's optional `operations` field is intentionally IGNORED here —
 * this mode deliberately never exercises per-operation retrieval or
 * packing (Phase 3/4, which DO exist in the real pipeline as of this
 * writing — see `runProductionPipelineOnDataset()` for the mode that
 * actually uses them); this one exists purely as a stable regression
 * signal for the underlying lexical/hybrid retrieval scoring itself,
 * independent of how the production pipeline currently decomposes and
 * packs a request. */
export async function runBenchmarkOnDataset(dataset: BenchmarkDataset, k = 2): Promise<QueryRunResult[]> {
  const recipes = dataset.recipes.map(toRagRecipe);
  const index = await buildRagIndex(recipes);

  const results: QueryRunResult[] = [];
  for (const query of dataset.queries) {
    const matches = await retrieveRagMatches(index, query.queryText, query.language, query.automationMode, k);
    const returnedIds = matches.map((m) => m.id);
    const scored = scoreQuery(query.queryId, returnedIds, query.relevantIds, query.alternativeGroups, k);
    results.push({ ...scored, returnedIds, language: query.language, automationMode: query.automationMode, split: query.split, origin: query.origin });
  }
  return results;
}

function formatRate(rate: { value: number | null; count: number }): string {
  return rate.value === null ? `n/a (0 queries)` : `${(rate.value * 100).toFixed(1)}% (n=${rate.count})`;
}

interface Segment {
  label: string;
  results: QueryRunResult[];
}

function buildSegments(results: QueryRunResult[]): Segment[] {
  const by = <K extends keyof QueryRunResult>(key: K, value: QueryRunResult[K]) => results.filter((r) => r[key] === value);
  return [
    { label: 'Overall', results },
    { label: 'Java', results: by('language', 'java') },
    { label: 'Python', results: by('language', 'python') },
    { label: 'UI mode', results: by('automationMode', 'ui') },
    { label: 'API mode', results: by('automationMode', 'api') },
    { label: 'Development split', results: by('split', 'development') },
    { label: 'Holdout split', results: by('split', 'holdout') },
    { label: 'Synthetic origin', results: by('origin', 'synthetic') },
    { label: 'Human-labeled origin', results: by('origin', 'human-labeled') }
  ].filter((segment) => segment.results.length > 0);
}

export interface BenchmarkReport {
  json: {
    datasetVersion: string;
    generatedAt: string;
    queryCount: number;
    segments: Record<string, AggregateMetrics>;
    perQuery: QueryRunResult[];
  };
  markdown: string;
}

/** Builds both a machine-readable (JSON, per-query detail included for
 * diffing/diagnosis) and human-readable (Markdown summary table) report
 * from already-scored results — pure and synchronous, so this half of
 * report generation is independently testable from the async retrieval
 * half above. */
export function buildBenchmarkReport(dataset: BenchmarkDataset, results: QueryRunResult[], generatedAt = new Date().toISOString()): BenchmarkReport {
  const segments = buildSegments(results);
  const segmentAggregates: Record<string, AggregateMetrics> = {};
  for (const segment of segments) {
    segmentAggregates[segment.label] = aggregateBenchmarkMetrics(segment.results);
  }

  const originCounts = new Set(dataset.queries.map((q) => q.origin));
  const syntheticNote =
    originCounts.size === 1 && originCounts.has('synthetic')
      ? '**All queries in this run are SYNTHETIC** — these numbers describe how well retrieval matches a hand-built, ' +
        'deliberately small fixture corpus, NOT real-world accuracy. Treat this as a regression baseline (did a change ' +
        'make the synthetic cases better or worse?), never as a production accuracy claim.'
      : 'This run mixes synthetic and human-labeled queries — see each query\'s own `origin` field in the JSON report ' +
        'before treating any single number as representative of real-world accuracy.';

  const rows = segments
    .map((segment) => {
      const agg = segmentAggregates[segment.label];
      return (
        `| ${segment.label} | ${agg.queryCount} | ${agg.positiveQueryCount} | ${agg.negativeQueryCount} | ` +
        `${formatRate(agg.recallAtK)} | ${formatRate(agg.precisionAtK)} | ${formatRate(agg.precisionAmongReturned)} | ` +
        `${formatRate(agg.meanReciprocalRank)} | ${formatRate(agg.noMatchFalsePositiveRate)} | ${formatRate(agg.positiveAbstentionRate)} |`
      );
    })
    .join('\n');

  const markdown =
    `# RAG retrieval benchmark (LEGACY/BASELINE mode) — dataset v${dataset.datasetVersion}\n\n` +
    `Generated: ${generatedAt}\n\n` +
    `${syntheticNote}\n\n` +
    `**Operations note (F15):** per-query \`operations\` (when present) are deliberately IGNORED in this mode — ` +
    `every query here is scored as ONE whole-query \`retrieveRagMatches()\` call, regardless of how many operations ` +
    `it declares. This is NOT what the real production pipeline does — the real pipeline decomposes a request into ` +
    `per-operation retrieval and real token-budget packing (Phase 3/4, which DO exist). This LEGACY mode is kept ` +
    `deliberately unchanged as a stable regression signal for the underlying retrieval scoring itself; see the ` +
    `separate PRODUCTION-PIPELINE mode report (\`*.production.latest.md\`) for a run that actually exercises the ` +
    `real end-to-end path.\n\n` +
    `| Segment | Queries | Positive | Negative | Recall@k | Precision@k | Precision (returned) | MRR | No-match FP rate | Abstention rate |\n` +
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n` +
    `${rows}\n`;

  return {
    json: {
      datasetVersion: dataset.datasetVersion,
      generatedAt,
      queryCount: dataset.queries.length,
      segments: segmentAggregates,
      perQuery: results
    },
    markdown
  };
}

// =============================================================================
// PRODUCTION-PIPELINE mode (F15) — see this file's own top-level doc comment.
// =============================================================================

/** Decomposes ONE benchmark query into the operations the PRODUCTION
 * pipeline would actually retrieve against — uses the query's own
 * OPTIONAL `operations` field when the dataset author provided one
 * (letting a multi-step scenario fixture exercise real per-operation
 * retrieval, exactly like a real multi-step Gherkin scenario would),
 * falling back to exactly ONE operation wrapping the whole `queryText`
 * when it's absent — the same "nothing more specific to decompose"
 * fallback `ragOperationPlanner.ts`'s own `planUnstructuredOperation()`
 * uses in production. */
export function operationsForBenchmarkQuery(query: BenchmarkQuery): RagOperation[] {
  if (query.operations && query.operations.length > 0) {
    return query.operations.map((op) => ({ operationId: op.operationId, text: op.text }));
  }
  return [{ operationId: 'whole-query', text: query.queryText }];
}

/** A DELIBERATELY crude, clearly-labeled chars-per-token ESTIMATE — this
 * offline harness has no real model to ask, so `packOperationCandidates()`
 * (which needs SOME token counter) is given this instead of a real
 * tokenizer. Every field this produces (`estimatedTokens` on each result,
 * every mention in the production-mode report) says "estimated," never
 * "measured" — this is NOT a claim about what any real model's tokenizer
 * would actually report, only a rough, consistent stand-in so packing's
 * own budget-fitting LOGIC can be exercised and compared across runs.
 * Exported (rather than duplicated) so any other offline harness needing
 * the SAME estimate against the SAME production packing path — e.g.
 * ragCalibrationRunner.ts's own production-pipeline calibration mode —
 * reuses this single definition instead of drifting out of sync with it. */
export const ESTIMATED_CHARS_PER_TOKEN = 4;
export async function estimateTokenCount(text: string): Promise<number> {
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

export interface ProductionModeQueryResult extends PerQueryMetrics {
  /** IDs that survived packing — the actual final set a real request
   * would include in its prompt. */
  returnedIds: string[];
  /** IDs `retrieveForOperations()` found, BEFORE packing decided what
   * fits — lets a report distinguish "retrieval didn't find it" from
   * "retrieval found it, but packing dropped it" (F10/F11's own failure
   * modes — invisible to legacy whole-query-only scoring). */
  retrievedIds: string[];
  operationCount: number;
  coveredOperationCount: number;
  /** See `estimateTokenCount()`'s own doc comment — an ESTIMATE, never a
   * real model's measurement. */
  estimatedTokens: number;
  tokensUnmeasured: boolean;
  omittedByReason: Partial<Record<OmissionReason, number>>;
  /** Wall-clock time for THIS process's own retrieval+packing work —
   * real, measured local CPU/IO time, but explicitly EXCLUDES any actual
   * LLM network call (there is none in this offline harness) — never
   * presented as "how long a real generation request would take." */
  latencyMs: number;
  language: string;
  automationMode: string;
  split: string;
  origin: string;
}

export interface ProductionPipelineOptions {
  /** Matches `ragOperationRetrieval.ts`'s own `DEFAULT_PER_OPERATION_K`
   * unless overridden. */
  perOperationK?: number;
  /** A stand-in for a real resolved model's `maxInputTokens` — this
   * harness has none to ask, so packing is evaluated against an ASSUMED
   * budget. Defaults to a generous, round figure representative of a
   * modern large-context model; override to evaluate against a smaller
   * one. */
  estimatedMaxInputTokens?: number;
  /** A stand-in for the caller's own already-measured non-RAG prompt
   * cost (built-in instructions, custom instruction files, ...) — real
   * production requests measure this for real; this harness assumes a
   * round, documented figure instead. */
  estimatedMandatoryTokens?: number;
  gateConfig?: RelevanceGateConfig;
}

const DEFAULT_PRODUCTION_OPTIONS: Required<ProductionPipelineOptions> = {
  perOperationK: 3,
  estimatedMaxInputTokens: 128_000,
  estimatedMandatoryTokens: 2_000,
  gateConfig: DEFAULT_RELEVANCE_GATE
};

/** PRODUCTION-PIPELINE mode (F15) — runs every query through the SAME
 * three functions a real request actually uses: `operationsForBenchmarkQuery()`
 * (decomposition), `retrieveForOperations()` (per-operation retrieval,
 * bound to `options.gateConfig` for every operation), and
 * `packOperationCandidates()` (real budget-fitting logic, against the
 * ESTIMATED budget described in `ProductionPipelineOptions`'s own doc
 * comments). Scores each query against `returnedIds` — the POST-PACKING
 * set, i.e. exactly what a real request would have included — using
 * `k = returnedIds.length` (never an arbitrary re-truncation on top of
 * what packing already decided; packing's own inclusion decision IS the
 * cutoff here, not a second one layered on top of it). */
export async function runProductionPipelineOnDataset(dataset: BenchmarkDataset, options: ProductionPipelineOptions = {}): Promise<ProductionModeQueryResult[]> {
  const opts = { ...DEFAULT_PRODUCTION_OPTIONS, ...options };
  const recipes = dataset.recipes.map(toRagRecipe);
  const index = await buildRagIndex(recipes);

  const retrieveMatches: RetrieveMatchesFn = (idx, queryText, language, automationMode, k) => retrieveRagMatches(idx, queryText, language, automationMode, k, opts.gateConfig);

  const results: ProductionModeQueryResult[] = [];
  for (const query of dataset.queries) {
    const startedAt = Date.now();
    const operations = operationsForBenchmarkQuery(query);
    const candidates = await retrieveForOperations(index, operations, query.language, query.automationMode, opts.perOperationK, retrieveMatches);
    const retrievedIds = candidates.map((c) => c.match.id);
    const packed = await packOperationCandidates(candidates, operations, query.language, {
      maxInputTokens: opts.estimatedMaxInputTokens,
      safetyMargin: 1,
      mandatoryTokens: opts.estimatedMandatoryTokens,
      countTokens: estimateTokenCount
    });
    const returnedIds = packed.includedMatches.map((m) => m.id);
    const latencyMs = Date.now() - startedAt;

    const scored = scoreQuery(query.queryId, returnedIds, query.relevantIds, query.alternativeGroups, returnedIds.length);
    const omittedByReason: Partial<Record<OmissionReason, number>> = {};
    for (const omission of packed.diagnostics.omitted) {
      omittedByReason[omission.reason] = (omittedByReason[omission.reason] ?? 0) + 1;
    }

    results.push({
      ...scored,
      returnedIds,
      retrievedIds,
      operationCount: operations.length,
      coveredOperationCount: packed.diagnostics.operationCoverage.filter((c) => c.covered).length,
      estimatedTokens: packed.diagnostics.countedTokens ?? 0,
      tokensUnmeasured: packed.diagnostics.tokensUnmeasured,
      omittedByReason,
      latencyMs,
      language: query.language,
      automationMode: query.automationMode,
      split: query.split,
      origin: query.origin
    });
  }
  return results;
}

/** Exported for reuse by any other offline harness reporting against the
 * SAME notion of "which corpus content produced this" — e.g.
 * ragCalibrationRunner.ts's own production-pipeline calibration mode —
 * rather than each harness computing its own, potentially-drifting
 * fingerprint. */
export function computeCorpusFingerprint(recipes: BenchmarkRecipeFixture[]): string {
  const canonical = recipes
    .map((r) => `${r.id}::${r.relativePath}::${r.body}`)
    .sort()
    .join('\n---\n');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export interface GitProvenance {
  commit: string;
  dirty: boolean;
}

export interface ProductionModeReportMeta {
  perOperationK: number;
  estimatedMaxInputTokens: number;
  estimatedMandatoryTokens: number;
  gateConfig: RelevanceGateConfig;
  /** `undefined` when git itself isn't available or this isn't a git
   * checkout — computed in `main()` (the only place process/file-system
   * access belongs in this module) and passed in; never a hard failure. */
  gitProvenance?: GitProvenance;
}

export interface ProductionModeReport {
  json: {
    datasetVersion: string;
    generatedAt: string;
    queryCount: number;
    /** SHA-256 of the dataset's own recipe content — F15's "corpus
     * fingerprint" reproducibility requirement: a report can always be
     * traced back to EXACTLY which corpus content produced it, independent
     * of the dataset file's own version string (which a human could bump
     * without actually changing content, or forget to bump when they do). */
    corpusFingerprint: string;
    meta: ProductionModeReportMeta;
    segments: Record<string, AggregateMetrics>;
    perQuery: ProductionModeQueryResult[];
  };
  markdown: string;
}

/** Builds the PRODUCTION-PIPELINE mode report — same segment-aggregation
 * machinery as the legacy report (`ProductionModeQueryResult` extends
 * `PerQueryMetrics`, so `aggregateBenchmarkMetrics()`/`buildSegments()`
 * apply unchanged), PLUS the operation-coverage/token/latency/omission
 * diagnostics and reproducibility metadata (F15) legacy mode never
 * reported at all. */
export function buildProductionModeReport(
  dataset: BenchmarkDataset,
  results: ProductionModeQueryResult[],
  meta: ProductionModeReportMeta,
  generatedAt = new Date().toISOString()
): ProductionModeReport {
  const segments = buildSegments(results as unknown as QueryRunResult[]);
  const segmentAggregates: Record<string, AggregateMetrics> = {};
  for (const segment of segments) {
    segmentAggregates[segment.label] = aggregateBenchmarkMetrics(segment.results as unknown as PerQueryMetrics[]);
  }

  const totalOperations = results.reduce((sum, r) => sum + r.operationCount, 0);
  const totalCovered = results.reduce((sum, r) => sum + r.coveredOperationCount, 0);
  const operationCoverageRate = totalOperations > 0 ? totalCovered / totalOperations : null;
  const avgEstimatedTokens = results.length > 0 ? results.reduce((sum, r) => sum + r.estimatedTokens, 0) / results.length : null;
  const avgLatencyMs = results.length > 0 ? results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length : null;
  const anyUnmeasured = results.some((r) => r.tokensUnmeasured);

  const omissionTotals: Partial<Record<OmissionReason, number>> = {};
  for (const result of results) {
    for (const [reason, count] of Object.entries(result.omittedByReason)) {
      omissionTotals[reason as OmissionReason] = (omissionTotals[reason as OmissionReason] ?? 0) + (count ?? 0);
    }
  }
  const omissionSummary =
    Object.entries(omissionTotals)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(', ') || 'none';

  const rows = segments
    .map((segment) => {
      const agg = segmentAggregates[segment.label];
      return (
        `| ${segment.label} | ${agg.queryCount} | ${agg.positiveQueryCount} | ${agg.negativeQueryCount} | ` +
        `${formatRate(agg.recallAtK)} | ${formatRate(agg.precisionAtK)} | ${formatRate(agg.precisionAmongReturned)} | ` +
        `${formatRate(agg.meanReciprocalRank)} | ${formatRate(agg.noMatchFalsePositiveRate)} | ${formatRate(agg.positiveAbstentionRate)} |`
      );
    })
    .join('\n');

  const provisionalNote = dataset.queries.some((q) => q.origin === 'synthetic')
    ? '**PROVISIONAL — this dataset includes SYNTHETIC labels.** These numbers describe how the REAL production ' +
      'pipeline (operation decomposition + per-operation retrieval + packing) behaves against a hand-built fixture ' +
      'corpus, using an ESTIMATED (never measured) token counter — not a production accuracy claim, and not tuned ' +
      'against any real model\'s real tokenizer.'
    : 'This run used only human-labeled data, but token counts remain an ESTIMATE (see `meta` in the JSON report) — ' +
      'no real model was consulted.';

  const gitLine = meta.gitProvenance
    ? `Git: \`${meta.gitProvenance.commit}\`${meta.gitProvenance.dirty ? ' (DIRTY working tree — uncommitted changes were present when this ran)' : ' (clean working tree)'}`
    : 'Git: unavailable (not a git checkout, or git could not be run) — this report\'s exact code provenance is unknown.';

  const markdown =
    `# RAG retrieval benchmark (PRODUCTION-PIPELINE mode) — dataset v${dataset.datasetVersion}\n\n` +
    `Generated: ${generatedAt}\n\n${provisionalNote}\n\n` +
    `## Reproducibility metadata\n\n` +
    `Corpus fingerprint (SHA-256 of recipe content): \`${computeCorpusFingerprint(dataset.recipes)}\`\n\n` +
    `${gitLine}\n\n` +
    `Config: perOperationK=${meta.perOperationK}, estimatedMaxInputTokens=${meta.estimatedMaxInputTokens.toLocaleString()}, ` +
    `estimatedMandatoryTokens=${meta.estimatedMandatoryTokens.toLocaleString()}, gateConfig=\`${JSON.stringify(meta.gateConfig)}\`\n\n` +
    `## Retrieval/scoring (post-packing — what a real request would actually include)\n\n` +
    `| Segment | Queries | Positive | Negative | Recall@k | Precision@k | Precision (returned) | MRR | No-match FP rate | Abstention rate |\n` +
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n` +
    `${rows}\n\n` +
    `## Packing diagnostics\n\n` +
    `Operation coverage: ${operationCoverageRate === null ? 'n/a' : `${(operationCoverageRate * 100).toFixed(1)}%`} (${totalCovered}/${totalOperations} operations had at least one included candidate)\n\n` +
    `Average ESTIMATED tokens per query: ${avgEstimatedTokens === null ? 'n/a' : avgEstimatedTokens.toFixed(0)}${anyUnmeasured ? ' (at least one query\'s token count was UNMEASURED — see per-query detail in the JSON report)' : ''}\n\n` +
    `Average local retrieval+packing latency: ${avgLatencyMs === null ? 'n/a' : `${avgLatencyMs.toFixed(1)} ms`} (excludes any real LLM network call — there is none in this harness)\n\n` +
    `Omissions by reason (summed across all queries): ${omissionSummary}\n\n` +
    'This report never selects or promotes anything — it is a comparison/diagnostic artifact only.\n';

  return {
    json: {
      datasetVersion: dataset.datasetVersion,
      generatedAt,
      queryCount: dataset.queries.length,
      corpusFingerprint: computeCorpusFingerprint(dataset.recipes),
      meta,
      segments: segmentAggregates,
      perQuery: results
    },
    markdown
  };
}

/** Best-effort git commit hash + dirty/clean working-tree status (F15's
 * "dirty-worktree provenance" requirement) — `undefined` on any failure
 * (not a git checkout, `git` not on PATH, ...), never a hard error; a
 * report missing this just says so explicitly rather than the whole
 * benchmark run failing over a diagnostic nicety. Process/file-system
 * access, so this lives here in `main()`, never in the pure report
 * builders above. */
export async function getGitProvenance(): Promise<GitProvenance | undefined> {
  try {
    const { execSync } = await import('child_process');
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { commit, dirty: status.trim().length > 0 };
  } catch {
    return undefined;
  }
}

/* c8 ignore start -- thin CLI glue (file I/O, argv, process.exit); the
   actual logic above is what's unit tested. */
async function main(): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const { parseBenchmarkDataset } = await import('./ragBenchmarkTypes');

  const datasetPath = process.argv[2] ?? path.join(__dirname, '..', '..', '..', '..', 'benchmarks', 'rag', 'datasets', 'synthetic-v1.json');
  const outDir = process.argv[3] ?? path.join(__dirname, '..', '..', '..', '..', 'benchmarks', 'rag', 'results');

  console.log(`Loading benchmark dataset: ${datasetPath}`);
  const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const parsed = parseBenchmarkDataset(raw);
  if (!parsed.ok || !parsed.dataset) {
    console.error('Invalid benchmark dataset:');
    for (const error of parsed.errors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  const dataset = parsed.dataset;
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Running ${dataset.queries.length} quer(ies) against ${dataset.recipes.length} synthetic recipe(s) — LEGACY/BASELINE mode...`);
  const legacyResults = await runBenchmarkOnDataset(dataset);
  const legacyReport = buildBenchmarkReport(dataset, legacyResults);
  const legacyJsonPath = path.join(outDir, `synthetic-v${dataset.datasetVersion}.legacy.latest.json`);
  const legacyMarkdownPath = path.join(outDir, `synthetic-v${dataset.datasetVersion}.legacy.latest.md`);
  fs.writeFileSync(legacyJsonPath, JSON.stringify(legacyReport.json, null, 2), 'utf8');
  fs.writeFileSync(legacyMarkdownPath, legacyReport.markdown, 'utf8');
  console.log(`\n${legacyReport.markdown}`);

  console.log(`Running ${dataset.queries.length} quer(ies) — PRODUCTION-PIPELINE mode (F15: real operation decomposition + per-operation retrieval + packing)...`);
  const productionResults = await runProductionPipelineOnDataset(dataset);
  const productionReport = buildProductionModeReport(dataset, productionResults, {
    perOperationK: DEFAULT_PRODUCTION_OPTIONS.perOperationK,
    estimatedMaxInputTokens: DEFAULT_PRODUCTION_OPTIONS.estimatedMaxInputTokens,
    estimatedMandatoryTokens: DEFAULT_PRODUCTION_OPTIONS.estimatedMandatoryTokens,
    gateConfig: DEFAULT_PRODUCTION_OPTIONS.gateConfig,
    gitProvenance: await getGitProvenance()
  });
  const productionJsonPath = path.join(outDir, `synthetic-v${dataset.datasetVersion}.production.latest.json`);
  const productionMarkdownPath = path.join(outDir, `synthetic-v${dataset.datasetVersion}.production.latest.md`);
  fs.writeFileSync(productionJsonPath, JSON.stringify(productionReport.json, null, 2), 'utf8');
  fs.writeFileSync(productionMarkdownPath, productionReport.markdown, 'utf8');
  console.log(`\n${productionReport.markdown}`);

  console.log(
    `Full reports written to:\n  ${legacyJsonPath}\n  ${legacyMarkdownPath}\n  ${productionJsonPath}\n  ${productionMarkdownPath}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
