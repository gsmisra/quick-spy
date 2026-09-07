# Bundled offline pip wheels (`wheels/`)

Ships `requests` + `pytest` and their full transitive dependency tree — as
**universal** wheels only (`py3-none-any`/`py2.py3-none-any`, never a
platform/CPython-version-specific build) — so **"Verify & Fix Code" for API
Automation mode (Python)** never has to reach PyPI. `requests`/`pytest`
themselves are pure Python; the one dependency that also ships
platform-specific accelerated wheels (`charset-normalizer`) is pinned here to
a version/file that still publishes a universal build, so this folder works
unmodified on Windows, macOS, and Linux, on any Python 3 version — see
`environmentCheck.ts`'s `ensureOfflineApiPythonEnv()`, which installs from
here via `pip install --no-index --find-links=<this folder>` into a
dedicated venv under the extension's own global storage (never the user's
system Python).

This is deliberately scoped to API mode's `requests`/`pytest` only. UI mode's
Playwright + `pytest-playwright` are NOT bundled here (a real browser
automation stack, far larger, and the user is expected to already have
Playwright + a real installed browser — see codegenManager.ts) — bundling
those is out of scope and UI mode's environment check is untouched.

## Regenerating it

Only needed to pick up newer `requests`/`pytest` releases. From a machine
with normal internet access:

```bash
mkdir -p resources/python/wheels && cd resources/python/wheels
python -m pip download requests pytest --dest . --no-cache-dir
# charset-normalizer resolves to a platform-specific wheel by default —
# replace it with a universal one (check the PyPI file list first; not
# every release publishes a py3-none-any build, but recent ones generally
# do alongside their accelerated per-platform builds):
rm charset_normalizer-*-cp*-*.whl
python -m pip download "charset-normalizer==<version with a py3-none-any wheel>" \
  --dest . --no-cache-dir --no-deps --only-binary :all: \
  --platform any --python-version 3 --implementation py --abi none
```

Verify every `.whl` filename in this folder ends in `-py3-none-any.whl` or
`-py2.py3-none-any.whl` before committing — any `-cp3xx-` /
`-manylinux*`/`-macosx*`/`-win*` tag means it won't install on some other
platform, defeating the point of bundling it.
