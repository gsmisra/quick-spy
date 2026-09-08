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
      return { id: metadata.id, title: metadata.title, body: doc.pageContent, imports: metadata.imports, score };
    });
}

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
      'implementation — only call it.'
  ];
  matches.forEach((match, i) => {
    parts.push(`\n### ${i + 1}. ${match.title} (id: \`${match.id}\`)`, match.body);
  });
  if (importLines.length > 0) {
    parts.push(`\n### Required imports for the component(s) used above\n${importLines.map((line) => `\`${line}\``).join('\n')}`);
  }
  return parts.join('\n');
}
