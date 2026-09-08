import * as vscode from 'vscode';
import { findModel, CopilotUnavailableError } from '../llm/copilotClient';
import { VSCodeCopilotToolCallingModel } from './vscodeCopilotToolCallingModel';
import { createReadFeatureFileTool, createReadScratchFileTool, createRunCodeTool, RunCodeToolDeps } from './verifyFixTools';
import { runToolCallingAgent, AgentRunResult, AgentStepLog } from './verifyFixAgent';

/**
 * The vscode-aware glue for "Verify & Fix Code" — resolves the real Copilot
 * model, builds the three tools bound to THIS session's own scratch
 * directory/feature file/attempt budget, and drives the tool-calling agent
 * (agent/verifyFixAgent.ts) to a stop. `objectSpyPanel.ts` calls this in
 * place of the old fixed-attempt-count loop, but still owns everything
 * around it (the environment check, the scratch dir, and — critically —
 * building `systemPrompt`/`userPrompt` from the exact same mandatory
 * standard / Auto Password Encryption / original-context pipeline every
 * other prompt in this extension already goes through, so this feature
 * never becomes a second, divergent place those rules could be forgotten).
 */

export interface VerifyFixAgentOptions {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  /** Real execution cap — mirrors the old MAX_VERIFY_ATTEMPTS. */
  maxAttempts: number;
  /** Total agent-turn cap (executions + inspection calls combined) — always
   * comfortably above `maxAttempts` so the agent has room to actually read
   * a file or the feature file between attempts without instantly hitting
   * this ceiling; still finite so a pathological loop can never run away. */
  maxSteps: number;
  cancellationToken: vscode.CancellationToken;
  runCodeDeps: Omit<RunCodeToolDeps, 'maxAttempts' | 'attemptCounter' | 'lastFailureOutput' | 'confirmRun' | 'onOutput'>;
  /** The one human-in-the-loop gate this whole feature is built around —
   * shown before every single code execution, no exceptions. `lastErrorOutput`
   * is the previous attempt's failure output (undefined on the first call)
   * so the confirmation itself can show the user what actually went wrong. */
  confirmRun: (attempt: number, maxAttempts: number, lastErrorOutput?: string) => Promise<boolean>;
  onOutput: (line: string) => void;
  onStep?: (log: AgentStepLog) => void;
}

export async function runVerifyFixAgent(options: VerifyFixAgentOptions): Promise<AgentRunResult> {
  const model = await findModel(options.modelId);
  if (!model) {
    throw new CopilotUnavailableError();
  }

  const attemptCounter = { count: 0 };
  const lastFailureOutput: { value: string | undefined } = { value: undefined };
  const runCodeTool = createRunCodeTool({
    ...options.runCodeDeps,
    maxAttempts: options.maxAttempts,
    attemptCounter,
    lastFailureOutput,
    confirmRun: options.confirmRun,
    onOutput: options.onOutput
  });
  const readScratchFileTool = createReadScratchFileTool(options.runCodeDeps.scratchDir);
  const readFeatureFileTool = createReadFeatureFileTool(options.runCodeDeps.linkedFeatureFilePath);

  const chatModel = new VSCodeCopilotToolCallingModel(model, options.cancellationToken);

  return runToolCallingAgent({
    model: chatModel,
    tools: [runCodeTool, readScratchFileTool, readFeatureFileTool],
    systemPrompt: options.systemPrompt,
    userPrompt: options.userPrompt,
    maxSteps: options.maxSteps,
    isCancelled: () => options.cancellationToken.isCancellationRequested,
    onStep: options.onStep
  });
}
