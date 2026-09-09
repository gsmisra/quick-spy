import * as vscode from 'vscode';
import * as path from 'path';
import { LANGUAGE_VERSIONS, Language, ObjectSpySettings, SettingsStore } from '../settings/settingsStore';
import { listCopilotModels } from '../llm/copilotClient';
import { generateRagCorpus, GenerationProgress, UploadedFile } from '../rag/ragCorpusGenerator';
import { unzip } from '../rag/zipReader';
import { isNoiseDirectoryPath, isSupportedRagSourceFile } from '../rag/ragUploadFilters';
import { getSecretEnv, SECRET_ENV_VAR } from '../security/secretVault';

/** Same per-file cap the drop zone enforces for a directly-dropped file
 * (settingsPanel.ts webview script's RAG_MAX_FILE_BYTES) — applied again
 * here to every individual entry extracted from an uploaded zip, since a
 * whole project archive can easily contain a file far larger than anyone
 * would drop by hand. */
const RAG_MAX_ZIP_ENTRY_BYTES = 200 * 1024;

type InboundMessage =
  | { type: 'update'; payload: Partial<ObjectSpySettings> }
  | { type: 'listModels' }
  | { type: 'openArchitectureDoc' }
  | { type: 'generateRagCorpus'; payload: { files: UploadedFile[] } }
  | { type: 'expandRagZip'; payload: { fileName: string; base64: string } }
  | { type: 'copySecretKey' };

/**
 * The Settings menu — deliberately a separate webview panel from the main
 * UI, not a section bolted onto it. Controls the browser channel, the
 * generated code's language/runtime version, and which GitHub Copilot chat
 * model to use, all persisted via SettingsStore (context.globalState). The
 * "Link with GitHub Copilot LLM" on/off switch itself lives in the Control
 * Panel (objectSpyPanel.ts) instead — this panel's model picker/status
 * still reacts to that setting via the same shared SettingsStore, it just
 * doesn't own the switch anymore.
 */
