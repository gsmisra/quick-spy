"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const diagnosticsChannel = __importStar(require("node:diagnostics_channel"));
const chat_models_1 = require("@langchain/core/language_models/chat_models");
const messages_1 = require("@langchain/core/messages");
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const verifyFixAgent_1 = require("../../src/agent/verifyFixAgent");
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
class ScriptedChatModel extends chat_models_1.BaseChatModel {
    script;
    turn = 0;
    invocations = [];
    constructor(script) {
        super({});
        this.script = script;
    }
    _llmType() {
        return 'scripted-fake-test-model';
    }
    // Tool binding is a no-op for this fake — the script above already
    // dictates exactly which tool calls come back on which turn, so there is
    // nothing to convert/forward here. Returning `this` keeps `.invoke()`
    // available, which is all agent/verifyFixAgent.ts ever calls.
    bindTools() {
        return this;
    }
    async _generate(messages) {
        this.invocations.push(messages);
        const message = this.script[Math.min(this.turn, this.script.length - 1)];
        this.turn += 1;
        const text = typeof message.content === 'string' ? message.content : '';
        return { generations: [{ text, message }] };
    }
}
class ThrowingChatModel extends chat_models_1.BaseChatModel {
    constructor() {
        super({});
    }
    _llmType() {
        return 'throwing-fake-test-model';
    }
    bindTools() {
        return this;
    }
    async _generate() {
        throw new Error('simulated Copilot failure');
    }
}
function aiText(text) {
    return new messages_1.AIMessage({ content: text });
}
function aiToolCall(name, args, id = `${name}-call`) {
    return new messages_1.AIMessage({ content: '', tool_calls: [{ type: 'tool_call', id, name, args }] });
}
function makeSuccessTool(name = 'run_code') {
    return (0, tools_1.tool)(async ({ code }) => JSON.stringify({ signal: 'success', code, summary: 'ok' }), {
        name,
        description: 'test success tool',
        schema: zod_1.z.object({ code: zod_1.z.string() })
    });
}
function makeFailureTool(name = 'run_code') {
    return (0, tools_1.tool)(async () => JSON.stringify({ output: 'compile error: missing semicolon' }), {
        name,
        description: 'test failure tool',
        schema: zod_1.z.object({ code: zod_1.z.string() })
    });
}
function makeDeclineTool(name = 'run_code') {
    return (0, tools_1.tool)(async () => JSON.stringify({ signal: 'declined', summary: 'user said no' }), {
        name,
        description: 'test decline tool',
        schema: zod_1.z.object({ code: zod_1.z.string() })
    });
}
(0, node_test_1.test)('stops with success the moment a tool reports the success signal', async () => {
    const model = new ScriptedChatModel([aiToolCall('run_code', { code: 'print(1)' })]);
    const result = await (0, verifyFixAgent_1.runToolCallingAgent)({
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
(0, node_test_1.test)('keeps going after a failure and succeeds on a later attempt', async () => {
    const model = new ScriptedChatModel([
        aiToolCall('run_code', { code: 'v1' }),
        aiToolCall('run_code', { code: 'v2 fixed' })
    ]);
    let call = 0;
    const flakyTool = (0, tools_1.tool)(async ({ code }) => {
        call += 1;
        return call === 1 ? JSON.stringify({ output: 'boom' }) : JSON.stringify({ signal: 'success', code, summary: 'ok' });
    }, { name: 'run_code', description: 'test', schema: zod_1.z.object({ code: zod_1.z.string() }) });
    const result = await (0, verifyFixAgent_1.runToolCallingAgent)({ model, tools: [flakyTool], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
    assert.equal(result.stopReason, 'success');
    assert.equal(result.finalCode, 'v2 fixed');
    assert.equal(model.invocations.length, 2);
    // The model's second turn must see the first tool's failure result in
    // its own message history — otherwise it has nothing to fix against.
    const secondCallMessages = model.invocations[1];
    const sawFailure = secondCallMessages.some((m) => typeof m.content === 'string' && m.content.includes('boom'));
    assert.ok(sawFailure, 'expected the failure output to be fed back to the model on the next turn');
});
(0, node_test_1.test)('stops immediately when the tool reports the user declined to run the code', async () => {
    const model = new ScriptedChatModel([
        aiToolCall('run_code', { code: 'v1' }),
        aiToolCall('run_code', { code: 'should never be reached' })
    ]);
    const result = await (0, verifyFixAgent_1.runToolCallingAgent)({ model, tools: [makeDeclineTool()], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
    assert.equal(result.stopReason, 'declined');
    assert.equal(model.invocations.length, 1, 'must not call the model again after a decline');
});
(0, node_test_1.test)('stops with max_steps when the model never succeeds within the budget', async () => {
    const model = new ScriptedChatModel([aiToolCall('run_code', { code: 'always broken' })]);
    const result = await (0, verifyFixAgent_1.runToolCallingAgent)({ model, tools: [makeFailureTool()], systemPrompt: 's', userPrompt: 'u', maxSteps: 3 });
    assert.equal(result.stopReason, 'max_steps');
    assert.equal(model.invocations.length, 3);
});
(0, node_test_1.test)('stops with no_further_action when the model returns plain text with no tool call', async () => {
    const model = new ScriptedChatModel([aiText('I am not sure how to fix this.')]);
    const result = await (0, verifyFixAgent_1.runToolCallingAgent)({ model, tools: [makeSuccessTool()], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
    assert.equal(result.stopReason, 'no_further_action');
    assert.match(result.summary, /not sure how to fix/);
    assert.equal(model.invocations.length, 1);
});
(0, node_test_1.test)('stops with cancelled and makes zero model calls when already cancelled', async () => {
    const model = new ScriptedChatModel([aiToolCall('run_code', { code: 'v1' })]);
    const result = await (0, verifyFixAgent_1.runToolCallingAgent)({
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
(0, node_test_1.test)('surfaces a model failure as stopReason "error" with the original error attached', async () => {
    const result = await (0, verifyFixAgent_1.runToolCallingAgent)({
        model: new ThrowingChatModel(),
        tools: [makeSuccessTool()],
        systemPrompt: 's',
        userPrompt: 'u',
        maxSteps: 5
    });
    assert.equal(result.stopReason, 'error');
    assert.ok(result.error instanceof Error);
    assert.match(result.error.message, /simulated Copilot failure/);
});
(0, node_test_1.test)('an unknown tool name does not crash the loop — it is reported back and the agent can recover', async () => {
    const model = new ScriptedChatModel([
        aiToolCall('does_not_exist', {}),
        aiToolCall('run_code', { code: 'v2' })
    ]);
    const result = await (0, verifyFixAgent_1.runToolCallingAgent)({ model, tools: [makeSuccessTool()], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
    assert.equal(result.stopReason, 'success');
    assert.equal(result.finalCode, 'v2');
});
(0, node_test_1.test)('records a full transcript of every tool call and result', async () => {
    const model = new ScriptedChatModel([aiToolCall('run_code', { code: 'v1' })]);
    const steps = [];
    await (0, verifyFixAgent_1.runToolCallingAgent)({
        model,
        tools: [makeSuccessTool()],
        systemPrompt: 's',
        userPrompt: 'u',
        maxSteps: 5,
        onStep: (log) => steps.push(log.kind)
    });
    assert.deepEqual(steps, ['tool_call', 'tool_result']);
});
(0, node_test_1.test)('makes zero outbound network calls during a full agent run (no telemetry, fully offline)', async () => {
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
    const onSocket = () => {
        networkCallAttempted = true;
    };
    socketChannel.subscribe(onSocket);
    try {
        const model = new ScriptedChatModel([
            aiToolCall('run_code', { code: 'v1' }),
            aiToolCall('run_code', { code: 'v2' })
        ]);
        let call = 0;
        const flakyTool = (0, tools_1.tool)(async ({ code }) => {
            call += 1;
            return call === 1 ? JSON.stringify({ output: 'boom' }) : JSON.stringify({ signal: 'success', code, summary: 'ok' });
        }, { name: 'run_code', description: 'test', schema: zod_1.z.object({ code: zod_1.z.string() }) });
        const result = await (0, verifyFixAgent_1.runToolCallingAgent)({ model, tools: [flakyTool], systemPrompt: 's', userPrompt: 'u', maxSteps: 5 });
        assert.equal(result.stopReason, 'success');
    }
    finally {
        socketChannel.unsubscribe(onSocket);
    }
    assert.equal(networkCallAttempted, false, 'the agent loop must never make an outbound network call on its own');
});
//# sourceMappingURL=verifyFixAgent.test.js.map