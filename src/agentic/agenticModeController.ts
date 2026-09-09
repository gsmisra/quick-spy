import * as vscode from 'vscode';
import * as path from 'path';
import { ObjectSpySettings, SettingsStore } from '../settings/settingsStore';
import { readFileCachedSync, readWorkspaceFileCached } from '../cache/fileCache';
import { CopilotUnavailableError, countModelTokens, extractCodeBlock, findModel } from '../llm/copilotClient';
import { VSCodeCopilotToolCallingModel } from '../agent/vscodeCopilotToolCallingModel';
import { getOrBuildRagIndex } from '../rag/ragIndexer';
import { retrieveRagMatches, formatRagPromptSection } from '../rag/ragRetriever';
import { AiCodePanel } from '../panel/aiCodePanel';
import { GeneratedFeaturePanel } from '../panel/generatedFeaturePanel';
import { buildAgenticAutomationCodeChain, buildAgenticFeatureFileChain, buildAgenticTestCaseCsvChain } from './agenticChains';
import { buildCsvPreview, detectAgenticFileKind, extractSegmentForFile } from './textIngestion';
import { parseXlsxBuffer, buildXlsxPreview } from './xlsxIngestion';
import { parseDocxBuffer, buildDocxPreview } from './docxIngestion';
import { parsePdfBuffer, buildPdfPreview } from './pdfIngestion';
import { InvalidTestCaseCsvError, normalizeTestCaseCsvResponse } from './csvTestCaseGenerator';
import { AGENTIC_LEGACY_UNSUPPORTED_EXTENSIONS, AgenticFileKind, AgenticFileMeta, AgenticIngestedFile, AgenticIngestionConfig } from './agenticTypes';

/**
 * Total Agentic Mode — a deliberately SEPARATE module from every existing
 * generation path (objectSpyPanel.ts's `runLlmRefinement()`/
 * `generateFeatureFile()`) rather than a third branch bolted onto them, per
 * the explicit "proper segregation" requirement: this class owns its own
 * ingested-file state, its own LangChain chains (agenticChains.ts), and its
 * own pair of output panels (fresh `AiCodePanel`/`GeneratedFeaturePanel`
 * instances, never the ones Standard mode already owns) — nothing here can
 * reach into, or be reached by, Standard mode's fields, so turning Agentic
 * Mode on/off can never change Standard mode's own behavior.
 *
 * File formats: text-shaped input (`.csv`, `.json`, `.xml`, `.yml`/`.yaml`,
 * `.txt`/`.md`/`.log`, and best-effort raw text for anything else) is
 * handled directly here as UTF-8 text (textIngestion.ts). `.xlsx`
 * (xlsxIngestion.ts, via `exceljs`), `.docx` (docxIngestion.ts, via
 * `mammoth`), and `.pdf` (pdfIngestion.ts, via `pdfjs-dist`) are each
 * parsed by their own dedicated module into a structured, already-parsed
 * shape (sheets/heading-sections/pages) — see `buildIngestedFile()` below
 * for the dispatch. Legacy pre-2007 Office binary formats (`.xls`, `.doc`)
 * are a completely different, unrelated binary format from `.xlsx`/`.docx`
 * (which are OOXML zip packages) and are rejected with a specific
 * "save as .xlsx/.docx" message rather than mis-parsed as garbage.
 *
 * In-memory only: every ingested file's raw/parsed content lives in the
 * `files` Map for this VS Code session and is NEVER written to disk —
 * closing the workspace or reloading the window clears it, exactly like
 * the rest of this extension's "staged context" (the chat box, checked
 * instruction files) never persisting across a restart.
 */

/** Per-file cap on the RAW upload — separate from (and larger than) the
 * post-ingestion `AGENTIC_MAX_SEGMENT_CHARS` cap on what's actually sent to
 * the LLM (textIngestion.ts) — a user may legitimately drop a large source
 * file and then configure a small slice of it. */
const AGENTIC_MAX_RAW_FILE_BYTES = 10 * 1024 * 1024;

const JIRA_TEMPLATE_RELATIVE_PATH = ['.github', 'Jira_test_case_template.md'];

export interface AgenticIngestResult {
  accepted: AgenticFileMeta[];
  rejected: { fileName: string; reason: string }[];
}

