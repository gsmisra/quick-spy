import { BenchmarkDataset } from './ragBenchmarkTypes';
import { scoreQuery, aggregateBenchmarkMetrics, AggregateMetrics, PerQueryMetrics } from './ragBenchmarkMetrics';
import { toRagRecipe, operationsForBenchmarkQuery, estimateTokenCount, computeCorpusFingerprint, getGitProvenance, GitProvenance } from './ragBenchmarkRunner';
import { buildRagIndex } from '../ragIndexBuilder';
import { retrieveRagMatches } from '../ragRetriever';
import { retrieveForOperations, RetrieveMatchesFn } from '../ragOperationRetrieval';
import { packOperationCandidates } from '../ragOperationPacking';
import { RelevanceGateConfig, DEFAULT_RELEVANCE_GATE } from '../ragRelevanceGate';

/**
 * Calibration harness (Phase 4) for rag/ragRelevanceGate.ts's configurable
 * acceptance gate — compares a small, DOCUMENTED parameter grid on the
 * benchmark's DEVELOPMENT split only, selects a configuration via an
 * explicit objective + deterministic tie-break policy, and evaluates that
 * ONE selection against the HOLDOUT split exactly once. Deliberately pure
 * (beyond the async retrieval calls it orchestrates), zero `vscode`
 * import, directly unit tested — same "pure logic tested, glue reviewed"
 * split as every other RAG module this session.
 *
 * CRITICAL: this module NEVER writes its result back into
 * `DEFAULT_RELEVANCE_GATE` or any other production code path. A
 * calibration run against synthetic-only labels produces a
 * RECOMMENDATION artifact (see `buildCalibrationReport()`'s own
 * `provisional` flag and ragCalibrationRunner.ts's CLI `main()`, which
 * only ever WRITES a report file, never edits ragRelevanceGate.ts) — the
 * live production default stays conservative and backward-compatible
 * until real, non-synthetic evidence justifies promoting a different one,
 * and that promotion is a deliberate, separate, human-reviewed code
 * change, never an automatic side effect of running this tool.
 *
 * Two DISTINCT, clearly-labeled modes (F15 — same dual-mode pattern
 * ragBenchmarkRunner.ts uses for exactly the same reason):
 *
 *  - LEGACY/BASELINE mode (`scoreConfigAgainstQueries()`, `runCalibration()`,
 *    `evaluateOnHoldout()`) — one whole-query `retrieveRagMatches()` call
 *    per query, bound to the candidate config. Kept unchanged for
 *    continuity with the already-published `relevance-gate.v1.latest.*`
 *    artifact and every historical calibration number recorded against it.
 *    A query's optional `operations` field is intentionally ignored here.
 *  - PRODUCTION-PIPELINE mode (`scoreConfigAgainstQueriesProductionMode()`,
 *    `runCalibrationProductionMode()`, `evaluateOnHoldoutProductionMode()`)
 *    — decomposes each query into operations
 *    (`operationsForBenchmarkQuery()`), retrieves PER OPERATION via
 *    `retrieveForOperations()` bound to the candidate gate config, and
 *    packs the result via `packOperationCandidates()` against an ESTIMATED
 *    token budget (`estimateTokenCount()`, imported from
 *    ragBenchmarkRunner.ts rather than duplicated) — the SAME three
 *    functions a real request actually uses. This is the mode that can
 *    actually see whether a gate config change helps or hurts once
 *    operation decomposition and budget-fitting are both in play, which
 *    whole-query-only scoring structurally cannot.
 *
 * Neither mode calls a real LLM; the production-pipeline mode's token
 * counts are an explicitly-labeled ESTIMATE, never a real tokenizer's
 * measurement — see ragBenchmarkRunner.ts's own `estimateTokenCount()` doc
 * comment.
 */

export interface CalibrationGridEntry {
  /** Human-readable name for this candidate — shown in the report table. */
  label: string;
  config: RelevanceGateConfig;
}

/** A small, DOCUMENTED grid — NOT an exhaustive sweep (per Phase 4's own
 * "do not add every signal without evidence"). Each entry changes exactly
 * ONE parameter away from the default (bar the last, a deliberately-noted
 * combination), so every row's effect in the comparison table is
 * individually attributable rather than a confusing joint effect. The
 * specific threshold VALUES here (0.05, 0.1) are round, easy-to-reason-
 * about starting points for a first calibration pass, not the product of
 * any prior tuning. */
