import { parseCsv, stringifyCsv } from './csvUtils';

/**
 * Pure post-processing for "Generate Manual Test Cases in CSV" (Total
 * Agentic Mode, see agenticModeController.ts, agenticChains.ts) — the model
 * is asked (via `Jira_test_case_template.md`'s own instructions, injected
 * into the prompt verbatim) to answer with CSV text matching the team's own
 * column spec. This file validates/normalizes that response into a real,
 * re-parseable CSV file rather than trusting the model's raw text
 * byte-for-byte — the exact same "never trust a model's formatting
 * completely" posture as rag/ragRecipeNormalizer.ts's `normalizeGeneratedRecipe()`.
 *
 * Zero `vscode` import — directly unit-testable.
 */

/** Strips a single outer fence wrapping the ENTIRE response, if the model
 * added one despite being told not to — identical rule to
 * rag/ragRecipeNormalizer.ts's `stripOuterFence()`, duplicated locally
 * rather than shared across modules whose only relationship is "both
 * post-process a Copilot text response" (an accidental coupling not worth
 * introducing for four lines of logic). */
function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*)\n```$/);
  return match ? match[1].trim() : trimmed;
}

export interface NormalizedTestCaseCsv {
  /** Always valid, re-parseable CSV text (CRLF line endings) — a header
   * row plus zero or more data rows, every row padded to the header's own
   * width. */
  content: string;
  rowCount: number;
  columnCount: number;
}

export class InvalidTestCaseCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTestCaseCsvError';
  }
}

/**
 * Validates and re-serializes a model's raw CSV response. Unlike
 * `normalizeGeneratedRecipe()`'s "always produce something, fall back to a
 * wrapper" posture, a manual test-case CSV has no sensible fallback shape —
 * a Jira import needs REAL rows matching REAL columns, so a response that
 * doesn't parse into at least a header row throws `InvalidTestCaseCsvError`
 * (caught by the caller and surfaced as a clear, actionable error rather
 * than silently writing a garbage file).
 */
export function normalizeTestCaseCsvResponse(rawResponse: string): NormalizedTestCaseCsv {
  const candidate = stripOuterFence(rawResponse);
  const rows = parseCsv(candidate).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) {
    throw new InvalidTestCaseCsvError('The model\'s response did not contain any parseable CSV rows.');
  }
  const [header, ...dataRows] = rows;
  if (header.every((cell) => cell.trim().length === 0)) {
    throw new InvalidTestCaseCsvError('The model\'s response is missing a header row.');
  }
  if (dataRows.length === 0) {
    throw new InvalidTestCaseCsvError('The model\'s response had a header row but no actual test-case data rows.');
  }

  return {
    content: stringifyCsv([header, ...dataRows]),
    rowCount: dataRows.length,
    columnCount: header.length
  };
}
