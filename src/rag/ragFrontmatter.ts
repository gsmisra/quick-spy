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

export function parseRagFile(raw: string): RagParseResult {
  const text = raw.replace(/^﻿/, ''); // strip a BOM if present — common on Windows-authored files
  if (!FRONTMATTER_DELIMITER.test(text)) {
    return { ok: false, error: 'Missing YAML frontmatter — the file must start with a "---" line.' };
  }
  const afterOpening = text.replace(FRONTMATTER_DELIMITER, '');
  const closingMatch = afterOpening.match(/\r?\n---\s*\r?\n/);
  if (!closingMatch || closingMatch.index === undefined) {
    return { ok: false, error: 'Frontmatter is never closed — expected a second "---" line on its own.' };
  }
  const yamlBlock = afterOpening.slice(0, closingMatch.index);
  const body = afterOpening.slice(closingMatch.index + closingMatch[0].length);

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

  return { ok: true, value: { frontmatter: result.data, body: body.trim() } };
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
