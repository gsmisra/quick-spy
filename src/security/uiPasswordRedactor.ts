import * as vscode from 'vscode';
import { encryptSecret, looksLikeSecretField } from './secretVault';

/**
 * UI Automation mode's half of "Auto Password Encryption". Playwright
 * Codegen's raw output embeds whatever was literally typed into the
 * recording browser as a plain string argument — e.g.
 * `page.getByLabel("Password").fill("Secret123!")` (Python) or
 * `page.getByLabel("Password").fill("Secret123!");` (Java, since codegen's
 * own `--target` flag controls which language is emitted directly — see
 * browser/codegenManager.ts). That literal would otherwise flow straight
 * into the LLM prompt AND into the final saved test file in plaintext.
 *
 * This scans the recorded code line-by-line and replaces exactly the
 * string literal of a `.fill(...)` / `.type(...)` / `.pressSequentially(...)`
 * call whose line looks like it targets a credential field (see
 * `looksLikeSecretField()`) with a call to the language-appropriate decrypt
 * helper wrapping a freshly-encrypted token — so the plaintext value is
 * encrypted before this function ever returns, and never appears again in
 * anything built from its result.
 *
 * Deliberately narrow in scope: this transforms only the COPY of the code
 * handed to the LLM (and, via the same call, the "original context" resent
 * on every Verify & Fix Code fix attempt) — never the raw recording shown
 * verbatim in the sidebar's own "Generated Code" view, which by design
 * always mirrors Playwright Codegen's real output unmodified.
 */

const FILL_CALL_PATTERN = /\.(fill|type|pressSequentially)\(\s*(['"])((?:\\.|(?!\2)[\s\S])*?)\2\s*\)/;

function unescapeLiteral(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

export interface RedactionResult {
  code: string;
  /** How many literals were found and encrypted — surfaced to the Output
   * channel purely for transparency ("N password(s) automatically
   * encrypted before this was sent"), never blocks or alters the flow. */
  count: number;
}

export async function encryptPasswordLiteralsInCode(
  context: vscode.ExtensionContext,
  code: string,
  language: 'java' | 'python'
): Promise<RedactionResult> {
  const decryptCall = language === 'java' ? 'SecretVault.decrypt' : 'secret_vault.decrypt';
  const lines = code.split(/\r?\n/);
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!looksLikeSecretField(line)) {
      continue;
    }
    const match = FILL_CALL_PATTERN.exec(line);
    if (!match) {
      continue;
    }
    const [fullMatch, method, , literalRaw] = match;
    const plaintext = unescapeLiteral(literalRaw);
    if (!plaintext) {
      continue; // an empty fill has nothing worth protecting
    }
    const token = await encryptSecret(context, plaintext);
    const replacement = `.${method}(${decryptCall}("${token}"))`;
    lines[i] = line.slice(0, match.index) + replacement + line.slice(match.index + fullMatch.length);
    count++;
  }

  return { code: lines.join('\n'), count };
}
