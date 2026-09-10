/**
 * The API Automation Control Panel's request builder, as a structured
 * shape — mirrors exactly what main.js's `collectApiRequestDetails()`
 * sends over (see objectSpyPanel.ts's 'sendToLlm'/'generateFeatureFile'
 * handlers). Kept separate from settingsStore.ts's `ObjectSpySettings`
 * deliberately: this is per-request data typed into the Control Panel each
 * time, not a persisted setting.
 */

export interface ApiKeyValueRow {
  key: string;
  value: string;
  description: string;
}

/** form-data's own row shape — the only body encoding that can carry a
 * file upload (matches Postman: each row's Value can be switched between
 * plain Text and a File picked via a native OS dialog). `value` holds the
 * absolute path on disk when `valueType` is 'file' (never file *contents*
 * — this extension doesn't send the HTTP request itself, only describes
 * its shape to the LLM, so a path is all the generated code needs to know
 * which file to stream). */
export interface ApiFormDataRow extends ApiKeyValueRow {
  valueType: 'text' | 'file';
}

/** Every auth type SoftPlay's Control Panel offers — the same set Postman
 * itself offers minus "Inherit auth from parent" (no collection/folder
 * hierarchy exists here for anything to inherit from). */
export type ApiAuthType = 'noauth' | 'apikey' | 'bearer' | 'basic' | 'digest' | 'oauth1' | 'oauth2' | 'hawk' | 'awsv4' | 'ntlm' | 'edgegrid';
export type ApiBodyMode = 'none' | 'form-data' | 'x-www-form-urlencoded' | 'raw';

/** All auth types' fields flattened into one object (mirrors the Control
 * Panel's own markup — one field block per type, shown/hidden by
 * `authType`) rather than a discriminated union: simpler to read/write
 * from main.js, and only the fields matching the current `authType` are
 * ever populated or rendered into the LLM prompt (see
 * buildApiRequestSummary()) — the rest just sit empty. */
export interface ApiAuthFields {
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyAddTo: 'header' | 'query';
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  digestUsername: string;
  digestPassword: string;
  oauth1ConsumerKey: string;
  oauth1ConsumerSecret: string;
  oauth1AccessToken: string;
  oauth1TokenSecret: string;
  oauth1SignatureMethod: string;
  oauth2AccessToken: string;
  oauth2HeaderPrefix: string;
  hawkAuthId: string;
  hawkAuthKey: string;
  hawkAlgorithm: string;
  awsAccessKey: string;
  awsSecretKey: string;
  awsSessionToken: string;
  awsRegion: string;
  awsServiceName: string;
  ntlmUsername: string;
  ntlmPassword: string;
  ntlmDomain: string;
  ntlmWorkstation: string;
  edgeGridAccessToken: string;
  edgeGridClientToken: string;
  edgeGridClientSecret: string;
}

export interface ApiRequestDetails {
  method: string;
  url: string;
  params: ApiKeyValueRow[];
  headers: ApiKeyValueRow[];
  authType: ApiAuthType;
  auth: ApiAuthFields;
  bodyMode: ApiBodyMode;
  bodyFormFields: ApiFormDataRow[];
  bodyUrlencodedFields: ApiKeyValueRow[];
  bodyRawLanguage: string;
  bodyRaw: string;
}

/** True once the user has typed at least a URL — the minimum needed for
 * "there's actually a request here" (mirrors the Playwright-code-empty
 * guard elsewhere: never send an empty/no-op context to the LLM). */
export function hasApiRequest(details: ApiRequestDetails | undefined): boolean {
  return !!details && details.url.trim().length > 0;
}

const MAX_BODY_FIELD_NAMES = 30;
const MAX_JSON_KEY_DEPTH = 4;

