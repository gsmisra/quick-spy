import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * The Verify & Fix Code agent's orchestration core — deliberately the ONLY
 * file in this feature with zero `vscode` import, so it can be exercised by
 * plain unit tests (see agent/__tests__/verifyFixAgent.test.ts) against a
 * fake `BaseChatModel`, with no real Copilot subscription, no Extension
 * Development Host, and no network access required.
 *
 * This intentionally does NOT use LangChain's `AgentExecutor` — that class
 * is a general-purpose black box with its own error-handling and stopping
 * heuristics that would fight the very specific UX contract this feature
 * must preserve (a human confirms every single code execution — see
 * verifyFixTools.ts's `run_code` — and the loop must stop on a
 * deterministic, tool-verified success signal, never on the model's own
 * self-assessment of whether it succeeded). Writing this loop by hand over
 * LangChain's own `BaseChatModel`/message/tool primitives keeps that control
 * explicit and auditable — exactly what "verify how an AI agent used company
 * data reached its result" requires in a regulated environment.
 */

export type AgentStepKind = 'tool_call' | 'tool_result' | 'model_text' | 'model_error';

export interface AgentStepLog {
  kind: AgentStepKind;
  toolName?: string;
  detail: string;
}

export type AgentStopReason = 'success' | 'declined' | 'max_steps' | 'no_further_action' | 'cancelled' | 'error';

export interface AgentRunResult {
  stopReason: AgentStopReason;
  /** Set only when a tool call unambiguously signaled success (see
   * `ToolSignal` below) — the exact code that was verified, never text the
   * model merely claims is correct. */
  finalCode?: string;
  /** Short, human-readable summary for the UI's status line. */
  summary: string;
  /** Every model/tool step taken, in order — written to the Output channel
   * as a full audit trail of what the agent actually did. */
  transcript: AgentStepLog[];
  /** The full success signal a tool reported, verbatim — e.g. run_code's
   * `compileOnly`/`apiCallOutcome` fields (see verifyFixTools.ts) — kept as
   * an opaque bag rather than named fields here, since this module is
   * domain-agnostic and has no business knowing what a specific tool's
   * result shape means; the caller (objectSpyPanel.ts) already knows. */
  raw?: Record<string, unknown>;
  error?: unknown;
}

export interface RunToolCallingAgentOptions {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  userPrompt: string;
  /** Hard ceiling on total model turns (tool-call rounds) — a cost/latency
   * safety valve independent of any individual tool's own attempt budget
   * (e.g. `run_code`'s own MAX_VERIFY_ATTEMPTS-equivalent cap). Every
   * production LLM-driven loop in this extension has an explicit bound
   * (see execution/testExecutor.ts's timeouts, objectSpyPanel.ts's
   * FIRST_CHUNK_TIMEOUT_MS) — an agent loop is no exception. */
  maxSteps: number;
  isCancelled?: () => boolean;
  onStep?: (log: AgentStepLog) => void;
}

/** The contract a tool's return string may optionally encode (as JSON) to
 * give the loop a deterministic instruction beyond "here is some text for
 * the model to read." Any tool result that isn't valid JSON, or doesn't
 * have a recognized `signal`, is treated as ordinary informational content
 * — the loop keeps going and the model sees it like any other tool output.
 * See verifyFixTools.ts for the tool that actually emits these. */
interface ToolSignal {
  signal: 'success' | 'declined';
  code?: string;
  summary?: string;
  [extra: string]: unknown;
}

