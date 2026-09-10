import * as vscode from 'vscode';

export type Language = 'java' | 'python';

/** Chrome or Edge only — this extension never downloads/bundles a browser
 * of its own. Passed straight through to Playwright `codegen`'s own
 * `--channel` flag (see codegenManager.ts), which drives the real,
 * already-installed system browser instead of needing one of Playwright's
 * own bundled binaries. */
export type BrowserChannel = 'chrome' | 'edge';

/** 'ui' (default) is the original Playwright/browser recording flow.
 * 'api' switches the Control Panel over to a Postman-style API request
 * builder and every AI/Gherkin generation path over to REST Assured
 * (Java)/`requests` (Python) API test code instead — see
 * objectSpyPanel.ts's buildLlmPrompt()/buildFeatureFilePrompt() and
 * prompts/api-automation-instructions.md. Nothing about the UI-mode flow
 * changes when this is 'ui'; the two modes are additive, not a rewrite. */
export type AutomationMode = 'ui' | 'api';

export interface ObjectSpySettings {
  language: Language;
  languageVersion: string;
  browserChannel: BrowserChannel;
  automationMode: AutomationMode;
  /** "Link with GitHub Copilot LLM" toggle — see settingsPanel.ts and src/llm/copilotClient.ts. */
  copilotEnabled: boolean;
  /** LanguageModelChat.id of the selected Copilot model, or '' if none picked yet. */
  copilotModelId: string;
  /** "Reusable Components (RAG)" — when true, code-generation prompts are
   * augmented with the best-matching entries from `.github/rag/*.md` (see
   * rag/ragRetriever.ts). Off by default — this is an opt-in feature a
   * team turns on once it has actually populated `.github/rag/`, rather
   * than a silent default every user must first discover and understand. */
  ragEnabled: boolean;
  /** "Hybrid Retrieval (Experimental)" — off by default, and INERT even
   * when true unless `ragSemanticEndpoint`/`ragSemanticModel` are ALSO both
   * non-empty (see rag/ragHybridConfig.ts's `resolveHybridRetrieveMatches()`)
   * — "semantic mode must be explicitly configured" means every one of
   * these, not just this toggle. When genuinely active, `.github/rag/`
   * recipe text and generation queries are sent to `ragSemanticEndpoint`
   * for embedding (see rag/ragHttpEmbeddingProvider.ts) and combined with
   * ordinary lexical (TF-IDF) retrieval via Reciprocal Rank Fusion (see
   * rag/ragHybridRetriever.ts) — lexical-only retrieval keeps working
   * completely unaffected when this is off. */
  ragHybridEnabled: boolean;
  /** Full URL of a user-run OpenAI-compatible embeddings endpoint (e.g.
   * "https://api.openai.com/v1/embeddings", an Azure OpenAI deployment
   * URL, or a self-hosted server). Empty string means "not configured" —
   * see `ragHybridEnabled`'s own doc comment. */
  ragSemanticEndpoint: string;
  /** Sent as the embeddings request's own `model` field — provider-defined
   * meaning (e.g. "text-embedding-3-small"). Empty string means "not
   * configured." */
  ragSemanticModel: string;
  /** "Total Agentic Mode" — when true, the Control Panel sidebar swaps its
   * normal Playwright-recording UI for the file-drop/ingestion-driven
   * agentic workflow (see agentic/agenticModeController.ts): drop
   * heterogeneous input files (requirements docs, data files, ...),
   * configure how much of each to bring into context, then generate a
   * feature file, automation code, and/or a Jira-importable manual
   * test-case CSV — all still built from the SAME shared context sources
   * (custom instruction files, RAG data, the chat box) as standard mode.
   * Deliberately its own independent flag rather than a third
   * `automationMode` value — `automationMode`/`language`/`languageVersion`
   * still choose the generated automation code's flavor/target while this
   * is on. */
  agenticModeEnabled: boolean;
}

/**
 * Language/runtime versions offered per language — drives Playwright
 * `codegen`'s own `--target` flag (java-junit for Java, python-pytest for
 * Python; see codegenManager.ts) and, separately, which language/runtime
 * idioms the "Custom md files" AI refinement prompt asks for.
 */
export const LANGUAGE_VERSIONS: Record<Language, string[]> = {
  java: ['11', '17', '21'],
  python: ['3.9', '3.10', '3.11', '3.12']
};