/** Field NAMES only — NEVER values — pulled from the request body, for use
 * as extra RAG retrieval signal (see rag/ragRetriever.ts's
 * `retrieveRagMatches()` and objectSpyPanel.ts's `buildRagSection()`,
 * which previously queried API mode by method+URL alone, e.g. just
 * "POST /api/orders" — with no visibility at all into what the request
 * body actually concerns). A field name like "cardNumber" or "keyspace" is
 * useful lexical signal for matching a relevant reusable helper; the VALUE
 * behind it could be arbitrary (and possibly sensitive) data with no
 * retrieval value, so values are never inspected here regardless of
 * `bodyMode` — this only ever collects the KEYS.
 *
 * `form-data`/`x-www-form-urlencoded` rows already carry their field names
 * as plain, structured data (zero parsing risk). A `raw` body's field
 * names are extracted only when it actually parses as JSON — a best-effort
 * regex/heuristic extraction over arbitrary raw text (XML, GraphQL, plain
 * text) risks pulling in noise rather than real field names, so anything
 * that isn't valid JSON is left alone rather than guessed at; the
 * method/URL and any linked Gherkin scenario text remain the query's other
 * signal in that case. */
export function extractApiBodyFieldNames(details: ApiRequestDetails): string[] {
  const names = new Set<string>();
  const add = (name: string): void => {
    const trimmed = name.trim();
    if (trimmed && names.size < MAX_BODY_FIELD_NAMES) {
      names.add(trimmed);
    }
  };

  if (details.bodyMode === 'form-data') {
    details.bodyFormFields.forEach((field) => add(field.key));
  } else if (details.bodyMode === 'x-www-form-urlencoded') {
    details.bodyUrlencodedFields.forEach((field) => add(field.key));
  } else if (details.bodyMode === 'raw' && details.bodyRaw.trim()) {
    try {
      collectJsonKeys(JSON.parse(details.bodyRaw), add, MAX_JSON_KEY_DEPTH);
    } catch {
      // Not JSON (or malformed) — no field names extracted from a raw body
      // this extension can't safely parse the shape of.
    }
  }
  return Array.from(names);
}

function collectJsonKeys(value: unknown, add: (name: string) => void, depthRemaining: number): void {
  if (depthRemaining <= 0 || value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonKeys(item, add, depthRemaining - 1);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    add(key);
    collectJsonKeys(nested, add, depthRemaining - 1);
  }
}

/** Encrypts a credential value for embedding in the LLM prompt (see
 * security/secretVault.ts) — injected rather than imported directly so this
 * module stays free of any `vscode` dependency, consistent with the rest of
 * this file. Real call sites (objectSpyPanel.ts) pass
 * `(plaintext) => secretVault.encryptSecret(context, plaintext)`. */
export type SecretEncryptor = (plaintext: string) => Promise<string>;

function formatRows(rows: ApiKeyValueRow[]): string {
  if (!rows.length) {
    return '  (none)';
  }
  return rows
    .map((r) => `  - ${r.key}: ${r.value}${r.description ? ` (${r.description})` : ''}`)
    .join('\n');
}

/** form-data rows need their own formatting: a 'file' row must read as an
 * unambiguous instruction to perform a real multipart file upload (Java
 * REST Assured `.multiPart(key, new File(path))`; Python `requests`
 * `files={key: open(path, 'rb')}`) — never as if the file's path string
 * were itself the field's text value. */
function formatFormDataRows(rows: ApiFormDataRow[]): string {
  if (!rows.length) {
    return '  (none)';
  }
  return rows
    .map((r) => {
      const value = r.valueType === 'file' ? `[FILE UPLOAD] ${r.value || '(no file selected)'}` : r.value;
      return `  - ${r.key} (${r.valueType}): ${value}${r.description ? ` (${r.description})` : ''}`;
    })
    .join('\n');
}