export class AgenticModeController implements vscode.Disposable {
  private readonly files = new Map<string, AgenticIngestedFile>();
  private nextFileId = 1;
  private lastUserRequest = '';
  // Workspace-relative paths of whichever "Custom Instructions" checkboxes
  // are currently checked in Agentic Mode's OWN "Custom Instructions & RAG
  // Data" segment (agenticModeSidebarView.ts/media/agenticMode.js) — its
  // own independent selection, never shared with Standard mode's
  // ObjectSpyPanel.selectedInstructionFiles. Starts empty (nothing
  // checked), matching Standard mode's own default.
  private selectedInstructionFiles: string[] = [];
  private lastReceivedTokens = 0;
  private tokenEstimateSeq = 0;
  // The last CSV file this session actually wrote — "View Manual Test
  // Cases in CSV" reopens exactly this file rather than regenerating (see
  // generateTestCaseCsv()). undefined until the first successful CSV
  // generation, and reset to undefined by reset()/Clear Data.
  private lastCsvUri: vscode.Uri | undefined;

  // Fresh, independent panel instances — see class doc comment. Regenerate
  // simply re-runs the same action; Agentic Mode's own generation actions
  // are idempotent given the same ingested files/config/request, so both
  // panels' "Regenerate" reruns the matching generate*() method below.
  private readonly aiCodePanel: AiCodePanel;
  private readonly generatedFeaturePanel: GeneratedFeaturePanel;

