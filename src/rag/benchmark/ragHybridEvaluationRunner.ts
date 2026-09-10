import { BenchmarkDataset, BenchmarkQuery } from './ragBenchmarkTypes';
import { scoreQuery, aggregateBenchmarkMetrics, AggregateMetrics, PerQueryMetrics } from './ragBenchmarkMetrics';
import { toRagRecipe } from './ragBenchmarkRunner';
import { buildRagIndex, RagIndex } from '../ragIndexBuilder';
import { retrieveRagMatches, RagMatch } from '../ragRetriever';
import { retrieveHybridMatches } from '../ragHybridRetriever';
import { EmbeddingProvider } from '../ragEmbeddingProvider';

/**
 * Phase 6's evaluation harness — reuses Phase 1's benchmark
 * dataset/metrics machinery (ragBenchmarkTypes.ts, ragBenchmarkMetrics.ts)
 * to compare LEXICAL-ONLY retrieval (`retrieveRagMatches()`, unchanged)
 * against HYBRID (lexical + semantic RRF fusion, `retrieveHybridMatches()`)
 * on the SAME dataset, same `k`, side by side.
 *
 * CRITICAL HONESTY NOTE, mirrored in every report this produces: unless the
 * CLI is given a REAL configured semantic provider (an endpoint + model,
 * opted into via environment variables — see `main()` below — never
 * automatic), this evaluates hybrid retrieval using
 * `ragCharNgramStandInProvider.ts`'s deterministic, NON-SEMANTIC
 * character-hashing stand-in. That is enough to prove the fusion MECHANISM
 * itself works correctly end-to-end against the real benchmark corpus
 * (provider interface, caching, RRF combination, gating) — it is NOT
 * evidence that real semantic embeddings would improve retrieval accuracy.
 * A genuine semantic-QUALITY evaluation requires a real provider — an
 * external dependency this environment cannot exercise on its own, exactly
 * the same "the calibration machinery exists; a production accuracy claim
 * is blocked on real evidence" distinction Phase 4's own calibration
 * runner draws (see ragCalibrationRunner.ts's own doc comment).
 *
 * This also NEVER selects or promotes anything — no config is written back
 * anywhere, unlike ragCalibrationRunner.ts's `DEFAULT_RELEVANCE_GATE`. This
 * is purely a side-by-side comparison report.
 */

export interface HybridEvaluationSplitResult {
  /** 'all' evaluates every query in the dataset regardless of split — safe
   * here specifically because this harness never SELECTS or tunes
   * anything from its own results (unlike ragCalibrationRunner.ts's
   * dev/holdout discipline, which exists to protect a SELECTION decision
   * from overfitting) — a pure side-by-side comparison has nothing for a
   * holdout split to protect against. */
  split: 'development' | 'holdout' | 'all';
  queryCount: number;
  lexicalOnly: AggregateMetrics;
  hybrid: AggregateMetrics;
}

type MatchesFn = (queryText: string, language: BenchmarkQuery['language'], automationMode: BenchmarkQuery['automationMode'], k: number) => Promise<RagMatch[]>;

async function scoreQueriesWith(queries: BenchmarkQuery[], k: number, retrieve: MatchesFn): Promise<AggregateMetrics> {
  const perQuery: PerQueryMetrics[] = [];
  for (const query of queries) {
    const matches = await retrieve(query.queryText, query.language, query.automationMode, k);
    perQuery.push(scoreQuery(query.queryId, matches.map((m) => m.id), query.relevantIds, query.alternativeGroups, k));
  }
  return aggregateBenchmarkMetrics(perQuery);
}

async function evaluateSplit(index: RagIndex, provider: EmbeddingProvider, queries: BenchmarkQuery[], k: number): Promise<{ lexicalOnly: AggregateMetrics; hybrid: AggregateMetrics }> {
  const lexicalOnly = await scoreQueriesWith(queries, k, (queryText, language, automationMode, kk) => retrieveRagMatches(index, queryText, language, automationMode, kk));
  const hybrid = await scoreQueriesWith(queries, k, (queryText, language, automationMode, kk) => retrieveHybridMatches(index, provider, queryText, language, automationMode, { topK: kk }));
  return { lexicalOnly, hybrid };
}

/** Runs the lexical-vs-hybrid comparison over `dataset`'s development
 * split, holdout split (each reported separately, when non-empty), and
 * every query combined ('all') — see `HybridEvaluationSplitResult.split`'s
 * own doc comment for why combining is safe here. */
export async function runHybridEvaluation(dataset: BenchmarkDataset, provider: EmbeddingProvider, k = 2): Promise<HybridEvaluationSplitResult[]> {
  const index = await buildRagIndex(dataset.recipes.map(toRagRecipe));
  const results: HybridEvaluationSplitResult[] = [];

  for (const split of ['development', 'holdout'] as const) {
    const queries = dataset.queries.filter((q) => q.split === split);
    if (queries.length === 0) {
      continue;
    }
    const { lexicalOnly, hybrid } = await evaluateSplit(index, provider, queries, k);
    results.push({ split, queryCount: queries.length, lexicalOnly, hybrid });
  }

  const { lexicalOnly, hybrid } = await evaluateSplit(index, provider, dataset.queries, k);
  results.push({ split: 'all', queryCount: dataset.queries.length, lexicalOnly, hybrid });

  return results;
}

function formatRate(rate: { value: number | null; count: number }): string {
  return rate.value === null ? 'n/a (0 queries)' : `${(rate.value * 100).toFixed(1)}% (n=${rate.count})`;
}