export const DEFAULT_CALIBRATION_GRID: CalibrationGridEntry[] = [
  { label: 'default (any positive score)', config: DEFAULT_RELEVANCE_GATE },
  { label: 'minLexicalScore=0.05', config: { ...DEFAULT_RELEVANCE_GATE, minLexicalScore: 0.05 } },
  { label: 'minLexicalScore=0.1', config: { ...DEFAULT_RELEVANCE_GATE, minLexicalScore: 0.1 } },
  { label: 'requireSymbolEvidence', config: { ...DEFAULT_RELEVANCE_GATE, requireSymbolEvidence: true } },
  { label: 'requireModeCompatibility', config: { ...DEFAULT_RELEVANCE_GATE, requireModeCompatibility: true } },
  { label: 'minLexicalScore=0.05 + requireSymbolEvidence', config: { ...DEFAULT_RELEVANCE_GATE, minLexicalScore: 0.05, requireSymbolEvidence: true } }
];

/** How much a no-match false-positive counts against a candidate's
 * objective score, relative to recall — a documented judgment call (a
 * false positive actively misleads a reviewer/model; a missed positive
 * "merely" fails to help), not a value derived from any formal
 * optimization. Revisit once real-world cost data exists. */
export const FALSE_POSITIVE_PENALTY_WEIGHT = 0.5;

/** `objective = recall@k - FALSE_POSITIVE_PENALTY_WEIGHT * noMatchFalsePositiveRate`
 * — an explicit, single-number ranking criterion so config selection is
 * reproducible and inspectable, not "whichever looked best." Both
 * `recallAtK.value` and `noMatchFalsePositiveRate.value` fall back to `0`
 * when `null` (no applicable queries in this split) — an empty subset
 * should never silently make a candidate look artificially better OR
 * worse. */
export function computeObjectiveScore(metrics: AggregateMetrics): number {
  const recall = metrics.recallAtK.value ?? 0;
  const fpRate = metrics.noMatchFalsePositiveRate.value ?? 0;
  return recall - FALSE_POSITIVE_PENALTY_WEIGHT * fpRate;
}

/** A candidate abstaining on more than this fraction of genuinely positive
 * queries is DISQUALIFIED from selection regardless of its objective
 * score — "abstaining on everything is not a successful improvement"
 * (Phase 4's own explicit instruction): a config that simply refuses to
 * answer almost every real request would trivially minimize false
 * positives without providing any real value, and the objective score
 * above has no other mechanism to catch that degenerate case on its own. */
export const ABSTENTION_DISQUALIFICATION_THRESHOLD = 0.5;

export function evaluateDisqualification(metrics: AggregateMetrics): { disqualified: boolean; reason?: string } {
  const abstention = metrics.positiveAbstentionRate.value;
  if (abstention !== null && abstention > ABSTENTION_DISQUALIFICATION_THRESHOLD) {
    return {
      disqualified: true,
      reason:
        `positive-query abstention rate ${(abstention * 100).toFixed(1)}% exceeds the ` +
        `${(ABSTENTION_DISQUALIFICATION_THRESHOLD * 100).toFixed(0)}% disqualification threshold — abstaining on ` +
        '(almost) everything is not a valid improvement, regardless of its false-positive rate.'
    };
  }
  return { disqualified: false };
}

function countNonDefaultParams(config: RelevanceGateConfig): number {
  let count = 0;
  if (config.minLexicalScore !== DEFAULT_RELEVANCE_GATE.minLexicalScore) count++;
  if (config.requireSymbolEvidence !== DEFAULT_RELEVANCE_GATE.requireSymbolEvidence) count++;
  if (config.requireModeCompatibility !== DEFAULT_RELEVANCE_GATE.requireModeCompatibility) count++;
  return count;
}

export interface CalibrationCandidateResult {
  label: string;
  config: RelevanceGateConfig;
  metrics: AggregateMetrics;
  objectiveScore: number;
  disqualified: boolean;
  disqualificationReason?: string;
}

