import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * SoftPlay's "Auto Password Encryption" — the local cryptographic core.
 *
 * Scope, deliberately: this protects NON-PRODUCTION test automation
 * credentials (a QA login account, a sandbox API token, ...) from ever
 * appearing in plaintext in two places — (1) a prompt sent to the GitHub
 * Copilot cloud LLM, and (2) the AI-generated source file saved to disk /
 * checked into a repository. It is not a replacement for a bank's real
 * production secrets infrastructure (HSM-backed KMS, per-environment
 * rotation, centralized audit) — see the `SECRET_ENV_VAR` doc below for
 * exactly where that would plug in instead.
 *
 * Algorithm: AES-256-CTR for confidentiality + HMAC-SHA256 for integrity
 * (Encrypt-then-MAC), each with its own key independently derived from one
 * master key via HMAC-SHA256 (never reusing one raw key for both the cipher
 * and the MAC). Chosen specifically because both primitives are natively
 * available with ZERO extra dependency in every runtime this extension
 * targets: Node's own `crypto` module here, `javax.crypto` in the JDK
 * (generated Java code), and `hmac`/`hashlib` in Python's standard library
 * — AES-256 itself for Python is a small bundled pure-Python implementation
 * (see prompts/secret-vault-python.txt) since this extension never assumes
 * PyPI network access to install a compiled crypto wheel. Interop with both
 * generated-code decrypt helpers is verified byte-for-byte (same key/iv/
 * plaintext in, identical ciphertext+tag out) as part of building this
 * feature.
 *
 * Key management: a single 32-byte master key, generated once via
 * `crypto.randomBytes` and stored through VS Code's `SecretStorage` API
 * (`context.secrets`) — backed by the OS's own credential vault (Windows
 * Credential Manager / macOS Keychain / libsecret on Linux), never written
 * to a plain file or `globalState`. It never appears in generated source —
 * see `SECRET_ENV_VAR`.
 */

const SECRET_STORAGE_KEY = 'SoftPlay.secretVault.masterKeyBase64';

/** The ONLY way the master key ever reaches the code that needs to decrypt
 * a credential — an environment variable, never a constant baked into the
 * generated file. `execution/testExecutor.ts` sets this automatically when
 * SoftPlay itself runs the code (Verify & Fix Code); a standalone CI/CD
 * pipeline running the same generated file later must supply it the same
 * way, sourced from whatever secrets manager that pipeline already uses
 * (HashiCorp Vault, CyberArk, Azure Key Vault, AWS Secrets Manager, ...) —
 * this extension deliberately doesn't prescribe which one. */
export const SECRET_ENV_VAR = 'SoftPlay_SECRET_KEY';

const TOKEN_VERSION = 'v1';
const TOKEN_PATTERN = /^ENC\[v1:([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)\]$/;
/** Cheap substring check for "does this text contain at least one encrypted
 * token" — used to decide whether a prompt needs the Auto Password
 * Encryption standard + decrypt-helper section appended at all, so a
 * request with no credentials in it stays exactly as lean as before this
 * feature existed. */
export const TOKEN_MARKER = 'ENC[';

// Fixed, public labels used only to derive two independent subkeys from one
// master key via HMAC — not secret themselves (their whole purpose is
// domain separation, not obscurity).
const ENC_KEY_LABEL = 'SoftPlay-aes-key-v1';
const MAC_KEY_LABEL = 'SoftPlay-hmac-key-v1';

// In-memory only — re-fetched from SecretStorage at most once per extension
// host session, never written to disk by this module itself.
let cachedMasterKey: Buffer | undefined;

async function getOrCreateMasterKey(context: vscode.ExtensionContext): Promise<Buffer> {
  if (cachedMasterKey) {
    return cachedMasterKey;
  }
  const existing = await context.secrets.get(SECRET_STORAGE_KEY);
  if (existing) {
    cachedMasterKey = Buffer.from(existing, 'base64');
    return cachedMasterKey;
  }
  const fresh = crypto.randomBytes(32);
  await context.secrets.store(SECRET_STORAGE_KEY, fresh.toString('base64'));
  cachedMasterKey = fresh;
  return fresh;
}

function deriveSubKeys(masterKey: Buffer): { encKey: Buffer; macKey: Buffer } {
  return {
    encKey: crypto.createHmac('sha256', masterKey).update(ENC_KEY_LABEL).digest(),
    macKey: crypto.createHmac('sha256', masterKey).update(MAC_KEY_LABEL).digest()
  };
}

/** Encrypts `plaintext` (a real password/token/API key value straight out
 * of the Control Panel or a recorded browser action) into a self-describing
 * `ENC[v1:iv:tag:ciphertext]` token, all three parts base64 — safe to embed
 * directly as a language string literal (the base64 alphabet plus `[`, `]`,
 * `:` needs no escaping in Java or Python), and structurally unmistakable
 * for what it is (never confusable with a real plaintext value). The
 * plaintext itself is never written anywhere by this function. */
export async function encryptSecret(context: vscode.ExtensionContext, plaintext: string): Promise<string> {
  const masterKey = await getOrCreateMasterKey(context);
  const { encKey, macKey } = deriveSubKeys(masterKey);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, ciphertext])).digest();
  return `ENC[${TOKEN_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}]`;
}

