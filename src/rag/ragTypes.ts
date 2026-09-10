import { z } from 'zod';

/**
 * The reusable-component corpus format — one Markdown file per component
 * under `.github/rag/`, YAML frontmatter + a free-text body (description
 * plus fenced code block(s)). Team-authored and PR-reviewed, exactly the
 * same trust model as this extension's existing `.github/*.md` custom
 * instruction files — see security/uiPasswordRedactor.ts's doc comment for
 * the parallel "this is trusted, reviewed content" reasoning.
 *
 * Kept deliberately flat and small: this is a curated internal snippet
 * library, not open-domain documents, so a simple, explicit schema beats a
 * more flexible/nested one neither the indexer nor a human author needs.
 */
export const RAG_AUTOMATION_MODES = ['ui', 'api'] as const;
export const RAG_LANGUAGES = ['java', 'python'] as const;

export const RagFrontmatterSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase kebab-case, e.g. "postgres-query-and-validate"'),
  title: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  automationMode: z.array(z.enum(RAG_AUTOMATION_MODES)).min(1),
  language: z.array(z.enum(RAG_LANGUAGES)).min(1),
  imports: z
    .object({
      java: z.array(z.string().min(1)).optional(),
      python: z.array(z.string().min(1)).optional()
    })
    .optional(),
  /** The original uploaded source file's own relative path (e.g.
   * "bigdata/src/main/java/com/td/tds/tcoe/automation/cassandra/CsqlHelper.java")
   * — stamped by ragCorpusGenerator.ts itself from data it already has,
   * NEVER trusted from the model's own output (see
   * ragRecipeNormalizer.ts's normalizeGeneratedRecipe() doc comment), so a
   * reviewer can always trace a generated recipe back to exactly which
   * source file produced it and re-verify the `imports`/package path
   * against the real thing. Absent for a hand-authored recipe with no
   * single upload behind it. */
  sourcePath: z.string().min(1).optional(),
  /** SHA-256 of the original uploaded source file's content at generation
   * time (see ragSourceIdentity.ts's `hashSourceContent()`) — the
   * provenance half of staleness detection, stamped alongside
   * `sourcePath` for the same "never trust the model's own output" reason.
   * If `sourcePath` still resolves to a real file later, comparing that
   * file's CURRENT hash against this one tells whether the recipe still
   * reflects what's actually there — see rag/ragFreshnessChecker.ts and
   * rag/ragFreshnessService.ts for the active check that consumes this
   * (the "SoftPlay: Check RAG Source Freshness" command). A recipe
   * generated before this field existed simply has it `undefined`, which
   * that checker reports as "unverifiable," never as stale — no existing
   * recipe needed to be regenerated for this to work. */
  sourceHash: z.string().length(64).optional(),
  /** WHICH hashing formula `sourceHash` above was actually computed under
   * — see rag/ragSourceIdentity.ts's `SourceHashScheme` (F09). Absent for
   * every recipe generated before this field existed (or hand-authored) —
   * ALWAYS interpreted as `SOURCE_HASH_SCHEME_LEGACY` in that case, never
   * as an error or as "unverifiable," so no existing recipe needed
   * regenerating for this to be safe. A value this build doesn't recognize
   * (a future scheme) is treated as "unverifiable" rather than guessed at
   * — see rag/ragFreshnessChecker.ts's own handling. Deliberately a bare
   * string here (not a Zod enum) so a NEWER scheme value written by a
   * newer version of this extension still parses successfully under an
   * OLDER schema instead of failing frontmatter validation outright. */
  sourceHashScheme: z.string().min(1).optional(),
  /** A06 — whether `sourcePath` was CONFIRMED to resolve to a real file
   * under some currently-open workspace folder AT GENERATION TIME (see
   * rag/ragCorpusGenerator.ts, which runs the exact same resolution logic
   * as rag/ragFreshnessService.ts's own active staleness check before ever
   * stamping this). `true` — the source was genuinely present in an open
   * workspace when this recipe was generated (the common case: recipes
   * generated from files that live in the project the user actually has
   * open), so a LATER "not found" result really does mean it went missing
   * (moved/renamed/deleted) and should be reported as `missing`. `false`
   * — the source could NOT be confirmed present anywhere at generation
   * time (a genuinely external upload — e.g. a shared framework project
   * that was never opened here — see ragCorpusGenerator.ts's
   * `UploadedFile`), so a later "not found" result carries NO information
   * about staleness at all and must be reported as `unverifiable`, never
   * `missing` — see rag/ragFreshnessChecker.ts's `classifyFreshness()`.
   * `undefined` for every recipe generated before this field existed (or
   * hand-authored) — preserves the EXACT pre-existing "not found ->
   * missing" behavior for those, so no existing recipe's freshness
   * reporting changes as a result of this field simply not existing yet. */
  sourceMapped: z.boolean().optional()
});

export type RagFrontmatter = z.infer<typeof RagFrontmatterSchema>;
export type RagAutomationMode = (typeof RAG_AUTOMATION_MODES)[number];
export type RagLanguage = (typeof RAG_LANGUAGES)[number];

