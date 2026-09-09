@echo off
setlocal enabledelayedexpansion

rem Build Object Spy end to end: install deps, bump the build number,
rem compile TypeScript, and package a single .vsix. Run from anywhere -
rem it changes to its own folder first.
cd /d "%~dp0"

echo ============================================
echo  Object Spy for Playwright -- build
echo ============================================

rem Redundant with .npmrc's playwright_skip_browser_download=1 -- belt and
rem suspenders so a browser is never fetched here even if .npmrc is somehow
rem bypassed (a global npm config override, etc).
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

rem Prerequisite check: a node_modules left in a half-broken state by an
rem earlier interrupted/failed install (a killed build, an antivirus lock,
rem a registry hiccup mid-install) can satisfy npm's own "up to date" check
rem while still being missing files a later step actually needs -- npm then
rem skips reinstalling anything, and that missing piece only surfaces much
rem later as a much more confusing failure (e.g. step [4/4] below suddenly
rem can't find vsce). Checking for the one file "npm run package" actually
rem depends on catches that specific corruption up front and forces a clean
rem reinstall ONLY when it's actually needed -- a normal, healthy
rem node_modules is left alone, so this doesn't slow down every build.
if exist node_modules (
  if not exist "node_modules\@vscode\vsce\vsce" (
    echo.
    echo [0/6] node_modules looks incomplete/corrupted ^(missing @vscode/vsce^) -- reinstalling from scratch...
    rmdir /s /q node_modules
    del /q package-lock.json >nul 2>&1
  )
)

echo.
echo [1/6] Installing dependencies (npm install)...
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/6] Bumping build number...
call node scripts\bump-version.js
if errorlevel 1 goto :fail

echo.
echo [3/6] Compiling TypeScript...
call npm run compile
if errorlevel 1 goto :fail

echo.
rem A literal "&" in any echo'd text below would be parsed by cmd.exe as a
rem command separator (e.g. "Verify & Fix" silently splits into two
rem commands, the second one failing with "'Fix' is not recognized...") --
rem spell it out ("and") rather than escaping ("^&"), so a future edit here
rem doesn't reintroduce the same trap by typing a plain "&".
echo [4/6] Running automated tests (Verify and Fix agent, security-critical path checks, ...)...
call npm test
if errorlevel 1 goto :fail

echo.
echo [5/6] Packaging extension (vsce package)...
del /q *.vsix >nul 2>&1
rem `npm run package` (not `npx vsce package`) -- its "package" script in
rem package.json calls @vscode/vsce's own JS file directly via `node`
rem (node_modules/@vscode/vsce/vsce), the ALREADY-INSTALLED devDependency,
rem rather than relying on a node_modules\.bin\vsce shim being present and
rem on PATH (the prerequisite check above exists because that shim can go
rem missing without npm noticing). `npx vsce` looks for the bare
rem (unscoped, deprecated) "vsce" package instead, which isn't what's
rem installed here -- npx doesn't find it locally and silently fetches+
rem installs a separate, stale copy into npm's global npx cache on EVERY
rem build, which is both slow and (on a locked-down/AV-monitored machine)
rem prone to failing outright when npx tries to clean up that temporary
rem install afterward.
call npm run package
if errorlevel 1 goto :fail

echo.
rem `vsce package` exiting 0 does NOT guarantee the .vsix it wrote is
rem actually complete -- this package bundles the full `playwright`
rem dependency and regularly comes out ~100MB+, so an interrupted process
rem (closed terminal, antivirus interference, sleep, OOM) can leave a
rem plausible-sized but TRUNCATED file on disk with `vsce` itself never
rem reporting an error. That surfaced for real as "End of central
rem directory record signature not found" when someone tried to install a
rem build like that on a different machine -- this step catches it here,
rem at build time, instead.
echo [6/6] Verifying the packaged .vsix is a complete, valid zip...
call node scripts\verify-vsix.js
if errorlevel 1 goto :fail

echo.
echo ============================================
echo  Build succeeded.
echo ============================================
for %%F in (*.vsix) do echo  Output: %%F
exit /b 0

:fail
echo.
echo ============================================
echo  BUILD FAILED -- see the output above.
echo ============================================
exit /b 1
