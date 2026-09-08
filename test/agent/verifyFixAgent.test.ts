import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as diagnosticsChannel from 'node:diagnostics_channel';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { runToolCallingAgent } from '../../src/agent/verifyFixAgent';

/**
 * Exercises the Verify & Fix agent's control-flow core in complete
 * isolation from `vscode`, GitHub Copilot, and the network — every
 * scenario below is fully deterministic, using a scripted fake
 * `BaseChatModel` in place of the real vscode.lm-backed adapter (see
 * agent/vscodeCopilotToolCallingModel.ts, which is reviewed rather than
 * unit tested for exactly this reason: it can only run inside a real
 * Extension Host). This is where the actual behavioral guarantees of the
 * feature live — the stopping conditions, the safety bounds, and (in the
 * last test) proof that no telemetry call is ever attempted — so it is
 * covered thoroughly.
 */

class ScriptedChatModel extends BaseChatModel {
  private turn = 0;
  readonly invocations: BaseMessage[][] = [];
  constructor(private readonly script: AIMessage[]) {
    super({});
  }
  _llmType(): string {
    return 'scripted-fake-test-model';
  }
  // Tool binding is a no-op for this fake — the script above already
  // dictates exactly which tool calls come back on which turn, so there is
  // nothing to convert/forward here. Returning `this` keeps `.invoke()`
  // available, which is all agent/verifyFixAgent.ts ever calls.
  bindTools(): this {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.invocations.push(messages);
    const message = this.script[Math.min(this.turn, this.script.length - 1)];
    this.turn += 1;
    const text = typeof message.content === 'string' ? message.content : '';
    return { generations: [{ text, message }] };
  }
}

class ThrowingChatModel extends BaseChatModel {
  constructor() {
    super({});
  }
  _llmType(): string {
    return 'throwing-fake-test-model';
  }
  bindTools(): this {
    return this;
  }
  async _generate(): Promise<ChatResult> {
    throw new Error('simulated Copilot failure');
  }
}

function aiText(text: string): AIMessage {
  return new AIMessage({ content: text });
}

function aiToolCall(name: string, args: Record<string, unknown>, id = `${name}-call`): AIMessage {
  return new AIMessage({ content: '', tool_calls: [{ type: 'tool_call', id, name, args }] });
}

function makeSuccessTool(name = 'run_code') {
  return tool(async ({ code }: { code: string }) => JSON.stringify({ signal: 'success', code, summary: 'ok' }), {
    name,
    description: 'test success tool',
    schema: z.object({ code: z.string() })
  });
}

function makeFailureTool(name = 'run_code') {
  return tool(async () => JSON.stringify({ output: 'compile error: missing semicolon' }), {
    name,
    description: 'test failure tool',
    schema: z.object({ code: z.string() })
  });
}

function makeDeclineTool(name = 'run_code') {
  return tool(async () => JSON.stringify({ signal: 'declined', summary: 'user said no' }), {
    name,
    description: 'test decline tool',
    schema: z.object({ code: z.string() })
  });
}

test('stops with success the moment a tool reports the success signal', async () => {
  const model = new ScriptedChatModel([aiToolCall('run_code', { code: 'print(1)' })]);
  const result = await runToolCallingAgent({
    model,
    tools: [makeSuccessTool()],
    systemPrompt: 'sys',
    userPrompt: 'user',
    maxSteps: 5
  });
  assert.equal(result.stopReason, 'success');
  assert.equal(result.finalCode, 'print(1)');
  assert.equal(model.invocations.length, 1);
});