/** One parsed `.github/rag/*.md` file, ready to be embedded and indexed. */
export interface RagRecipe {
  /** Absolute path of the source `.md` file — used for logging and as the
   * vector store document id (stable across rebuilds as long as the file
   * isn't renamed). */
  filePath: string;
  /** Path of `filePath` RELATIVE TO the `.github/rag/` folder itself
   * (forward slashes always, regardless of OS) — e.g.
   * "database/cassandra/cassandra-helper.md" for a recipe a project zip's
   * own folder structure placed under a `database/cassandra/` subfolder
   * (see rag/ragCorpusGenerator.ts's `ragTargetRelPath()`). Deliberately
   * relative to the RAG folder, never the full absolute machine path —
   * folding in someone's own local checkout path (username, project
   * folder name, ...) would inject the SAME accidental tokens into every
   * single recipe's embedding, quietly biasing every match toward
   * whatever words happen to appear in that one machine's directory
   * structure. Fed into `recipeToEmbeddingText()` below so a recipe is
   * findable by its own folder/subfolder/file name, not just its title/
   * tags/body content — see that function's own doc comment. */
  relativePath: string;
  frontmatter: RagFrontmatter;
  /** Everything after the closing `---` — the human-readable description
   * plus fenced code block(s), included in the prompt verbatim when this
   * recipe is retrieved. */
  body: string;
  /** mtime (ms since epoch) of `filePath` at parse time — the indexer's
   * cache-invalidation key alongside the file's own path. */
  mtimeMs: number;
}

/** How many times each field's text is repeated before being concatenated
 * into a recipe's embedding text (see `recipeToEmbeddingText()` below) —
 * TF-IDF has no built-in notion of "this field matters more," so
 * repetition is the standard way to give one field's terms proportionally
 * more weight in the resulting term-frequency vector without needing a
 * different retrieval model (the same technique real field-weighted search
 * engines use, e.g. Lucene/Elasticsearch's per-field boost). `title`/`tags`
 * are short, curated, high-precision signal an author wrote SPECIFICALLY
 * to describe what a recipe does — weighted highest. `relativePath`
 * (folder/filename) is also curated but usually shorter/less descriptive
 * on its own. `body` (prose plus example code) is weighted lowest — it's
 * by far the most voluminous field, and without an explicit weight it
 * would otherwise dominate purely by raw word count, diluting the precise
 * signal from the fields an author actually curated to describe intent.
 *
 * Repeating a field within ONE recipe's text does NOT inflate that term's
 * DOCUMENT frequency (IDF is computed from a per-document `Set`,
 * deduplicating repeats within one document — see tfidfEmbeddings.ts's
 * `fit()`) — only that recipe's own TERM frequency for those words, which
 * is exactly the intended effect: "this word is more central to what THIS
 * recipe is," not "this word is rarer across the whole corpus." */
const EMBEDDING_FIELD_WEIGHTS = { title: 3, tags: 3, relativePath: 2, body: 1 } as const;

/** Repeats non-empty `text` `times` times, newline-joined — empty/
 * whitespace-only text contributes nothing (no point repeating blankness),
 * so a recipe with no tags, say, doesn't inject empty lines into its own
 * embedding text. */
function weighted(text: string, times: number): string {
  return text.trim() ? Array(times).fill(text).join('\n') : '';
}

/** Text actually fed to the embedder for indexing (never for the QUERY
 * side — a scenario/prompt's free text has no equivalent "fields" to weight
 * the same way, and is embedded as plain text by its own caller) — the
 * parts of a recipe most likely to line up with how a scenario/prompt
 * describes what it needs, each weighted per `EMBEDDING_FIELD_WEIGHTS`
 * above rather than concatenated flat. Title + tags carry the most signal
 * for a short, curated corpus; the body is included too (at baseline
 * weight) so a description phrase like "opens a database connection"
 * still matches even if it wasn't tagged; `relativePath` is included so a
 * recipe organized into a meaningfully named folder/subfolder (e.g.
 * "database/cassandra/...") or given a descriptive filename is ALSO
 * findable by those words even if the exact same term never appears in
 * the title/tags/body — e.g. a recipe filed under
 * `database/cassandra/connection-helper.md` becomes matchable by a
 * scenario that just says "connect to Cassandra", purely from its folder
 * name, with zero change needed to the recipe's own content. The
 * tokenizer (tfidfEmbeddings.ts) already splits on any non-alphanumeric
 * character (and, for a compound identifier, on its own camelCase/
 * snake_case word boundaries too — see that file's `extractFeatures()`),
 * so "database/cassandra/connection-helper.md" naturally yields the
 * separate keywords "database", "cassandra", "connection", "helper" with
 * no extra parsing needed here — this applies identically whether the
 * recipe is later retrieved for UI or API Automation mode, since both
 * share this exact same indexing/embedding pipeline. */
export function recipeToEmbeddingText(recipe: RagRecipe): string {
  const { title, tags } = recipe.frontmatter;
  return [
    weighted(title, EMBEDDING_FIELD_WEIGHTS.title),
    weighted(tags.join(' '), EMBEDDING_FIELD_WEIGHTS.tags),
    weighted(recipe.relativePath, EMBEDDING_FIELD_WEIGHTS.relativePath),
    weighted(recipe.body, EMBEDDING_FIELD_WEIGHTS.body)
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}
