import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AutomationMode, Language } from '../settings/settingsStore';

export interface EnvironmentCheckResult {
  ok: boolean;
  /** Human-readable summary for the Output channel / an error message —
   * either "all good" detail or exactly what's missing and how to fix it. */
  message: string;
}

/** Runs `command args...` and resolves with its combined stdout+stderr and
 * exit code — never rejects (a missing executable is a normal, expected
 * outcome here, not an exceptional one), so callers can just branch on
 * `code`.
 *
 * `shell` defaults to false (plain `execFile`, args passed through exactly
 * as given — required for `python -c "import x"`-style checks, since
 * `execFile`'s shell mode does NOT reliably re-quote an argument containing
 * spaces on Windows: verified it actually splits "import playwright" into
 * two separate argv entries at the cmd.exe level, breaking `-c`). Pass
 * `shell: true` only for a command that specifically needs it — `mvn`
 * resolves to a `.cmd`/`.bat` launcher on Windows, which plain `execFile`
 * cannot locate at all (Windows `CreateProcess` needs an exact executable,
 * no PATHEXT resolution, unless a shell does that resolution first); none
 * of the args `mvn` is ever called with here contain spaces, so shell mode
 * never hits the quoting problem above for it. */
function run(
  command: string,
  args: string[],
  cwd?: string,
  shell = false,
  timeoutMs = 30_000
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, windowsHide: true, timeout: timeoutMs, shell }, (error, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`.trim();
      // execFile's `error` for a plain non-zero exit still carries a
      // `.code` (the process's own exit code) — only fall back to -1 for a
      // genuine spawn failure (command not found, permissions, etc.).
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
      resolve({ code, output });
    });
  });
}

/**
 * "Take necessary steps beforehand to assert all the necessary Maven, Java
 * and other environmental parameters are in place" — verifies `java` and
 * `mvn` are both on PATH and report their versions, without installing or
 * modifying anything: an enterprise/bank environment is not somewhere this
 * extension should silently mutate. On failure, `message` names exactly
 * what's missing and points at the standard way to install it.
 */
export async function checkJavaEnvironment(): Promise<EnvironmentCheckResult> {
  const java = await run('java', ['-version']);
  if (java.code !== 0) {
    return {
      ok: false,
      message:
        'Java (JDK) was not found on PATH — "java -version" failed. Install a JDK ' +
        '(17 or newer recommended) and ensure it is on PATH before executing generated Java code.'
    };
  }
  const mvn = await run('mvn', ['-version'], undefined, true);
  if (mvn.code !== 0) {
    return {
      ok: false,
      message:
        'Apache Maven was not found on PATH — "mvn -version" failed. Install Maven ' +
        'and ensure it is on PATH before executing generated Java code.'
    };
  }
  const javaVersionLine = java.output.split('\n')[0]?.trim() || 'java';
  const mvnVersionLine = mvn.output.split('\n')[0]?.trim() || 'mvn';
  return { ok: true, message: `${javaVersionLine} · ${mvnVersionLine}` };
}

// Import names vs. the pip package names required to install them —
// differ only for pytest-playwright (`pytest_playwright` import).
const OFFLINE_PYTHON_PACKAGES: Record<AutomationMode, { import: string; pipName: string }[]> = {
  api: [
    { import: 'requests', pipName: 'requests' },
    { import: 'pytest', pipName: 'pytest' }
  ],
  ui: [
    { import: 'playwright', pipName: 'playwright' },
    { import: 'pytest', pipName: 'pytest' },
    { import: 'pytest_playwright', pipName: 'pytest-playwright' }
  ]
};

function venvPythonPath(venvDir: string): string {
  return process.platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
}

function tailForMessage(output: string): string {
  const MAX = 800;
  return output.length > MAX ? `…${output.slice(-MAX)}` : output;
}

/**
 * Self-provisions the pip packages "Verify & Fix Code" needs — API mode's
 * `requests`/`pytest`, or UI mode's `playwright`/`pytest`/`pytest-playwright`
 * — entirely offline, from the extension's own bundled wheels under
 * `resources/python/wheels` (see resources/python/README.md for how that
 * folder is populated), so a bank/enterprise machine with no PyPI egress
 * never needs an internet-based `pip install` to run generated Python code.
 *
 * API mode's packages are pure-Python universal wheels, portable to any OS.
 * UI mode's `playwright` (and its native `greenlet` dependency) are NOT —
 * PyPI ships a real per-OS/per-Python-ABI binary for those (Playwright's
 * Python package bundles its own self-contained driver, Node.js binary
 * included, no external Node/browser-download step needed for the
 * `executable_path=<real Chrome/Edge>` pattern this extension always uses —
 * see codegenManager.ts) — so only Windows x64 builds are bundled here,
 * matching this extension's existing Windows-only scope (e.g.
 * detectPrimaryScreenSize()). UI mode falls back to the old check-only
 * behavior (report what's missing, install nothing) on any other OS.
 *
 * Provisions (once, lazily — reused on every later call) a DEDICATED
 * virtual environment per mode under the extension's own global storage,
 * NEVER the user's system/base Python, so this never mutates an environment
 * outside the extension's own control. Returns that venv's own python
 * executable as `pythonCommand` — every subsequent compile-check/pytest run
 * uses it instead of the system interpreter.
 */
async function ensureOfflinePythonEnv(
  basePythonCommand: string,
  resourcesRoot: string,
  storageDir: string,
  automationMode: AutomationMode
): Promise<EnvironmentCheckResult & { pythonCommand?: string }> {
  const packages = OFFLINE_PYTHON_PACKAGES[automationMode];
  const modeLabel = automationMode === 'api' ? 'API' : 'UI';
  const venvDir = path.join(storageDir, `${automationMode}-python-env`);
  const venvPython = venvPythonPath(venvDir);
  const wheelsDir = path.join(resourcesRoot, 'resources', 'python', 'wheels');

  if (!fs.existsSync(venvPython)) {
    const created = await run(basePythonCommand, ['-m', 'venv', venvDir], undefined, false, 60_000);
    if (created.code !== 0 || !fs.existsSync(venvPython)) {
      return {
        ok: false,
        message: `Could not create the offline Python environment for ${modeLabel} Automation verification (${venvDir}):\n${created.output}`
      };
    }
  }

  const missing: string[] = [];
  for (const pkg of packages) {
    const result = await run(venvPython, ['-c', `import ${pkg.import}`]);
    if (result.code !== 0) missing.push(pkg.pipName);
  }
  if (missing.length > 0) {
    if (!fs.existsSync(wheelsDir)) {
      return {
        ok: false,
        message:
          `The offline Python environment is missing ${missing.join(', ')}, and the extension's bundled ` +
          `offline package cache was not found at "${wheelsDir}" — try reinstalling the extension.`
      };
    }
    const install = await run(
      venvPython,
      ['-m', 'pip', 'install', '--no-index', '--find-links', wheelsDir, ...missing],
      undefined,
      false,
      120_000
    );
    if (install.code !== 0) {
      return {
        ok: false,
        message: `Failed to install bundled offline package(s) (${missing.join(', ')}) into the local ${modeLabel} Automation Python environment:\n${tailForMessage(install.output)}`
      };
    }
  }

  return {
    ok: true,
    pythonCommand: venvPython,
    message: `Offline ${modeLabel} Automation Python environment ready (${packages.map((p) => p.pipName).join(' + ')}, bundled with the extension — no internet required).`
  };
}