/**
 * Renders the API request as a plain-language summary for the LLM prompt —
 * never the literal secret VALUE of an API key/bearer token/basic-auth
 * password: every credential-shaped field goes through `encryptSecret`
 * first (SoftPlay's "Auto Password Encryption" — see security/secretVault.ts),
 * so what actually reaches the prompt is an opaque `ENC[v1:...]` token, not
 * the real value. This is stronger than the previous "just tell the LLM to
 * reference an env var" approach: the generated code comes back already
 * wired to decrypt the real credential at run time (see
 * password-encryption-standard.md), so "Verify & Fix Code" can actually
 * execute it, while the real plaintext never leaves this machine and never
 * sits in the saved source file either.
 */
export async function buildApiRequestSummary(details: ApiRequestDetails, encryptSecret: SecretEncryptor): Promise<string> {
  const lines: string[] = [];
  lines.push(`Method: ${details.method}`);
  lines.push(`URL: ${details.url}`);

  lines.push('Query Params:');
  lines.push(formatRows(details.params));

  lines.push('Headers:');
  lines.push(formatRows(details.headers));

  lines.push(`Authorization: ${authTypeLabel(details.authType)}`);
  lines.push(...(await formatAuthFields(details.authType, details.auth, encryptSecret)));

  lines.push(`Body mode: ${details.bodyMode}`);
  if (details.bodyMode === 'form-data') {
    lines.push('Form-data fields:');
    lines.push(formatFormDataRows(details.bodyFormFields));
  } else if (details.bodyMode === 'x-www-form-urlencoded') {
    lines.push('x-www-form-urlencoded fields:');
    lines.push(formatRows(details.bodyUrlencodedFields));
  } else if (details.bodyMode === 'raw') {
    const format = rawBodyFormatInfo(details.bodyRawLanguage);
    lines.push(
      `Raw body — data format: **${format.label}** (the user explicitly selected this in the Control Panel's Body ` +
        `tab; treat the body below as ${format.label}, not any other format, regardless of how it happens to look) ` +
        `— set \`Content-Type: ${format.contentType}\` on the request${format.parseNote ? `; ${format.parseNote}` : ''}.`
    );
    lines.push(`\`\`\`${format.fence}`);
    lines.push(details.bodyRaw || '(empty)');
    lines.push('```');
  }

  return lines.join('\n');
}

/** Maps the raw body's language picker (`bodyRawLanguage` — 'JSON' / 'XML'
 * / 'Text', exactly as the Control Panel's select option values read) to
 * everything the LLM needs to generate code that actually treats the body
 * as that format: the real Content-Type to set, the fenced-code-block
 * language tag (so the body itself is visually/structurally unambiguous
 * in the prompt too, not just labeled in prose), and — for JSON/XML — a
 * reminder to parse/serialize accordingly rather than pass it as an
 * opaque string. Unrecognized values fall back to Text, never silently to
 * JSON — the user's actual selection must never be guessed at. */
function rawBodyFormatInfo(bodyRawLanguage: string): { label: string; contentType: string; fence: string; parseNote: string } {
  switch (bodyRawLanguage) {
    case 'JSON':
      return {
        label: 'JSON',
        contentType: 'application/json',
        fence: 'json',
        parseNote: 'build/send it as real structured JSON (a serialized object/POJO, or a JSON library), never as a hand-typed string'
      };
    case 'XML':
      return {
        label: 'XML',
        contentType: 'application/xml',
        fence: 'xml',
        parseNote: 'build/send it as real XML (an XML library/builder or a properly escaped template), never as a hand-typed string with no escaping'
      };
    default:
      return { label: 'plain text', contentType: 'text/plain', fence: '', parseNote: '' };
  }
}

function authTypeLabel(type: ApiAuthType): string {
  switch (type) {
    case 'apikey':
      return 'API Key';
    case 'bearer':
      return 'Bearer Token';
    case 'basic':
      return 'Basic Auth';
    case 'digest':
      return 'Digest Auth';
    case 'oauth1':
      return 'OAuth 1.0';
    case 'oauth2':
      return 'OAuth 2.0';
    case 'hawk':
      return 'Hawk Authentication';
    case 'awsv4':
      return 'AWS Signature';
    case 'ntlm':
      return 'NTLM Authentication';
    case 'edgegrid':
      return 'Akamai EdgeGrid';
    default:
      return 'No Auth';
  }
}