export class SettingsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  /** Cancelled if the panel is disposed mid-generation, so a closed
   * Settings panel doesn't leave a "Generate RAG Corpus format" batch
   * quietly running in the background. */
  private ragGenerationCts: vscode.CancellationTokenSource | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly settingsStore: SettingsStore) {
    this.disposables.push(this.settingsStore.onChange((settings) => this.postSettings(settings)));
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'objectSpySettings',
      'SoftPlay: Settings',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (message: InboundMessage) => void this.handleMessage(message),
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );

    this.postSettings(this.settingsStore.get());
  }

  dispose(): void {
    this.ragGenerationCts?.cancel();
    this.ragGenerationCts?.dispose();
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private async handleMessage(message: InboundMessage): Promise<void> {
    if (message.type === 'update') {
      await this.settingsStore.update(message.payload);
    } else if (message.type === 'listModels') {
      const models = await listCopilotModels();
      this.panel?.webview.postMessage({ type: 'models', payload: models });
    } else if (message.type === 'openArchitectureDoc') {
      await this.openArchitectureDoc();
    } else if (message.type === 'generateRagCorpus') {
      await this.handleGenerateRagCorpus(message.payload.files);
    } else if (message.type === 'expandRagZip') {
      await this.handleExpandRagZip(message.payload.fileName, message.payload.base64);
    } else if (message.type === 'copySecretKey') {
      await this.copySecretKeyToClipboard();
    }
  }

  /**
   * "Copy CI/CD Secret Key" — the ONLY place this extension ever exposes
   * the raw Auto Password Encryption master key to a human. SoftPlay never
   * needs this itself: "Verify & Fix Code" gets it injected automatically
   * into its own child process's environment (see
   * execution/testExecutor.ts). This exists purely for the scenario
   * security/secretVault.ts's own doc comment already anticipates — a
   * SAVED generated file later run OUTSIDE the extension (a standalone
   * terminal, a real CI/CD pipeline) needs `SoftPlay_SECRET_KEY` set to
   * decrypt its `ENC[v1:...]` tokens, and until now there was literally no
   * way for a user to learn what value that actually is (it's held in
   * VS Code's OS-keychain-backed SecretStorage, not a plain file).
   *
   * Deliberately copies to the clipboard rather than displaying it in the
   * webview — never rendered into the DOM, never left sitting visible in
   * a screen-shared window.
   */
  private async copySecretKeyToClipboard(): Promise<void> {
    const env = await getSecretEnv(this.context);
    const value = env[SECRET_ENV_VAR];
    await vscode.env.clipboard.writeText(`${SECRET_ENV_VAR}=${value}`);
    void vscode.window.showInformationMessage(
      `Copied ${SECRET_ENV_VAR} to the clipboard. This is your own local Auto Password Encryption key — set it as an ` +
        `environment variable wherever you run a saved generated test OUTSIDE this extension (a terminal, your CI/CD ` +
        `pipeline's own secrets manager). Never commit it to source control or paste it into a generated file — ` +
        'store it the same way you would any other secret.'
    );
  }

  /**
   * Front-end companion to the "Generate RAG Corpus format" drop zone
   * accepting a whole project/framework as a single `.zip` (settingsPanel.ts
   * webview script) — a webview has no Node `zlib`, so the actual unzip has
   * to happen here in the extension host (zipReader.ts, dependency-free —
   * same posture as tfidfEmbeddings.ts). Filters out noise directories
   * (node_modules, target, .git, ...) and unsupported file types so a real
   * project zip doesn't queue up hundreds of useless recipe generations,
   * and caps individual entries at the same size the UI enforces for a
   * directly dropped file — then hands the surviving files back to the
   * webview to merge into its normal pending-file list, exactly as if each
   * had been dropped individually (folder structure preserved via
   * `relativePath`, see ragRecipeNormalizer.ts's `ragTargetRelPath()`).
   */
  private async handleExpandRagZip(fileName: string, base64: string): Promise<void> {
    try {
      const buffer = Buffer.from(base64, 'base64');
      const entries = unzip(buffer);
      const files: { fileName: string; relativePath: string; content: string }[] = [];
      let skipped = 0;
      for (const entry of entries) {
        if (entry.isDirectory) {
          continue;
        }
        const normalized = entry.path.replace(/^\/+/, '');
        const baseName = path.posix.basename(normalized);
        const dirPath = path.posix.dirname(normalized);
        const relativePath = dirPath === '.' ? '' : dirPath;
        if (isNoiseDirectoryPath(relativePath) || !isSupportedRagSourceFile(baseName) || entry.content.byteLength > RAG_MAX_ZIP_ENTRY_BYTES) {
          skipped += 1;
          continue;
        }
        files.push({ fileName: baseName, relativePath, content: entry.content.toString('utf-8') });
      }
      this.panel?.webview.postMessage({ type: 'ragZipExpanded', payload: { fileName, files, skippedCount: skipped } });
    } catch (err) {
      this.panel?.webview.postMessage({
        type: 'ragZipExpanded',
        payload: { fileName, files: [], skippedCount: 0, error: err instanceof Error ? err.message : String(err) }
      });
    }
  }

  /**
   * "Generate RAG Corpus format" — turns each uploaded file into a
   * `.github/rag/<name>.md` reusable-component recipe via Copilot (see
   * rag/ragCorpusGenerator.ts). Requires the same "Link with GitHub
   * Copilot LLM" + model selection every other AI feature does — this is
   * a real LLM call (analyzing arbitrary code to infer a title/tags/
   * imports isn't something a template can do), not a local operation.
   */
  private async handleGenerateRagCorpus(files: UploadedFile[]): Promise<void> {
    const settings = this.settingsStore.get();
    if (!settings.copilotEnabled || !settings.copilotModelId) {
      this.panel?.webview.postMessage({
        type: 'ragGenerationDone',
        payload: { succeeded: 0, skipped: 0, failed: files.length, error: 'Enable "Link with GitHub Copilot LLM" (Control Panel) and pick a model in Settings first.' }
      });
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
      this.panel?.webview.postMessage({
        type: 'ragGenerationDone',
        payload: { succeeded: 0, skipped: 0, failed: files.length, error: 'Open a workspace folder first — recipes are saved under its .github/rag folder.' }
      });
      return;
    }
    if (files.length === 0) {
      return;
    }

    this.ragGenerationCts?.cancel();
    this.ragGenerationCts?.dispose();
    const cts = new vscode.CancellationTokenSource();
    this.ragGenerationCts = cts;

    const result = await generateRagCorpus({
      modelId: settings.copilotModelId,
      files,
      workspaceRoot,
      cancellationToken: cts.token,
      onProgress: (progress: GenerationProgress) => {
        this.panel?.webview.postMessage({ type: 'ragGenerationProgress', payload: progress });
      },
      confirmOverwrite: async (existingFileNames) => {
        const choice = await vscode.window.showWarningMessage(
          `${existingFileNames.length} recipe file(s) already exist in .github/rag and would be overwritten: ${existingFileNames.join(', ')}. Overwrite them?`,
          { modal: true },
          'Overwrite',
          'Skip Existing'
        );
        return choice === 'Overwrite';
      }
    });

    this.panel?.webview.postMessage({ type: 'ragGenerationDone', payload: result });
  }

  /**
   * "Architecture & Technical Information" — a standalone, self-contained
   * HTML file (media/architecture.html: inline CSS/SVG only, no external
   * script/stylesheet/CDN references) opened in the user's own default
   * browser via `vscode.env.openExternal`, not a second webview panel.
   * Deliberately NOT a webview: the page is long, image-free but
   * diagram-heavy, and meant to be read/printed/shared like a normal
   * document — a real browser tab (with its own zoom, find-in-page, print)
   * suits that far better than a CSP-constrained VS Code webview, and this
   * still satisfies "opens a html page locally" since nothing ever leaves
   * the machine to render it.
   */
  private async openArchitectureDoc(): Promise<void> {
    const docPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'architecture.html');
    try {
      await vscode.env.openExternal(docPath);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `SoftPlay: Could not open the Architecture & Technical Information page (${docPath.fsPath}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  private postSettings(settings: ObjectSpySettings): void {
    this.panel?.webview.postMessage({
      type: 'settings',
      payload: settings,
      languageVersions: LANGUAGE_VERSIONS
    });
  }

  private getHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SoftPlay Settings</title>
  <style>
    :root {
      /* TD Bank's own brand green — same fixed (non-theme-derived) color
         used for the app title bar in the Control Panel (media/main.css's
         --td-green), reused here so this link reads as the same brand
         element wherever it appears. */
      --td-green: #54b948;
      --td-green-dark: #3f9636;
    }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 16px 20px;
    }
    h2 {
      font-size: 1em;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--vscode-descriptionForeground);
      margin: 20px 0 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 4px;
    }
    h2:first-of-type { margin-top: 0; }
    .field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0;
    }
    .field label { flex: 1; }
    .field .hint {
      display: block;
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    select {
      min-width: 160px;
      padding: 3px 6px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, transparent);
      border-radius: 2px;
    }
    .radio-group { display: flex; gap: 14px; }
    .radio-group label { display: flex; align-items: center; gap: 4px; flex: none; }
    .note {
      margin-top: 24px;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    #copilotModelRow, #copilotStatus { display: none; }
    #copilotModelRow.visible, #copilotStatus.visible { display: flex; }
    .status-text {
      font-size: 0.82em;
      color: var(--vscode-descriptionForeground);
    }
    .field.disabled { opacity: 0.5; }
    .architecture-link-row {
      margin-top: 32px;
      padding-top: 14px;
      border-top: 1px solid var(--vscode-panel-border);
      text-align: center;
    }
    .architecture-link {
      /* -apple-system stack + weight/letter-spacing to match the Control
         Panel's own TD-green title text (media/main.css's .title), so this
         reads as the same brand-styled element rather than a generic link. */
      font-family: -apple-system, BlinkMacSystemFont, var(--vscode-font-family), 'Segoe UI', sans-serif;
      font-weight: 600;
      font-size: 0.92em;
      letter-spacing: 0.01em;
      color: var(--td-green);
      background: none;
      border: none;
      padding: 4px 2px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .architecture-link:hover,
    .architecture-link:focus-visible {
      color: var(--td-green-dark);
      text-decoration: underline;
    }
    .btn {
      padding: 6px 14px;
      border: none;
      border-radius: 4px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: 0.9em;
    }
    .btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border);
    }
    .rag-dropzone {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;
      padding: 22px 16px;
      border: 2px dashed var(--vscode-panel-border);
      border-radius: 6px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 0.88em;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    /* TD Bank green highlight while a drag is actually over the zone —
       fixed brand color like --td-green elsewhere, not theme-derived, so
       the "you're about to drop here" cue reads the same in every theme. */
    .rag-dropzone.dragover {
      border-color: var(--td-green);
      background: rgba(84, 185, 72, 0.08);
    }
    .rag-file-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 10px;
    }
    .rag-file-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-radius: 4px;
      background: var(--vscode-input-background);
      font-size: 0.85em;
    }
    .rag-file-item .rag-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rag-file-item .rag-file-size { flex: none; color: var(--vscode-descriptionForeground); }
    .rag-file-remove {
      flex: none;
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 0.9em;
      padding: 0 4px;
    }
    .rag-file-remove:hover { color: var(--vscode-errorForeground, #f14c4c); }
    .rag-progress {
      margin-top: 12px;
      max-height: 160px;
      overflow-y: auto;
      font-size: 0.8em;
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px 10px;
    }
    .rag-progress-line { padding: 2px 0; white-space: pre-wrap; }
    .rag-progress-line.success { color: #3fb950; }
    .rag-progress-line.error { color: var(--vscode-errorForeground, #f14c4c); }
    .rag-progress-line.skipped, .rag-progress-line.started { color: var(--vscode-descriptionForeground); }
    .rag-progress-line.done { font-weight: 600; color: var(--vscode-foreground); }
  </style>
</head>
<body>
  <h2>Automation Type</h2>
  <div class="field">
    <label>
      Automation type
      <span class="hint">UI Automation records/refines Playwright browser tests. API Automation builds REST Assured (Java) / requests (Python) API tests from a request you describe below instead — no browser involved.</span>
    </label>
    <div class="radio-group">
      <label><input type="radio" name="automationMode" value="ui" /> UI Automation</label>
      <label><input type="radio" name="automationMode" value="api" /> API Automation</label>
    </div>
  </div>

  <h2>Browser</h2>
  <div class="field" id="browserField">
    <label>
      Browser
      <span class="hint">Chrome or Edge only — this extension never downloads a browser of its own. Not used in API Automation mode (no browser is launched).</span>
    </label>
    <div class="radio-group">
      <label><input type="radio" name="browserChannel" value="chrome" /> Chrome</label>
      <label><input type="radio" name="browserChannel" value="edge" /> Edge</label>
    </div>
  </div>

  <h2>Code Generation</h2>
  <div class="field">
    <label>
      Language
      <span class="hint">Playwright codegen (Start) emits automation in this language — passed through as its own --target flag.</span>
    </label>
    <select id="language">
      <option value="java">Java</option>
      <option value="python">Python</option>
    </select>
  </div>
  <div class="field">
    <label>
      Language / runtime version
      <span class="hint">Affects generated syntax idioms only — never the extension's own runtime.</span>
    </label>
    <select id="languageVersion"></select>
  </div>

  <h2>AI Assist</h2>
  <p class="note" style="margin-top: 0;">
    The "Link with GitHub Copilot LLM" switch now lives in the Control Panel (SoftPlay's main sidebar view) — turn it
    on there first. Once it's on, pick which model to use below.
  </p>
  <div class="field" id="copilotModelRow">
    <label>Model</label>
    <select id="copilotModel"></select>
  </div>
  <div class="field" id="copilotStatus">
    <span class="status-text" id="copilotStatusText"></span>
  </div>

  <h2>Mode</h2>
  <div class="field">
    <label>
      Total Agentic Mode
      <span class="hint">
        Swaps the Control Panel sidebar for a file-drop-driven workflow: ingest requirement/data files, then generate
        a feature file, automation code, and/or a Jira-importable manual test-case CSV — all built from the same
        ingested files plus your custom instructions and RAG data. Standard mode's own recording workflow is
        untouched and always available by switching back.
      </span>
    </label>
    <div class="radio-group">
      <label><input type="radio" name="agenticModeEnabled" value="false" /> Standard</label>
      <label><input type="radio" name="agenticModeEnabled" value="true" /> Total Agentic Mode</label>
    </div>
  </div>

  <h2>Auto Password Encryption</h2>
  <p class="note" style="margin-top: 0;">
    Every credential SoftPlay detects (recorded UI fields, API Authorization tab values, and now the "Instant
    instructions to LLM" chat box) is encrypted locally before it ever reaches Copilot, and saved into generated code
    only as an <code>ENC[v1:...]</code> token — never the real value. SoftPlay itself supplies the decryption key
    automatically whenever it runs your code ("Verify &amp; Fix Code"). If you run a SAVED generated test file
    yourself — a terminal, your own CI/CD pipeline — it needs the same key, set as the
    <code>SoftPlay_SECRET_KEY</code> environment variable, to decrypt those tokens.
  </p>
  <div style="display: flex; justify-content: flex-end; margin-bottom: 8px;">
    <button type="button" id="copySecretKeyBtn" class="btn btn-secondary">Copy CI/CD Secret Key</button>
  </div>
  <p class="note" style="margin-top: 0;">
    Copies <code>SoftPlay_SECRET_KEY=&lt;value&gt;</code> to your clipboard — this is YOUR OWN key, generated once and
    stored in VS Code's own OS-keychain-backed secret storage, never written to a plain file. Store it the same way
    you'd store any other secret (your CI/CD system's own secrets manager). <b>Never</b> paste it into a generated
    code file or commit it to source control — doing so would let anyone who can read that file decrypt every
    credential this extension has ever encrypted for you.
  </p>

  <h2>Reusable Components (RAG)</h2>
  <div class="field">
    <label>
      Use reusable components
      <span class="hint">Augments code-generation prompts with the best-matching entries from <code>.github/rag/</code>, if any exist. Safe to leave on — retrieval simply finds nothing when that folder is empty or missing.</span>
    </label>
    <input type="checkbox" id="ragEnabledToggle" />
  </div>

  <h2>Generate RAG Corpus Format</h2>
  <p class="note" style="margin-top: 0;">
    Drop existing helper/config files below — or drop a single <code>.zip</code> of an entire project/framework (Java,
    Python, Scala, ...) and SoftPlay will unzip it, keep only supported source/config files (skipping
    <code>node_modules</code>, <code>.git</code>, build output, etc.), and generate a recipe for each — preserving the
    original folder structure under <code>.github/rag/</code>. SoftPlay asks Copilot to turn each file into a
    well-structured reusable-component recipe (creating <code>.github/rag/</code> if it doesn't exist yet). Requires
    "Link with GitHub Copilot LLM" (Control Panel) and a model picked above.
  </p>
  <div id="ragDropZone" class="rag-dropzone">
    <span>Drop files or a project <code>.zip</code> here, or</span>
    <button type="button" id="ragBrowseBtn" class="btn btn-secondary">Choose Files…</button>
    <input
      type="file"
      id="ragFileInput"
      multiple
      hidden
      accept=".java,.py,.js,.ts,.jsx,.tsx,.sh,.bash,.zsh,.bat,.cmd,.ps1,.json,.xml,.yml,.yaml,.properties,.ini,.toml,.sql,.scala,.kt,.kts,.rb,.go,.cs,.gradle,.groovy,.conf,.cfg,.env.example,.md,.txt,.zip"
    />
  </div>
  <div id="ragFileList" class="rag-file-list"></div>
  <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
    <button type="button" id="ragGenerateBtn" class="btn" disabled>Generate</button>
  </div>
  <div id="ragProgress" class="rag-progress" hidden></div>

  <p class="note">Changes apply immediately and persist across VS Code restarts.</p>

  <div class="architecture-link-row">
    <button type="button" id="architectureLink" class="architecture-link" title="Opens a local HTML page with the full architecture, caching, and LLM integration reference, plus a step-by-step usage guide">
      📐 Architecture &amp; Technical Information
    </button>
  </div>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const languageSelect = document.getElementById('language');
      const versionSelect = document.getElementById('languageVersion');
      const copilotModelRow = document.getElementById('copilotModelRow');
      const copilotModelSelect = document.getElementById('copilotModel');
      const copilotStatus = document.getElementById('copilotStatus');
      const copilotStatusText = document.getElementById('copilotStatusText');
      let languageVersions = {};
      let pendingModelId = '';

      const browserField = document.getElementById('browserField');

      document.getElementById('architectureLink').addEventListener('click', () => {
        vscode.postMessage({ type: 'openArchitectureDoc' });
      });

      document.getElementById('copySecretKeyBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'copySecretKey' });
      });

      document.querySelectorAll('input[name="agenticModeEnabled"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          if (radio.checked) {
            vscode.postMessage({ type: 'update', payload: { agenticModeEnabled: radio.value === 'true' } });
          }
        });
      });

      const ragEnabledToggle = document.getElementById('ragEnabledToggle');
      ragEnabledToggle.addEventListener('change', () => {
        vscode.postMessage({ type: 'update', payload: { ragEnabled: ragEnabledToggle.checked } });
      });

      // --- "Generate RAG Corpus format" — drop zone / file picker / Generate ---
      const ragDropZone = document.getElementById('ragDropZone');
      const ragFileInput = document.getElementById('ragFileInput');
      const ragBrowseBtn = document.getElementById('ragBrowseBtn');
      const ragFileListEl = document.getElementById('ragFileList');
      const ragGenerateBtn = document.getElementById('ragGenerateBtn');
      const ragProgressEl = document.getElementById('ragProgress');
      // Generous enough for a real source/config file, small enough to
      // guard against a pathological paste bloating the Copilot prompt —
      // this content is read entirely into memory and sent as-is.
      const RAG_MAX_FILE_BYTES = 200 * 1024;
      // A whole project/framework zip is a different scale of upload than
      // a hand-picked file — generous enough for a real small-to-medium
      // repo, small enough that reading it into memory + base64-encoding
      // it for the postMessage to the extension host stays snappy.
      const RAG_MAX_ZIP_BYTES = 25 * 1024 * 1024;
      let ragPendingFiles = []; // { fileName, relativePath, content }

      function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
      }

      function ragAppendProgressLine(fileName, status, message) {
        ragProgressEl.hidden = false;
        const line = document.createElement('div');
        line.className = 'rag-progress-line ' + status;
        line.textContent = fileName ? fileName + ' — ' + (message || status) : message || status;
        ragProgressEl.appendChild(line);
        ragProgressEl.scrollTop = ragProgressEl.scrollHeight;
      }

      function ragUpdateFileListUI() {
        ragFileListEl.innerHTML = '';
        ragPendingFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'rag-file-item';

          const name = document.createElement('span');
          name.className = 'rag-file-name';
          const displayName = (file.relativePath ? file.relativePath + '/' : '') + file.fileName;
          name.textContent = displayName;
          name.title = displayName;

          const size = document.createElement('span');
          size.className = 'rag-file-size';
          size.textContent = (file.content.length / 1024).toFixed(1) + ' KB';

          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'rag-file-remove';
          removeBtn.title = 'Remove';
          removeBtn.textContent = '✕';
          removeBtn.addEventListener('click', () => {
            ragPendingFiles.splice(index, 1);
            ragUpdateFileListUI();
          });

          item.appendChild(name);
          item.appendChild(size);
          item.appendChild(removeBtn);
          ragFileListEl.appendChild(item);
        });
        ragGenerateBtn.disabled = ragPendingFiles.length === 0;
      }

      function ragAddFiles(fileList) {
        Array.from(fileList).forEach((file) => {
          const isZip =
            /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
          if (isZip) {
            if (file.size > RAG_MAX_ZIP_BYTES) {
              ragAppendProgressLine(file.name, 'error', 'Skipped — zip larger than 25 MB.');
              return;
            }
            ragAppendProgressLine(file.name, 'started', 'Reading zip and extracting supported files…');
            const reader = new FileReader();
            reader.onload = () => {
              vscode.postMessage({
                type: 'expandRagZip',
                payload: { fileName: file.name, base64: arrayBufferToBase64(reader.result) }
              });
            };
            reader.onerror = () => ragAppendProgressLine(file.name, 'error', 'Could not read this zip file.');
            reader.readAsArrayBuffer(file);
            return;
          }

          if (file.size > RAG_MAX_FILE_BYTES) {
            ragAppendProgressLine(file.name, 'error', 'Skipped — larger than 200 KB.');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            ragPendingFiles.push({ fileName: file.name, relativePath: '', content: String(reader.result || '') });
            ragUpdateFileListUI();
          };
          reader.onerror = () => ragAppendProgressLine(file.name, 'error', 'Could not read this file.');
          reader.readAsText(file);
        });
      }

      ragBrowseBtn.addEventListener('click', () => ragFileInput.click());
      ragFileInput.addEventListener('change', () => {
        ragAddFiles(ragFileInput.files);
        ragFileInput.value = '';
      });

      ['dragenter', 'dragover'].forEach((evt) => {
        ragDropZone.addEventListener(evt, (e) => {
          e.preventDefault();
          ragDropZone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach((evt) => {
        ragDropZone.addEventListener(evt, (e) => {
          e.preventDefault();
          ragDropZone.classList.remove('dragover');
        });
      });
      ragDropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          ragAddFiles(e.dataTransfer.files);
        }
      });

      ragGenerateBtn.addEventListener('click', () => {
        if (ragPendingFiles.length === 0) return;
        ragGenerateBtn.disabled = true;
        ragProgressEl.hidden = false;
        ragProgressEl.innerHTML = '';
        vscode.postMessage({
          type: 'generateRagCorpus',
          payload: { files: ragPendingFiles.map((f) => ({ fileName: f.fileName, relativePath: f.relativePath || '', content: f.content })) }
        });
      });

      document.querySelectorAll('input[name="browserChannel"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          if (radio.checked) {
            vscode.postMessage({ type: 'update', payload: { browserChannel: radio.value } });
          }
        });
      });

      document.querySelectorAll('input[name="automationMode"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          if (radio.checked) {
            vscode.postMessage({ type: 'update', payload: { automationMode: radio.value } });
          }
        });
      });

      function applyAutomationMode(mode) {
        const isApi = mode === 'api';
        document.querySelectorAll('input[name="browserChannel"]').forEach((radio) => {
          radio.disabled = isApi;
        });
        browserField.classList.toggle('disabled', isApi);
      }

      languageSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'update', payload: { language: languageSelect.value } });
      });

      versionSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'update', payload: { languageVersion: versionSelect.value } });
      });

      copilotModelSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'update', payload: { copilotModelId: copilotModelSelect.value } });
      });

      function renderModels(models) {
        copilotModelSelect.innerHTML = '';
        if (!models.length) {
          copilotStatusText.textContent =
            'No Copilot chat models found. Is GitHub Copilot Chat installed and are you signed in?';
          return;
        }
        copilotStatusText.textContent = models.length + ' model(s) available.';
        for (const m of models) {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.name + ' (' + m.family + ')';
          if (m.id === pendingModelId) {
            opt.selected = true;
          }
          copilotModelSelect.appendChild(opt);
        }
        // No prior selection, or it's no longer offered -- persist whichever
        // the browser defaulted to (the first model) so Settings and the
        // main panel agree on what will actually be used.
        if (!models.some((m) => m.id === pendingModelId)) {
          vscode.postMessage({ type: 'update', payload: { copilotModelId: copilotModelSelect.value } });
        }
      }

      function renderVersions(language, selected) {
        const versions = languageVersions[language] || [];
        versionSelect.innerHTML = '';
        for (const v of versions) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          if (v === selected) {
            opt.selected = true;
          }
          versionSelect.appendChild(opt);
        }
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'models') {
          renderModels(message.payload);
          return;
        }
        if (message.type === 'ragZipExpanded') {
          const p = message.payload;
          if (p.error) {
            ragAppendProgressLine(p.fileName, 'error', 'Could not read as a zip — ' + p.error);
          } else {
            p.files.forEach((f) => ragPendingFiles.push(f));
            ragUpdateFileListUI();
            const skippedNote = p.skippedCount ? ', skipped ' + p.skippedCount + ' (unsupported type or excluded folder)' : '';
            ragAppendProgressLine(p.fileName, 'success', 'Extracted ' + p.files.length + ' supported file(s)' + skippedNote + '.');
          }
          return;
        }
        if (message.type === 'ragGenerationProgress') {
          const p = message.payload;
          ragAppendProgressLine(p.fileName, p.status, p.message);
          return;
        }
        if (message.type === 'ragGenerationDone') {
          const r = message.payload;
          if (r.error) {
            ragAppendProgressLine('', 'error', r.error);
          } else {
            ragAppendProgressLine('', 'done', 'Done — ' + r.succeeded + ' generated, ' + r.skipped + ' skipped, ' + r.failed + ' failed.');
            // Only clear the queue on a real attempt (not the early-exit
            // "Copilot isn't set up" error above) — a genuine failure per
            // file already stays visible in the progress log for review,
            // but the pending list itself is done with regardless.
            ragPendingFiles = [];
            ragUpdateFileListUI();
          }
          ragGenerateBtn.disabled = ragPendingFiles.length === 0;
          return;
        }
        if (message.type !== 'settings') {
          return;
        }
        languageVersions = message.languageVersions;
        const settings = message.payload;

        document.querySelectorAll('input[name="browserChannel"]').forEach((radio) => {
          radio.checked = radio.value === settings.browserChannel;
        });
        document.querySelectorAll('input[name="automationMode"]').forEach((radio) => {
          radio.checked = radio.value === settings.automationMode;
        });
        applyAutomationMode(settings.automationMode);
        languageSelect.value = settings.language;
        renderVersions(settings.language, settings.languageVersion);
        ragEnabledToggle.checked = settings.ragEnabled;
        document.querySelectorAll('input[name="agenticModeEnabled"]').forEach((radio) => {
          radio.checked = radio.value === String(settings.agenticModeEnabled);
        });

        pendingModelId = settings.copilotModelId;
        copilotModelRow.classList.toggle('visible', settings.copilotEnabled);
        copilotStatus.classList.toggle('visible', settings.copilotEnabled);
        if (settings.copilotEnabled) {
          copilotStatusText.textContent = 'Looking for GitHub Copilot chat models…';
          vscode.postMessage({ type: 'listModels' });
        }
      });
    })();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Re-exported for anything that only needs the type name from this module.
export type { Language };