const DEFAULTS: ObjectSpySettings = {
  language: 'java',
  languageVersion: '17',
  browserChannel: 'chrome',
  automationMode: 'ui',
  copilotEnabled: false,
  copilotModelId: '',
  ragEnabled: false,
  ragHybridEnabled: false,
  ragSemanticEndpoint: '',
  ragSemanticModel: '',
  agenticModeEnabled: false
};

const STORAGE_KEY = 'objectSpy.settings';

/** One-time migration marker (its OWN separate globalState key, never part
 * of the settings object itself) for the day `DEFAULTS.ragEnabled` flipped
 * from `true` to `false` — changing that default only ever affects a
 * BRAND-NEW install with no `STORAGE_KEY` entry yet; an existing
 * installation already has `ragEnabled: true` sitting in `stored` (either
 * from an explicit choice, or simply because it inherited the OLD default
 * the very first time settings were ever saved), and `stored` always wins
 * over `DEFAULTS` in the merge below — so the new default alone would
 * never actually turn it off for anyone who had already used this
 * extension. This forces `ragEnabled` to `false` exactly ONCE, the first
 * time settings load after this migration shipped, regardless of whatever
 * was previously stored — and never again after that, so a user who
 * deliberately re-enables it afterward has that choice persisted and
 * respected normally going forward, exactly like any other setting. */
const RAG_ENABLED_DEFAULT_MIGRATION_KEY = 'objectSpy.ragEnabledDefaultMigrated.v1';

/**
 * Owns SoftPlay's persistent settings (language, language version, browser
 * channel, GitHub Copilot linking) — these live in `context.globalState`
 * rather than VS Code workspace settings, so the Settings panel is the
 * single source of truth (no separate settings.json copy to drift out of
 * sync with).
 */
export class SettingsStore implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ObjectSpySettings>();
  readonly onChange = this.changeEmitter.event;

  private current: ObjectSpySettings;

  constructor(private readonly context: vscode.ExtensionContext) {
    const stored = context.globalState.get<Partial<ObjectSpySettings>>(STORAGE_KEY);
    let merged: ObjectSpySettings = { ...DEFAULTS, ...stored };
    // See RAG_ENABLED_DEFAULT_MIGRATION_KEY's own doc comment — forces
    // ragEnabled off exactly once for an existing installation whose
    // ALREADY-persisted settings still carry the old `true` default,
    // then never touches it again.
    if (!context.globalState.get<boolean>(RAG_ENABLED_DEFAULT_MIGRATION_KEY)) {
      merged = { ...merged, ragEnabled: false };
      void context.globalState.update(RAG_ENABLED_DEFAULT_MIGRATION_KEY, true);
    }
    // automationMode is deliberately NOT restored from a previous session —
    // "UI Automation should be always selected by default" means every
    // fresh VS Code/extension-host start, not just a brand-new install.
    // Switching to API Automation is a per-session choice the user makes
    // explicitly each time; it still persists normally (via update() below)
    // for the rest of THIS session (e.g. if the Settings panel is closed
    // and reopened), it just never survives a restart. Every other setting
    // (language, browser, Copilot linking) keeps its usual persisted
    // behavior, unaffected.
    this.current = { ...sanitize(merged), automationMode: DEFAULTS.automationMode };
  }

  get(): ObjectSpySettings {
    return this.current;
  }

  async update(partial: Partial<ObjectSpySettings>): Promise<ObjectSpySettings> {
    this.current = sanitize({ ...this.current, ...partial });
    await this.context.globalState.update(STORAGE_KEY, this.current);
    this.changeEmitter.fire(this.current);
    return this.current;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

/** Guards against a language/version combination that doesn't actually exist
 * (e.g. settings persisted by a future version of the extension with a
 * language version this build doesn't know about). */
function sanitize(settings: ObjectSpySettings): ObjectSpySettings {
  const versions = LANGUAGE_VERSIONS[settings.language] ?? LANGUAGE_VERSIONS[DEFAULTS.language];
  let result = settings;
  if (!versions.includes(settings.languageVersion)) {
    result = { ...result, languageVersion: versions[0] };
  }
  if (result.automationMode !== 'ui' && result.automationMode !== 'api') {
    result = { ...result, automationMode: DEFAULTS.automationMode };
  }
  return result;
}