/** LEGACY/BASELINE scoring (F15 — see this file's own top-level doc
 * comment) — one whole-query `retrieveRagMatches()` call per query, bound
 * to `config`. */
async function scoreConfigAgainstQueries(
  index: Awaited<ReturnType<typeof buildRagIndex>>,
  queries: BenchmarkDataset['queries'],
  config: RelevanceGateConfig,
  k: number
): Promise<AggregateMetrics> {
  const perQuery: PerQueryMetrics[] = [];
  for (const query of queries) {
    const matches = await retrieveRagMatches(index, query.queryText, query.language, query.automationMode, k, config);
    perQuery.push(scoreQuery(query.queryId, matches.map((m) => m.id), query.relevantIds, query.alternativeGroups, k));
  }
  return aggregateBenchmarkMetrics(perQuery);
}

/** Runs every grid entry against the dataset's DEVELOPMENT split ONLY —
 * holdout queries are never touched here; see `evaluateOnHoldout()` for
 * the separate, once-only final comparison. */
export async function runCalibration(
  dataset: BenchmarkDataset,
  grid: CalibrationGridEntry[] = DEFAULT_CALIBRATION_GRID,
  k = 2
): Promise<CalibrationCandidateResult[]> {
  const index = await buildRagIndex(dataset.recipes.map(toRagRecipe));
  const devQueries = dataset.queries.filter((q) => q.split === 'development');

  const results: CalibrationCandidateResult[] = [];
  for (const entry of grid) {
    const metrics = await scoreConfigAgainstQueries(index, devQueries, entry.config, k);
    const objectiveScore = computeObjectiveScore(metrics);
    const { disqualified, reason } = evaluateDisqualification(metrics);
    results.push({ label: entry.label, config: entry.config, metrics, objectiveScore, disqualified, disqualificationReason: reason });
  }
  return results;
}

function isBetterCandidate(a: CalibrationCandidateResult, b: CalibrationCandidateResult): boolean {
  const EPS = 1e-9;
  if (Math.abs(a.objectiveScore - b.objectiveScore) > EPS) {
    return a.objectiveScore > b.objectiveScore;
  }
  const aRecall = a.metrics.recallAtK.value ?? 0;
  const bRecall = b.metrics.recallAtK.value ?? 0;
  if (Math.abs(aRecall - bRecall) > EPS) {
    return aRecall > bRecall;
  }
  const aComplexity = countNonDefaultParams(a.config);
  const bComplexity = countNonDefaultParams(b.config);
  if (aComplexity !== bComplexity) {
    return aComplexity < bComplexity; // simpler config wins a tie — avoids overfitting a small dev set
  }
  return JSON.stringify(a.config) < JSON.stringify(b.config); // fully deterministic final tie-break
}

/** Selects the best ELIGIBLE (non-disqualified) candidate using the
 * explicit objective above and a deterministic tie-break policy: higher
 * objective score, then higher recall, then FEWER non-default parameters
 * (prefer the simplest config achieving the same result), then a
 * byte-for-byte deterministic JSON-string comparison as the final
 * tie-break — the same grid, run twice, always selects the same
 * candidate. Returns `undefined` only when EVERY candidate is
 * disqualified. */
export function selectBestConfig(results: CalibrationCandidateResult[]): CalibrationCandidateResult | undefined {
  const eligible = results.filter((r) => !r.disqualified);
  if (eligible.length === 0) {
    return undefined;
  }
  return eligible.reduce((best, current) => (isBetterCandidate(current, best) ? current : best));
}

export interface HoldoutEvaluation {
  config: RelevanceGateConfig;
  metrics: AggregateMetrics;
}

/** Evaluates ONE config — the one `selectBestConfig()` chose from the
 * DEVELOPMENT split — against the HOLDOUT split. Meant to be called
 * EXACTLY ONCE per calibration cycle for a final, independent comparison;
 * this function's own existence as something separate from
 * `runCalibration()`'s grid loop (which NEVER sees holdout queries at
 * all) is the structural half of that discipline — the other half is
 * process discipline this code can't mechanically enforce: if holdout
 * results end up influencing further tuning, treat that split as
 * DEVELOPMENT from that point on and construct a genuinely fresh holdout
 * before claiming an independent result again (see this module's own
 * top-level doc comment and benchmarks/rag/HUMAN_LABELING_GUIDE.md's
 * identical warning). */
