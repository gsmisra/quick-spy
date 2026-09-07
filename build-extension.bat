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

echo.
echo [1/4] Installing dependencies (npm install)...
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/4] Bumping build number...
call node scripts\bump-version.js
if errorlevel 1 goto :fail

echo.
echo [3/4] Compiling TypeScript...
call npm run compile
if errorlevel 1 goto :fail

echo.
echo [4/4] Packaging extension (vsce package)...
del /q *.vsix >nul 2>&1
rem `npm run package` (not `npx vsce package`) -- npm scripts run with
rem node_modules\.bin on PATH, so this resolves the ALREADY-INSTALLED
rem @vscode/vsce devDependency's own "vsce" binary directly. `npx vsce`
rem looks for the bare (unscoped, deprecated) "vsce" package instead, which
rem isn't what's installed here -- npx doesn't find it locally and silently
rem fetches+installs a separate, stale copy into npm's global npx cache on
rem EVERY build, which is both slow and (on a locked-down/AV-monitored
rem machine) prone to failing outright when npx tries to clean up that
rem temporary install afterward.
call npm run package
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
