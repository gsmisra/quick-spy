/**
 * Pure token-budget decision logic for admission-controlling a request
 * BEFORE it ever reaches Copilot — deliberately its own file with zero
 * `vscode` import (llm/copilotClient.ts itself imports `vscode` for the
 * real `vscode.lm` calls, which would make this logic untestable outside
 * an Extension Host if it lived there too — see that file's own doc
 * comment on the same pattern for `sendPrompt`/`assertMessagesFitModel`),
 * so the actual "is this request too big, and by how much" arithmetic is
 * directly unit tested.
 */

/** Fraction of a model's own `maxInputTokens` actually admitted for a
 * request's INPUT — reserved headroom accounts for the model's own
 * response sharing the same context window, and for token counting being
 * an ESTIMATE for some providers rather than an exact preflight guarantee.
 * Not tunable via settings — this is a safety margin, not a user
 * preference. */
export const PROMPT_TOKEN_SAFETY_MARGIN = 0.9;

export interface TokenBudgetDecision {
  /** 'fits' — under budget, safe to send. 'exceeds' — over budget, must NOT
   * be sent as-is. 'unmeasured' — at least one message's token count
   * couldn't be determined at all, so there is no reliable total to compare
   * against the budget; treated as "let it through" by callers (see
   * llm/copilotClient.ts's `assertMessagesFitModel()`) rather than as
   * either a pass or a fail — an unmeasured request is a DIFFERENT claim
   * than a measured, known-safe one. */
  outcome: 'fits' | 'exceeds' | 'unmeasured';
  /** Sum of every message's own token count. Present for 'fits'/'exceeds';
   * `undefined` for 'unmeasured' (there is no reliable total). */
  totalTokens?: number;
  maxInputTokens: number;
  /** `Math.floor(maxInputTokens * safetyMargin)` — the actual ceiling
   * `totalTokens` is compared against. */
  budget: number;
}

/**
 * Decides whether a request whose messages individually counted to
 * `perMessageCounts` (in token-count order, matching however many messages
 * make up the real assembled request — a single prompt, or a full
 * multi-turn LangChain conversation) fits within `maxInputTokens`'s
 * safety-margined budget. An `undefined` entry means that ONE message's
 * count could not be determined (the underlying `countTokens` call
 * failed) — the whole decision becomes 'unmeasured' rather than silently
 * summing only the messages that succeeded, which could under-report an
 * actually-oversized request as fitting.
 */
export function decideTokenBudget(
  perMessageCounts: ReadonlyArray<number | undefined>,
  maxInputTokens: number,
  safetyMargin: number = PROMPT_TOKEN_SAFETY_MARGIN
): TokenBudgetDecision {
  const budget = Math.floor(maxInputTokens * safetyMargin);
  if (perMessageCounts.some((count) => count === undefined)) {
    return { outcome: 'unmeasured', maxInputTokens, budget };
  }
  const totalTokens = (perMessageCounts as number[]).reduce((sum, count) => sum + count, 0);
  return { outcome: totalTokens > budget ? 'exceeds' : 'fits', totalTokens, maxInputTokens, budget };
}

/** Thrown when a `decideTokenBudget()` decision comes back 'exceeds' — see
 * llm/copilotClient.ts's `assertMessagesFitModel()`/`sendPrompt()` and
 * agent/vscodeCopilotToolCallingModel.ts's `_generate()` for where this
 * actually gets thrown BEFORE any network call. Names concrete, actionable
 * levers rather than leaving the raw numbers to speak for themselves. */
export class PromptTooLargeError extends Error {
  constructor(
    public readonly tokenCount: number,
    public readonly maxInputTokens: number,
    public readonly budget: number
  ) {
    super(
      `This request is too large for the selected model (${tokenCount.toLocaleString()} tokens, over the ` +
        `${budget.toLocaleString()}-token safe budget out of its ${maxInputTokens.toLocaleString()}-token limit). ` +
        'Try: unchecking some Custom Instruction files, selecting fewer Gherkin scenario steps, turning off ' +
        'Reusable Components (RAG), splitting up an oversized source file, or picking a model with a larger context window.'
    );
    this.name = 'PromptTooLargeError';
  }
}
