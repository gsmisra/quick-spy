import * as yaml from 'js-yaml';
import { RagFrontmatter, RagFrontmatterSchema } from './ragTypes';

/**
 * Splits a `.github/rag/*.md` file's raw text into frontmatter + body, and
 * validates the frontmatter against `RagFrontmatterSchema`. Pure — no
 * `vscode`, no `fs` — so both the indexer (ragIndexer.ts) and the corpus
 * generator's own self-check (ragCorpusGenerator.ts) can call it, and it's
 * directly unit-testable against malformed input without any extension-host
 * scaffolding.
 */
export interface ParsedRagFile {
  frontmatter: RagFrontmatter;
  body: string;
}

export type RagParseResult = { ok: true; value: ParsedRagFile } | { ok: false; error: string };

const FRONTMATTER_DELIMITER = /^---\s*\r?\n/;

export interface FrontmatterBlock {
  /** Raw text between the opening and closing "---" delimiters — NOT yet
   * parsed as YAML or validated against the schema. */
  yamlBlock: string;
  /** Raw text after the closing delimiter — NOT yet trimmed. */
  body: string;
}

/** Structural-only split of a `.github/rag/*.md`-shaped file into its raw
 * YAML block and body text — no YAML parsing, no schema validation. Broken
 * out of `parseRagFile()` so a caller that needs the raw YAML AFTER schema
 * validation has already failed (ragRecipeNormalizer.ts's bounded repair
 * pass — see its own doc comment) isn't stuck re-implementing this same
 * "---...---" delimiter parsing itself. Returns `undefined` when the text
 * doesn't even have the "---"-delimited shape at all (frontmatter missing
 * entirely, or never closed) — there is nothing to extract yet in that
 * case, YAML-repairable or not. */
export function splitFrontmatterBlock(raw: string): FrontmatterBlock | undefined {
  const text = raw.replace(/^﻿/, ''); // strip a BOM if present — common on Windows-authored files
  if (!FRONTMATTER_DELIMITER.test(text)) {
    return undefined;
  }
  const afterOpening = text.replace(FRONTMATTER_DELIMITER, '');
  const closingMatch = afterOpening.match(/\r?\n---\s*\r?\n/);
  if (!closingMatch || closingMatch.index === undefined) {
    return undefined;
  }
  return {
    yamlBlock: afterOpening.slice(0, closingMatch.index),
    body: afterOpening.slice(closingMatch.index + closingMatch[0].length)
  };
}

export function parseRagFile(raw: string): RagParseResult {
  const split = splitFrontmatterBlock(raw);
  if (!split) {
    const text = raw.replace(/^﻿/, '');
    if (!FRONTMATTER_DELIMITER.test(text)) {
      return { ok: false, error: 'Missing YAML frontmatter — the file must start with a "---" line.' };
    }
    return { ok: false, error: 'Frontmatter is never closed — expected a second "---" line on its own.' };
  }
  const { yamlBlock, body } = split;

  let parsedYaml: unknown;
  try {
    parsedYaml = yaml.load(yamlBlock);
  } catch (err) {
    return { ok: false, error: `Frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}` };
  }

  const result = RagFrontmatterSchema.safeParse(parsedYaml);
  if (!result.success) {
    return { ok: false, error: `Frontmatter failed validation: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  }

  // A schema-valid frontmatter with NOTHING after it used to parse
  // successfully with an empty `body` — silently indexing a recipe with no
  // description and no example at all, matchable by title/tags/folder name
  // alone yet with nothing useful to actually inject into a prompt. Empty
  // is never valid content, whether this recipe came from a hand-written
  // file or "Generate RAG Corpus format" (ragRecipeNormalizer.ts calls this
  // same check for exactly that reason).
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return { ok: false, error: 'Body is empty — a recipe needs a description and/or example, not just frontmatter.' };
  }

  return { ok: true, value: { frontmatter: result.data, body: trimmedBody } };
}

/** The inverse of `parseRagFile()` — renders a frontmatter object + body
 * back into the exact `.github/rag/*.md` file format. Used by
 * ragCorpusGenerator.ts to write out what the LLM produced after
 * validating/normalizing it, so the file on disk is always guaranteed
 * well-formed even if the model's own YAML formatting was slightly off. */
export function serializeRagFile(frontmatter: RagFrontmatter, body: string): string {
  const yamlBlock = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${yamlBlock}\n---\n\n${body.trim()}\n`;
}