export async function evaluateOnHoldout(dataset: BenchmarkDataset, config: RelevanceGateConfig, k = 2): Promise<HoldoutEvaluation> {
  const index = await buildRagIndex(dataset.recipes.map(toRagRecipe));
  const holdoutQueries = dataset.queries.filter((q) => q.split === 'holdout');
  const metrics = await scoreConfigAgainstQueries(index, holdoutQueries, config, k);
  return { config, metrics };
}

// =============================================================================
// PRODUCTION-PIPELINE mode (F15) — see this file's own top-level doc comment.
// =============================================================================

export interface ProductionCalibrationOptions {
  /** Matches `ragOperationRetrieval.ts`'s own `DEFAULT_PER_OPERATION_K`
   * unless overridden — same meaning as
   * ragBenchmarkRunner.ts's `ProductionPipelineOptions.perOperationK`. */
  perOperationK?: number;
  /** See ragBenchmarkRunner.ts's `ProductionPipelineOptions.estimatedMaxInputTokens`
   * — a stand-in for a real resolved model's `maxInputTokens`, since this
   * offline harness has none to ask. */
  estimatedMaxInputTokens?: number;
  /** See ragBenchmarkRunner.ts's `ProductionPipelineOptions.estimatedMandatoryTokens`. */
  estimatedMandatoryTokens?: number;
}

const DEFAULT_PRODUCTION_CALIBRATION_OPTIONS: Required<ProductionCalibrationOptions> = {
  perOperationK: 3,
  estimatedMaxInputTokens: 128_000,
  estimatedMandatoryTokens: 2_000
};

/** PRODUCTION-PIPELINE scoring (F15) — unlike `scoreConfigAgainstQueries()`
 * above, `config` here is NOT a param threaded through one whole-query
 * retrieval call: it's bound into a `RetrieveMatchesFn` that
 * `retrieveForOperations()` calls once PER operation, exactly how a real
 * request would apply a candidate gate config to per-operation retrieval.
 * The candidate set is then packed via `packOperationCandidates()` against
 * an ESTIMATED token budget, and scored against `returnedIds` — the
 * POST-PACKING set, i.e. what a real request would actually have included
 * — using `k = returnedIds.length`, the same "packing's own inclusion
 * decision IS the cutoff" convention as
 * ragBenchmarkRunner.ts's `runProductionPipelineOnDataset()`. */
async function scoreConfigAgainstQueriesProductionMode(
  index: Awaited<ReturnType<typeof buildRagIndex>>,
  queries: BenchmarkDataset['queries'],
  config: RelevanceGateConfig,
  options: Required<ProductionCalibrationOptions>
): Promise<AggregateMetrics> {
  const retrieveMatches: RetrieveMatchesFn = (idx, queryText, language, automationMode, k) =>
    retrieveRagMatches(idx, queryText, language, automationMode, k, config);

  const perQuery: PerQueryMetrics[] = [];
  for (const query of queries) {
    const operations = operationsForBenchmarkQuery(query);
    const candidates = await retrieveForOperations(index, operations, query.language, query.automationMode, options.perOperationK, retrieveMatches);
    const packed = await packOperationCandidates(candidates, operations, query.language, {
      maxInputTokens: options.estimatedMaxInputTokens,
      safetyMargin: 1,
      mandatoryTokens: options.estimatedMandatoryTokens,
      countTokens: estimateTokenCount
    });
    const returnedIds = packed.includedMatches.map((m) => m.id);
    perQuery.push(scoreQuery(query.queryId, returnedIds, query.relevantIds, query.alternativeGroups, returnedIds.length));
  }
  return aggregateBenchmarkMetrics(perQuery);
}

/** PRODUCTION-PIPELINE counterpart to `runCalibration()` — same DEVELOPMENT-
 * split-only filtering and same objective/disqualification computation per
 * grid entry, but scored through the real operation-decomposition +
 * per-operation-retrieval + packing path instead of one whole-query call. */
