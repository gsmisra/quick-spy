import * as vscode from 'vscode';
import { BaseChatModel, type BaseChatModelCallOptions, type BindToolsInput } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk, BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { ChatResult } from '@langchain/core/outputs';
import type { Runnable } from '@langchain/core/runnables';
import { convertToOpenAIFunction } from '@langchain/core/utils/function_calling';

/**
 * Wraps an already-resolved `vscode.LanguageModelChat` (the exact same
 * handle `llm/copilotClient.ts`'s `sendPrompt()`/`countModelTokens()` use)
 * as a real LangChain `BaseChatModel` — this is the ONLY bridge between
 * LangChain's tool-calling agent machinery (agent/verifyFixAgent.ts) and
 * GitHub Copilot. It never introduces a second credential or a different
 * LLM provider: every request still goes out through the user's own
 * Copilot subscription via the same `vscode.lm` API and the same one-time
 * consent dialog VS Code itself owns (see architecture.html's LLM
 * Integration section) — LangChain here is purely an orchestration layer
 * on top of the exact same model connection the rest of this extension
 * already uses.
 *
 * Deliberately thin: all control-flow logic (when to stop, how to react to
 * a tool result) lives in agent/verifyFixAgent.ts, which has zero `vscode`
 * dependency and is unit-tested directly. This file's only job is format
 * translation — LangChain messages/tools in, `vscode.lm` wire format out,
 * and back — so it is reviewed like every other vscode.lm-touching module
 * in this codebase (llm/copilotClient.ts included) rather than unit tested
 * in isolation, since a real `vscode.LanguageModelChat` only exists inside
 * a running Extension Host.
 */

export interface VSCodeCopilotCallOptions extends BaseChatModelCallOptions {
  tools?: BindToolsInput[];
}

/** Thrown when `vscode.lm` itself rejects the request outright (model
 * unavailable, consent denied, quota) — distinct from the code under test
 * simply having a bug, so callers (agent/verifyFixAgent.ts, and ultimately
 * objectSpyPanel.ts's fallback) can tell "Copilot itself failed" apart from
 * "the generated code failed to compile/run." */
export class VSCodeCopilotRequestError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'VSCodeCopilotRequestError';
  }
}

export class VSCodeCopilotToolCallingModel extends BaseChatModel<VSCodeCopilotCallOptions> {
  constructor(
    private readonly chatModel: vscode.LanguageModelChat,
    private readonly cancellationToken: vscode.CancellationToken
  ) {
    super({});
  }

  _llmType(): string {
    return 'vscode-copilot-tool-calling';
  }

  /** Standard LangChain pattern: `bindTools()` just threads the tool list
   * through as a bound call option, read back out in `_generate()` below —
   * see @langchain/core's own provider integrations for the same shape.
   * The declared return type is `AIMessageChunk` (LangChain's streaming
   * contract) purely to satisfy the base class's signature; this model
   * never streams (see `_generate()`) and every real call site in this
   * feature (agent/verifyFixAgent.ts) only ever calls `.invoke()`, reading
   * `.content`/`.tool_calls` — both present on the plain `AIMessage` this
   * actually resolves to at runtime. */
  bindTools(tools: BindToolsInput[]): Runnable<BaseLanguageModelInput, AIMessageChunk, VSCodeCopilotCallOptions> {
    return this.withConfig({ tools } as Partial<VSCodeCopilotCallOptions>) as unknown as Runnable<
      BaseLanguageModelInput,
      AIMessageChunk,
      VSCodeCopilotCallOptions
    >;
  }

  async _generate(messages: BaseMessage[], options: this['ParsedCallOptions']): Promise<ChatResult> {
    const vscodeMessages = messages.map(toVSCodeMessage);
    const boundTools = (options as VSCodeCopilotCallOptions).tools ?? [];
    const vscodeTools: vscode.LanguageModelChatTool[] = boundTools.map((t) => {
      const fn = convertToOpenAIFunction(t as Parameters<typeof convertToOpenAIFunction>[0]);
      return { name: fn.name, description: fn.description ?? '', inputSchema: fn.parameters };
    });

    let response: vscode.LanguageModelChatResponse;
    try {
      response = await this.chatModel.sendRequest(
        vscodeMessages,
        vscodeTools.length ? { tools: vscodeTools } : {},
        this.cancellationToken
      );
    } catch (err) {
      throw new VSCodeCopilotRequestError(err instanceof Error ? err.message : String(err), err);
    }

    let text = '';
    const toolCalls: NonNullable<AIMessage['tool_calls']> = [];
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        text += part.value;
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          type: 'tool_call',
          id: part.callId,
          name: part.name,
          args: (part.input ?? {}) as Record<string, unknown>
        });
      }
      // Any other/unknown streamed part (e.g. LanguageModelDataPart) is
      // outside this agent's needs — text and tool calls are the whole
      // contract the Verify & Fix loop reacts to.
    }

    const aiMessage = new AIMessage({ content: text, tool_calls: toolCalls.length ? toolCalls : undefined });
    return { generations: [{ text, message: aiMessage }] };
  }
}

/** Folds a LangChain message into the shape `vscode.lm` actually accepts —
 * only a User/Assistant role exists at that layer (no separate System or
 * Tool role), so: a SystemMessage becomes a User message (identical to how
 * llm/copilotClient.ts's single-shot `sendPrompt()` already has no system
 * role to use either), an AIMessage becomes an Assistant message (carrying
 * its own prior tool calls, if any, so the model sees its own history
 * correctly on the next turn), and a ToolMessage becomes a User message
 * carrying a `LanguageModelToolResultPart` — exactly the pairing
 * `LanguageModelToolResultPart`'s own doc comment requires ("can only be
 * included in the content of a User message"). */
function toVSCodeMessage(message: BaseMessage): vscode.LanguageModelChatMessage {
  const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

  if (message instanceof ToolMessage) {
    const callId = typeof message.tool_call_id === 'string' ? message.tool_call_id : String(message.tool_call_id);
    return vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart(callId, [new vscode.LanguageModelTextPart(text)])]);
  }

  if (message instanceof AIMessage) {
    const toolCallParts = (message.tool_calls ?? []).map(
      (tc) => new vscode.LanguageModelToolCallPart(tc.id ?? tc.name, tc.name, (tc.args ?? {}) as object)
    );
    if (toolCallParts.length === 0) {
      return vscode.LanguageModelChatMessage.Assistant(text);
    }
    const content: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
    if (text) {
      content.push(new vscode.LanguageModelTextPart(text));
    }
    content.push(...toolCallParts);
    return vscode.LanguageModelChatMessage.Assistant(content);
  }

  // SystemMessage and HumanMessage (and anything else) — a plain User turn.
  return vscode.LanguageModelChatMessage.User(text);
}