export interface HybridEvaluationReport {
  json: {
    datasetVersion: string;
    generatedAt: string;
    providerId: string;
    /** True unless the CLI was given a real configured semantic provider —
     * see this module's own top-level doc comment. */
    isStandInProvider: boolean;
    /** True whenever any dataset query is `origin: 'synthetic'` — same
     * convention as ragCalibrationRunner.ts's own `provisional` flag. */
    provisional: boolean;
    results: HybridEvaluationSplitResult[];
  };
  markdown: string;
}

export function buildHybridEvaluationReport(dataset: BenchmarkDataset, results: HybridEvaluationSplitResult[], providerId: string, isStandInProvider: boolean, generatedAt = new Date().toISOString()): HybridEvaluationReport {
  const provisional = dataset.queries.some((q) => q.origin === 'synthetic');

  const standInWarning = isStandInProvider
    ? '⚠ **This run used the deterministic, NON-SEMANTIC character-hashing stand-in provider** ' +
      '(`ragCharNgramStandInProvider.ts`) because no real semantic embedding provider was configured. ' +
      'It proves the hybrid retrieval/RRF-fusion MECHANISM works correctly end-to-end against real data — it is ' +
      '**NOT evidence that real semantic embeddings would improve retrieval accuracy**. To evaluate a real ' +
      'provider, set `SOFTPLAY_RAG_EVAL_ENDPOINT` and `SOFTPLAY_RAG_EVAL_MODEL` (and optionally ' +
      '`SOFTPLAY_RAG_EVAL_API_KEY`) before running `npm run rag:evaluate-hybrid`.'
    : `This run used a REAL configured semantic embedding provider (\`${providerId}\`).`;

  const provisionalNote = provisional
    ? '**PROVISIONAL — this dataset includes SYNTHETIC labels** (see benchmarks/rag/HUMAN_LABELING_GUIDE.md).'
    : 'This dataset is entirely human-labeled.';

  const rows = results
    .map(
      (r) =>
        `### Split: ${r.split} (${r.queryCount} quer${r.queryCount === 1 ? 'y' : 'ies'})\n\n` +
        `| | Recall@k | Precision@k | No-match FP rate | Abstention rate |\n| --- | --- | --- | --- | --- |\n` +
        `| Lexical-only | ${formatRate(r.lexicalOnly.recallAtK)} | ${formatRate(r.lexicalOnly.precisionAtK)} | ${formatRate(r.lexicalOnly.noMatchFalsePositiveRate)} | ${formatRate(r.lexicalOnly.positiveAbstentionRate)} |\n` +
        `| Hybrid (RRF-fused) | ${formatRate(r.hybrid.recallAtK)} | ${formatRate(r.hybrid.precisionAtK)} | ${formatRate(r.hybrid.noMatchFalsePositiveRate)} | ${formatRate(r.hybrid.positiveAbstentionRate)} |`
    )
    .join('\n\n');

  const markdown =
    `# RAG hybrid retrieval evaluation — dataset v${dataset.datasetVersion}\n\n` +
    `Generated: ${generatedAt}\n\nProvider: \`${providerId}\`\n\n${standInWarning}\n\n${provisionalNote}\n\n${rows}\n\n` +
    'This report is a comparison only — it never selects a configuration or writes anything back to production code.\n';

  return {
    json: { datasetVersion: dataset.datasetVersion, generatedAt, providerId, isStandInProvider, provisional, results },
    markdown
  };
}

/* c8 ignore start -- thin CLI glue (env vars, file I/O, process.exit); the
   actual evaluation logic above is what's unit tested. */
async function main(): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const { parseBenchmarkDataset } = await import('./ragBenchmarkTypes');
  const { HttpEmbeddingProvider } = await import('../ragHttpEmbeddingProvider');
  const { CachingEmbeddingProvider } = await import('../ragEmbeddingCache');
  const { CharNgramStandInProvider } = await import('./ragCharNgramStandInProvider');

  const datasetPath = process.argv[2] ?? path.join(__dirname, '..', '..', '..', '..', 'benchmarks', 'rag', 'datasets', 'synthetic-v1.json');
  const outDir = process.argv[3] ?? path.join(__dirname, '..', '..', '..', '..', 'benchmarks', 'rag', 'hybrid-evaluation');

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

  // Opt-in ONLY — a real semantic provider is used exclusively when BOTH
  // an endpoint and a model are explicitly supplied via environment
  // variables; this is never contacted automatically. See this module's
  // own top-level doc comment.
  const endpoint = process.env.SOFTPLAY_RAG_EVAL_ENDPOINT;
  const model = process.env.SOFTPLAY_RAG_EVAL_MODEL;
  const apiKey = process.env.SOFTPLAY_RAG_EVAL_API_KEY;

  const isStandInProvider = !endpoint || !model;
  const provider = isStandInProvider ? new CharNgramStandInProvider() : new CachingEmbeddingProvider(new HttpEmbeddingProvider({ endpoint: endpoint!, model: model!, apiKey }));

  if (isStandInProvider) {
    console.log('No SOFTPLAY_RAG_EVAL_ENDPOINT/SOFTPLAY_RAG_EVAL_MODEL configured — using the deterministic, NON-SEMANTIC stand-in provider (see this file\'s own doc comment).');
  } else {
    console.log(`Using the REAL configured semantic provider: ${endpoint} (model: ${model}).`);
  }

  const results = await runHybridEvaluation(dataset, provider);
  const report = buildHybridEvaluationReport(dataset, results, provider.id, isStandInProvider);

  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `hybrid-evaluation.v${dataset.datasetVersion}.latest.json`);
  const markdownPath = path.join(outDir, `hybrid-evaluation.v${dataset.datasetVersion}.latest.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report.json, null, 2), 'utf8');
  fs.writeFileSync(markdownPath, report.markdown, 'utf8');

  console.log(`\n${report.markdown}`);
  console.log(`Full report written to:\n  ${jsonPath}\n  ${markdownPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