export async function runCalibrationProductionMode(
  dataset: BenchmarkDataset,
  grid: CalibrationGridEntry[] = DEFAULT_CALIBRATION_GRID,
  options: ProductionCalibrationOptions = {}
): Promise<CalibrationCandidateResult[]> {
  const opts = { ...DEFAULT_PRODUCTION_CALIBRATION_OPTIONS, ...options };
  const index = await buildRagIndex(dataset.recipes.map(toRagRecipe));
  const devQueries = dataset.queries.filter((q) => q.split === 'development');

  const results: CalibrationCandidateResult[] = [];
  for (const entry of grid) {
    const metrics = await scoreConfigAgainstQueriesProductionMode(index, devQueries, entry.config, opts);
    const objectiveScore = computeObjectiveScore(metrics);
    const { disqualified, reason } = evaluateDisqualification(metrics);
    results.push({ label: entry.label, config: entry.config, metrics, objectiveScore, disqualified, disqualificationReason: reason });
  }
  return results;
}

/** PRODUCTION-PIPELINE counterpart to `evaluateOnHoldout()` — same
 * once-only, holdout-split-only evaluation of the ONE config
 * `selectBestConfig()` chose, scored through the real production path. */
export async function evaluateOnHoldoutProductionMode(
  dataset: BenchmarkDataset,
  config: RelevanceGateConfig,
  options: ProductionCalibrationOptions = {}
): Promise<HoldoutEvaluation> {
  const opts = { ...DEFAULT_PRODUCTION_CALIBRATION_OPTIONS, ...options };
  const index = await buildRagIndex(dataset.recipes.map(toRagRecipe));
  const holdoutQueries = dataset.queries.filter((q) => q.split === 'holdout');
  const metrics = await scoreConfigAgainstQueriesProductionMode(index, holdoutQueries, config, opts);
  return { config, metrics };
}

function formatRate(rate: { value: number | null; count: number }): string {
  return rate.value === null ? 'n/a (0 queries)' : `${(rate.value * 100).toFixed(1)}% (n=${rate.count})`;
}

export interface CalibrationReport {
  json: {
    datasetVersion: string;
    generatedAt: string;
    /** True whenever ANY query in the dataset is `origin: 'synthetic'` —
     * a calibration run mixing even a little synthetic data alongside
     * real labels is still reported as provisional overall, never
     * selectively "mostly real." */
    provisional: boolean;
    productionDefault: RelevanceGateConfig;
    grid: CalibrationCandidateResult[];
    selected: CalibrationCandidateResult | undefined;
    holdout: HoldoutEvaluation | undefined;
  };
  markdown: string;
}

export function buildCalibrationReport(
  dataset: BenchmarkDataset,
  grid: CalibrationCandidateResult[],
  selected: CalibrationCandidateResult | undefined,
  holdout: HoldoutEvaluation | undefined,
  generatedAt = new Date().toISOString()
): CalibrationReport {
  const provisional = dataset.queries.some((q) => q.origin === 'synthetic');

  const provisionalNote = provisional
    ? '**PROVISIONAL — this calibration run includes SYNTHETIC labels.** The selected configuration below is a ' +
      'candidate recommendation only; it has NOT been promoted to the production default ' +
      '(`DEFAULT_RELEVANCE_GATE` in rag/ragRelevanceGate.ts remains the conservative, backward-compatible ' +
      '"any positive score" behavior). Promoting a different default requires real, non-synthetic evidence — see ' +
      'benchmarks/rag/HUMAN_LABELING_GUIDE.md.'
    : 'This run used only human-labeled data.';

  const gridRows = grid
    .map(
      (r) =>
        `| ${r.label} | ${formatRate(r.metrics.recallAtK)} | ${formatRate(r.metrics.precisionAtK)} | ` +
        `${formatRate(r.metrics.noMatchFalsePositiveRate)} | ${formatRate(r.metrics.positiveAbstentionRate)} | ` +
        `${r.disqualified ? `DISQUALIFIED — ${r.disqualificationReason}` : r.objectiveScore.toFixed(4)} |`
    )
    .join('\n');

  const selectedSection = selected
    ? `**Selected (development split):** \`${selected.label}\` — objective score ${selected.objectiveScore.toFixed(4)}.\n\n` +
      '```json\n' +
      JSON.stringify(selected.config, null, 2) +
      '\n```'
    : '**No candidate was selected** — every grid entry was disqualified (see the table above for reasons).';

  const holdoutSection = holdout
    ? `\n\n## Final holdout evaluation (evaluated ONCE)\n\n` +
      `| Recall@k | Precision@k | No-match FP rate | Abstention rate |\n| --- | --- | --- | --- |\n` +
      `| ${formatRate(holdout.metrics.recallAtK)} | ${formatRate(holdout.metrics.precisionAtK)} | ` +
      `${formatRate(holdout.metrics.noMatchFalsePositiveRate)} | ${formatRate(holdout.metrics.positiveAbstentionRate)} |\n\n` +
      'This holdout number must not be used to select a DIFFERENT configuration — doing so would make this split ' +
      'development data going forward, requiring a fresh holdout before any future "independent result" claim.'
    : '\n\n## Final holdout evaluation\n\nSkipped — no eligible candidate was selected from the development split.';

  const markdown =
    `# RAG relevance-gate calibration — dataset v${dataset.datasetVersion}\n\n` +
    `Generated: ${generatedAt}\n\n${provisionalNote}\n\n` +
    `## Development-split parameter grid\n\n` +
    `| Configuration | Recall@k | Precision@k | No-match FP rate | Abstention rate | Objective score |\n` +
    `| --- | --- | --- | --- | --- | --- |\n${gridRows}\n\n${selectedSection}${holdoutSection}\n`;

  return {
    json: { datasetVersion: dataset.datasetVersion, generatedAt, provisional, productionDefault: DEFAULT_RELEVANCE_GATE, grid, selected, holdout },
    markdown
  };
}