/**
 * Same idea for Python: verifies a `python` (or `python3`) interpreter is on
 * PATH, then self-provisions the pip packages the generated test file
 * actually needs — see `ensureOfflinePythonEnv()` — whenever `resourcesRoot`
 * and `storageDir` are supplied (the extension's real callers always pass
 * both; they're optional only so this function stays testable/callable
 * without a live extension context) and, for UI mode, the current OS is one
 * the bundled wheels actually support (Windows). Otherwise falls back to
 * the old check-only behavior: report exactly what pip package is missing
 * and the command to install it, installing nothing itself.
 */
export async function checkPythonEnvironment(
  automationMode: AutomationMode = 'ui',
  resourcesRoot?: string,
  storageDir?: string
): Promise<EnvironmentCheckResult & { pythonCommand?: string }> {
  const candidates = ['python', 'python3'];
  let pythonCommand: string | undefined;
  let versionLine = '';
  for (const candidate of candidates) {
    const result = await run(candidate, ['--version']);
    if (result.code === 0) {
      pythonCommand = candidate;
      versionLine = result.output.split('\n')[0]?.trim() || candidate;
      break;
    }
  }
  if (!pythonCommand) {
    return {
      ok: false,
      message: 'Python was not found on PATH — neither "python --version" nor "python3 --version" succeeded. Install Python 3 and ensure it is on PATH before executing generated Python code.'
    };
  }

  const canGoOffline = resourcesRoot && storageDir && (automationMode === 'api' || process.platform === 'win32');
  if (canGoOffline) {
    return ensureOfflinePythonEnv(pythonCommand, resourcesRoot, storageDir, automationMode);
  }

  const required = OFFLINE_PYTHON_PACKAGES[automationMode].map((p) => p.import);
  const missing: string[] = [];
  for (const moduleName of required) {
    const result = await run(pythonCommand, ['-c', `import ${moduleName}`]);
    if (result.code !== 0) {
      missing.push(moduleName === 'pytest_playwright' ? 'pytest-playwright' : moduleName);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      pythonCommand,
      message:
        `${versionLine} found, but missing required pip package(s): ${missing.join(', ')}. Install them with:\n` +
        `    ${pythonCommand} -m pip install ${missing.join(' ')}\n` +
        (automationMode === 'api'
          ? ''
          : '(this never installs a browser — the generated code launches the real, already-installed Chrome/Edge.)')
    };
  }
  return { ok: true, pythonCommand, message: versionLine };
}

export function checkEnvironment(
  language: Language,
  automationMode: AutomationMode = 'ui',
  resourcesRoot?: string,
  storageDir?: string
): Promise<EnvironmentCheckResult & { pythonCommand?: string }> {
  return language === 'java' ? checkJavaEnvironment() : checkPythonEnvironment(automationMode, resourcesRoot, storageDir);
}
