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
const path = __importStar(require("path"));
const scratchPath_1 = require("../../src/agent/scratchPath");
/**
 * The Verify & Fix agent's `read_file` tool trusts this function completely
 * to keep an LLM-supplied path from ever escaping the disposable scratch
 * project it's allowed to inspect. Every one of these cases is a real
 * traversal shape an adversarial or simply confused model response could
 * plausibly produce — this suite exists to make an escape a loud, obvious
 * test failure, not a silent security regression.
 */
const SCRATCH = path.join('C:', 'fake', 'scratch', 'dir');
(0, node_test_1.test)('accepts a simple relative path inside the scratch dir', () => {
    const resolved = (0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, 'pom.xml');
    assert.equal(resolved, path.join(SCRATCH, 'pom.xml'));
});
(0, node_test_1.test)('accepts a nested relative path inside the scratch dir', () => {
    const resolved = (0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, path.join('src', 'test', 'java', 'Foo.java'));
    assert.equal(resolved, path.join(SCRATCH, 'src', 'test', 'java', 'Foo.java'));
});
(0, node_test_1.test)('accepts the scratch dir itself', () => {
    const resolved = (0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, '.');
    assert.equal(resolved, path.resolve(SCRATCH));
});
(0, node_test_1.test)('rejects a ".." traversal that climbs out of the scratch dir', () => {
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, path.join('..', 'secret.txt')), null);
});
(0, node_test_1.test)('rejects a deeply nested ".." traversal that still climbs out', () => {
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, path.join('a', 'b', '..', '..', '..', '..', 'etc', 'passwd')), null);
});
(0, node_test_1.test)('rejects a Windows absolute path outright', () => {
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, 'C:\\Windows\\System32\\config\\SAM'), null);
});
(0, node_test_1.test)('rejects a POSIX absolute path outright', () => {
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, '/etc/passwd'), null);
});
(0, node_test_1.test)('rejects a sibling directory that merely shares the scratch dir\'s string prefix', () => {
    // "dir-evil" starts with the same characters as "dir" but is a different,
    // sibling directory — a naive `startsWith(base)` check (without a
    // trailing separator) would wrongly accept this.
    const evilSibling = path.join('C:', 'fake', 'scratch', 'dir-evil', 'secret.txt');
    const relativeFromScratch = path.relative(SCRATCH, evilSibling);
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, relativeFromScratch), null);
});
(0, node_test_1.test)('rejects a non-string path', () => {
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, undefined), null);
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, 42), null);
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, null), null);
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, { path: '../x' }), null);
});
(0, node_test_1.test)('rejects an empty or whitespace-only path', () => {
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, ''), null);
    assert.equal((0, scratchPath_1.resolveWithinScratchDir)(SCRATCH, '   '), null);
});
//# sourceMappingURL=scratchPath.test.js.map