// =============================================================================
// PRODUCTION-PIPELINE mode report (F15) — see this file's own top-level doc
// comment.
// =============================================================================

export interface ProductionCalibrationReportMeta {
  perOperationK: number;
  estimatedMaxInputTokens: number;
  estimatedMandatoryTokens: number;
  /** `undefined` when git itself isn't available or this isn't a git
   * checkout — same best-effort convention as
   * ragBenchmarkRunner.ts's `ProductionModeReportMeta.gitProvenance`. */
  gitProvenance?: GitProvenance;
}

export interface ProductionCalibrationReport {
  json: {
    datasetVersion: string;
    generatedAt: string;
    provisional: boolean;
    /** SHA-256 of the dataset's own recipe content — same reproducibility
     * requirement as ragBenchmarkRunner.ts's production-mode report: a
     * report can always be traced back to EXACTLY which corpus content
     * produced it. */
    corpusFingerprint: string;
    meta: ProductionCalibrationReportMeta;
    productionDefault: RelevanceGateConfig;
    grid: CalibrationCandidateResult[];
    selected: CalibrationCandidateResult | undefined;
    holdout: HoldoutEvaluation | undefined;
  };
  markdown: string;
}

/** PRODUCTION-PIPELINE counterpart to `buildCalibrationReport()` — same
 * grid/selection/holdout shape and the same NEVER-writes-back-to-
 * `DEFAULT_RELEVANCE_GATE` guarantee, but built from results scored through
 * the real operation-decomposition + per-operation-retrieval + packing path
 * (`runCalibrationProductionMode()` / `evaluateOnHoldoutProductionMode()`),
 * plus the reproducibility metadata (corpus fingerprint, git provenance,
 * the exact estimated-budget options used) that mode's extra moving parts
 * make worth recording — mirroring
 * ragBenchmarkRunner.ts's `buildProductionModeReport()`. Kept entirely
 * separate from `buildCalibrationReport()` above rather than parameterizing
 * it, so the LEGACY report's own shape/wording never has to accommodate a
 * concern (packing/token-budget provenance) that mode doesn't have. */
