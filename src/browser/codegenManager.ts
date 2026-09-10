import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import { Language, BrowserChannel } from '../settings/settingsStore';

export type CodegenStatus =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'running'; url: string }
  | { state: 'error'; message: string };

/**
 * Drives Playwright's OWN `codegen` CLI tool as a child process — the sole
 * way this extension launches a browser, scans elements, and records
 * actions into generated code. Real `playwright codegen` launches and owns
 * its own browser window with its own built-in recorder overlay baked into
 * the page, and this class's whole job is spawning/killing that process and
 * streaming its output file's content back verbatim (see onCodeUpdate).
 *
 * `playwright` (the full package, not just `playwright-core`) is a real
 * dependency of this extension purely for this CLI file — never for its own
 * bundled browser. `--channel chrome`/`--channel msedge` drives the real,
 * already-installed system browser directly (Playwright resolves the
 * installed Chrome/Edge path for a named channel on its own — no separate
 * executable-finding logic needed here); Playwright's browser-download step
 * is disabled at install time for this whole project (see .npmrc), so
 * nothing is ever fetched at runtime, in keeping with the bank-environment
 * constraint that a Chromium/Firefox/WebKit binary is never downloaded.
 */
export class CodegenManager implements vscode.Disposable {
  private child: ChildProcess | undefined;
  private outputFile: string | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lastFileContent = '';
  private lastEmittedContent = '';
  private currentLanguage: Language = 'python';
  private currentChannel: BrowserChannel = 'chrome';

  private status: CodegenStatus = { state: 'idle' };

  private readonly statusEmitter = new vscode.EventEmitter<CodegenStatus>();
  readonly onStatusChange = this.statusEmitter.event;

  private readonly codeEmitter = new vscode.EventEmitter<string>();
  /** Fires codegen's own file content every time it writes a new version —
   * left otherwise untouched (no reformatting, no locator/action rewriting;
   * that's deliberately "as-is" per the feature's whole point) with exactly
   * one addition: a launch override that finds the real, already-installed
   * Chrome/Edge executable on disk (whichever is selected in Settings — see
   * injectBrowserChannelConfig below) and launches that directly, so code
   * saved straight from this panel never falls back to Playwright's own
   * bundled Chromium, whose download is blocked by company policy. */
  readonly onCodeUpdate = this.codeEmitter.event;

  private readonly logEmitter = new vscode.EventEmitter<string>();
  readonly onLog = this.logEmitter.event;

  getStatus(): CodegenStatus {
    return this.status;
  }

  isRunning(): boolean {
    return this.status.state === 'running' || this.status.state === 'starting';
  }

