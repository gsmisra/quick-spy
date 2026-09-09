import * as vscode from 'vscode';

/**
 * Total Agentic Mode's sidebar HTML — a deliberately SEPARATE template from
 * ObjectSpyPanel's own Standard-mode markup (its own file, its own script
 * `media/agenticMode.js`, never main.js) per this feature's "proper
 * segregation" requirement. ObjectSpyPanel.getHtml() picks between the two
 * templates based on `settings.agenticModeEnabled`; nothing else about
 * Standard mode's own HTML changes because this file exists.
 *
 * Reuses `media/main.css` purely for visual consistency (buttons, the chat
 * input, the Token Monitoring bar all use the exact same classes Standard
 * mode does) — a stylesheet is inert markup, not behavior, so sharing it
 * carries none of the coupling risk sharing main.js's DOM-wiring would.
 */
export function getAgenticModeSidebarHtml(params: {
  webview: vscode.Webview;
  styleUri: vscode.Uri;
  scriptUri: vscode.Uri;
  nonce: string;
  version: string;
}): string {
  const { webview, styleUri, scriptUri, nonce, version } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title></title>
  <style>
    /* Agentic Mode's own small additions on top of main.css — kept here
       rather than added to main.css itself so Standard mode's stylesheet
       stays completely untouched by this feature. */
    .note { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin: 6px 0; }
    .status-text { font-size: 0.82em; color: var(--vscode-descriptionForeground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border);
      padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 0.9em;
    }
    .rag-dropzone {
      display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px;
      padding: 22px 16px; border: 2px dashed var(--vscode-panel-border); border-radius: 6px;
      text-align: center; color: var(--vscode-descriptionForeground); font-size: 0.88em;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .rag-dropzone.dragover { border-color: var(--td-green, #54b948); background: rgba(84, 185, 72, 0.08); }
    .agentic-rejected-list { margin-top: 10px; font-size: 0.8em; color: var(--vscode-errorForeground, #f14c4c); }
    .agentic-rejected-line { padding: 2px 0; }
    .agentic-csv-status { margin-top: 10px; font-size: 0.85em; padding: 6px 10px; border-radius: 4px; background: var(--vscode-input-background); }
    .agentic-csv-status.success { color: #3fb950; }
    .agentic-csv-status.error { color: var(--vscode-errorForeground, #f14c4c); }
  </style>
</head>
<body>
  <div class="toolbar-row title-row app-title-row">
    <span class="title-group">
      <span class="title-line">
        <span class="title">TD Securities Agentic Test Automation</span>
        <span class="version-badge">v${version}</span>
      </span>
      <span class="title-subtitle">Total Agentic Mode — LangChain-powered</span>
    </span>
    <button id="settingsBtn" class="btn-icon-top" title="Settings (language, browser, GitHub Copilot, Total Agentic Mode)">⚙</button>
  </div>

  <details class="section" id="agenticIngestSection" open>
    <summary>Input Files</summary>
    <div class="section-body">
      <div class="toolbar-row" style="justify-content: flex-end;">
        <button id="agenticClearDataBtn" class="btn btn-danger clear-data-btn" title="Wipe every ingested file, cached parsed content, custom-instruction selection, chat text, and generated output — so nothing from this batch of files carries over into the next one">Clear Data</button>
      </div>
      <p class="note" style="margin-top: 0;">
        Drop one or more requirement/data files (.csv, .json, .xml, .yml, .txt, .md, .log, .xlsx, .docx, .pdf).
        After ingesting, open Ingestion Configuration to choose exactly which sheet/columns/rows/lines of each file
        reach the LLM.
      </p>
      <div id="agenticDropZone" class="rag-dropzone">
        <span>Drop input files here, or</span>
        <button type="button" id="agenticBrowseBtn" class="btn btn-secondary">Choose Files…</button>
        <input type="file" id="agenticFileInput" multiple hidden accept=".csv,.json,.xml,.yml,.yaml,.txt,.md,.log,.xlsx,.docx,.pdf" />
      </div>
      <div class="toolbar-row" style="margin-top: 10px; justify-content: space-between;">
        <span id="agenticFileCountLabel" class="status-text">No files ingested yet.</span>
        <button id="agenticManageFilesBtn" class="btn btn-small btn-silver" hidden>Manage Ingested Files…</button>
      </div>
      <div id="agenticRejectedList" class="agentic-rejected-list" hidden></div>
    </div>
  </details>

  <details class="section" id="agenticCustomInstructionsRagSection" open>
    <summary>Custom Instructions &amp; RAG Data</summary>
    <div class="section-body">
      <details class="ai-assist" id="agenticCustomInstructionsSubsection">
        <summary>Custom Instructions</summary>
        <div class="ai-assist-body">
          <div class="ai-files-header">Instruction / skill / prompt files (<code>.github/*.md</code>) — check which ones this generation should use</div>
          <div id="agenticPromptFilesList" class="prompt-files-list">
            <div class="prompt-files-empty">No .md files found yet — click Refresh.</div>
          </div>
        </div>
      </details>

      <details class="ai-assist" id="agenticRagDataSubsection">
        <summary>RAG Data</summary>
        <div class="ai-assist-body">
          <div class="ai-files-header">Reusable component recipes (<code>.github/rag/*.md</code>) — matched automatically, nothing to select here</div>
          <div id="agenticRagFilesList" class="prompt-files-list">
            <div class="prompt-files-empty">No recipes found yet — click Refresh.</div>
          </div>
        </div>
      </details>

      <div class="toolbar-row">
        <button id="agenticRefreshPromptFilesBtn" class="btn btn-small btn-silver" title="Re-scan .github/*.md (Custom Instructions) and .github/rag/*.md (RAG Data)">Refresh file list</button>
      </div>

      <div class="chat-input-label" style="margin-top: 12px;">Instant instructions to LLM</div>
      <textarea id="agenticChatInput" class="chat-input" rows="3" placeholder="Describe what you want generated from the ingested files…" style="width: 100%;"></textarea>
    </div>
  </details>

  <details class="section" id="agenticActionsSection" open>
    <summary>Generate</summary>
    <div class="section-body">
      <div class="toolbar-row">
        <button id="agenticCsvBtn" class="btn btn-primary">Generate Manual Test Cases in CSV</button>
      </div>
      <div id="agenticCsvStatus" class="agentic-csv-status" hidden></div>
      <div class="toolbar-row">
        <button id="agenticFeatureBtn" class="btn btn-primary">Start AI Feature File Generation</button>
      </div>
      <div class="toolbar-row">
        <button id="agenticCodeBtn" class="btn btn-primary">Start AI Code Generation</button>
      </div>
    </div>
  </details>

  <details class="section" id="tokenMonitoringSection">
    <summary>Token Monitoring</summary>
    <div class="section-body">
      <div class="token-bar-track">
        <div id="tokenBarFill" class="token-bar-fill"></div>
      </div>
      <div class="token-stats-row">
        <span id="tokenPercentLabel" class="token-percent-label">—</span>
        <span id="tokenModelLabel" class="token-model-label"></span>
      </div>
      <div id="tokenUnavailableNote" class="token-unavailable-note">Enable "Link with GitHub Copilot LLM" and pick a model in Settings to see token usage.</div>
      <div id="tokenBreakdown" class="token-breakdown" hidden>
        <div class="token-breakdown-item"><span class="token-breakdown-label">Sent</span><span id="tokenSentValue" class="token-breakdown-value">0</span></div>
        <div class="token-breakdown-item"><span class="token-breakdown-label">Received</span><span id="tokenReceivedValue" class="token-breakdown-value">0</span></div>
        <div class="token-breakdown-item"><span class="token-breakdown-label">Total</span><span id="tokenTotalValue" class="token-breakdown-value">0</span></div>
        <div class="token-breakdown-item"><span class="token-breakdown-label">Context limit</span><span id="tokenMaxValue" class="token-breakdown-value">0</span></div>
      </div>
    </div>
  </details>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