export function buildProductionModeCalibrationReport(
  dataset: BenchmarkDataset,
  grid: CalibrationCandidateResult[],
  selected: CalibrationCandidateResult | undefined,
  holdout: HoldoutEvaluation | undefined,
  meta: ProductionCalibrationReportMeta,
  generatedAt = new Date().toISOString()
): ProductionCalibrationReport {
  const provisional = dataset.queries.some((q) => q.origin === 'synthetic');

  const provisionalNote = provisional
    ? '**PROVISIONAL — this calibration run includes SYNTHETIC labels, AND its retrieval/packing runs through the ' +
      'REAL production pipeline against an ESTIMATED (never measured) token budget.** The selected configuration ' +
      'below is a candidate recommendation only; it has NOT been promoted to the production default ' +
      '(`DEFAULT_RELEVANCE_GATE` in rag/ragRelevanceGate.ts remains the conservative, backward-compatible ' +
      '"any positive score" behavior). Promoting a different default requires real, non-synthetic evidence — see ' +
      'benchmarks/rag/HUMAN_LABELING_GUIDE.md.'
    : 'This run used only human-labeled data, but token counts remain an ESTIMATE (see `meta` in the JSON report) — ' +
      'no real model was consulted.';

  const gridRows = grid
    .map(
      (r) =>
        `| ${r.label} | ${formatRate(r.metrics.recallAtK)} | ${formatRate(r.metrics.precisionAtK)} | ` +
        `${formatRate(r.metrics.noMatchFalsePositiveRate)} | ${formatRate(r.metrics.positiveAbstentionRate)} | ` +
        `${r.disqualified ? `DISQUALIFIED — ${r.disqualificationReason}` : r.objectiveScore.toFixed(4)} |`
    )
    .join('\n');

  const selectedSection = selected
    ? `**Selected (development split):** \`${selected.label}\` — objective score ${selected.objectiveScore.toFixed(4)}.\n\n` +
      '```json\n' +
      JSON.stringify(selected.config, null, 2) +
      '\n```'
    : '**No candidate was selected** — every grid entry was disqualified (see the table above for reasons).';

  const holdoutSection = holdout
    ? `\n\n## Final holdout evaluation (evaluated ONCE)\n\n` +
      `| Recall@k | Precision@k | No-match FP rate | Abstention rate |\n| --- | --- | --- | --- |\n` +
      `| ${formatRate(holdout.metrics.recallAtK)} | ${formatRate(holdout.metrics.precisionAtK)} | ` +
      `${formatRate(holdout.metrics.noMatchFalsePositiveRate)} | ${formatRate(holdout.metrics.positiveAbstentionRate)} |\n\n` +
      'This holdout number must not be used to select a DIFFERENT configuration — doing so would make this split ' +
      'development data going forward, requiring a fresh holdout before any future "independent result" claim.'
    : '\n\n## Final holdout evaluation\n\nSkipped — no eligible candidate was selected from the development split.';

  const corpusFingerprint = computeCorpusFingerprint(dataset.recipes);
  const gitLine = meta.gitProvenance
    ? `Git: \`${meta.gitProvenance.commit}\`${meta.gitProvenance.dirty ? ' (DIRTY working tree — uncommitted changes were present when this ran)' : ' (clean working tree)'}`
    : 'Git: unavailable (not a git checkout, or git could not be run) — this report\'s exact code provenance is unknown.';

  const markdown =
    `# RAG relevance-gate calibration (PRODUCTION-PIPELINE mode) — dataset v${dataset.datasetVersion}\n\n` +
    `Generated: ${generatedAt}\n\n${provisionalNote}\n\n` +
    `## Reproducibility metadata\n\n` +
    `Corpus fingerprint (SHA-256 of recipe content): \`${corpusFingerprint}\`\n\n` +
    `${gitLine}\n\n` +
    `Config: perOperationK=${meta.perOperationK}, estimatedMaxInputTokens=${meta.estimatedMaxInputTokens.toLocaleString()}, ` +
    `estimatedMandatoryTokens=${meta.estimatedMandatoryTokens.toLocaleString()}\n\n` +
    `## Development-split parameter grid (scored through real operation decomposition + per-operation retrieval + packing)\n\n` +
    `| Configuration | Recall@k | Precision@k | No-match FP rate | Abstention rate | Objective score |\n` +
    `| --- | --- | --- | --- | --- | --- |\n${gridRows}\n\n${selectedSection}${holdoutSection}\n`;

  return {
    json: {
      datasetVersion: dataset.datasetVersion,
      generatedAt,
      provisional,
      corpusFingerprint,
      meta,
      productionDefault: DEFAULT_RELEVANCE_GATE,
      grid,
      selected,
      holdout
    },
    markdown
  };
}

/* c8 ignore start -- thin CLI glue (file I/O, argv, process.exit); the
   actual calibration logic above is what's unit tested. */
