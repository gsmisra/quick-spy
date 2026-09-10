import { z } from 'zod';
import { RAG_AUTOMATION_MODES, RAG_LANGUAGES } from '../ragTypes';

/**
 * Versioned JSON/JSONL fixture format for the RAG benchmark harness
 * (Phase 1) — a small, self-contained corpus + labeled queries a
 * benchmark run scores real retrieval output against. Deliberately zero
 * `vscode` import; validated with `zod` (already a dependency — see
 * ragTypes.ts's own `RagFrontmatterSchema` for the same pattern) since
 * this format is meant to be loaded from an actual JSON file at runtime,
 * where TypeScript's own compile-time types provide no protection at all.
 */

export const BENCHMARK_SPLITS = ['development', 'holdout'] as const;
export const BENCHMARK_ORIGINS = ['synthetic', 'human-labeled'] as const;

export type BenchmarkSplit = (typeof BENCHMARK_SPLITS)[number];
export type BenchmarkOrigin = (typeof BENCHMARK_ORIGINS)[number];

/** One fixture recipe — deliberately a SUBSET of the real
 * `RagFrontmatter`/`RagRecipe` shape (ragTypes.ts): just enough fields for
 * `buildRagIndex()` to embed and index it, without dragging in every real
 * corpus concern (sourcePath/sourceHash provenance, etc.) that a synthetic
 * benchmark fixture has no meaningful value for. */
export const BenchmarkRecipeFixtureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  automationMode: z.array(z.enum(RAG_AUTOMATION_MODES)).min(1),
  language: z.array(z.enum(RAG_LANGUAGES)).min(1),
  relativePath: z.string().min(1),
  body: z.string().min(1),
  imports: z
    .object({
      java: z.array(z.string().min(1)).optional(),
      python: z.array(z.string().min(1)).optional()
    })
    .optional()
});
export type BenchmarkRecipeFixture = z.infer<typeof BenchmarkRecipeFixtureSchema>;

export const BenchmarkOperationSchema = z.object({
  operationId: z.string().min(1),
  text: z.string().min(1)
});
export type BenchmarkOperation = z.infer<typeof BenchmarkOperationSchema>;

export const BenchmarkQuerySchema = z.object({
  queryId: z.string().min(1),
  language: z.enum(RAG_LANGUAGES),
  automationMode: z.enum(RAG_AUTOMATION_MODES),
  split: z.enum(BENCHMARK_SPLITS),
  origin: z.enum(BENCHMARK_ORIGINS),
  datasetVersion: z.string().min(1),
  queryText: z.string().min(1),
  /** Per-operation breakdown — optional, since operation-level planning
   * (Phase 3) doesn't exist in the pipeline yet; a query with no
   * `operations` is scored as a single whole-query request, exactly like
   * today's real retrieval call. */
  operations: z.array(BenchmarkOperationSchema).optional(),
  /** Empty array is a DELIBERATE no-match case (a query nothing in the
   * corpus should satisfy), not "not yet labeled." */
  relevantIds: z.array(z.string().min(1)),
  gradedRelevance: z.record(z.string(), z.number()).optional(),
  alternativeGroups: z.array(z.array(z.string().min(1)).min(1)).optional(),
  /** Short human-readable reason this label is what it is — required so a
   * dataset reviewer (or a future contributor questioning a label) always
   * has SOME stated justification, never a bare unexplained ID list. */
  rationale: z.string().min(1)
});
export type BenchmarkQuery = z.infer<typeof BenchmarkQuerySchema>;

export const BenchmarkDatasetSchema = z.object({
  datasetVersion: z.string().min(1),
  recipes: z.array(BenchmarkRecipeFixtureSchema).min(1),
  queries: z.array(BenchmarkQuerySchema).min(1)
});
export type BenchmarkDataset = z.infer<typeof BenchmarkDatasetSchema>;

export interface BenchmarkValidationResult {
  ok: boolean;
  errors: string[];
}

/** Validates a dataset beyond what the zod schema alone can express:
 * duplicate IDs, dangling references, and contradictory no-match labels.
 * Schema-shape validity (`BenchmarkDatasetSchema.safeParse`) is checked
 * FIRST and separately by the caller — this function assumes it already
 * passed and only does cross-referential checks. */
export function validateBenchmarkDataset(dataset: BenchmarkDataset): BenchmarkValidationResult {
  const errors: string[] = [];

  const recipeIds = new Set<string>();
  for (const recipe of dataset.recipes) {
    if (recipeIds.has(recipe.id)) {
      errors.push(`Duplicate recipe id: "${recipe.id}".`);
    }
    recipeIds.add(recipe.id);
  }

  const queryIds = new Set<string>();
  for (const query of dataset.queries) {
    if (queryIds.has(query.queryId)) {
      errors.push(`Duplicate query id: "${query.queryId}".`);
    }
    queryIds.add(query.queryId);

    for (const id of query.relevantIds) {
      if (!recipeIds.has(id)) {
        errors.push(`Query "${query.queryId}" references unknown recipe id "${id}" in relevantIds.`);
      }
    }
    for (const group of query.alternativeGroups ?? []) {
      for (const id of group) {
        if (!recipeIds.has(id)) {
          errors.push(`Query "${query.queryId}" references unknown recipe id "${id}" in alternativeGroups.`);
        }
      }
    }
    for (const id of Object.keys(query.gradedRelevance ?? {})) {
      if (!recipeIds.has(id)) {
        errors.push(`Query "${query.queryId}" references unknown recipe id "${id}" in gradedRelevance.`);
      }
    }

    // A query's requirements can be expressed EITHER as standalone
    // `relevantIds` OR as `alternativeGroups` (or both) — a query whose
    // only requirement is "any one of these alternatives" legitimately has
    // an EMPTY `relevantIds` alongside a non-empty `alternativeGroups`;
    // that is a normal positive query, not a contradiction. The genuine
    // no-match case is when NEITHER is populated at all.
    const hasAlternatives = (query.alternativeGroups ?? []).length > 0;
    const isNoMatch = query.relevantIds.length === 0 && !hasAlternatives;
    const hasGradedRelevance = Object.keys(query.gradedRelevance ?? {}).length > 0;
    if (isNoMatch && hasGradedRelevance) {
      errors.push(
        `Query "${query.queryId}" is contradictory: relevantIds and alternativeGroups are both empty (a deliberate ` +
          `no-match label) but gradedRelevance is non-empty (implying something SHOULD match).`
      );
    }

    if (query.operations) {
      const operationIds = new Set<string>();
      for (const op of query.operations) {
        if (operationIds.has(op.operationId)) {
          errors.push(`Query "${query.queryId}" has a duplicate operationId "${op.operationId}".`);
        }
        operationIds.add(op.operationId);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Parses and validates a raw (untyped, e.g. freshly `JSON.parse()`-d)
 * value as a `BenchmarkDataset` — schema shape first, then the
 * cross-referential checks above. Never throws; a malformed dataset
 * (whether hand-edited or freshly authored) comes back as a clear list of
 * reasons, same philosophy as rag/ragFrontmatter.ts's `parseRagFile()`. */
export function parseBenchmarkDataset(raw: unknown): BenchmarkValidationResult & { dataset?: BenchmarkDataset } {
  const parsed = BenchmarkDatasetSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
  }
  const crossRefResult = validateBenchmarkDataset(parsed.data);
  return { ...crossRefResult, dataset: crossRefResult.ok ? parsed.data : undefined };
}
