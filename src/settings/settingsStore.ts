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
   * rag/ragRetriever.ts). Safe to leave on with an empty/missing
   * `.github/rag` folder — retrieval then simply finds nothing and adds
   * zero prompt content, so this defaults to true rather than requiring an
   * extra step once a team actually populates the folder. */
  ragEnabled: boolean;
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
  ragEnabled: true,
  agenticModeEnabled: false
};

const STORAGE_KEY = 'objectSpy.settings';

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
    // automationMode is deliberately NOT restored from a previous session —
    // "UI Automation should be always selected by default" means every
    // fresh VS Code/extension-host start, not just a brand-new install.
    // Switching to API Automation is a per-session choice the user makes
    // explicitly each time; it still persists normally (via update() below)
    // for the rest of THIS session (e.g. if the Settings panel is closed
    // and reopened), it just never survives a restart. Every other setting
    // (language, browser, Copilot linking) keeps its usual persisted
    // behavior, unaffected.
    this.current = { ...sanitize({ ...DEFAULTS, ...stored }), automationMode: DEFAULTS.automationMode };
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