async function main(): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const { parseBenchmarkDataset } = await import('./ragBenchmarkTypes');

  const datasetPath = process.argv[2] ?? path.join(__dirname, '..', '..', '..', '..', 'benchmarks', 'rag', 'datasets', 'synthetic-v1.json');
  const outDir = process.argv[3] ?? path.join(__dirname, '..', '..', '..', '..', 'benchmarks', 'rag', 'calibration');

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

  console.log(`Running the ${DEFAULT_CALIBRATION_GRID.length}-entry calibration grid against the DEVELOPMENT split — LEGACY/BASELINE mode...`);
  const legacyGrid = await runCalibration(dataset);
  const legacySelected = selectBestConfig(legacyGrid);

  let legacyHoldout: HoldoutEvaluation | undefined;
  if (legacySelected) {
    console.log(`[legacy] Selected "${legacySelected.label}" — evaluating ONCE against the HOLDOUT split...`);
    legacyHoldout = await evaluateOnHoldout(dataset, legacySelected.config);
  } else {
    console.log('[legacy] Every grid candidate was disqualified — skipping the holdout evaluation.');
  }

  const legacyReport = buildCalibrationReport(dataset, legacyGrid, legacySelected, legacyHoldout);
  const legacyJsonPath = path.join(outDir, `relevance-gate.v${dataset.datasetVersion}.legacy.latest.json`);
  const legacyMarkdownPath = path.join(outDir, `relevance-gate.v${dataset.datasetVersion}.legacy.latest.md`);
  fs.writeFileSync(legacyJsonPath, JSON.stringify(legacyReport.json, null, 2), 'utf8');
  fs.writeFileSync(legacyMarkdownPath, legacyReport.markdown, 'utf8');
  console.log(`\n${legacyReport.markdown}`);

  console.log(
    `Running the ${DEFAULT_CALIBRATION_GRID.length}-entry calibration grid against the DEVELOPMENT split — ` +
      'PRODUCTION-PIPELINE mode (F15: real operation decomposition + per-operation retrieval + packing)...'
  );
  const productionGrid = await runCalibrationProductionMode(dataset);
  const productionSelected = selectBestConfig(productionGrid);

  let productionHoldout: HoldoutEvaluation | undefined;
  if (productionSelected) {
    console.log(`[production] Selected "${productionSelected.label}" — evaluating ONCE against the HOLDOUT split...`);
    productionHoldout = await evaluateOnHoldoutProductionMode(dataset, productionSelected.config);
  } else {
    console.log('[production] Every grid candidate was disqualified — skipping the holdout evaluation.');
  }

  const productionReport = buildProductionModeCalibrationReport(dataset, productionGrid, productionSelected, productionHoldout, {
    perOperationK: DEFAULT_PRODUCTION_CALIBRATION_OPTIONS.perOperationK,
    estimatedMaxInputTokens: DEFAULT_PRODUCTION_CALIBRATION_OPTIONS.estimatedMaxInputTokens,
    estimatedMandatoryTokens: DEFAULT_PRODUCTION_CALIBRATION_OPTIONS.estimatedMandatoryTokens,
    gitProvenance: await getGitProvenance()
  });
  const productionJsonPath = path.join(outDir, `relevance-gate.v${dataset.datasetVersion}.production.latest.json`);
  const productionMarkdownPath = path.join(outDir, `relevance-gate.v${dataset.datasetVersion}.production.latest.md`);
  fs.writeFileSync(productionJsonPath, JSON.stringify(productionReport.json, null, 2), 'utf8');
  fs.writeFileSync(productionMarkdownPath, productionReport.markdown, 'utf8');
  console.log(`\n${productionReport.markdown}`);

  console.log(
    `Full reports written to:\n  ${legacyJsonPath}\n  ${legacyMarkdownPath}\n  ${productionJsonPath}\n  ${productionMarkdownPath}`
  );
  console.log(
    '\nNOTE: both reports are RECOMMENDATION artifacts only. rag/ragRelevanceGate.ts\'s DEFAULT_RELEVANCE_GATE ' +
      'was NOT modified by running this — promoting a different production default is a separate, deliberate, ' +
      'human-reviewed code change that requires real (non-synthetic) evidence.'
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
