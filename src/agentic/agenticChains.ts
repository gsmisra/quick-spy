import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Runnable } from '@langchain/core/runnables';

/**
 * Total Agentic Mode's LangChain generation chains — the genuinely
 * LangChain-native counterpart to the rest of this extension's
 * hand-rolled "concatenate a big prompt string, call `sendPrompt()`"
 * pattern (objectSpyPanel.ts's `buildLlmPrompt()`/`runLlmRefinement()`).
 * All three of Agentic Mode's actions (feature file, automation code,
 * manual test-case CSV) share the exact same shape — a system turn
 * carrying every combined instruction source (senior-QE/API standards,
 * language/version, RAG matches, custom instruction files, the CSV
 * template when relevant) plus a human turn carrying the ingested-file
 * context and the user's actual ask — so this is ONE composed
 * `Runnable` (`ChatPromptTemplate.pipe(model).pipe(StringOutputParser)`,
 * LangChain's own idiomatic composition primitive) built once and reused
 * for all three, parametrized per call rather than three near-duplicate
 * hand-rolled prompt builders.
 *
 * Deliberately built fresh per request (agenticModeController.ts passes in
 * a freshly-constructed `VSCodeCopilotToolCallingModel` bound to that
 * request's own `vscode.CancellationToken`) rather than a long-lived
 * singleton — cancellation flows through the model instance itself, the
 * same pattern agent/verifyFixOrchestrator.ts already uses, so a chain
 * here needs no separate AbortSignal plumbing of its own.
 *
 * Zero `vscode` import — the prompt template and chain wiring are
 * reviewed rather than unit tested directly (same posture as
 * agent/vscodeCopilotToolCallingModel.ts: a real `BaseChatModel` call only
 * makes sense against an actual Extension Host), but every string this
 * chain receives is itself built by pure, tested functions (textIngestion.ts,
 * csvTestCaseGenerator.ts).
 */

export interface AgenticGenerationInput {
  /** Every "standing" instruction source combined into one system turn:
   * senior-QE or API-automation standards, target language/version, the
   * RAG "Reusable components" section, checked Custom Instructions files,
   * and — for the CSV chain only — the full `Jira_test_case_template.md`
   * content. */
  systemInstructions: string;
  /** The ingested files' user-selected segments (see textIngestion.ts),
   * concatenated with clear per-file headers. Empty string when Agentic
   * Mode has no files loaded yet — a valid, supported state (the user may
   * be relying purely on RAG/custom instructions/the chat box). */
  ingestedContext: string;
  /** The "Instant instructions to LLM" chat box content — the user's
   * actual, immediate ask for this generation. */
  userRequest: string;
}

/** The human turn's own literal wrapper text around `ingestedContext`/
 * `userRequest` — pulled into its own function (F12 fix) so
 * agenticModeController.ts's token-budget estimation can build the EXACT
 * same text this template actually sends, rather than a hand-maintained
 * approximation that can silently drift out of sync with it (the bug this
 * fixes: the old estimate concatenated `systemInstructions`+
 * `ingestedContext`+`userRequest` with plain "\n\n" joins, entirely
 * omitting this wrapper's own literal text — "Ingested input files
 * (already trimmed...)...", "---", "The user's request:" — a real,
 * reproducible undercount of the actual request size). Called BOTH here
 * (with the template's own `{ingestedContext}`/`{userRequest}` placeholder
 * strings, so `ChatPromptTemplate` still recognizes them as its own
 * template variables) and from agenticModeController.ts (with REAL
 * values, for measurement) — one definition, never two copies to keep in
 * sync. */
export function buildAgenticHumanTurnText(ingestedContext: string, userRequest: string): string {
  return (
    'Ingested input files (already trimmed to exactly the segments the user selected — treat anything outside ' +
    `this text as NOT available to you):\n\n${ingestedContext}\n\n---\n\nThe user's request:\n${userRequest}`
  );
}

const AGENTIC_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', '{systemInstructions}'],
  ['human', buildAgenticHumanTurnText('{ingestedContext}', '{userRequest}')]
]);

/** Builds the one shared chain, bound to a specific model instance. Exposed
 * as three identically-shaped named exports purely so a call site
 * (agenticModeController.ts) reads as "the feature-file chain"/"the code
 * chain"/"the CSV chain" rather than a generic `buildChain()` whose purpose
 * depends on which system prompt the caller happens to pass in. */
function buildAgenticChain(model: BaseChatModel): Runnable<AgenticGenerationInput, string> {
  return AGENTIC_PROMPT.pipe(model).pipe(new StringOutputParser());
}

export const buildAgenticFeatureFileChain = buildAgenticChain;
export const buildAgenticAutomationCodeChain = buildAgenticChain;
export const buildAgenticTestCaseCsvChain = buildAgenticChain;