test('keeps going after a failure and succeeds on a later attempt', async () => {
  const model = new ScriptedChatModel([
    aiToolCall('run_code', { code: 'v1' }),
    aiToolCall('run_code', { code: 'v2 fixed' })
  ]);
  let call = 0;
  const flakyTool = tool(
    async ({ code }: { code: string }) => {
      call += 1;
      return call === 1 ? JSON.stringify({ output: 'boom' }) : JSON.stringify({ signal: 'success', code, summary: 'ok' });
    },
    { name: 'run_code', description: 'test', schema: z.object({ code: z.string() }) }
  );

  const result = await runToolCallingAgent({ model, tools: [flakyTool], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
  assert.equal(result.stopReason, 'success');
  assert.equal(result.finalCode, 'v2 fixed');
  assert.equal(model.invocations.length, 2);
  // The model's second turn must see the first tool's failure result in
  // its own message history — otherwise it has nothing to fix against.
  const secondCallMessages = model.invocations[1];
  const sawFailure = secondCallMessages.some((m) => typeof m.content === 'string' && m.content.includes('boom'));
  assert.ok(sawFailure, 'expected the failure output to be fed back to the model on the next turn');
});

test('stops immediately when the tool reports the user declined to run the code', async () => {
  const model = new ScriptedChatModel([
    aiToolCall('run_code', { code: 'v1' }),
    aiToolCall('run_code', { code: 'should never be reached' })
  ]);
  const result = await runToolCallingAgent({ model, tools: [makeDeclineTool()], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
  assert.equal(result.stopReason, 'declined');
  assert.equal(model.invocations.length, 1, 'must not call the model again after a decline');
});

test('stops with max_steps when the model never succeeds within the budget', async () => {
  const model = new ScriptedChatModel([aiToolCall('run_code', { code: 'always broken' })]);
  const result = await runToolCallingAgent({ model, tools: [makeFailureTool()], systemPrompt: 's', userPrompt: 'u', maxSteps: 3 });
  assert.equal(result.stopReason, 'max_steps');
  assert.equal(model.invocations.length, 3);
});

test('stops with no_further_action when the model returns plain text with no tool call', async () => {
  const model = new ScriptedChatModel([aiText('I am not sure how to fix this.')]);
  const result = await runToolCallingAgent({ model, tools: [makeSuccessTool()], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
  assert.equal(result.stopReason, 'no_further_action');
  assert.match(result.summary, /not sure how to fix/);
  assert.equal(model.invocations.length, 1);
});

test('stops with cancelled and makes zero model calls when already cancelled', async () => {
  const model = new ScriptedChatModel([aiToolCall('run_code', { code: 'v1' })]);
  const result = await runToolCallingAgent({
    model,
    tools: [makeSuccessTool()],
    systemPrompt: 's',
    userPrompt: 'u',
    maxSteps: 5,
    isCancelled: () => true
  });
  assert.equal(result.stopReason, 'cancelled');
  assert.equal(model.invocations.length, 0);
});

test('surfaces a model failure as stopReason "error" with the original error attached', async () => {
  const result = await runToolCallingAgent({
    model: new ThrowingChatModel(),
    tools: [makeSuccessTool()],
    systemPrompt: 's',
    userPrompt: 'u',
    maxSteps: 5
  });
  assert.equal(result.stopReason, 'error');
  assert.ok(result.error instanceof Error);
  assert.match((result.error as Error).message, /simulated Copilot failure/);
});

test('an unknown tool name does not crash the loop — it is reported back and the agent can recover', async () => {
  const model = new ScriptedChatModel([
    aiToolCall('does_not_exist', {}),
    aiToolCall('run_code', { code: 'v2' })
  ]);
  const result = await runToolCallingAgent({ model, tools: [makeSuccessTool()], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
  assert.equal(result.stopReason, 'success');
  assert.equal(result.finalCode, 'v2');
});

test('records a full transcript of every tool call and result', async () => {
  const model = new ScriptedChatModel([aiToolCall('run_code', { code: 'v1' })]);
  const steps: string[] = [];
  await runToolCallingAgent({
    model,
    tools: [makeSuccessTool()],
    systemPrompt: 's',
    userPrompt: 'u',
    maxSteps: 5,
    onStep: (log) => steps.push(log.kind)
  });
  assert.deepEqual(steps, ['tool_call', 'tool_result']);
});

test('makes zero outbound network calls during a full agent run (no telemetry, fully offline)', async () => {
  // Bank-grade requirement: nothing about running this agent may reach the
  // network on its own — LangChain's tracing SDK (langsmith) is a
  // transitive dependency of @langchain/core, and while it is documented
  // as opt-in (only active via LANGCHAIN_TRACING_V2/LANGSMITH_API_KEY),
  // this test proves it rather than merely trusting the documentation.
  // Node's built-in `net.client.socket` diagnostics channel fires for every
  // outbound socket this process opens, no matter which module (http,
  // https, undici, a raw `net.connect`, ...) opens it — a robust,
  // non-invasive observation point that needs no monkeypatching of
  // core-module exports (which are non-configurable accessor properties in
  // modern Node and cannot be reassigned at all, patched or otherwise).
  const socketChannel = diagnosticsChannel.channel('net.client.socket');
  let networkCallAttempted = false;
  const onSocket = (): void => {
    networkCallAttempted = true;
  };
  socketChannel.subscribe(onSocket);

  try {
    const model = new ScriptedChatModel([
      aiToolCall('run_code', { code: 'v1' }),
      aiToolCall('run_code', { code: 'v2' })
    ]);
    let call = 0;
    const flakyTool = tool(
      async ({ code }: { code: string }) => {
        call += 1;
        return call === 1 ? JSON.stringify({ output: 'boom' }) : JSON.stringify({ signal: 'success', code, summary: 'ok' });
      },
      { name: 'run_code', description: 'test', schema: z.object({ code: z.string() }) }
    );
    const result = await runToolCallingAgent({ model, tools: [flakyTool], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
    assert.equal(result.stopReason, 'success');
  } finally {
    socketChannel.unsubscribe(onSocket);
  }

  assert.equal(networkCallAttempted, false, 'the agent loop must never make an outbound network call on its own');
});