  async start(url: string, language: Language, browserChannel: BrowserChannel): Promise<void> {
    if (this.isRunning()) {
      this.log('A native Playwright codegen session is already running.');
      return;
    }

    let cliPath: string;
    try {
      cliPath = resolveCodegenCliPath();
    } catch (err) {
      this.setStatus({ state: 'error', message: describeError(err) });
      return;
    }

    const target = language === 'java' ? 'java-junit' : 'python-pytest';
    const channel = browserChannel === 'edge' ? 'msedge' : 'chrome';
    const ext = language === 'java' ? 'java' : 'py';
    this.outputFile = path.join(os.tmpdir(), `SoftPlay-codegen-${Date.now()}.${ext}`);
    this.lastFileContent = '';
    this.lastEmittedContent = '';
    this.currentLanguage = language;
    this.currentChannel = browserChannel;

    // Empty/blank stays genuinely absent from argv — codegen opens with a
    // blank page and the user types into its own address bar, exactly like
    // running `playwright codegen` by hand with no URL at all. Passing an
    // empty string as the positional argument instead would make it try to
    // navigate to "", which is not the same thing.
    const trimmedUrl = url.trim();
    const normalizedUrl = trimmedUrl ? normalizeUrl(trimmedUrl) : '';
    // codegen's CLI has no "launch maximized"/"fullscreen" switch of its
    // own — the closest, actually-supported lever is `--viewport-size`,
    // which sizes the *page content area* (never the outer window chrome
    // — title bar, tab strip, address bar — around it). Matching it to the
    // user's real primary-monitor resolution is what "opens full screen and
    // shows the entire webpage in view" concretely means here: the recorded
    // page fills the whole screen instead of Playwright's own small
    // (800x600-ish) default. Falls back to a generous 1920x1080 (the single
    // most common desktop resolution) if the real one can't be detected —
    // every recording still gets a large viewport either way, never a
    // silent revert to the tiny default.
    //
    // Reproduced bug fix: requesting a viewport EXACTLY as tall as the full
    // screen used to make the browser's OUTER window taller than the
    // screen — `--viewport-size` sizes the content area alone, so the
    // window Chrome/Edge actually opens is that height PLUS its own title
    // bar/tab strip/address bar (roughly BROWSER_CHROME_HEIGHT_RESERVE
    // below), which no longer fits the display at all — the window (and
    // the whole web app inside it) got positioned at the top of the screen
    // and its BOTTOM portion extended past the visible screen, with no way
    // to see or scroll to it (zooming the PAGE out never changes the
    // window's own outer size). `detectPrimaryScreenSize()` below now
    // returns the monitor's usable WORKING area (excluding the taskbar,
    // which a normal window can never be sized/positioned over) rather
    // than its raw bounds, and `BROWSER_CHROME_HEIGHT_RESERVE` is
    // subtracted from that height here so the OUTER window — content plus
    // chrome — fits entirely within the visible screen, top to bottom.
    const { width, height } = await detectPrimaryScreenSize();
    const viewportHeight = Math.max(1, height - BROWSER_CHROME_HEIGHT_RESERVE);
    const args = [
      cliPath,
      'codegen',
      `--target=${target}`,
      `--channel=${channel}`,
      `--viewport-size=${width},${viewportHeight}`,
      '-o',
      this.outputFile
    ];
    if (normalizedUrl) {
      args.push(normalizedUrl);
    }

    this.setStatus({ state: 'starting' });
    this.log(
      `Starting native Playwright codegen: --target=${target} --channel=${channel} --viewport-size=${width},${viewportHeight}` +
        `${normalizedUrl ? ' ' + normalizedUrl : ' (no URL — opens blank)'}`
    );

    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    this.child = child;

    child.once('exit', (code) => {
      // Only react if this is still the child we're tracking — a Stop
      // call already replaces `this.child` with undefined before killing,
      // so a late 'exit' from an already-superseded process is a no-op.
      if (this.child === child) {
        this.stopPolling();
        this.child = undefined;
        if (this.status.state !== 'idle') {
          this.setStatus({ state: 'idle' });
        }
        if (code !== null && code !== 0) {
          this.log(`Native Playwright codegen exited with code ${code} — the codegen window may have been closed manually.`);
        }
      }
    });

    child.once('error', (err) => {
      this.setStatus({ state: 'error', message: describeError(err) });
    });

    // Empty when no URL was given — left falsy deliberately, so the panel's
    // existing `if (status.url) { urlInput.value = ... }` echo (meant for
    // the CDP-attach flow's live current-URL tracking) never overwrites the
    // URL field with a placeholder string here; native mode has no
    // comparable "current URL" to report once the browser is running.
    this.setStatus({ state: 'running', url: normalizedUrl });
    this.startPolling();
  }

  /** Terminates the spawned `codegen` process — its browser goes down with
   * it (verified: the OS's own job-object/process-group cleanup takes down
   * a launched Chrome/Edge's child processes when the parent process that
   * launched it is killed, with no need to enumerate and kill them
   * ourselves). */
  async stop(): Promise<void> {
    this.stopPolling();
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) {
      try {
        child.kill();
      } catch (err) {
        this.log(`Error stopping native Playwright codegen: ${describeError(err)}`);
      }
    }
    const outputFile = this.outputFile;
    this.outputFile = undefined;
    if (outputFile) {
      await fs.promises.unlink(outputFile).catch(() => undefined);
    }
    this.setStatus({ state: 'idle' });
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => void this.pollOutputFile(), 700);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async pollOutputFile(): Promise<void> {
    if (!this.outputFile) {
      return;
    }
    try {
      const content = await fs.promises.readFile(this.outputFile, 'utf8');
      if (content !== this.lastFileContent) {
        this.lastFileContent = content;
        const augmented = injectBrowserChannelConfig(content, this.currentLanguage, this.currentChannel);
        if (augmented !== this.lastEmittedContent) {
          this.lastEmittedContent = augmented;
          this.codeEmitter.fire(augmented);
        }
      }
    } catch {
      // Not written yet (no action recorded in the codegen browser so far),
      // or momentarily mid-write — next poll picks it up.
    }
  }

  private setStatus(status: CodegenStatus): void {
    this.status = status;
    this.statusEmitter.fire(status);
  }

  private log(message: string): void {
    this.logEmitter.fire(message);
  }

  dispose(): void {
    void this.stop();
    this.statusEmitter.dispose();
    this.codeEmitter.dispose();
    this.logEmitter.dispose();
  }
}