function tryParseToolSignal(resultText: string): ToolSignal | undefined {
  try {
    const parsed: unknown = JSON.parse(resultText);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'signal' in parsed &&
      ((parsed as { signal: unknown }).signal === 'success' || (parsed as { signal: unknown }).signal === 'declined')
    ) {
      return parsed as ToolSignal;
    }
  } catch {
    // Not JSON, or not our signal shape — ordinary tool output, not a
    // control signal. Not an error: most tool results (a read_file's
    // content, a run_code failure's compiler output) are exactly this.
  }
  return undefined;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Drives a bounded, tool-calling conversation with `model` until one of:
 *  - a tool call reports `{"signal":"success", code}` (run_code verified
 *    the code actually works) — returns `stopReason: 'success'`.
 *  - a tool call reports `{"signal":"declined"}` (the human said no to
 *    running the code) — returns `stopReason: 'declined'`, ending
 *    immediately, exactly like the original fixed-loop's "No" button did.
 *  - the model responds with no tool call at all — it has nothing further
 *    to try, so the loop ends rather than spin waiting for one.
 *  - `maxSteps` model turns are exhausted — the cost/latency safety valve.
 *  - `isCancelled()` becomes true between any two steps (a fresh "Verify &
 *    Fix Code" click, or the panel closing) — checked before every model
 *    call and before every individual tool invocation.
 *  - the model call itself throws — surfaced as `stopReason: 'error'` so
 *    the caller can fall back to the previous, proven single-shot fix
 *    prompt (see objectSpyPanel.ts) rather than leave the user stuck.
 */
export async function runToolCallingAgent(options: RunToolCallingAgentOptions): Promise<AgentRunResult> {
  const { model, tools, systemPrompt, userPrompt, maxSteps, isCancelled, onStep } = options;
  const transcript: AgentStepLog[] = [];
  const record = (entry: AgentStepLog): void => {
    transcript.push(entry);
    onStep?.(entry);
  };

  const toolByName = new Map(tools.map((t) => [t.name, t] as const));
  if (typeof model.bindTools !== 'function') {
    // Every real model this feature ever runs against (see
    // agent/vscodeCopilotToolCallingModel.ts) implements bindTools — this
    // only guards a malformed/future model wiring from crashing instead of
    // failing clearly.
    return {
      stopReason: 'error',
      summary: 'The configured model does not support tool calling.',
      transcript,
      error: new Error('model.bindTools is not a function')
    };
  }
  const boundModel = model.bindTools(tools);

  const messages: BaseMessage[] = [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)];

  for (let step = 0; step < maxSteps; step++) {
    if (isCancelled?.()) {
      return { stopReason: 'cancelled', summary: 'Cancelled.', transcript };
    }

    let response: AIMessage;
    try {
      response = (await boundModel.invoke(messages)) as AIMessage;
    } catch (err) {
      record({ kind: 'model_error', detail: describeError(err) });
      return { stopReason: 'error', summary: describeError(err), transcript, error: err };
    }
    messages.push(response);

    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      record({ kind: 'model_text', detail: text });
      return {
        stopReason: 'no_further_action',
        summary: text.trim() || '(the model returned no further action and called no tool)',
        transcript
      };
    }

    for (const call of toolCalls) {
      if (isCancelled?.()) {
        return { stopReason: 'cancelled', summary: 'Cancelled.', transcript };
      }

      const tool = toolByName.get(call.name);
      let resultText: string;
      if (!tool) {
        resultText = JSON.stringify({ error: `Unknown tool "${call.name}" — it was never offered to the model.` });
      } else {
        record({ kind: 'tool_call', toolName: call.name, detail: JSON.stringify(call.args ?? {}) });
        try {
          const raw = await tool.invoke((call.args ?? {}) as Parameters<typeof tool.invoke>[0]);
          resultText = typeof raw === 'string' ? raw : JSON.stringify(raw);
        } catch (err) {
          resultText = JSON.stringify({ error: describeError(err) });
        }
      }
      record({ kind: 'tool_result', toolName: call.name, detail: resultText });
      messages.push(new ToolMessage({ content: resultText, tool_call_id: call.id ?? call.name }));

      const signal = tryParseToolSignal(resultText);
      if (signal?.signal === 'success') {
        return {
          stopReason: 'success',
          finalCode: signal.code,
          summary: signal.summary ?? 'Verified successfully.',
          transcript,
          raw: signal
        };
      }
      if (signal?.signal === 'declined') {
        return { stopReason: 'declined', summary: signal.summary ?? 'The user declined to run the code.', transcript };
      }
    }
  }

  return {
    stopReason: 'max_steps',
    summary: `Stopped after ${maxSteps} agent step(s) without a confirmed success — see the transcript for the last known error.`,
    transcript
  };
}
