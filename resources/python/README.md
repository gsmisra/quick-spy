# Bundled offline pip wheels (`wheels/`)

Ships everything **"Verify & Fix Code" (Python, both automation modes)**
needs as offline pip wheels, so it never has to reach PyPI:

- **API Automation**: `requests` + `pytest` and their full transitive
  dependency tree, as **universal** wheels (`py3-none-any`/
  `py2.py3-none-any`, never a platform/CPython-version-specific build) — the
  one dependency that also ships platform-specific accelerated wheels
  (`charset-normalizer`) is pinned here to a version/file that still
  publishes a universal build. Portable to Windows, macOS, and Linux, any
  Python 3 version.
- **UI Automation**: `playwright` + `pytest` + `pytest-playwright` and their
  dependency tree. Unlike the API side, `playwright` and its native
  `greenlet` dependency are genuinely platform/ABI-specific (PyPI ships a
  real per-OS binary — Playwright's Python package bundles its own
  self-contained driver, Node.js binary included, so no external Node
  install or `playwright install` browser-download step is ever needed for
  the `executable_path=<real Chrome/Edge>` pattern this extension always
  uses — see codegenManager.ts) — so **only Windows x64 builds are bundled**
  here, matching this extension's existing Windows-only scope (e.g.
  `detectPrimaryScreenSize()` in codegenManager.ts). `playwright` itself
  ships one `py3-none-win_amd64` wheel (Python-version-agnostic); `greenlet`
  does not, so cp39–cp313 win_amd64 builds are all bundled side by side —
  pip picks whichever matches the venv's actual interpreter automatically.

`environmentCheck.ts`'s `ensureOfflinePythonEnv()` installs from here via
`pip install --no-index --find-links=<this folder>` into a dedicated venv
per mode under the extension's own global storage (never the user's system
Python). UI mode's offline provisioning is skipped (falls back to the old
check-only behavior, installing nothing) on any OS other than Windows.

## Regenerating it

Only needed to pick up newer package releases. From a Windows machine with
normal internet access:

```bash
mkdir -p resources/python/wheels && cd resources/python/wheels

# API mode packages (universal wheels).
python -m pip download requests pytest --dest . --no-cache-dir
# charset-normalizer resolves to a platform-specific wheel by default —
# replace it with a universal one (check the PyPI file list first; not
# every release publishes a py3-none-any build, but recent ones generally
# do alongside their accelerated per-platform builds):
rm charset_normalizer-*-cp*-*.whl
python -m pip download "charset-normalizer==<version with a py3-none-any wheel>" \
  --dest . --no-cache-dir --no-deps --only-binary :all: \
  --platform any --python-version 3 --implementation py --abi none

# UI mode packages (Windows x64 only).
python -m pip download playwright pytest-playwright --dest . --no-cache-dir \
  --platform win_amd64 --python-version 3.12 --implementation cp --abi cp312 --only-binary=:all:
# That pulls in one cp312-specific greenlet wheel — fetch the other Python
# versions' builds too so any venv's interpreter has a match:
for abi in cp39 cp310 cp311 cp313; do
  ver="${abi#cp}"; ver="${ver:0:1}.${ver:1}"
  python -m pip download greenlet --dest . --no-cache-dir --no-deps \
    --only-binary=:all: --platform win_amd64 --python-version "$ver" --implementation cp --abi "$abi"
done
```

Verify every non-Windows-specific `.whl` filename ends in `-py3-none-any.whl`
or `-py2.py3-none-any.whl` before committing (any `-cp3xx-manylinux*`/
`-macosx*` tag means it won't install on some other platform, defeating the
point of bundling it) — `playwright-*-py3-none-win_amd64.whl` and the
`greenlet-*-cp3xx-cp3xx-win_amd64.whl` files are the deliberate Windows-only
exceptions.
