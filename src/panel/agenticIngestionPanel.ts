import * as vscode from 'vscode';
import { AgenticModeController } from '../agentic/agenticModeController';
import { AgenticIngestionConfig } from '../agentic/agenticTypes';
import { extractSegmentForFile } from '../agentic/textIngestion';

type InboundMessage =
  | { type: 'updateConfig'; payload: { id: string; config: AgenticIngestionConfig } }
  | { type: 'removeFile'; payload: { id: string } }
  | { type: 'ready' };

/**
 * "Ingestion Configuration" — a separate editor-area panel (own file, own
 * webview, own message protocol; matches SettingsPanel.ts's shape) that
 * opens automatically the moment Total Agentic Mode successfully ingests
 * one or more files, showing exactly what was loaded and letting the user
 * dial in how much of EACH file actually reaches the LLM's context (a
 * column/row range for CSV, a line range for everything else — see
 * agentic/textIngestion.ts). Deliberately reads/writes through
 * `AgenticModeController` directly rather than round-tripping messages
 * through ObjectSpyPanel's sidebar — this panel and the controller are the
 * two halves of Agentic Mode's own self-contained state, untouched by
 * anything Standard mode does.
 */
export class AgenticIngestionPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext, private readonly controller: AgenticModeController) {}

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  /** Opens the panel if needed (bringing it to front either way) and pushes
   * the current file list — called right after a successful drop/ingest,
   * and whenever the sidebar's own "Manage Ingested Files" affordance is
   * used to reopen it later in the same session. */
  showAndRefresh(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('SoftPlayAgenticIngestion', 'Total Agentic Mode — Ingestion Configuration', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true
      });
      this.panel.webview.html = this.getHtml();
      this.panel.webview.onDidReceiveMessage((message: InboundMessage) => this.handleMessage(message), undefined, this.disposables);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      }, undefined, this.disposables);
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }
    this.refresh();
  }

  refresh(): void {
    this.panel?.webview.postMessage({
      type: 'files',
      payload: this.controller.getFiles().map((f) => {
        // Computed fresh from the CURRENT config every refresh (cheap —
        // pure string slicing, see textIngestion.ts) rather than cached,
        // so the truncation badge always reflects whatever the user just
        // changed, not a stale snapshot from when the file was ingested.
        const segment = extractSegmentForFile(f);
        return {
          id: f.id,
          fileName: f.fileName,
          kind: f.kind,
          sizeBytes: f.sizeBytes,
          csvPreview: f.csvPreview,
          xlsxPreview: f.xlsxPreview,
          docxPreview: f.docxPreview,
          pdfPreview: f.pdfPreview,
          config: f.config,
          truncated: segment.truncated,
          selectedChars: segment.text.length
        };
      })
    });
  }

  private postTruncationStatus(id: string): void {
    const file = this.controller.getFiles().find((f) => f.id === id);
    if (!file) {
      return;
    }
    const segment = extractSegmentForFile(file);
    this.panel?.webview.postMessage({
      type: 'truncationStatus',
      payload: { id, truncated: segment.truncated, selectedChars: segment.text.length }
    });
  }

  private handleMessage(message: InboundMessage): void {
    if (message.type === 'updateConfig') {
      this.controller.updateConfig(message.payload.id, message.payload.config);
      // A single, TARGETED truncation update for just this file — not a
      // full refresh(), which would rebuild every file card's DOM
      // (including whatever input the user is actively typing into) and
      // steal focus/cursor position mid-edit.
      this.postTruncationStatus(message.payload.id);
    } else if (message.type === 'removeFile') {
      this.controller.removeFile(message.payload.id);
      this.refresh();
    } else if (message.type === 'ready') {
      this.refresh();
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ingestion Configuration</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 14px 18px; }
    h2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin: 0 0 10px; }
    p.note { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin: 0 0 18px; }
    .file-card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px 14px; margin-bottom: 14px; }
    .file-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .file-name { font-weight: 600; }
    .file-meta { font-size: 0.78em; color: var(--vscode-descriptionForeground); }
    .file-unsupported { font-size: 0.85em; color: var(--vscode-errorForeground, #f14c4c); }
    .remove-btn { background: none; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); border-radius: 4px; cursor: pointer; padding: 2px 8px; font-size: 0.8em; }
    .remove-btn:hover { color: var(--vscode-errorForeground, #f14c4c); }
    .config-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
    .config-row label { font-size: 0.85em; }
    .config-row input[type="number"] { width: 70px; padding: 2px 4px; }
    .columns-list { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 4px; }
    .columns-list label { font-size: 0.82em; display: flex; align-items: center; gap: 4px; }
    .empty-state { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .truncation-badge {
      font-size: 0.75em; font-weight: 600; padding: 1px 8px; border-radius: 10px;
      background: rgba(210, 153, 34, 0.18); color: #d29922; white-space: nowrap;
    }
    .truncation-badge[hidden] { display: none; }
  </style>
</head>
<body>
  <h2>Ingestion Configuration</h2>
  <p class="note">
    Choose exactly how much of each ingested file reaches the LLM's context. Only the selected segments are ever
    sent — everything else stays out of the prompt entirely. Changes apply immediately and are reflected in the
    Token Monitoring bar on the main sidebar.
  </p>
  <div id="fileListEl"></div>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const fileListEl = document.getElementById('fileListEl');

      function debounce(fn, ms) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
      }

      // Row-range + column-checklist controls shared by CSV and (one sheet
      // of) XLSX -- existingConfig seeds the initial values, onChange is
      // called (debounced) with just {rowRange, columns}; the caller
      // decides what ELSE (e.g. sheetName) belongs in the full config
      // object actually sent, since updateConfig replaces a file's whole
      // config rather than merging into it.
      function renderTableRangeControls(headers, dataRowCount, existingConfig, onChange) {
        const selectedColumns = new Set(existingConfig.columns && existingConfig.columns.length ? existingConfig.columns : headers);
        const from = (existingConfig.rowRange && existingConfig.rowRange.from) || '';
        const to = (existingConfig.rowRange && existingConfig.rowRange.to) || '';

        const wrap = document.createElement('div');

        const rowRangeRow = document.createElement('div');
        rowRangeRow.className = 'config-row';
        rowRangeRow.innerHTML =
          '<label>Data rows ' + (dataRowCount ? '(1-' + dataRowCount + ')' : '') + ': from</label>' +
          '<input type="number" min="1" class="row-from" value="' + from + '" placeholder="1" />' +
          '<label>to</label>' +
          '<input type="number" min="1" class="row-to" value="' + to + '" placeholder="' + (dataRowCount || '') + '" />';
        wrap.appendChild(rowRangeRow);

        const columnsWrap = document.createElement('div');
        columnsWrap.className = 'columns-list';
        headers.forEach((col) => {
          const label = document.createElement('label');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'column-checkbox';
          cb.dataset.column = col;
          cb.checked = selectedColumns.has(col);
          label.appendChild(cb);
          label.appendChild(document.createTextNode(col || '(unnamed column)'));
          columnsWrap.appendChild(label);
        });
        wrap.appendChild(columnsWrap);

        const send = debounce(() => {
          const fromVal = parseInt(rowRangeRow.querySelector('.row-from').value, 10);
          const toVal = parseInt(rowRangeRow.querySelector('.row-to').value, 10);
          const checked = Array.from(columnsWrap.querySelectorAll('.column-checkbox:checked')).map((cb) => cb.dataset.column);
          const config = {};
          if (!isNaN(fromVal) || !isNaN(toVal)) {
            config.rowRange = {};
            if (!isNaN(fromVal)) config.rowRange.from = fromVal;
            if (!isNaN(toVal)) config.rowRange.to = toVal;
          }
          if (checked.length !== headers.length) {
            config.columns = checked;
          }
          onChange(config);
        }, 400);
        wrap.addEventListener('input', send);
        return wrap;
      }

      function renderCsvControls(file) {
        const headers = (file.csvPreview && file.csvPreview.headers) || [];
        const dataRowCount = (file.csvPreview && file.csvPreview.dataRowCount) || 0;
        return renderTableRangeControls(headers, dataRowCount, file.config, (config) => {
          vscode.postMessage({ type: 'updateConfig', payload: { id: file.id, config: config } });
        });
      }

      function renderXlsxControls(file) {
        const sheets = (file.xlsxPreview && file.xlsxPreview.sheets) || [];
        const container = document.createElement('div');
        if (sheets.length === 0) {
          container.innerHTML = '<div class="file-meta">This workbook has no sheets.</div>';
          return container;
        }

        const sheetRow = document.createElement('div');
        sheetRow.className = 'config-row';
        const sheetLabel = document.createElement('label');
        sheetLabel.textContent = 'Sheet:';
        const sheetSelect = document.createElement('select');
        sheets.forEach((s) => {
          const opt = document.createElement('option');
          opt.value = s.name;
          opt.textContent = s.name + ' (' + s.dataRowCount + ' row(s))';
          sheetSelect.appendChild(opt);
        });
        const currentSheetName = file.config.sheetName && sheets.some((s) => s.name === file.config.sheetName) ? file.config.sheetName : sheets[0].name;
        sheetSelect.value = currentSheetName;
        sheetRow.appendChild(sheetLabel);
        sheetRow.appendChild(sheetSelect);
        container.appendChild(sheetRow);

        const tableWrap = document.createElement('div');
        container.appendChild(tableWrap);

        function renderForSheet(sheetName, seedConfig) {
          tableWrap.innerHTML = '';
          const sheet = sheets.find((s) => s.name === sheetName) || sheets[0];
          const controls = renderTableRangeControls(sheet.headers, sheet.dataRowCount, seedConfig, (partial) => {
            partial.sheetName = sheetSelect.value;
            vscode.postMessage({ type: 'updateConfig', payload: { id: file.id, config: partial } });
          });
          tableWrap.appendChild(controls);
        }
        renderForSheet(currentSheetName, file.config);

        sheetSelect.addEventListener('change', () => {
          // Switching sheets makes any previous row/column selection
          // meaningless (it was against a different table) — resets to
          // "the whole new sheet" rather than carrying over a selection
          // that no longer makes sense.
          renderForSheet(sheetSelect.value, {});
          vscode.postMessage({ type: 'updateConfig', payload: { id: file.id, config: { sheetName: sheetSelect.value } } });
        });

        return container;
      }

      function renderDocxControls(file) {
        const headings = (file.docxPreview && file.docxPreview.headings) || [];
        const wrap = document.createElement('div');
        if (headings.length === 0) {
          wrap.innerHTML = '<div class="file-meta">No headings found in this document — its full text is always sent.</div>';
          return wrap;
        }

        const fromIndex = (file.config.headingRange && file.config.headingRange.fromIndex) || '';
        const toIndex = (file.config.headingRange && file.config.headingRange.toIndex) || '';
        const row = document.createElement('div');
        row.className = 'config-row';
        row.innerHTML =
          '<label>Headings (1-' + headings.length + '): from</label>' +
          '<input type="number" min="1" max="' + headings.length + '" class="head-from" value="' + fromIndex + '" placeholder="1" />' +
          '<label>to</label>' +
          '<input type="number" min="1" max="' + headings.length + '" class="head-to" value="' + toIndex + '" placeholder="' + headings.length + '" />';
        wrap.appendChild(row);

        const listEl = document.createElement('div');
        listEl.className = 'file-meta';
        listEl.style.marginTop = '6px';
        listEl.innerHTML = headings
          .map((h, i) => (i + 1) + '. ' + '&nbsp;'.repeat(Math.max(0, (h.level - 1) * 2)) + escapeHtml(h.text))
          .join('<br/>');
        wrap.appendChild(listEl);

        const send = debounce(() => {
          const fromVal = parseInt(row.querySelector('.head-from').value, 10);
          const toVal = parseInt(row.querySelector('.head-to').value, 10);
          const config = {};
          if (!isNaN(fromVal) || !isNaN(toVal)) {
            config.headingRange = {};
            if (!isNaN(fromVal)) config.headingRange.fromIndex = fromVal;
            if (!isNaN(toVal)) config.headingRange.toIndex = toVal;
          }
          vscode.postMessage({ type: 'updateConfig', payload: { id: file.id, config: config } });
        }, 400);
        wrap.addEventListener('input', send);
        return wrap;
      }

      function renderPdfControls(file) {
        const pageCount = (file.pdfPreview && file.pdfPreview.pageCount) || 0;
        const from = (file.config.pageRange && file.config.pageRange.from) || '';
        const to = (file.config.pageRange && file.config.pageRange.to) || '';
        const row = document.createElement('div');
        row.className = 'config-row';
        row.innerHTML =
          '<label>Pages (1-' + pageCount + '): from</label>' +
          '<input type="number" min="1" max="' + pageCount + '" class="page-from" value="' + from + '" placeholder="1" />' +
          '<label>to</label>' +
          '<input type="number" min="1" max="' + pageCount + '" class="page-to" value="' + to + '" placeholder="' + (pageCount || '') + '" />';

        const send = debounce(() => {
          const fromVal = parseInt(row.querySelector('.page-from').value, 10);
          const toVal = parseInt(row.querySelector('.page-to').value, 10);
          const config = {};
          if (!isNaN(fromVal) || !isNaN(toVal)) {
            config.pageRange = {};
            if (!isNaN(fromVal)) config.pageRange.from = fromVal;
            if (!isNaN(toVal)) config.pageRange.to = toVal;
          }
          vscode.postMessage({ type: 'updateConfig', payload: { id: file.id, config: config } });
        }, 400);
        row.addEventListener('input', send);
        return row;
      }

      function renderLineRangeControls(file) {
        const from = (file.config.lineRange && file.config.lineRange.from) || '';
        const to = (file.config.lineRange && file.config.lineRange.to) || '';
        const row = document.createElement('div');
        row.className = 'config-row';
        row.innerHTML =
          '<label>Lines: from</label>' +
          '<input type="number" min="1" class="line-from" value="' + from + '" placeholder="1" />' +
          '<label>to</label>' +
          '<input type="number" min="1" class="line-to" value="' + to + '" placeholder="end" />' +
          '<span class="file-meta">(leave both blank to send the whole file)</span>';

        const send = debounce(() => {
          const fromVal = parseInt(row.querySelector('.line-from').value, 10);
          const toVal = parseInt(row.querySelector('.line-to').value, 10);
          const config = {};
          if (!isNaN(fromVal) || !isNaN(toVal)) {
            config.lineRange = {};
            if (!isNaN(fromVal)) config.lineRange.from = fromVal;
            if (!isNaN(toVal)) config.lineRange.to = toVal;
          }
          vscode.postMessage({ type: 'updateConfig', payload: { id: file.id, config: config } });
        }, 400);
        row.addEventListener('input', send);
        return row;
      }

      function truncationBadgeText(file) {
        return 'Truncated to ' + file.selectedChars.toLocaleString() + ' chars (safety cap)';
      }

      function applyTruncationStatus(id, truncated, selectedChars) {
        const badge = document.getElementById('trunc-badge-' + id);
        if (!badge) return; // the card may have been removed since this update was requested
        badge.hidden = !truncated;
        if (truncated) {
          badge.textContent = truncationBadgeText({ selectedChars: selectedChars });
        }
      }

      function renderControlsForKind(file) {
        if (file.kind === 'csv') return renderCsvControls(file);
        if (file.kind === 'xlsx') return renderXlsxControls(file);
        if (file.kind === 'docx') return renderDocxControls(file);
        if (file.kind === 'pdf') return renderPdfControls(file);
        return renderLineRangeControls(file);
      }

      function renderFiles(files) {
        fileListEl.innerHTML = '';
        if (files.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'empty-state';
          empty.textContent = 'No files ingested yet — drop files onto Total Agentic Mode\\'s file area on the main sidebar.';
          fileListEl.appendChild(empty);
          return;
        }
        files.forEach((file) => {
          const card = document.createElement('div');
          card.className = 'file-card';

          const head = document.createElement('div');
          head.className = 'file-head';
          const nameEl = document.createElement('div');
          nameEl.innerHTML = '<span class="file-name">' + escapeHtml(file.fileName) + '</span> ' +
            '<span class="file-meta">(' + file.kind + ', ' + (file.sizeBytes / 1024).toFixed(1) + ' KB)</span> ' +
            '<span id="trunc-badge-' + file.id + '" class="truncation-badge" title="Only the first ' +
            (file.truncated ? file.selectedChars.toLocaleString() : '') +
            ' characters of this file\\'s SELECTED segment are sent to the LLM — narrow the range/columns above to fit more of what matters." ' +
            (file.truncated ? '' : 'hidden') + '>' +
            (file.truncated ? escapeHtml(truncationBadgeText(file)) : '') + '</span>';
          const removeBtn = document.createElement('button');
          removeBtn.className = 'remove-btn';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', () => vscode.postMessage({ type: 'removeFile', payload: { id: file.id } }));
          head.appendChild(nameEl);
          head.appendChild(removeBtn);
          card.appendChild(head);

          card.appendChild(renderControlsForKind(file));
          fileListEl.appendChild(card);
        });
      }

      function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      }

      window.addEventListener('message', (event) => {
        if (event.data.type === 'files') {
          renderFiles(event.data.payload);
        } else if (event.data.type === 'truncationStatus') {
          const p = event.data.payload;
          applyTruncationStatus(p.id, p.truncated, p.selectedChars);
        }
      });

      vscode.postMessage({ type: 'ready' });
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