/** One line per field of whichever auth type is actually selected — every
 * secret-shaped field (keys, secrets, tokens, passwords) is run through
 * SoftPlay's Auto Password Encryption (`encryptSecret`) and sent as an
 * opaque `ENC[v1:...]` token, never the real value; everything else
 * (usernames, key NAMES, regions, algorithms, header prefixes) is plain,
 * non-secret metadata the LLM needs to generate the right shape of code and
 * is sent as-is. */
async function formatAuthFields(type: ApiAuthType, auth: ApiAuthFields, encryptSecret: SecretEncryptor): Promise<string[]> {
  const notSet = (v: string) => v || '(not set)';
  const secret = async (v: string) => (v ? await encryptSecret(v) : '(not set)');
  switch (type) {
    case 'apikey':
      return [
        `  - Key name: ${notSet(auth.apiKeyName)}`,
        `  - Value: ${await secret(auth.apiKeyValue)}`,
        `  - Added to: ${auth.apiKeyAddTo === 'query' ? 'Query Params' : 'Header'}`
      ];
    case 'bearer':
      return [`  - Token: ${await secret(auth.bearerToken)}`];
    case 'basic':
      return [`  - Username: ${notSet(auth.basicUsername)}`, `  - Password: ${await secret(auth.basicPassword)}`];
    case 'digest':
      return [`  - Username: ${notSet(auth.digestUsername)}`, `  - Password: ${await secret(auth.digestPassword)}`];
    case 'oauth1':
      return [
        `  - Consumer Key: ${await secret(auth.oauth1ConsumerKey)}`,
        `  - Consumer Secret: ${await secret(auth.oauth1ConsumerSecret)}`,
        `  - Access Token: ${await secret(auth.oauth1AccessToken)}`,
        `  - Token Secret: ${await secret(auth.oauth1TokenSecret)}`,
        `  - Signature Method: ${notSet(auth.oauth1SignatureMethod)}`
      ];
    case 'oauth2':
      return [`  - Access Token: ${await secret(auth.oauth2AccessToken)}`, `  - Header Prefix: ${notSet(auth.oauth2HeaderPrefix)}`];
    case 'hawk':
      return [
        `  - Hawk Auth ID: ${notSet(auth.hawkAuthId)}`,
        `  - Hawk Auth Key: ${await secret(auth.hawkAuthKey)}`,
        `  - Algorithm: ${notSet(auth.hawkAlgorithm)}`
      ];
    case 'awsv4':
      return [
        `  - Access Key: ${await secret(auth.awsAccessKey)}`,
        `  - Secret Key: ${await secret(auth.awsSecretKey)}`,
        `  - Session Token: ${auth.awsSessionToken ? await secret(auth.awsSessionToken) : '(not set — not using temporary credentials)'}`,
        `  - AWS Region: ${notSet(auth.awsRegion)}`,
        `  - Service Name: ${notSet(auth.awsServiceName)}`
      ];
    case 'ntlm':
      return [
        `  - Username: ${notSet(auth.ntlmUsername)}`,
        `  - Password: ${await secret(auth.ntlmPassword)}`,
        `  - Domain: ${auth.ntlmDomain || '(not set)'}`,
        `  - Workstation: ${auth.ntlmWorkstation || '(not set)'}`
      ];
    case 'edgegrid':
      return [
        `  - Access Token: ${await secret(auth.edgeGridAccessToken)}`,
        `  - Client Token: ${await secret(auth.edgeGridClientToken)}`,
        `  - Client Secret: ${await secret(auth.edgeGridClientSecret)}`
      ];
    default:
      return [];
  }
}
