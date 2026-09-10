/**
 * A14 fix — the complete, immutable shape of ONE Agentic generation action
 * (feature file / automation code / manual test-case CSV) that does NOT
 * depend on the packed RAG section, pulled out of agenticModeController.ts
 * as its own pure, zero-`vscode`-import module so it's directly unit
 * tested (matching this codebase's established "pure decision logic
 * extracted and tested, vscode-dependent orchestration reviewed" split —
 * see e.g. rag/ragFreshnessChecker.ts vs. rag/ragFreshnessService.ts, and
 * this SAME session's own agenticRequestEpoch.ts for A13).
 *
 * The bug this closes: each `generateXxx()` method used to measure its
 * "mandatory" (non-RAG) token cost against `buildSystemInstructions()`'s
 * bare output and the RAW, possibly-empty `lastUserRequest` — then, at the
 * ACTUAL `chain.invoke()` call, sent `buildSystemInstructions()`'s output
 * PLUS this action's own directive suffix (a real, decently long sentence
 * for feature/code — see `directiveSuffix` below), and the EFFECTIVE
 * (fallback-substituted) user request instead of the raw one. BOTH
 * additions happened AFTER `buildRagSection()` had already decided how
 * much RAG content fits the (undercounted) remaining budget — so a
 * near-the-limit request could pack MORE RAG than the model's real limit
 * actually allows once the directive/fallback text are added back in, and
 * get rejected outright by `assertMessagesFitModel()`
 * (`vscodeCopilotToolCallingModel.ts`, "the final adapter admission
 * check") even though a correctly-sized (smaller) RAG section, chosen from
 * the start against the REAL mandatory cost, would have fit fine.
 *
 * Built ONCE per generation and reused for BOTH the mandatory-only
 * measurement pass and the final real send — the only thing that
 * legitimately differs between the two is the RAG section text itself,
 * exactly as the review's own remediation asks: "construct the complete
 * immutable ... input before measuring it ... measure and send this same
 * structure, inserting only the packed RAG section."
 */

export type AgenticActionKind = 'feature' | 'code' | 'csv';

export interface AgenticActionShape {
  /** Appended DIRECTLY onto `buildSystemInstructions()`'s own output —
   * the literal directive text for this action. Empty for `'csv'`: the
   * CSV chain's own `systemInstructions` (built WITH the Jira template —
   * see `includeCsvTemplate` below) already fully specify the ask, with
   * nothing appended after it, unlike feature/code. */
  directiveSuffix: string;
  /** Whether `buildSystemInstructions()` should build the CSV Jira
   * template instead of the ordinary automation-mode instructions. */
  includeCsvTemplate: boolean;
  /** The EFFECTIVE user request actually sent to the chain — this
   * action's OWN fallback placeholder substituted for an empty chat box,
   * never the raw (possibly empty) `lastUserRequest` on its own. */
  effectiveUserRequest: string;
}

const FEATURE_DIRECTIVE_SUFFIX =
  '\n\nGenerate a single, well-structured Cucumber Gherkin .feature file (Feature/Scenario/Given-When-Then) covering the ask below. Output ONLY the .feature file content, no commentary, no fenced code block wrapper.';

const FEATURE_AND_CODE_FALLBACK_USER_REQUEST = '(No additional instructions were provided — use the ingested files and any custom instructions/RAG context above.)';

const CSV_FALLBACK_USER_REQUEST = '(No additional instructions were provided — cover every scenario found in the ingested files.)';

/** Builds `kind`'s complete action shape. `lastUserRequest` is the RAW
 * (possibly empty) chat-box text; `language`/`languageVersion` are only
 * used by `'code'`'s own directive (the target language/version the
 * generated automation code must actually be written in). */
export function buildAgenticActionShape(kind: AgenticActionKind, lastUserRequest: string, language: string, languageVersion: string): AgenticActionShape {
  switch (kind) {
    case 'feature':
      return {
        directiveSuffix: FEATURE_DIRECTIVE_SUFFIX,
        includeCsvTemplate: false,
        effectiveUserRequest: lastUserRequest || FEATURE_AND_CODE_FALLBACK_USER_REQUEST
      };
    case 'code':
      return {
        directiveSuffix: `\n\nGenerate complete, runnable ${language} (version ${languageVersion}) automation code satisfying the ask below, following every standard above. Output ONLY the code inside a single fenced code block.`,
        includeCsvTemplate: false,
        effectiveUserRequest: lastUserRequest || FEATURE_AND_CODE_FALLBACK_USER_REQUEST
      };
    case 'csv':
      return {
        directiveSuffix: '',
        includeCsvTemplate: true,
        effectiveUserRequest: lastUserRequest || CSV_FALLBACK_USER_REQUEST
      };
  }
}
