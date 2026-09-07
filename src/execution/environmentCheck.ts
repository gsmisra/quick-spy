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

const API_PYTHON_PACKAGES = ['requests', 'pytest'];

function venvPythonPath(venvDir: string): string {
  return process.platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
}

/**
 * API Automation mode's `requests`/`pytest` — unlike UI mode's Playwright
 * (a real browser automation library the user is expected to already have
 * installed, see this module's other doc comments), these two are small,
 * pure-Python, and safe to ship and self-provision entirely offline —
 * exactly what "Verify & Fix Code" needs in a bank/enterprise environment
 * with no PyPI egress. Bundled as offline pip wheels under the extension's
 * own `resources/python/wheels` (universal `py3-none-any` builds only, so
 * they install on any OS/Python combination without compiling anything —
 * see resources/python/README.md for how that folder is populated).
 *
 * Provisions (once, lazily — reused on every later call) a dedicated
 * virtual environment under the extension's own global storage, NEVER the
 * user's system/base Python, so this never mutates an environment outside
 * the extension's own control. Returns that venv's own python executable
 * as `pythonCommand` — every subsequent compile-check/pytest run in API
 * mode uses it instead of the system interpreter.
 */
async function ensureOfflineApiPythonEnv(
  basePythonCommand: string,
  resourcesRoot: string,
  storageDir: string
): Promise<EnvironmentCheckResult & { pythonCommand?: string }> {
  const venvDir = path.join(storageDir, 'api-python-env');
  const venvPython = venvPythonPath(venvDir);
  const wheelsDir = path.join(resourcesRoot, 'resources', 'python', 'wheels');

  if (!fs.existsSync(venvPython)) {
    const created = await run(basePythonCommand, ['-m', 'venv', venvDir], undefined, false, 60_000);
    if (created.code !== 0 || !fs.existsSync(venvPython)) {
      return {
        ok: false,
        message: `Could not create the offline Python environment for API Automation verification (${venvDir}):\n${created.output}`
      };
    }
  }

  const missing: string[] = [];
  for (const moduleName of API_PYTHON_PACKAGES) {
    const result = await run(venvPython, ['-c', `import ${moduleName}`]);
    if (result.code !== 0) missing.push(moduleName);
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
      60_000
    );
    if (install.code !== 0) {
      return {
        ok: false,
        message: `Failed to install bundled offline package(s) (${missing.join(', ')}) into the local API Automation Python environment:\n${tailForMessage(install.output)}`
      };
    }
  }

  return {
    ok: true,
    pythonCommand: venvPython,
    message: 'Offline API Automation Python environment ready (requests + pytest, bundled with the extension — no internet required).'
  };
}

function tailForMessage(output: string): string {
  const MAX = 800;
  return output.length > MAX ? `…${output.slice(-MAX)}` : output;
}

/**
 * Same idea for Python: verifies a `python` (or `python3`) interpreter is on
 * PATH, then that the pip packages the generated test file actually needs
 * are importable — UI mode: `playwright` (the library import, never its
 * own browser binaries — those are never installed, see
 * codegenManager.ts), `pytest`, and `pytest-playwright` (supplies the
 * `page`/`browser_type_launch_args` fixtures the generated code overrides);
 * these are reported only, never installed, exactly as before.
 *
 * API mode: `requests` and `pytest`, self-provisioned entirely offline from
 * the extension's own bundled wheels into a dedicated venv the extension
 * fully owns — see `ensureOfflineApiPythonEnv()` — whenever `resourcesRoot`
 * and `storageDir` are supplied (the extension's real callers always pass
 * both; they're optional only so this function stays testable/callable
 * without a live extension context).
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

  if (automationMode === 'api' && resourcesRoot && storageDir) {
    return ensureOfflineApiPythonEnv(pythonCommand, resourcesRoot, storageDir);
  }

  const required = automationMode === 'api' ? ['requests', 'pytest'] : ['playwright', 'pytest', 'pytest_playwright'];
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