/** Locates the `playwright` package's `cli.js` on disk without going through
 * Node's module `exports` map (the `playwright` package doesn't expose
 * `./cli.js` as a public subpath export, even though the file itself ships
 * and is exactly what its own `bin` entry points at) — resolving
 * `playwright/package.json` instead and joining `cli.js` next to it sidesteps
 * that restriction legitimately, since we're only building a filesystem
 * path, not asking the module resolver to load an unexported subpath. */
function resolveCodegenCliPath(): string {
  const pkgPath = require.resolve('playwright/package.json');
  const cliPath = path.join(path.dirname(pkgPath), 'cli.js');
  if (!fs.existsSync(cliPath)) {
    throw new Error('Could not locate the Playwright CLI (playwright/cli.js) — is the "playwright" package installed?');
  }
  return cliPath;
}

/** A bare host/path typed without a scheme is assumed to be https://, same
 * as everywhere else in this extension a URL is accepted from the user. */
function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DEFAULT_SCREEN_SIZE = { width: 1920, height: 1080 };

/** Approximate extra vertical space Chrome/Edge's own OUTER window chrome
 * (title bar + tab strip + toolbar/address bar) occupies ABOVE the page
 * content area on Windows at 100% display scaling — `--viewport-size`
 * sizes ONLY that inner content area, so this must be subtracted from the
 * detected screen height before use, or the browser's real outer window
 * ends up taller than the screen itself. Deliberately a bit generous
 * (real chrome height is usually closer to ~90-110px with no bookmarks
 * bar shown) — a SLIGHTLY smaller-than-necessary viewport still leaves the
 * ENTIRE window (and so the entire page) visible and fully reachable,
 * which is the actual requirement; a viewport that's a few px larger than
 * it should be is what silently pushes the window's bottom edge past the
 * visible screen with no way to scroll to it — the exact reported bug this
 * constant fixes. Windows-only, matching `detectPrimaryScreenSize()`'s own
 * scope — this number is never applied to `DEFAULT_SCREEN_SIZE`'s own
 * fallback path below, which already reserves its own margin by using a
 * common resolution rather than claiming a real, exact screen size. */
const BROWSER_CHROME_HEIGHT_RESERVE = 140;

/** Queries the real primary-monitor's USABLE working area (its full
 * resolution MINUS the taskbar and any other always-on-top OS chrome — a
 * normal, non-fullscreen-exclusive window can never be sized or positioned
 * to overlap that area at all) via .NET's own `System.Windows.Forms.Screen`
 * (Windows only — there is no portable, dependency-free way to ask the OS
 * this from a plain Node.js extension host process) so codegen's
 * `--viewport-size` can fill the actual VISIBLE screen instead of the
 * raw, taskbar-inclusive monitor resolution. Verified against this exact
 * PowerShell invocation before relying on it. Never throws: any failure
 * (non-Windows, PowerShell unavailable, unexpected output, timeout) falls
 * back to DEFAULT_SCREEN_SIZE, so a recording session is never blocked or
 * delayed waiting on this. */
function detectPrimaryScreenSize(): Promise<{ width: number; height: number }> {
  if (process.platform !== 'win32') {
    return Promise.resolve(DEFAULT_SCREEN_SIZE);
  }
  return new Promise((resolve) => {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$b = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; ' +
      'Write-Output "$($b.Width)x$($b.Height)"';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        const match = !error ? /(\d+)x(\d+)/.exec(stdout) : null;
        if (!match) {
          resolve(DEFAULT_SCREEN_SIZE);
          return;
        }
        resolve({ width: parseInt(match[1], 10), height: parseInt(match[2], 10) });
      }
    );
  });
}

/**
 * `playwright codegen --channel=...` only steers the browser codegen itself
 * launches to record the flow — verified against Playwright's own
 * `python-pytest`/`java-junit` templates, neither one writes any launch
 * config into the *generated test file* on its own (the fixture-based
 * `pytest-playwright` plugin and the `@UsePlaywright` JUnit extension both
 * default to downloading and launching Playwright's own bundled Chromium
 * unless the test file itself says otherwise). Since a Chromium/Firefox/
 * WebKit download is blocked by company policy here, this stitches in an
 * override that finds the real, already-installed Chrome/Edge executable on
 * disk directly (`executablePath`, resolved from a list of the standard
 * per-machine/per-user install locations, with an env-var override for a
 * nonstandard install) — a stronger guarantee than Playwright's own
 * `channel` resolution, which still depends on Playwright recognizing the
 * install itself. Same override the AI refinement prompt is told to
 * reproduce (see prompts/senior-qe-instructions.md).
 */
