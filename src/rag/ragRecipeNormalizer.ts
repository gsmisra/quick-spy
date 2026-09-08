import * as path from 'path';
import { parseRagFile, serializeRagFile } from './ragFrontmatter';
import { RAG_LANGUAGES, RagFrontmatter } from './ragTypes';

/**
 * Pure post-processing for a Copilot response from "Generate RAG Corpus
 * format" (see ragCorpusGenerator.ts) — deliberately its own file with zero
 * `vscode` import (ragCorpusGenerator.ts itself imports `vscode` for real
 * file-system/model-resolution work, which would make this function
 * untestable outside an Extension Host if it lived there too) so this,
 * the actual "is the model's output usable" logic, is directly unit
 * tested.
 */

export function slugify(fileBaseName: string): string {
  const slug = fileBaseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'component';
}

export function guessLanguageFromExtension(fileName: string): RagFrontmatter['language'] {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.java') return ['java'];
  if (ext === '.py') return ['python'];
  return [...RAG_LANGUAGES]; // ambiguous (config/script/etc.) — apply to both rather than guess wrong
}

/** Strips a single outer fence wrapping the ENTIRE response, if the model
 * added one despite being told not to (defensive — models don't always
 * follow formatting instructions to the letter). Never touches fences
 * WITHIN the body (the actual example code block), only one that wraps
 * everything including the frontmatter's own "---" delimiters. */
export function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*)\n```$/);
  return match ? match[1].trim() : trimmed;
}

export interface NormalizedRecipe {
  content: string;
  usedFallback: boolean;
  fallbackReason?: string;
}

/**
 * Validates the model's raw response as a recipe file; if it doesn't parse
 * (malformed YAML, a missing required field, an id that isn't kebab-case,
 * ...), falls back to wrapping the ENTIRE response as the body under a
 * minimal, always-valid, filename-derived frontmatter — so a generation
 * request always produces *something* usable rather than silently
 * dropping a file, at the cost of that fallback likely needing a manual
 * touch-up (flagged via `usedFallback`).
 */
export function normalizeGeneratedRecipe(fileName: string, rawResponse: string): NormalizedRecipe {
  const candidate = stripOuterFence(rawResponse);
  const parsed = parseRagFile(candidate);
  if (parsed.ok) {
    // Re-serialize rather than saving the model's raw text verbatim — this
    // guarantees the file on disk is byte-for-byte in this extension's own
    // canonical format regardless of the model's own YAML formatting
    // quirks (key order, quoting style, trailing spaces).
    return { content: serializeRagFile(parsed.value.frontmatter, parsed.value.body), usedFallback: false };
  }

  const baseName = path.basename(fileName, path.extname(fileName));
  const fallbackFrontmatter: RagFrontmatter = {
    id: slugify(baseName),
    title: `Reusable component from ${fileName}`,
    tags: [],
    automationMode: ['ui', 'api'],
    language: guessLanguageFromExtension(fileName)
  };
  return {
    content: serializeRagFile(fallbackFrontmatter, candidate),
    usedFallback: true,
    fallbackReason: parsed.error
  };
}
