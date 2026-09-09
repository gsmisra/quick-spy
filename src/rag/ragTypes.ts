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
    .optional()
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

/** Text actually fed to the embedder for both indexing and querying — the
 * parts of a recipe most likely to line up with how a scenario/prompt
 * describes what it needs. Title + tags carry the most signal for a short,
 * curated corpus; the body is included too so a description phrase like
 * "opens a database connection" still matches even if it wasn't tagged;
 * `relativePath` is included so a recipe organized into a meaningfully
 * named folder/subfolder (e.g. "database/cassandra/...") or given a
 * descriptive filename is ALSO findable by those words even if the exact
 * same term never appears in the title/tags/body — e.g. a recipe filed
 * under `database/cassandra/connection-helper.md` becomes matchable by a
 * scenario that just says "connect to Cassandra", purely from its folder
 * name, with zero change needed to the recipe's own content. The
 * tokenizer (tfidfEmbeddings.ts) already splits on any non-alphanumeric
 * character, so "database/cassandra/connection-helper.md" naturally
 * yields the separate keywords "database", "cassandra", "connection",
 * "helper" with no extra parsing needed here — this applies identically
 * whether the recipe is later retrieved for UI or API Automation mode,
 * since both share this exact same indexing/embedding pipeline. */
export function recipeToEmbeddingText(recipe: RagRecipe): string {
  const { title, tags } = recipe.frontmatter;
  return [title, tags.join(' '), recipe.relativePath, recipe.body].join('\n');
}