function injectBrowserChannelConfig(content: string, language: Language, browserChannel: BrowserChannel): string {
  return language === 'java' ? injectJavaExecutablePath(content, browserChannel) : injectPythonExecutablePath(content, browserChannel);
}

function injectPythonExecutablePath(content: string, browserChannel: BrowserChannel): string {
  const lines = content.split('\n');
  let importEnd = 0;
  while (importEnd < lines.length && (/^\s*(import |from )/.test(lines[importEnd]) || lines[importEnd].trim() === '')) {
    importEnd++;
  }
  const isEdge = browserChannel === 'edge';
  const envVar = isEdge ? 'EDGE_EXECUTABLE_PATH' : 'CHROME_EXECUTABLE_PATH';
  const exeName = isEdge ? 'msedge.exe' : 'chrome.exe';
  const browserLabel = isEdge ? 'Microsoft Edge' : 'Google Chrome';
  // Each a separate os.path.join() argument below, never concatenated with
  // a literal "\" ourselves — a bare "\" inside a normal (non-raw) Python
  // string is an invalid/deprecated escape sequence unless the following
  // character happens to form a real one; letting os.path.join supply the
  // separator sidesteps that entirely, on top of being the idiomatic way to
  // build a path in Python regardless.
  const vendor = isEdge ? 'Microsoft' : 'Google';
  const product = isEdge ? 'Edge' : 'Chrome';
  // Exact locations Chrome/Edge actually install to on Windows — Chrome
  // under Program Files, Edge under Program Files (x86) — checked first;
  // the other Program Files variant and the per-user LOCALAPPDATA install
  // follow as fallbacks for a non-default install.
  const primaryProgramFilesVar = isEdge ? 'PROGRAMFILES(X86)' : 'PROGRAMFILES';
  const primaryProgramFilesDefault = isEdge ? 'C:\\Program Files (x86)' : 'C:\\Program Files';
  const secondaryProgramFilesVar = isEdge ? 'PROGRAMFILES' : 'PROGRAMFILES(X86)';
  const secondaryProgramFilesDefault = isEdge ? 'C:\\Program Files' : 'C:\\Program Files (x86)';
  const candidateLines = [
    `        os.environ.get("${envVar}"),`,
    `        os.path.join(os.environ.get("${primaryProgramFilesVar}", r"${primaryProgramFilesDefault}"), "${vendor}", "${product}", "Application", "${exeName}"),`,
    `        os.path.join(os.environ.get("${secondaryProgramFilesVar}", r"${secondaryProgramFilesDefault}"), "${vendor}", "${product}", "Application", "${exeName}"),`,
    `        os.path.join(os.environ.get("LOCALAPPDATA", ""), "${vendor}", "${product}", "Application", "${exeName}"),`
  ];
  const fixtureBlock = [
    'import os',
    'import pytest',
    '',
    '',
    `def _resolve_${isEdge ? 'edge' : 'chrome'}_executable():`,
    `    # Chromium/Firefox/WebKit downloads are blocked by company policy — find the`,
    `    # real, already-installed ${browserLabel} on disk instead (an explicit`,
    `    # ${envVar} override first, then the standard per-machine/per-user install`,
    `    # locations) and launch that directly, never Playwright's own bundled browser.`,
    '    candidates = [',
    ...candidateLines,
    '    ]',
    '    for path in candidates:',
    '        if path and os.path.isfile(path):',
    '            return path',
    '    raise RuntimeError(',
    `        "Could not find a locally installed ${browserLabel} (${exeName}). Chromium downloads are disabled by "`,
    `        "company policy — install ${browserLabel}, or set the ${envVar} environment variable to its full path."`,
    '    )',
    '',
    '',
    '@pytest.fixture(scope="session")',
    'def browser_type_launch_args(browser_type_launch_args):',
    `    return {**browser_type_launch_args, "executable_path": _resolve_${isEdge ? 'edge' : 'chrome'}_executable()}`,
    ''
  ];
  const hasOsImport = lines.slice(0, importEnd).some((l) => /^\s*import os\s*$/.test(l));
  const hasPytestImport = lines.slice(0, importEnd).some((l) => /^\s*import pytest\s*$/.test(l));
  const block = fixtureBlock.filter((line) => {
    if (hasOsImport && line === 'import os') return false;
    if (hasPytestImport && line === 'import pytest') return false;
    return true;
  });
  const result = [...lines.slice(0, importEnd), ...block, ...lines.slice(importEnd)];
  return result.join('\n');
}