  private codeCancellation: vscode.CancellationTokenSource | undefined;
  private featureCancellation: vscode.CancellationTokenSource | undefined;
  private csvCancellation: vscode.CancellationTokenSource | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly settingsStore: SettingsStore,
    private readonly getSidebarWebview: () => vscode.Webview | undefined,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    // The panel's OWN "Regenerate" button must always force a fresh
    // generation — `true` bypasses the "already have content, just show
    // it" short-circuit generateAutomationCode()/generateFeatureFile()
    // apply for the SIDEBAR's own Start/View button (see their own doc
    // comments below). Without this, clicking Regenerate on already-open
    // content would silently do nothing, since content already exists.
    this.aiCodePanel = new AiCodePanel(context, () => void this.generateAutomationCode(true), () => undefined, 'Agentic Mode — AI Generated Code');
    this.generatedFeaturePanel = new GeneratedFeaturePanel(context, () => void this.generateFeatureFile(true), 'Agentic Mode — Generated Feature File');
  }

  dispose(): void {
    this.codeCancellation?.cancel();
    this.codeCancellation?.dispose();
    this.featureCancellation?.cancel();
    this.featureCancellation?.dispose();
    this.csvCancellation?.cancel();
    this.csvCancellation?.dispose();
    this.aiCodePanel.dispose();
    this.generatedFeaturePanel.dispose();
  }

  /**
   * "Clear Data" (Agentic Mode's own sidebar button) AND the reset that
   * runs automatically when Total Agentic Mode is turned off — the exact
   * same "start completely over" guarantee Standard mode's own Clear Data/
   * Kill All Browsers give: every ingested file's raw AND parsed content,
   * every per-file ingestion config, the checked custom-instruction
   * selection, the accumulated chat-box request, any in-flight generation,
   * both owned result panels' content, and the Token Monitoring estimate
   * are all wiped — nothing from this batch of files can leak into the
   * next one. Mirrors ObjectSpyPanel.clearSharedLlmContext() scope-for-scope.
   */
  reset(): void {
    this.codeCancellation?.cancel();
    this.codeCancellation?.dispose();
    this.codeCancellation = undefined;
    this.featureCancellation?.cancel();
    this.featureCancellation?.dispose();
    this.featureCancellation = undefined;
    this.csvCancellation?.cancel();
    this.csvCancellation?.dispose();
    this.csvCancellation = undefined;

    // Dropping every reference to the Map's own AgenticIngestedFile entries
    // (raw text AND any parsedXlsx/parsedDocx/parsedPdf structure) is what
    // actually frees the in-memory content — clear() removes the only
    // handles this controller was holding, so it becomes eligible for
    // garbage collection immediately, not just logically "forgotten".
    this.files.clear();
    this.lastUserRequest = '';
    this.selectedInstructionFiles = [];

    this.aiCodePanel.clear();
    this.generatedFeaturePanel.clear();
    this.lastCsvUri = undefined;
    // Flips "View Manual Test Cases in CSV"/"View AI Feature File
    // Generation"/"View AI Code Generation" back to their original
    // Generate/Start labels now that there's nothing left to view.
    this.postGenerationState();

    this.lastReceivedTokens = 0;
    this.tokenEstimateSeq++; // discard any in-flight estimate for the context just wiped
    this.getSidebarWebview()?.postMessage({ type: 'tokenEstimate', payload: { available: false, reason: 'Cleared — nothing to estimate yet.' } });

    this.postFileList();
    // Re-scanning also re-renders the sidebar's Custom Instructions
    // checkboxes from scratch (unchecked by default) — the only way to
    // clear THEIR visual state too, since the sidebar only re-renders that
    // list from a fresh 'agentic:promptFiles' message, never on its own.
    void this.refreshInstructionFiles();
  }

  // ------------------------------------------------------------------
  // Ingestion
  // ------------------------------------------------------------------

  /** `uploads` are base64-encoded exactly as read by the webview's
   * `FileReader.readAsArrayBuffer` + base64 encoder (same mechanism the RAG
   * zip drop zone already uses — see settingsPanel.ts) — the sidebar
   * webview has no Node `Buffer`/text-decoding of its own, so decoding
   * happens here in the extension host. Async because xlsx/docx/pdf
   * parsing (exceljs/mammoth/pdfjs-dist) genuinely is — every file in the
   * batch is parsed in parallel via `Promise.all`, so one large PDF
   * doesn't serialize behind the others. */
  async ingestFiles(uploads: { fileName: string; base64: string }[]): Promise<AgenticIngestResult> {
    const accepted: AgenticFileMeta[] = [];
    const rejected: { fileName: string; reason: string }[] = [];

    const results = await Promise.all(
      uploads.map(async (upload) => {
        const ext = path.extname(upload.fileName).toLowerCase();
        const legacyReason = AGENTIC_LEGACY_UNSUPPORTED_EXTENSIONS[ext];
        if (legacyReason) {
          return { ok: false as const, fileName: upload.fileName, reason: legacyReason };
        }

        let buffer: Buffer;
        try {
          buffer = Buffer.from(upload.base64, 'base64');
        } catch {
          return { ok: false as const, fileName: upload.fileName, reason: 'Could not decode the uploaded file.' };
        }
        if (buffer.byteLength > AGENTIC_MAX_RAW_FILE_BYTES) {
          return { ok: false as const, fileName: upload.fileName, reason: `Larger than ${AGENTIC_MAX_RAW_FILE_BYTES / (1024 * 1024)} MB.` };
        }

        const kind = detectAgenticFileKind(upload.fileName);
        try {
          const file = await this.buildIngestedFile(upload.fileName, kind, buffer);
          return { ok: true as const, file };
        } catch (err) {
          // A real parse failure (corrupt/password-protected file, an
          // .xlsx/.docx/.pdf that isn't actually valid despite its
          // extension, ...) — rejected with the library's own message
          // rather than silently producing an empty/garbled file.
          return {
            ok: false as const,
            fileName: upload.fileName,
            reason: `Could not read this ${kind.toUpperCase()} file: ${err instanceof Error ? err.message : String(err)}`
          };
        }
      })
    );

    for (const result of results) {
      if (result.ok) {
        this.files.set(result.file.id, result.file);
        accepted.push(this.toMeta(result.file));
      } else {
        rejected.push({ fileName: result.fileName, reason: result.reason });
      }
    }

    this.postFileList();
    void this.estimateTokens();
    return { accepted, rejected };
  }

  /** Builds the full `AgenticIngestedFile` for one successfully-decoded
   * upload — the one place that dispatches to the right parser
   * (xlsxIngestion.ts/docxIngestion.ts/pdfIngestion.ts, or a plain UTF-8
   * decode for the text-like kinds) and builds that kind's preview. Throws
   * on a genuine parse failure — the caller (ingestFiles()) turns that into
   * a rejection with the library's own error message. */
  private async buildIngestedFile(fileName: string, kind: AgenticFileKind, buffer: Buffer): Promise<AgenticIngestedFile> {
    const id = String(this.nextFileId++);
    const base = { id, fileName, kind, sizeBytes: buffer.byteLength, rawText: '', config: {} };

    if (kind === 'xlsx') {
      const parsedXlsx = await parseXlsxBuffer(buffer);
      return { ...base, parsedXlsx, xlsxPreview: buildXlsxPreview(parsedXlsx) };
    }
    if (kind === 'docx') {
      const parsedDocx = await parseDocxBuffer(buffer);
      return { ...base, parsedDocx, docxPreview: buildDocxPreview(parsedDocx) };
    }
    if (kind === 'pdf') {
      const parsedPdf = await parsePdfBuffer(buffer);
      return { ...base, parsedPdf, pdfPreview: buildPdfPreview(parsedPdf) };
    }

    const rawText = buffer.toString('utf-8');
    return { ...base, rawText, csvPreview: kind === 'csv' ? buildCsvPreview(rawText) : undefined };
  }

  removeFile(id: string): void {
    this.files.delete(id);
    this.postFileList();
    void this.estimateTokens();
  }

  updateConfig(id: string, config: AgenticIngestionConfig): void {
    const file = this.files.get(id);
    if (!file) {
      return;
    }
    file.config = config;
    void this.estimateTokens();
  }

  updateDraftUserRequest(text: string): void {
    this.lastUserRequest = text;
    void this.estimateTokens();
  }

  private toMeta(file: AgenticIngestedFile): AgenticFileMeta {
    return {
      id: file.id,
      fileName: file.fileName,
      kind: file.kind,
      sizeBytes: file.sizeBytes,
      csvPreview: file.csvPreview
    };
  }

  /** Public so ObjectSpyPanel can re-sync the sidebar's file-count display
   * after a fresh `resolveWebviewView()` (VS Code recreates the webview's
   * content when the sidebar is hidden/shown again, same as every other
   * piece of state Standard mode already re-syncs on resolve) — the
   * controller's own in-memory file map survives that; only the webview
   * handle needs telling about it again. */
  postFileList(): void {
    this.getSidebarWebview()?.postMessage({
      type: 'agentic:fileList',
      payload: Array.from(this.files.values()).map((f) => this.toMeta(f))
    });
  }

  /** Exposed for agenticIngestionPanel.ts, which needs the full ingested
   * file (raw text included) to render an accurate preview alongside its
   * config controls — never sent to the sidebar's own webview, which only
   * ever needs the lightweight metadata (`postFileList()` above). */
  getFiles(): AgenticIngestedFile[] {
    return Array.from(this.files.values());
  }

  /** Tells the sidebar whether each of the three "Generate"/"Start" buttons
   * should read as "View ..." instead — i.e. whether that output already
   * exists in memory (or, for CSV, was already written to disk this
   * session) and a click should just SHOW it rather than run a fresh
   * generation. Called after every successful generation, after
   * `reset()`/Clear Data (flips every button back to its original label),
   * and once on the sidebar's own 'agentic:ready' so a freshly (re-)loaded
   * webview immediately shows the correct labels rather than defaulting to
   * "Generate"/"Start" for output that's actually still sitting in memory. */
  postGenerationState(): void {
    this.getSidebarWebview()?.postMessage({
      type: 'agentic:generationState',
      payload: {
        hasFeatureFile: this.generatedFeaturePanel.hasContent(),
        hasCode: this.aiCodePanel.hasCode(),
        hasCsv: this.lastCsvUri !== undefined
      }
    });
  }

  // ------------------------------------------------------------------
  // Shared context assembly
  // ------------------------------------------------------------------

  private buildIngestedContext(): string {
    if (this.files.size === 0) {
      return '(No input files have been ingested yet.)';
    }
    const parts: string[] = [];
    for (const file of this.files.values()) {
      const segment = extractSegmentForFile(file);
      parts.push(`### File: ${file.fileName}${segment.truncated ? ' (truncated to the size cap)' : ''}\n${segment.text}`);
    }
    return parts.join('\n\n');
  }

  setSelectedInstructionFiles(files: string[]): void {
    this.selectedInstructionFiles = files;
    void this.estimateTokens();
  }

  /** Re-scans `.github/*.md` (Custom Instructions — checkbox list) and
   * `.github/rag/*.md` (RAG Data — read-only list) and pushes both to the
   * sidebar, exactly mirroring ObjectSpyPanel.refreshPromptFiles()'s own
   * two queries/exclusion glob for Standard mode. Called on Agentic Mode's
   * own "Refresh file list" click and once automatically when the sidebar
   * (re-)loads, so the lists are populated without an extra manual step. */
  async refreshInstructionFiles(): Promise<void> {
    const [instructionFiles, ragFiles] = await Promise.all([
      vscode.workspace.findFiles('.github/**/*.md', '.github/rag/**'),
      vscode.workspace.findFiles('.github/rag/**/*.md')
    ]);
    const relPaths = instructionFiles.map((f) => vscode.workspace.asRelativePath(f)).sort();
    const ragRelPaths = ragFiles.map((f) => vscode.workspace.asRelativePath(f)).sort();
    this.getSidebarWebview()?.postMessage({ type: 'agentic:promptFiles', payload: relPaths });
    this.getSidebarWebview()?.postMessage({ type: 'agentic:ragFiles', payload: ragRelPaths });
  }

  /** Only the CHECKED `.github/*.md` files (`selectedInstructionFiles`,
   * set via `setSelectedInstructionFiles()`) — Agentic Mode's own "Custom
   * Instructions" checkbox list works exactly like Standard mode's
   * (nothing selected by default; the user opts specific files in),
   * rather than silently including every instruction file that exists.
   * Reviewed rather than unit tested (pure vscode.workspace.fs glue,
   * mirroring objectSpyPanel.ts's own readInstructionFiles()). */
  private async readSelectedCustomInstructionFiles(): Promise<string> {
    if (!vscode.workspace.workspaceFolders?.length || this.selectedInstructionFiles.length === 0) {
      return '';
    }
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
    const contents = await Promise.all(
      this.selectedInstructionFiles.map(async (relPath) => {
        try {
          const uri = vscode.Uri.joinPath(workspaceRoot, relPath);
          const content = await readWorkspaceFileCached(uri);
          return `### ${relPath}\n${content}`;
        } catch {
          // Skip a file that vanished/moved between listing and sending.
          return '';
        }
      })
    );
    return contents.filter(Boolean).join('\n\n');
  }

  private async buildRagSection(settings: ObjectSpySettings, queryText: string): Promise<string> {
    if (!settings.ragEnabled) {
      return '';
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot || !queryText.trim()) {
      return '';
    }
    const index = await getOrBuildRagIndex(workspaceRoot, (message) => this.outputChannel.appendLine(`Agentic Mode RAG: ${message}`));
    if (!index) {
      return '';
    }
    const matches = await retrieveRagMatches(index, queryText, settings.language, settings.automationMode);
    return formatRagPromptSection(matches, settings.language);
  }

  private readSeniorQeInstructions(): string {
    return readFileCachedSync(path.join(__dirname, '..', '..', 'prompts', 'senior-qe-instructions.md'));
  }

  private readApiAutomationInstructions(): string {
    return readFileCachedSync(path.join(__dirname, '..', '..', 'prompts', 'api-automation-instructions.md'));
  }

  /** `.github/Jira_test_case_template.md` — copied from this extension's
   * own shipped default (prompts/Jira_test_case_template.md) into the
   * workspace the first time it's needed, exactly like `.github/rag/`
   * being auto-created for RAG (ragCorpusGenerator.ts) — so it's a real,
   * git-trackable, user-editable file from the very first generation
   * rather than something only this extension's binary knows about. */
  private async readOrScaffoldJiraTemplate(workspaceRoot: vscode.Uri): Promise<string> {
    const templateUri = vscode.Uri.joinPath(workspaceRoot, ...JIRA_TEMPLATE_RELATIVE_PATH);
    try {
      const bytes = await vscode.workspace.fs.readFile(templateUri);
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      const defaultContent = readFileCachedSync(path.join(__dirname, '..', '..', 'prompts', 'Jira_test_case_template.md'));
      try {
        await vscode.workspace.fs.writeFile(templateUri, new TextEncoder().encode(defaultContent));
        this.outputChannel.appendLine(`Agentic Mode: created ${templateUri.fsPath} from the built-in default template.`);
      } catch (err) {
        this.outputChannel.appendLine(`Agentic Mode: could not create ${templateUri.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return defaultContent;
    }
  }

  private async buildSystemInstructions(settings: ObjectSpySettings, ragSection: string, includeCsvTemplate: boolean): Promise<string> {
    const parts: string[] = [];
    if (includeCsvTemplate) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      parts.push(workspaceRoot ? await this.readOrScaffoldJiraTemplate(workspaceRoot) : readFileCachedSync(path.join(__dirname, '..', '..', 'prompts', 'Jira_test_case_template.md')));
    } else {
      const isApiMode = settings.automationMode === 'api';
      parts.push(isApiMode ? this.readApiAutomationInstructions() : this.readSeniorQeInstructions());
      parts.push(`Target language: ${settings.language} (version ${settings.languageVersion}).`);
    }
    const customInstructions = await this.readSelectedCustomInstructionFiles();
    if (customInstructions) {
      parts.push('## Team custom instructions / skills / prompt files\n' + customInstructions);
    }
    if (ragSection) {
      parts.push(ragSection);
    }
    return parts.join('\n\n');
  }

  // ------------------------------------------------------------------
  // Token Monitoring — reuses the SAME `tokenEstimate` message shape/UI
  // Standard mode's Token Monitoring already renders (media/main.js's
  // applyTokenEstimate()); Agentic Mode's own sidebar script
  // (media/agenticMode.js) renders it with a small dedicated copy of that
  // same rendering logic, kept deliberately separate per this feature's
  // "proper segregation" requirement rather than sharing main.js's DOM
  // wiring across two very different sidebar layouts.
  // ------------------------------------------------------------------

  async estimateTokens(): Promise<void> {
    const settings = this.settingsStore.get();
    const seq = ++this.tokenEstimateSeq;
    if (!settings.copilotEnabled || !settings.copilotModelId) {
      this.getSidebarWebview()?.postMessage({
        type: 'tokenEstimate',
        payload: { available: false, reason: 'Enable "Link with GitHub Copilot LLM" (Control Panel, Standard mode) and pick a model in Settings to see token usage.' }
      });
      return;
    }

    const ingestedContext = this.buildIngestedContext();
    const ragSection = await this.buildRagSection(settings, `${this.lastUserRequest}\n${ingestedContext}`.slice(0, 4000));
    const systemInstructions = await this.buildSystemInstructions(settings, ragSection, false);
    const fullPrompt = `${systemInstructions}\n\n${ingestedContext}\n\n${this.lastUserRequest}`;

    const result = await countModelTokens(settings.copilotModelId, fullPrompt);
    if (seq !== this.tokenEstimateSeq) {
      return; // a newer estimate has already superseded this one
    }
    if (!result) {
      this.getSidebarWebview()?.postMessage({
        type: 'tokenEstimate',
        payload: { available: false, reason: 'Could not reach the selected Copilot model to estimate tokens.' }
      });
      return;
    }
    this.getSidebarWebview()?.postMessage({
      type: 'tokenEstimate',
      payload: {
        available: true,
        sentTokens: result.count,
        receivedTokens: this.lastReceivedTokens,
        maxInputTokens: result.maxInputTokens,
        modelId: settings.copilotModelId
      }
    });
  }

  private async recordReceivedTokens(settings: ObjectSpySettings, text: string): Promise<void> {
    const result = await countModelTokens(settings.copilotModelId, text);
    this.lastReceivedTokens = result?.count ?? 0;
    this.getSidebarWebview()?.postMessage({
      type: 'tokenEstimate',
      payload: { available: true, receivedTokens: this.lastReceivedTokens, sentTokens: null, maxInputTokens: result?.maxInputTokens, modelId: settings.copilotModelId }
    });
  }

  // ------------------------------------------------------------------
  // Generation actions
  // ------------------------------------------------------------------

  private async resolveModel(settings: ObjectSpySettings): Promise<vscode.LanguageModelChat> {
    if (!settings.copilotEnabled || !settings.copilotModelId) {
      throw new CopilotUnavailableError();
    }
    const model = await findModel(settings.copilotModelId);
    if (!model) {
      throw new CopilotUnavailableError();
    }
    return model;
  }

  /** `forceRegenerate` — false (the default, used by the sidebar's own
   * "Start AI Feature File Generation"/"View AI Feature File Generation"
   * button) means: if a feature file is ALREADY sitting in memory from an
   * earlier click this session, just reveal it again (`.show()`, no new
   * LLM call, no re-run of anything) — the exact "reopen what I already
   * generated" behavior AiCodePanel/GeneratedFeaturePanel already support
   * (see GeneratedFeaturePanel.hasContent()'s own doc comment), just never
   * reached before because this method always regenerated unconditionally.
   * `true` (used ONLY by the panel's own internal "Regenerate" button —
   * see the constructor) bypasses that check to force a genuinely fresh
   * generation. */
  async generateFeatureFile(forceRegenerate = false): Promise<void> {
    if (!forceRegenerate && this.generatedFeaturePanel.hasContent()) {
      this.generatedFeaturePanel.show();
      return;
    }

    const settings = this.settingsStore.get();
    this.featureCancellation?.cancel();
    this.featureCancellation?.dispose();
    const cts = new vscode.CancellationTokenSource();
    this.featureCancellation = cts;

    this.generatedFeaturePanel.show();
    this.generatedFeaturePanel.startGenerating();
    try {
      const chatModel = await this.resolveModel(settings);
      const ingestedContext = this.buildIngestedContext();
      const ragSection = await this.buildRagSection(settings, `${this.lastUserRequest}\n${ingestedContext}`.slice(0, 4000));
      const systemInstructions = await this.buildSystemInstructions(settings, ragSection, false);
      const chain = buildAgenticFeatureFileChain(new VSCodeCopilotToolCallingModel(chatModel, cts.token));
      const result = await chain.invoke({
        systemInstructions:
          systemInstructions +
          '\n\nGenerate a single, well-structured Cucumber Gherkin .feature file (Feature/Scenario/Given-When-Then) covering the ask below. Output ONLY the .feature file content, no commentary, no fenced code block wrapper.',
        ingestedContext,
        userRequest: this.lastUserRequest || '(No additional instructions were provided — use the ingested files and any custom instructions/RAG context above.)'
      });
      this.generatedFeaturePanel.finish(result.trim());
      this.postGenerationState();
      void this.recordReceivedTokens(settings, result);
    } catch (err) {
      const message = err instanceof CopilotUnavailableError ? err.message : err instanceof Error ? err.message : String(err);
      this.generatedFeaturePanel.showError(message);
      this.outputChannel.appendLine(`Agentic Mode — feature file generation failed: ${message}`);
    }
  }

  /** See generateFeatureFile()'s doc comment — identical `forceRegenerate`
   * contract, just for "Start"/"View AI Code Generation". */
  async generateAutomationCode(forceRegenerate = false): Promise<void> {
    if (!forceRegenerate && this.aiCodePanel.hasCode()) {
      this.aiCodePanel.show();
      return;
    }

    const settings = this.settingsStore.get();
    this.codeCancellation?.cancel();
    this.codeCancellation?.dispose();
    const cts = new vscode.CancellationTokenSource();
    this.codeCancellation = cts;

    this.aiCodePanel.setLanguage(settings.language);
    this.aiCodePanel.show();
    // "Verify & Fix Code" isn't wired up for Agentic Mode yet (this
    // instance's onVerify is a deliberate no-op — see the constructor) —
    // disabled rather than left silently non-functional, so clicking it
    // never looks like it did nothing.
    this.aiCodePanel.setVerifyButtonEnabled(false);
    this.aiCodePanel.startGenerating();
    try {
      const chatModel = await this.resolveModel(settings);
      const ingestedContext = this.buildIngestedContext();
      const ragSection = await this.buildRagSection(settings, `${this.lastUserRequest}\n${ingestedContext}`.slice(0, 4000));
      const systemInstructions = await this.buildSystemInstructions(settings, ragSection, false);
      const chain = buildAgenticAutomationCodeChain(new VSCodeCopilotToolCallingModel(chatModel, cts.token));
      const result = await chain.invoke({
        systemInstructions:
          systemInstructions +
          `\n\nGenerate complete, runnable ${settings.language} (version ${settings.languageVersion}) automation code satisfying the ask below, following every standard above. Output ONLY the code inside a single fenced code block.`,
        ingestedContext,
        userRequest: this.lastUserRequest || '(No additional instructions were provided — use the ingested files and any custom instructions/RAG context above.)'
      });
      this.aiCodePanel.finish(extractCodeBlock(result));
      this.postGenerationState();
      void this.recordReceivedTokens(settings, result);
    } catch (err) {
      const message = err instanceof CopilotUnavailableError ? err.message : err instanceof Error ? err.message : String(err);
      this.aiCodePanel.showError(message);
      this.outputChannel.appendLine(`Agentic Mode — automation code generation failed: ${message}`);
    }
  }

  /** `forceRegenerate` — false (the sidebar's own button, "Generate"/"View
   * Manual Test Cases in CSV") reopens the exact CSV file already written
   * this session (`lastCsvUri`) with no new LLM call at all when one
   * exists; `true` forces a genuinely fresh generation. Unlike the feature
   * file/code chains, there's no separate "Regenerate" affordance for CSV
   * today — the only way to force `true` is via a fresh generation after
   * "Clear Data" resets `lastCsvUri` to undefined. */
  async generateTestCaseCsv(forceRegenerate = false): Promise<void> {
    if (!forceRegenerate && this.lastCsvUri) {
      try {
        const document = await vscode.workspace.openTextDocument(this.lastCsvUri);
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        return;
      } catch {
        // The file was moved/deleted outside SoftPlay since it was
        // written — fall through and generate a fresh one rather than
        // leaving the button permanently stuck on "View" with nothing to
        // show.
        this.lastCsvUri = undefined;
        this.postGenerationState();
      }
    }

    const settings = this.settingsStore.get();
    this.csvCancellation?.cancel();
    this.csvCancellation?.dispose();
    const cts = new vscode.CancellationTokenSource();
    this.csvCancellation = cts;

    const webview = this.getSidebarWebview();
    webview?.postMessage({ type: 'agentic:csvStatus', payload: { state: 'generating' } });
    try {
      const chatModel = await this.resolveModel(settings);
      const ingestedContext = this.buildIngestedContext();
      const ragSection = await this.buildRagSection(settings, `${this.lastUserRequest}\n${ingestedContext}`.slice(0, 4000));
      const systemInstructions = await this.buildSystemInstructions(settings, ragSection, true);
      const chain = buildAgenticTestCaseCsvChain(new VSCodeCopilotToolCallingModel(chatModel, cts.token));
      const result = await chain.invoke({
        systemInstructions,
        ingestedContext,
        userRequest: this.lastUserRequest || '(No additional instructions were provided — cover every scenario found in the ingested files.)'
      });
      const normalized = normalizeTestCaseCsvResponse(result);
      void this.recordReceivedTokens(settings, result);

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceRoot) {
        throw new Error('Open a workspace folder first — the CSV is saved into it.');
      }
      const outDir = vscode.Uri.joinPath(workspaceRoot, '.github', 'generated-test-cases');
      await vscode.workspace.fs.createDirectory(outDir);
      const fileName = `manual-test-cases-${timestampForFileName()}.csv`;
      const outUri = vscode.Uri.joinPath(outDir, fileName);
      await vscode.workspace.fs.writeFile(outUri, new TextEncoder().encode(normalized.content));
      this.lastCsvUri = outUri;
      this.postGenerationState();

      webview?.postMessage({
        type: 'agentic:csvStatus',
        payload: { state: 'done', message: `Saved ${normalized.rowCount} step row(s), ${normalized.columnCount} column(s) to ${vscode.workspace.asRelativePath(outUri)}.` }
      });
      const document = await vscode.workspace.openTextDocument(outUri);
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    } catch (err) {
      const message =
        err instanceof InvalidTestCaseCsvError || err instanceof CopilotUnavailableError || err instanceof Error ? err.message : String(err);
      webview?.postMessage({ type: 'agentic:csvStatus', payload: { state: 'error', message } });
      this.outputChannel.appendLine(`Agentic Mode — manual test-case CSV generation failed: ${message}`);
    }
  }
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
