import * as path from 'path';
import type { RagIndex, RagRecipeMetadata } from './ragIndexBuilder';
import type { RagAutomationMode, RagLanguage } from './ragTypes';

/**
 * Turns a built `RagIndex` (ragIndexBuilder.ts) plus a query into the
 * prompt section `buildLlmPrompt()`/`buildApiLlmPrompt()` (objectSpyPanel.ts)
 * inject before sending a "Start AI Code Generation" request. Zero `vscode`
 * dependency — fully unit-testable with a hand-built index.
 */

export interface RagMatch {
  id: string;
  title: string;
  body: string;
  imports?: { java?: string[]; python?: string[] };
  score: number;
  /** The recipe's own source `.md` file's absolute path — carried through
   * so a caller (objectSpyPanel.ts) can point a user at EXACTLY which
   * `.github/rag/` file a piece of generated code was traced back to. Kept
   * as the raw absolute path here (this module has no `vscode` import to
   * compute a workspace-relative one); `formatRagPromptSection()` below
   * only ever shows the plain filename (`path.basename`), never the full
   * local path, in text that's sent to the LLM. */
  filePath: string;
}

/** Retrieves the top `topK` recipes relevant to `queryText`, restricted to
 * ones that declare support for the current `language`/`automationMode` —
 * a recipe for a Python-only helper is never shown when generating Java,
 * even if its text happens to score well, since it would just be
 * misleading/unusable context. A zero-similarity match is dropped
 * entirely (see the filter below) — sharing every indexed recipe
 * regardless of relevance would defeat the whole point (unrelated context
 * inflating the prompt and, worse, tempting the model to shoehorn in a
 * helper that doesn't actually apply). */
export async function retrieveRagMatches(
  index: RagIndex,
  queryText: string,
  language: RagLanguage,
  automationMode: RagAutomationMode,
  topK = 3
): Promise<RagMatch[]> {
  if (!queryText.trim()) {
    return [];
  }
  const queryVector = await index.embeddings.embedQuery(queryText);
  const results = await index.store.similaritySearchVectorWithScore(queryVector, topK, { language, automationMode });
  return results
    .filter(([, score]) => score > 0)
    .map(([doc, score]) => {
      const metadata = doc.metadata as RagRecipeMetadata;
      return { id: metadata.id, title: metadata.title, body: doc.pageContent, imports: metadata.imports, score, filePath: metadata.filePath };
    });
}

/** Hard safety net on a SINGLE recipe body's contribution to the prompt —
 * "Generate RAG Corpus format" (ragCorpusGenerator.ts) accepts source
 * files up to 200KB and asks Copilot to write a recipe from one, with no
 * cap on how much of that the model echoes back into the body it returns.
 * Without this, one unusually verbose auto-generated recipe (or a
 * hand-written one someone pasted a large class into) can silently make
 * "Start AI Code Generation"'s ALREADY sizeable prompt (built-in
 * instructions + every checked custom .md file + the full recorded/API
 * code) too large for the model — while "Start AI Feature File
 * Generation", which never includes RAG content at all, keeps working
 * fine with the exact same recipe library, misleadingly looking like "RAG
 * itself is broken" when the real cause is one oversized recipe tipping a
 * request that was already close to the model's own context limit. */
const RAG_MAX_RECIPE_BODY_CHARS = 4_000;

/** Pure formatter — returns `''` (no section at all) when there's nothing
 * to show, so a request with no relevant reusable component costs exactly
 * zero extra prompt tokens, never a "no matches found" placeholder. */
export function formatRagPromptSection(matches: RagMatch[], language: RagLanguage): string {
  if (matches.length === 0) {
    return '';
  }

  const importLines = Array.from(
    new Set(
      matches
        .map((match) => match.imports?.[language])
        .filter((imports): imports is string[] => Array.isArray(imports) && imports.length > 0)
        .flat()
    )
  );

  const parts = [
    '\n## Reusable components available — prefer these over writing new code',
    "Your team maintains a library of tested, reusable helpers. Before writing new logic for something one of " +
      'these already does, USE IT: add the exact import statement shown below, then call the helper exactly as ' +
      "shown in its example. Do not reimplement what's already here, and do not modify a helper's own " +
      'implementation — only call it. TRACEABILITY (required): the FIRST TIME you call any component listed ' +
      'below, add a one-line comment directly above that call, in this exact form (using this language\'s own ' +
      'comment syntax): "RAG match: <component id> (from <source file>)" — using the exact id and source file ' +
      'shown for that component below. This lets a reviewer see, directly in the generated code, that this call ' +
      "came from the team's own reusable library rather than being freshly written."
  ];
  matches.forEach((match, i) => {
    const body =
      match.body.length > RAG_MAX_RECIPE_BODY_CHARS
        ? `${match.body.slice(0, RAG_MAX_RECIPE_BODY_CHARS)}\n… (truncated — this recipe's body is unusually large; consider trimming it in .github/rag/)`
        : match.body;
    parts.push(`\n### ${i + 1}. ${match.title} (id: \`${match.id}\`, source file: \`${path.basename(match.filePath)}\`)`, body);
  });
  if (importLines.length > 0) {
    parts.push(`\n### Required imports for the component(s) used above\n${importLines.map((line) => `\`${line}\``).join('\n')}`);
  }
  return parts.join('\n');
}
