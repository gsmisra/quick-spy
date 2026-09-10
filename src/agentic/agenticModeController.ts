import * as vscode from 'vscode';
import * as path from 'path';
import { ObjectSpySettings, SettingsStore } from '../settings/settingsStore';
import { readFileCachedSync, readWorkspaceFileCached } from '../cache/fileCache';
import { CopilotUnavailableError, countModelTokens, extractCodeBlock, findModel } from '../llm/copilotClient';
import { VSCodeCopilotToolCallingModel } from '../agent/vscodeCopilotToolCallingModel';
import { getOrBuildRagIndex } from '../rag/ragIndexer';
import { formatRagPromptSection } from '../rag/ragRetriever';
import { planOperationsFromAgenticSegments, chunkTextForOperations } from '../rag/ragOperationPlanner';
import { retrieveForOperations } from '../rag/ragOperationRetrieval';
import { resolveHybridRetrieveMatches } from '../rag/ragHybridConfig';
import { RAG_DRAFTS_FOLDER_SEGMENTS } from '../rag/ragCorpusGenerator';
import { parseRagFile } from '../rag/ragFrontmatter';
import { getOrBuildFreshnessReport } from '../rag/ragFreshnessService';
import { packOperationCandidates } from '../rag/ragOperationPacking';
import { PROMPT_TOKEN_SAFETY_MARGIN } from '../llm/tokenBudget';
import { AiCodePanel } from '../panel/aiCodePanel';
import { GeneratedFeaturePanel } from '../panel/generatedFeaturePanel';
import { buildAgenticAutomationCodeChain, buildAgenticFeatureFileChain, buildAgenticTestCaseCsvChain, buildAgenticHumanTurnText } from './agenticChains';
import { buildCsvPreview, detectAgenticFileKind, extractSegmentForFile } from './textIngestion';
import { parseXlsxBuffer, buildXlsxPreview } from './xlsxIngestion';
import { parseDocxBuffer, buildDocxPreview } from './docxIngestion';
import { parsePdfBuffer, buildPdfPreview } from './pdfIngestion';
import { InvalidTestCaseCsvError, normalizeTestCaseCsvResponse } from './csvTestCaseGenerator';
import { isStaleRequest } from './agenticRequestEpoch';
import { buildAgenticActionShape } from './agenticActionShape';
import {
  AGENTIC_LEGACY_UNSUPPORTED_EXTENSIONS,
  AGENTIC_MAX_SEGMENT_CHARS,
  AgenticFileKind,
  AgenticFileMeta,
  AgenticIngestedFile,
  AgenticIngestionConfig
} from './agenticTypes';

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
  // A15: bumped by reset()/Clear Data (and dispose()) so any `ingestFiles()`
  // call already IN FLIGHT when the session was reset can tell, once its own
  // async parsing finally finishes, that it's no longer the current session
  // — and discard its own results instead of unconditionally re-inserting a
  // stale upload into a `files` Map the user just explicitly emptied. See
  // `ingestFiles()`'s own doc comment for the exact reproduced gap this
  // closes.
  private sessionEpoch = 0;
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
    this.sessionEpoch++; // A15 — see ingestFiles()'s own doc comment
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
    this.sessionEpoch++; // A15 — see ingestFiles()'s own doc comment
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

  // A13: "is this request still current?" (isStaleRequest()) now lives in
  // its own pure, directly-unit-tested module — see agenticRequestEpoch.ts
  // for the full reasoning on why this must be checked explicitly, every
  // time, immediately before any output/file/UI side effect, rather than
  // assumed from whether `chain.invoke()` itself threw.

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
   * doesn't serialize behind the others.
   *
   * A15: `sessionEpoch` is captured BEFORE any of that async parsing
   * starts, and re-checked immediately after `Promise.all()` resolves,
   * before this batch's results are inserted into `this.files` or any
   * side effect (`postFileList()`/`estimateTokens()`) runs. The reproduced
   * gap this closes: start an upload, call `reset()`/Clear Data WHILE
   * parsing is still in flight (a real xlsx/docx/pdf parse genuinely takes
   * time), then let the parse finish — the OLD code unconditionally
   * inserted the (now stale) parsed files into `this.files` regardless,
   * silently repopulating state the user had JUST explicitly emptied, and
   * broadcast a file-list/token update for a batch that no longer belongs
   * to the current session. `reset()`/`dispose()` both bump `sessionEpoch`
   * — a mismatch here means EXACTLY that happened, and the whole batch
   * (not just some of it) is discarded silently: no `files.set()`, no
   * `postFileList()`/`estimateTokens()`, and an honestly empty result
   * (never a stale "accepted"/"rejected" list a caller might act on, e.g.
   * objectSpyPanel.ts's own "open the Ingestion Configuration panel when
   * something was accepted" — nothing here should still be considered
   * accepted). A LEGITIMATE, still-current upload is completely
   * unaffected — this only ever discards a batch whose OWN session has
   * already ended. */
  async ingestFiles(uploads: { fileName: string; base64: string }[]): Promise<AgenticIngestResult> {
    const epoch = this.sessionEpoch;
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

    // A15: checked HERE — after every file finished parsing, before ANY of
    // it is inserted or reported. See this method's own doc comment.
    if (epoch !== this.sessionEpoch) {
      return { accepted: [], rejected: [] };
    }

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

  /**
   * Every currently ingested file contributes — this loop never skips a
   * file, filters by kind, or caps how MANY files go in; the only per-file
   * limit is `AGENTIC_MAX_SEGMENT_CHARS` (60,000 chars — see
   * agenticTypes.ts) as a last-resort safety net against one pathological
   * file (an unconfigured multi-thousand-row spreadsheet, a huge PDF)
   * blowing out the whole request on its own.
   *
   * `audit`, when true, logs a line PER FILE to the Output channel — real
   * character counts, not a claim: how large the file's selected segment
   * is, whether the safety cap actually cut it, and the running total — so
   * "did my file's content actually make it into the prompt, in full or
   * truncated" is something you can verify directly in the SoftPlay Output
   * channel, not something you have to take on trust. Deliberately opt-in
   * (only the three generate*() methods below pass `true`) — this method
   * is ALSO called by `estimateTokens()` on essentially every keystroke/
   * config change (Token Monitoring), where logging unconditionally would
   * flood the Output channel with noise for zero benefit.
   */
  private buildIngestedContext(audit = false): string {
    if (this.files.size === 0) {
      if (audit) {
        this.outputChannel.appendLine('Agentic Mode — context audit: no files ingested; sending custom instructions/RAG/chat-box content only.');
      }
      return '(No input files have been ingested yet.)';
    }
    const parts: string[] = [];
    let totalChars = 0;
    if (audit) {
      this.outputChannel.appendLine(`Agentic Mode — context audit: assembling ${this.files.size} file(s) for this generation.`);
    }
    for (const file of this.files.values()) {
      const segment = extractSegmentForFile(file);
      totalChars += segment.text.length;
      if (audit) {
        this.outputChannel.appendLine(
          `  - ${file.fileName} (${file.kind}): ${segment.text.length.toLocaleString()} char(s) included` +
            (segment.truncated
              ? ` — TRUNCATED at the ${AGENTIC_MAX_SEGMENT_CHARS.toLocaleString()}-char safety cap; narrow this file's range in Ingestion Configuration to fit more of it.`
              : ' (full selection, not truncated).')
        );
      }
      parts.push(`### File: ${file.fileName}${segment.truncated ? ' (truncated to the size cap)' : ''}\n${segment.text}`);
    }
    if (audit) {
      this.outputChannel.appendLine(`Agentic Mode — context audit: ${totalChars.toLocaleString()} total char(s) of file content included in this request.`);
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
   * two queries/exclusion glob (including the `.github/rag-drafts/**`
   * exclusion — see that method's own doc comment on why a rejected,
   * quarantined draft must never be selectable here) for Standard mode.
   * Called on Agentic Mode's own "Refresh file list" click and once
   * automatically when the sidebar (re-)loads, so the lists are populated
   * without an extra manual step. */
  async refreshInstructionFiles(): Promise<void> {
    const excludedRagFolders = `{.github/rag/**,${RAG_DRAFTS_FOLDER_SEGMENTS.join('/')}/**}`;
    const [instructionFiles, ragFiles] = await Promise.all([
      vscode.workspace.findFiles('.github/**/*.md', excludedRagFolders),
      vscode.workspace.findFiles('.github/rag/**/*.md')
    ]);
    const relPaths = instructionFiles.map((f) => vscode.workspace.asRelativePath(f)).sort();
    // F16 — see ObjectSpyPanel.refreshPromptFiles()'s own doc comment: only
    // list a RAG file here if it will actually be indexed, never a
    // visible-library/empty-index mismatch a user has no way to notice.
    const indexed: string[] = [];
    for (const uri of ragFiles) {
      const relPath = vscode.workspace.asRelativePath(uri);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const parsed = parseRagFile(new TextDecoder('utf-8').decode(bytes));
        if (parsed.ok) {
          indexed.push(relPath);
        } else {
          this.outputChannel.appendLine(`Agentic Mode RAG: "${relPath}" was found under .github/rag/ but is NOT indexed (${parsed.error}) — it will never be retrieved.`);
        }
      } catch (err) {
        this.outputChannel.appendLine(`Agentic Mode RAG: "${relPath}" could not be read (${err instanceof Error ? err.message : String(err)}) — it will never be retrieved.`);
      }
    }
    this.getSidebarWebview()?.postMessage({ type: 'agentic:promptFiles', payload: relPaths });
    this.getSidebarWebview()?.postMessage({ type: 'agentic:ragFiles', payload: indexed.sort() });
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

  /** Per-file character budget when building the RAG retrieval QUERY
   * specifically — distinct from `buildIngestedContext()` above, which
   * always includes every file's FULL selected segment in the actual
   * generation prompt regardless. Blindly slicing the fully-concatenated
   * `lastUserRequest + ingestedContext` string to a flat total (this used
   * to be `.slice(0, 4000)`) means whichever files happened to be
   * ingested/iterated FIRST consumed the entire budget, and any file after
   * that point contributed ZERO retrieval signal at all — a helper only
   * relevant to a LATER file's own requirements could never be found by
   * RAG, even though that file's full content still reaches the real
   * generation prompt untouched. A fixed, modest budget PER CHUNK instead
   * guarantees every ingested file contributes SOME query signal regardless
   * of how many files there are or what order they were added in. Modest
   * on purpose — this is retrieval signal, not the actual content sent to
   * the model, so a bounded excerpt is enough; the local, zero-cost TF-IDF
   * embedding (see rag/tfidfEmbeddings.ts) has no reason to need more per
   * individual chunk. */
  private static readonly RAG_QUERY_CHARS_PER_FILE = 600;

  /** Caps how many operations ONE file's segment can contribute (F13) —
   * `chunkTextForOperations()` adaptively grows chunk size to stay within
   * this, so a single very large ingested file (up to
   * `AGENTIC_MAX_SEGMENT_CHARS` = 60,000 chars) still produces FULL
   * coverage of its own content, in a bounded number of retrieval
   * operations, rather than either (a) the pre-F13 bug — one operation
   * covering only the first `RAG_QUERY_CHARS_PER_FILE` characters, losing
   * everything after that entirely — or (b) an unbounded number of
   * operations (a naive one-chunk-per-600-chars split of a 60,000-char
   * file would be 100 operations on its own) that would dominate coverage-
   * ordering and packing with one file's worth of chunks. */
  private static readonly MAX_RAG_CHUNKS_PER_FILE = 12;

  /** Decomposes the CURRENT ingested files + free-text request into
   * independently-retrievable operations (rag/ragOperationPlanner.ts,
   * Phase 3) — one operation for the user's own explicit request, plus one
   * or more operations PER ingested file, covering that file's ENTIRE
   * selected segment (F13 fix) via `chunkTextForOperations()` rather than
   * only its first `RAG_QUERY_CHARS_PER_FILE` characters (the bug this
   * replaces: a distinctive requirement mentioned only near the end of a
   * long ingested document previously never influenced RAG retrieval at
   * all, even though the model itself received that file's FULL content
   * for actual generation — see `buildIngestedContext()`). Per-operation
   * retrieval on top of that removes the further "only 2 matches total, no
   * matter how many distinct files/needs" ceiling a single whole-query
   * retrieval call used to impose. */
  private buildOperationPlan() {
    const fileSegments = Array.from(this.files.values()).flatMap((file) => {
      const fullText = extractSegmentForFile(file).text;
      const chunks = chunkTextForOperations(fullText, AgenticModeController.RAG_QUERY_CHARS_PER_FILE, AgenticModeController.MAX_RAG_CHUNKS_PER_FILE);
      return chunks.map((text, i) => ({ fileName: chunks.length > 1 ? `${file.fileName} (part ${i + 1}/${chunks.length})` : file.fileName, text }));
    });
    return planOperationsFromAgenticSegments(this.lastUserRequest, fileSegments);
  }

  /** Retrieves per operation and packs against the ACTUAL resolved model's
   * real remaining token budget when `mandatoryTokens` (the caller's own
   * already-measured cost of everything else in the prompt) is available;
   * falls back to formatRagPromptSection()'s character-based packing
   * (still benefiting from per-operation retrieval's wider coverage) when
   * it isn't. `model`, when the caller already resolved one (every
   * generation call site here does, via `resolveModel()`, before this is
   * called), is reused rather than re-resolved — see
   * objectSpyPanel.ts's own `buildRagSection()` for the identical pattern
   * and its own doc comment on the full reasoning. */
  private async buildRagSection(
    settings: ObjectSpySettings,
    mandatoryTokens: number | undefined,
    model?: vscode.LanguageModelChat,
    cancellationToken?: vscode.CancellationToken
  ): Promise<string> {
    if (!settings.ragEnabled) {
      return '';
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
      return '';
    }
    const index = await getOrBuildRagIndex(workspaceRoot, (message) => this.outputChannel.appendLine(`Agentic Mode RAG: ${message}`));
    if (!index) {
      return '';
    }

    const plan = this.buildOperationPlan();
    if (plan.operations.length === 0) {
      return '';
    }
    // Phase 6 — see objectSpyPanel.ts's buildRagSection() for the identical
    // pattern and its own doc comment: `undefined` (hybrid mode off, the
    // default) falls straight through to plain lexical retrieval.
    //
    // A10: `cancellationToken` (this SAME generation request's own — every
    // real call site below passes one) is bridged into a plain
    // `AbortSignal` and forwarded to every per-operation semantic-embedding
    // call this resolves to; `onSemanticFailure` reports a real (non-
    // cancellation) semantic failure ONCE for this whole generation — see
    // ragHybridConfig.ts's own doc comments for exactly what each does and
    // why cancellation must never trigger this fallback-reporting path.
    const retrieveMatches = await resolveHybridRetrieveMatches(this.context, settings, {
      cancellationToken,
      onSemanticFailure: (message) =>
        this.outputChannel.appendLine(`Agentic Mode RAG: semantic (hybrid) retrieval failed for this request (${message}) — falling back to lexical-only matching for the rest of it.`)
    });
    if (retrieveMatches) {
      this.outputChannel.appendLine('Agentic Mode RAG: hybrid (lexical + semantic, RRF-fused) retrieval is active for this request.');
    }

    // A08 — see objectSpyPanel.ts's buildRagSection() for the identical
    // pattern and its own doc comment: fetched BEFORE retrieval (not
    // after) and threaded INTO retrieveForOperations() itself, so a known
    // stale/missing recipe is excluded from EACH operation's own
    // per-operation top-k (and, in hybrid mode, from semantic embedding)
    // rather than discarded from an already-truncated result afterward —
    // the fix for a real reproduced gap where a fresh, usable recipe
    // ranked just outside the per-operation top-k was never even
    // retrieved, so no amount of later filtering could recover it.
    const staleFilePaths = await this.getStaleRagFilePaths(workspaceRoot);

    const candidates = await retrieveForOperations(index, plan.operations, settings.language, settings.automationMode, undefined, retrieveMatches, staleFilePaths);
    if (candidates.length === 0) {
      return '';
    }
    this.outputChannel.appendLine(
      `Agentic Mode RAG: ${plan.operations.length} operation(s) planned, ${candidates.length} distinct candidate(s) retrieved — ${candidates.map((c) => c.match.id).join(', ')}.`
    );

    const resolvedModel = mandatoryTokens !== undefined ? (model ?? (await findModel(settings.copilotModelId))) : undefined;
    if (!resolvedModel || mandatoryTokens === undefined) {
      const eligibleCandidates = candidates.filter((c) => !staleFilePaths.has(c.match.filePath));
      return formatRagPromptSection(
        eligibleCandidates.map((c) => c.match),
        settings.language
      ).section;
    }

    const packed = await packOperationCandidates(candidates, plan.operations, settings.language, {
      maxInputTokens: resolvedModel.maxInputTokens,
      safetyMargin: PROMPT_TOKEN_SAFETY_MARGIN,
      mandatoryTokens,
      staleFilePaths,
      countTokens: async (text) => {
        try {
          return await resolvedModel.countTokens(text);
        } catch {
          return undefined;
        }
      }
    });
    if (packed.includedMatches.length < candidates.length) {
      this.outputChannel.appendLine(
        `Agentic Mode RAG: ${candidates.length - packed.includedMatches.length} candidate(s) omitted from the prompt — ` +
          `${packed.diagnostics.omitted.map((o) => `${o.id} (${o.reason})`).join(', ')}.`
      );
    }
    return packed.section;
  }

  /** See ObjectSpyPanel.getStaleRagFilePaths()'s own doc comment — the
   * identical pattern for Agentic Mode. */
  private async getStaleRagFilePaths(workspaceRoot: vscode.Uri): Promise<Set<string>> {
    try {
      const report = await getOrBuildFreshnessReport(workspaceRoot, {
        onWarn: (message) => this.outputChannel.appendLine(`Agentic Mode RAG Source Freshness: ${message}`)
      });
      return new Set(report.entries.filter((e) => e.state === 'stale' || e.state === 'missing').map((e) => e.filePath));
    } catch (err) {
      this.outputChannel.appendLine(`Agentic Mode RAG Source Freshness: could not check freshness for this request (${err instanceof Error ? err.message : String(err)}) — proceeding without excluding any recipe.`);
      return new Set();
    }
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

    // Resolve ONE model and reuse it for every measurement below (F12) —
    // the old code called countModelTokens() by model id string twice,
    // each independently re-resolving via findModel() internally.
    const model = await findModel(settings.copilotModelId);
    if (!model) {
      this.getSidebarWebview()?.postMessage({
        type: 'tokenEstimate',
        payload: { available: false, reason: 'Could not reach the selected Copilot model to estimate tokens.' }
      });
      return;
    }

    const ingestedContext = this.buildIngestedContext();
    // Measure the MANDATORY (non-RAG) cost first, using the REAL final
    // two-message shape (F12) — see buildRagSection()'s own doc comment on
    // why packing needs this to know how much of the model's real context
    // window is actually left for RAG content.
    const mandatorySystemInstructions = await this.buildSystemInstructions(settings, '', false);
    const mandatoryTokens = await this.measureAgenticRequestTokens(model, mandatorySystemInstructions, ingestedContext, this.lastUserRequest);
    const ragSection = await this.buildRagSection(settings, mandatoryTokens, model);
    const systemInstructions = await this.buildSystemInstructions(settings, ragSection, false);

    const sentTokens = await this.measureAgenticRequestTokens(model, systemInstructions, ingestedContext, this.lastUserRequest);
    if (seq !== this.tokenEstimateSeq) {
      return; // a newer estimate has already superseded this one
    }
    if (sentTokens === undefined) {
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
        sentTokens,
        receivedTokens: this.lastReceivedTokens,
        maxInputTokens: model.maxInputTokens,
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

  // A14: the complete, immutable per-action shape (directive suffix,
  // whether to include the CSV template, the effective/fallback-
  // substituted user request) now lives in its own pure, directly-unit-
  // tested module — see agenticActionShape.ts for the full reasoning on
  // why this must be built ONCE and reused for both the mandatory-only
  // measurement pass and the actual chain.invoke() call.

  /** Measures a would-be agentic request's token cost using the SAME
   * message shape agenticChains.ts's `AGENTIC_PROMPT` actually sends at
   * request time — TWO SEPARATE messages (`systemInstructions`, then the
   * human turn's own literal wrapper text around `ingestedContext`/
   * `userRequest` — see `vscodeCopilotToolCallingModel.ts`'s
   * `toVSCodeMessage()`, which turns BOTH into separate `User`-role
   * `vscode.LanguageModelChatMessage`s), counted and SUMMED exactly like
   * `assertMessagesFitModel()` itself counts a real multi-message request
   * (F12 fix). Used for BOTH the "mandatory-only" pass (an empty/no-RAG
   * `systemInstructions`, to learn how much budget is left for RAG
   * content) and the FINAL pass (the real, RAG-included
   * `systemInstructions`, for the actual token estimate/preflight) — same
   * message shape either way, only `systemInstructions` differs.
   *
   * The OLD estimate concatenated all three pieces into ONE string with
   * plain "\n\n" joins — entirely omitting the human turn's own literal
   * wrapper text ("Ingested input files (already trimmed...)...", "---",
   * "The user's request:") and never reflecting that these are two
   * SEPARATE messages, not one — a real, reproducible undercount of what
   * actually gets sent. Reuses the ALREADY-resolved `model` handle (every
   * call site here resolves one up front) rather than a second,
   * potentially different, resolution by model id string.
   *
   * Returns `undefined` if either count fails, matching
   * `countModelTokens()`'s own "can't measure" convention — an unmeasured
   * mandatory cost is exactly what makes `buildRagSection()` fall back to
   * `formatRagPromptSection()`'s own character-based packing instead of
   * the real-token-budget path. */
  private async measureAgenticRequestTokens(model: vscode.LanguageModelChat, systemInstructions: string, ingestedContext: string, userRequest: string): Promise<number | undefined> {
    try {
      const humanTurnText = buildAgenticHumanTurnText(ingestedContext, userRequest);
      const [systemCount, humanCount] = await Promise.all([model.countTokens(systemInstructions), model.countTokens(humanTurnText)]);
      return systemCount + humanCount;
    } catch {
      return undefined;
    }
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
      const ingestedContext = this.buildIngestedContext(true);
      // A14: the complete, immutable shape of this ONE action — computed
      // ONCE and reused for BOTH the mandatory-only measurement below AND
      // the actual chain.invoke() call — see buildActionShape()'s own doc
      // comment for the exact bug this closes (measuring against a
      // SMALLER structure than what's actually sent).
      const shape = buildAgenticActionShape('feature', this.lastUserRequest, settings.language, settings.languageVersion);
      // Measure the MANDATORY (non-RAG) cost first, reusing the model
      // already resolved above — see buildRagSection()'s own doc comment.
      const mandatorySystemInstructions = (await this.buildSystemInstructions(settings, '', shape.includeCsvTemplate)) + shape.directiveSuffix;
      const mandatoryTokens = await this.measureAgenticRequestTokens(chatModel, mandatorySystemInstructions, ingestedContext, shape.effectiveUserRequest);
      const ragSection = await this.buildRagSection(settings, mandatoryTokens, chatModel, cts.token);
      const systemInstructions = (await this.buildSystemInstructions(settings, ragSection, shape.includeCsvTemplate)) + shape.directiveSuffix;
      this.outputChannel.appendLine('Agentic Mode — invoking the LangChain feature-file chain (ChatPromptTemplate -> Copilot -> StringOutputParser)...');
      const chain = buildAgenticFeatureFileChain(new VSCodeCopilotToolCallingModel(chatModel, cts.token));
      const result = await chain.invoke({
        systemInstructions,
        ingestedContext,
        userRequest: shape.effectiveUserRequest
      });
      // A13: checked HERE — immediately before the FIRST output/UI side
      // effect this method commits — never assumed from whether
      // `chain.invoke()` itself threw (it may not have: see
      // agenticRequestEpoch.ts's own doc comment on why cancellation/reset
      // must not rely on the provider rejecting its stream). A stale
      // result is discarded silently — reset()/a newer "Start"/"Regenerate"
      // click already owns whatever the user is now looking at, and this
      // response no longer corresponds to it.
      if (isStaleRequest(cts, this.featureCancellation)) {
        return;
      }
      this.generatedFeaturePanel.finish(result.trim());
      this.postGenerationState();
      void this.recordReceivedTokens(settings, result);
      cts.dispose(); // A13: a request that actually completed no longer needs its own token source kept around
    } catch (err) {
      // A13: an old request's own REJECTION must not overwrite a NEWER,
      // still-in-flight (or already-finished) request's panel state either
      // — checked before `showError()` for the exact same reason as the
      // success path above.
      if (isStaleRequest(cts, this.featureCancellation)) {
        return;
      }
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
      const ingestedContext = this.buildIngestedContext(true);
      // A14 — see generateFeatureFile()'s identical shape construction and
      // buildActionShape()'s own doc comment for the full reasoning.
      const shape = buildAgenticActionShape('code', this.lastUserRequest, settings.language, settings.languageVersion);
      // Measure the MANDATORY (non-RAG) cost first, reusing the model
      // already resolved above — see buildRagSection()'s own doc comment.
      const mandatorySystemInstructions = (await this.buildSystemInstructions(settings, '', shape.includeCsvTemplate)) + shape.directiveSuffix;
      const mandatoryTokens = await this.measureAgenticRequestTokens(chatModel, mandatorySystemInstructions, ingestedContext, shape.effectiveUserRequest);
      const ragSection = await this.buildRagSection(settings, mandatoryTokens, chatModel, cts.token);
      const systemInstructions = (await this.buildSystemInstructions(settings, ragSection, shape.includeCsvTemplate)) + shape.directiveSuffix;
      this.outputChannel.appendLine('Agentic Mode — invoking the LangChain automation-code chain (ChatPromptTemplate -> Copilot -> StringOutputParser)...');
      const chain = buildAgenticAutomationCodeChain(new VSCodeCopilotToolCallingModel(chatModel, cts.token));
      const result = await chain.invoke({
        systemInstructions,
        ingestedContext,
        userRequest: shape.effectiveUserRequest
      });
      // A13 — see generateFeatureFile()'s identical check and
      // agenticRequestEpoch.ts's own doc comment for the full reasoning.
      if (isStaleRequest(cts, this.codeCancellation)) {
        return;
      }
      this.aiCodePanel.finish(extractCodeBlock(result));
      this.postGenerationState();
      void this.recordReceivedTokens(settings, result);
      cts.dispose();
    } catch (err) {
      if (isStaleRequest(cts, this.codeCancellation)) {
        return;
      }
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
      const ingestedContext = this.buildIngestedContext(true);
      // A14 — see generateFeatureFile()'s identical shape construction and
      // buildActionShape()'s own doc comment for the full reasoning. CSV
      // has no directiveSuffix to append (see that method's own comment on
      // why), but still shares the SAME "measure exactly what gets sent"
      // fix for its own effective (fallback-substituted) user request.
      const shape = buildAgenticActionShape('csv', this.lastUserRequest, settings.language, settings.languageVersion);
      // Measure the MANDATORY (non-RAG) cost first, reusing the model
      // already resolved above — see buildRagSection()'s own doc comment.
      const mandatorySystemInstructions = (await this.buildSystemInstructions(settings, '', shape.includeCsvTemplate)) + shape.directiveSuffix;
      const mandatoryTokens = await this.measureAgenticRequestTokens(chatModel, mandatorySystemInstructions, ingestedContext, shape.effectiveUserRequest);
      const ragSection = await this.buildRagSection(settings, mandatoryTokens, chatModel, cts.token);
      const systemInstructions = (await this.buildSystemInstructions(settings, ragSection, shape.includeCsvTemplate)) + shape.directiveSuffix;
      this.outputChannel.appendLine('Agentic Mode — invoking the LangChain manual-test-case-CSV chain (ChatPromptTemplate -> Copilot -> StringOutputParser)...');
      const chain = buildAgenticTestCaseCsvChain(new VSCodeCopilotToolCallingModel(chatModel, cts.token));
      const result = await chain.invoke({
        systemInstructions,
        ingestedContext,
        userRequest: shape.effectiveUserRequest
      });
      // A13 — see generateFeatureFile()'s identical check and
      // agenticRequestEpoch.ts's own doc comment for the full reasoning.
      // Checked here BEFORE directory creation/write/status-reporting even
      // starts.
      if (isStaleRequest(cts, this.csvCancellation)) {
        return;
      }
      const normalized = normalizeTestCaseCsvResponse(result);
      void this.recordReceivedTokens(settings, result);

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceRoot) {
        throw new Error('Open a workspace folder first — the CSV is saved into it.');
      }
      const outDir = vscode.Uri.joinPath(workspaceRoot, '.github', 'generated-test-cases');
      await vscode.workspace.fs.createDirectory(outDir);
      // A13: re-checked AFTER `createDirectory()` — a real async boundary a
      // reset()/Clear Data could land in between the check above and the
      // ACTUAL write below (the review's own explicit "reset immediately
      // before write" scenario) — never assume nothing changed just
      // because it didn't a few lines up.
      if (isStaleRequest(cts, this.csvCancellation)) {
        return;
      }
      const fileName = `manual-test-cases-${timestampForFileName()}.csv`;
      const outUri = vscode.Uri.joinPath(outDir, fileName);
      await vscode.workspace.fs.writeFile(outUri, new TextEncoder().encode(normalized.content));
      this.lastCsvUri = outUri;
      this.postGenerationState();
      cts.dispose();

      webview?.postMessage({
        type: 'agentic:csvStatus',
        payload: { state: 'done', message: `Saved ${normalized.rowCount} step row(s), ${normalized.columnCount} column(s) to ${vscode.workspace.asRelativePath(outUri)}.` }
      });
      const document = await vscode.workspace.openTextDocument(outUri);
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    } catch (err) {
      // A13: an old/superseded/cancelled request's own rejection (or an
      // error thrown by this method's own body, e.g. "no workspace open")
      // must not report a stale status over a newer request's own
      // in-progress or already-completed one.
      if (isStaleRequest(cts, this.csvCancellation)) {
        return;
      }
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