function injectJavaExecutablePath(content: string, browserChannel: BrowserChannel): string {
  const classMatch = content.match(/public\s+class\s+(\w+)/);
  if (!classMatch) {
    return content;
  }
  const className = classMatch[1];
  let result = content;

  if (!result.includes('import com.microsoft.playwright.junit.Options;')) {
    result = result.replace(
      /import com\.microsoft\.playwright\.junit\.UsePlaywright;/,
      `import com.microsoft.playwright.junit.UsePlaywright;\nimport com.microsoft.playwright.junit.Options;\nimport com.microsoft.playwright.junit.OptionsFactory;\nimport java.io.File;\nimport java.nio.file.Paths;`
    );
  }

  // Point @UsePlaywright at this class's own Options factory (added below)
  // instead of the bare, browser-default-launching form codegen emits.
  result = result.replace('@UsePlaywright', `@UsePlaywright(${className}.SoftPlayOptions.class)`);

  const isEdge = browserChannel === 'edge';
  const envVar = isEdge ? 'EDGE_EXECUTABLE_PATH' : 'CHROME_EXECUTABLE_PATH';
  const exeName = isEdge ? 'msedge.exe' : 'chrome.exe';
  const browserLabel = isEdge ? 'Microsoft Edge' : 'Google Chrome';
  const vendorDir = isEdge ? 'Microsoft\\\\Edge' : 'Google\\\\Chrome';
  const methodName = isEdge ? 'resolveEdgeExecutable' : 'resolveChromeExecutable';
  // Exact locations Chrome/Edge actually install to on Windows — Chrome
  // under Program Files, Edge under Program Files (x86) — checked first;
  // the other Program Files variant follows as a fallback for a
  // non-default install.
  const primaryVar = isEdge ? 'PROGRAMFILES(X86)' : 'PROGRAMFILES';
  const primaryDefault = isEdge ? 'C:\\\\Program Files (x86)' : 'C:\\\\Program Files';
  const secondaryVar = isEdge ? 'PROGRAMFILES' : 'PROGRAMFILES(X86)';
  const secondaryDefault = isEdge ? 'C:\\\\Program Files' : 'C:\\\\Program Files (x86)';

  const optionsClass =
    `\n  /** Chromium/Firefox/WebKit downloads are blocked by company policy —\n` +
    `   * finds the real, already-installed ${browserLabel} on disk instead and\n` +
    `   * launches that directly, never Playwright's own bundled browser. */\n` +
    `  public static class SoftPlayOptions implements OptionsFactory {\n` +
    `    @Override\n` +
    `    public Options getOptions() {\n` +
    `      return new Options().setLaunchOptions(\n` +
    `          new com.microsoft.playwright.BrowserType.LaunchOptions().setExecutablePath(Paths.get(${methodName}())));\n` +
    `    }\n\n` +
    `    private static String ${methodName}() {\n` +
    `      String primaryDir = System.getenv().getOrDefault("${primaryVar}", "${primaryDefault}");\n` +
    `      String secondaryDir = System.getenv().getOrDefault("${secondaryVar}", "${secondaryDefault}");\n` +
    `      String localAppData = System.getenv().getOrDefault("LOCALAPPDATA", "");\n` +
    `      String[] candidates = new String[] {\n` +
    `          System.getenv("${envVar}"),\n` +
    `          primaryDir + "\\\\${vendorDir}\\\\Application\\\\${exeName}",\n` +
    `          secondaryDir + "\\\\${vendorDir}\\\\Application\\\\${exeName}",\n` +
    `          localAppData + "\\\\${vendorDir}\\\\Application\\\\${exeName}"\n` +
    `      };\n` +
    `      for (String candidate : candidates) {\n` +
    `        if (candidate != null && new File(candidate).isFile()) {\n` +
    `          return candidate;\n` +
    `        }\n` +
    `      }\n` +
    `      throw new IllegalStateException(\n` +
    `          "Could not find a locally installed ${browserLabel} (${exeName}). Chromium downloads are disabled by "\n` +
    `              + "company policy — install ${browserLabel}, or set the ${envVar} environment variable to its full path.");\n` +
    `    }\n` +
    `  }\n`;

  const lastBraceIndex = result.lastIndexOf('}');
  if (lastBraceIndex === -1) {
    return result;
  }
  return result.slice(0, lastBraceIndex) + optionsClass + result.slice(lastBraceIndex);
}