/** The inverse of `encryptSecret()` — not needed by the extension's own
 * runtime path (decryption happens inside the GENERATED Java/Python code,
 * at test-execution time, using the templates in prompts/secret-vault-*),
 * but kept here so the exact same key-derivation/verification logic used to
 * produce a token can also be exercised and tested from this side, and as a
 * building block for any future "preview the real value" affordance. */
export async function decryptSecret(context: vscode.ExtensionContext, token: string): Promise<string> {
  const masterKey = await getOrCreateMasterKey(context);
  const { encKey, macKey } = deriveSubKeys(masterKey);
  const match = TOKEN_PATTERN.exec(token.trim());
  if (!match) {
    throw new Error('Not a SoftPlay encrypted token.');
  }
  const iv = Buffer.from(match[1], 'base64');
  const tag = Buffer.from(match[2], 'base64');
  const ciphertext = Buffer.from(match[3], 'base64');
  const expectedTag = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, ciphertext])).digest();
  if (expectedTag.length !== tag.length || !crypto.timingSafeEqual(expectedTag, tag)) {
    throw new Error('SoftPlay encrypted value failed its integrity check — token may be corrupted or tampered with.');
  }
  const decipher = crypto.createDecipheriv('aes-256-ctr', encKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function isEncryptedToken(value: string): boolean {
  return TOKEN_PATTERN.test(value.trim());
}

/** The master key, base64-encoded, ready to inject as `SECRET_ENV_VAR` into
 * a child process's environment — see execution/testExecutor.ts's
 * "Verify & Fix Code" wiring. Always returned (harmless if the code being
 * run happens to contain no encrypted values at all). */
export async function getSecretEnv(context: vscode.ExtensionContext): Promise<Record<string, string>> {
  const masterKey = await getOrCreateMasterKey(context);
  return { [SECRET_ENV_VAR]: masterKey.toString('base64') };
}

/**
 * Best-effort heuristic for "is this UI element/field a credential" —
 * matched against a recorded Playwright line's full text (locator name,
 * label, placeholder, id — whatever codegen captured), never against the
 * typed VALUE itself. Deliberately broad (a false positive just means a
 * harmless, non-secret value gets encrypted too — no real cost — while a
 * false negative would defeat the entire feature), covering password
 * fields plus the token/API-key/PIN/credential shapes the API Automation
 * Authorization tab already names explicitly.
 */
export const SECRET_FIELD_PATTERN = /password|passwd|\bpwd\b|passphrase|secret|credential|\bpin\b|api[-_]?key|auth[-_]?token/i;

export function looksLikeSecretField(text: string): boolean {
  return SECRET_FIELD_PATTERN.test(text);
}
