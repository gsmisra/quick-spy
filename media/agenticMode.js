// Total Agentic Mode — the sidebar's dedicated script, deliberately
// SEPARATE from main.js (per this feature's "proper segregation"
// requirement). Owns only what this mode's own HTML (see
// objectSpyPanel.ts's getAgenticModeSidebarHtml()) renders: the file drop
// zone, the ingested-file count, the "Instant instructions to LLM" chat
// box, the three action buttons, a small CSV-generation status line, and
// its own copy of the Token Monitoring renderer (same message SHAPE as
// Standard mode's main.js — see agentic/agenticModeController.ts's doc
// comment — but its own independent DOM/render code, since the two modes'
// sidebar layouts are otherwise unrelated).
(function () {
  const vscode = acquireVsCodeApi();

  const settingsBtn = document.getElementById('settingsBtn');
  const dropZone = document.getElementById('agenticDropZone');
  const fileInput = document.getElementById('agenticFileInput');
  const browseBtn = document.getElementById('agenticBrowseBtn');
  const fileCountLabel = document.getElementById('agenticFileCountLabel');
  const manageFilesBtn = document.getElementById('agenticManageFilesBtn');
  const rejectedList = document.getElementById('agenticRejectedList');
  const promptFilesList = document.getElementById('agenticPromptFilesList');
  const ragFilesList = document.getElementById('agenticRagFilesList');
  const refreshPromptFilesBtn = document.getElementById('agenticRefreshPromptFilesBtn');
  const chatInput = document.getElementById('agenticChatInput');
  const featureBtn = document.getElementById('agenticFeatureBtn');
  const codeBtn = document.getElementById('agenticCodeBtn');
  const csvBtn = document.getElementById('agenticCsvBtn');
  const csvStatus = document.getElementById('agenticCsvStatus');
  const clearDataBtn = document.getElementById('agenticClearDataBtn');

  // ---- Token Monitoring (own copy — see file doc comment) ----
  const tokenBarFill = document.getElementById('tokenBarFill');
  const tokenPercentLabel = document.getElementById('tokenPercentLabel');
  const tokenModelLabel = document.getElementById('tokenModelLabel');
  const tokenUnavailableNote = document.getElementById('tokenUnavailableNote');
  const tokenBreakdown = document.getElementById('tokenBreakdown');
  const tokenSentValue = document.getElementById('tokenSentValue');
  const tokenReceivedValue = document.getElementById('tokenReceivedValue');
  const tokenTotalValue = document.getElementById('tokenTotalValue');
  const tokenMaxValue = document.getElementById('tokenMaxValue');

  let lastTokenState = null;
  function applyTokenEstimate(payload) {
    if (payload.available === false) {
      lastTokenState = null;
      tokenUnavailableNote.hidden = false;
      tokenUnavailableNote.textContent = payload.reason || 'Token usage unavailable.';
      tokenBreakdown.hidden = true;
      tokenBarFill.style.width = '0%';
      tokenPercentLabel.textContent = '—';
      tokenModelLabel.textContent = '';
      return;
    }
    lastTokenState = lastTokenState || {};
    if (payload.sentTokens !== null && payload.sentTokens !== undefined) lastTokenState.sentTokens = payload.sentTokens;
    if (payload.receivedTokens !== null && payload.receivedTokens !== undefined) lastTokenState.receivedTokens = payload.receivedTokens;
    if (payload.maxInputTokens) lastTokenState.maxInputTokens = payload.maxInputTokens;
    if (payload.modelId) lastTokenState.modelId = payload.modelId;
    if (lastTokenState.sentTokens === undefined) return;

    tokenUnavailableNote.hidden = true;
    tokenBreakdown.hidden = false;
    const sent = lastTokenState.sentTokens;
    const received = lastTokenState.receivedTokens || 0;
    const max = lastTokenState.maxInputTokens || 0;
    const percent = max > 0 ? Math.min(100, (sent / max) * 100) : 0;
    tokenBarFill.style.width = percent + '%';
    tokenBarFill.style.background = percent >= 85 ? '#f85149' : percent >= 60 ? '#d29922' : '#3fb950';
    tokenPercentLabel.textContent = percent.toFixed(1) + '% of context window';
    tokenModelLabel.textContent = lastTokenState.modelId || '';
    tokenSentValue.textContent = sent.toLocaleString();
    tokenReceivedValue.textContent = received.toLocaleString();
    tokenTotalValue.textContent = (sent + received).toLocaleString();
    tokenMaxValue.textContent = max.toLocaleString();
  }

  // ---- File drop / picker ----
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function readAllAsBase64(fileList) {
    return Promise.all(
      Array.from(fileList).map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ fileName: file.name, base64: arrayBufferToBase64(reader.result) });
            reader.onerror = () => resolve(null);
            reader.readAsArrayBuffer(file);
          })
      )
    );
  }

  function ingest(fileList) {
    if (!fileList || fileList.length === 0) return;
    readAllAsBase64(fileList).then((results) => {
      const files = results.filter(Boolean);
      if (files.length > 0) {
        vscode.postMessage({ type: 'agentic:ingestFiles', payload: { files: files } });
      }
    });
  }

  settingsBtn.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));

  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    ingest(fileInput.files);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach((evt) => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((evt) => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) ingest(e.dataTransfer.files);
  });

  manageFilesBtn.addEventListener('click', () => vscode.postMessage({ type: 'agentic:openIngestionPanel' }));

  // "Clear Data" -- a genuine "start this batch of files over from
  // nothing", matching Standard mode's own Clear Data/Kill All Browsers
  // buttons: the extension host wipes every ingested file, cached parsed
  // content, custom-instruction selection, and generated output
  // (agentic/agenticModeController.ts's reset()); this click handler only
  // resets what's purely client-side state here (the chat box text, the
  // rejected-files list, the CSV status line) -- everything else arrives
  // back via the 'agentic:fileList'/'agentic:promptFiles'/'tokenEstimate'
  // messages reset() already sends.
  clearDataBtn.addEventListener('click', () => {
    chatInput.value = '';
    csvStatus.hidden = true;
    csvStatus.textContent = '';
    renderRejected([]);
    vscode.postMessage({ type: 'agentic:clearData' });
  });

  function renderFileList(files) {
    fileCountLabel.textContent = files.length === 0 ? 'No files ingested yet.' : files.length + ' file(s) ingested.';
    manageFilesBtn.hidden = files.length === 0;
  }

  function renderRejected(rejected) {
    rejectedList.innerHTML = '';
    if (!rejected || rejected.length === 0) {
      rejectedList.hidden = true;
      return;
    }
    rejectedList.hidden = false;
    rejected.forEach((r) => {
      const line = document.createElement('div');
      line.className = 'agentic-rejected-line';
      line.textContent = r.fileName + ' — ' + r.reason;
      rejectedList.appendChild(line);
    });
  }

  // ---- Custom Instructions & RAG Data (mirrors main.js's own Custom
  // Instructions & RAG Data segment — same checkbox-driven selection model,
  // its own independent DOM/render code per this feature's "proper
  // segregation" requirement) ----
  function postSelectedInstructionFiles() {
    const selected = Array.from(promptFilesList.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
    vscode.postMessage({ type: 'agentic:selectedInstructionFiles', payload: selected });
  }

  function renderPromptFiles(files) {
    if (!files.length) {
      promptFilesList.innerHTML = '<div class="prompt-files-empty">No .md files found under .github/.</div>';
      postSelectedInstructionFiles();
      return;
    }
    promptFilesList.innerHTML = '';
    files.forEach((file) => {
      const label = document.createElement('label');
      label.className = 'prompt-file-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = file;
      checkbox.addEventListener('change', postSelectedInstructionFiles);
      label.appendChild(checkbox);
      const text = document.createElement('span');
      text.textContent = file;
      label.appendChild(text);
      promptFilesList.appendChild(label);
    });
    postSelectedInstructionFiles();
  }

  function renderRagFiles(files) {
    if (!files.length) {
      ragFilesList.innerHTML = '<div class="prompt-files-empty">No recipes found under .github/rag/.</div>';
      return;
    }
    ragFilesList.innerHTML = '';
    files.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'prompt-file-item';
      item.textContent = file;
      ragFilesList.appendChild(item);
    });
  }

  refreshPromptFilesBtn.addEventListener('click', () => vscode.postMessage({ type: 'agentic:refreshInstructionFiles' }));

  // ---- Chat box ("Instant instructions to LLM") ----
  let chatDebounceTimer = null;
  chatInput.addEventListener('input', () => {
    clearTimeout(chatDebounceTimer);
    chatDebounceTimer = setTimeout(() => {
      vscode.postMessage({ type: 'agentic:updateDraftInstructions', payload: chatInput.value });
    }, 500);
  });

  // ---- Generation actions ----
  // Button LABELS flip between Generate/Start and View based on the
  // 'agentic:generationState' message (see agentic/agenticModeController.ts's
  // postGenerationState()) -- the click handler always posts the SAME
  // message type either way; the extension host decides whether to run a
  // fresh generation or just reveal what's already in memory (or, for CSV,
  // reopen the file already written this session).
  function applyGenerationState(payload) {
    featureBtn.textContent = payload.hasFeatureFile ? 'View AI Feature File Generation' : 'Start AI Feature File Generation';
    codeBtn.textContent = payload.hasCode ? 'View AI Code Generation' : 'Start AI Code Generation';
    csvBtn.textContent = payload.hasCsv ? 'View Manual Test Cases in CSV' : 'Generate Manual Test Cases in CSV';
    csvBtn.dataset.hasCsv = payload.hasCsv ? 'true' : 'false';
  }

  featureBtn.addEventListener('click', () => vscode.postMessage({ type: 'agentic:generateFeatureFile' }));
  codeBtn.addEventListener('click', () => vscode.postMessage({ type: 'agentic:generateCode' }));
  csvBtn.addEventListener('click', () => {
    // Only show the "Generating..." status when a generation is actually
    // about to run -- reopening an existing CSV (dataset.hasCsv === 'true')
    // is a near-instant file-open with no csvStatus message coming back at
    // all, so showing this here would leave a misleading "Generating..."
    // line stuck on screen forever after a View click.
    if (csvBtn.dataset.hasCsv !== 'true') {
      csvStatus.hidden = false;
      csvStatus.className = 'agentic-csv-status';
      csvStatus.textContent = 'Generating manual test cases…';
    }
    vscode.postMessage({ type: 'agentic:generateCsv' });
  });

  function applyCsvStatus(payload) {
    csvStatus.hidden = false;
    if (payload.state === 'generating') {
      csvStatus.className = 'agentic-csv-status';
      csvStatus.textContent = 'Generating manual test cases…';
    } else if (payload.state === 'done') {
      csvStatus.className = 'agentic-csv-status success';
      csvStatus.textContent = payload.message;
    } else if (payload.state === 'error') {
      csvStatus.className = 'agentic-csv-status error';
      csvStatus.textContent = payload.message;
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'tokenEstimate':
        applyTokenEstimate(message.payload);
        break;
      case 'agentic:fileList':
        renderFileList(message.payload);
        break;
      case 'agentic:promptFiles':
        renderPromptFiles(message.payload);
        break;
      case 'agentic:ragFiles':
        renderRagFiles(message.payload);
        break;
      case 'agentic:ingestResult':
        renderRejected(message.payload.rejected);
        break;
      case 'agentic:csvStatus':
        applyCsvStatus(message.payload);
        break;
      case 'agentic:generationState':
        applyGenerationState(message.payload);
        break;
    }
  });

  vscode.postMessage({ type: 'agentic:ready' });
  vscode.postMessage({ type: 'agentic:refreshInstructionFiles' });
})();
