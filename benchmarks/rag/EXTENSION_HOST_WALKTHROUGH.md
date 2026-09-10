# RAG feature — manual Extension Host walkthrough

A step-by-step checklist for a human to run in a REAL, running Extension Development
Host — the one verification step nothing in this codebase's automated test suite can
perform (no GUI/webview automation tool exists for this extension; see
`test/rag/ragCorpusGenerator.cancellation.test.ts` and
`test/rag/ragIndexer.summary.test.ts` for how far the AUTOMATED side goes instead,
using a `Module._load`-faked `vscode` — real orchestration logic, but never a real
webview or a real Copilot model).

This closes the "manual Extension Host validation" item that was never performed
during this session's own remediation work, and gives every fix below a real,
end-to-end, human-observed check — not just a unit test's word for it.

## What this does and doesn't prove

Every scenario below exercises REAL code paths end-to-end (a real webview, real
`vscode.workspace.fs`, and — for generation — a real GitHub Copilot model call). It
does NOT re-prove the pure logic the unit tests already cover exhaustively (exact
argument-count arithmetic, hash-scheme dispatch, etc.) — it proves that logic is
correctly WIRED into the running extension, which is a different, real, and
previously-unverified claim.

Model output is not deterministic. A generation scenario's PRECISE recipe text will
vary between runs; what matters is the SHAPE of the outcome (accepted vs. rejected,
staleness state, which file got written), not exact wording.

## Prerequisites

1. Open this repo (`soft-play`) in VS Code.
2. `npm install` (if not already), then `npm run compile` — or just let the launch
   config's own `preLaunchTask` do this.
3. Press **F5** (or Run → Start Debugging → "Run Object Spy Extension"). A new
   **Extension Development Host** window opens.
4. In that NEW window: **File → Open Folder…** and open this SAME `soft-play`
   repo folder. (F5's own launch config doesn't pre-select a workspace folder — you
   must open one yourself. Using this repo itself means Scenario 0 below has real
   fixture content to check against immediately, with zero extra setup.)
5. In that window, open **View → Output**, and select **"SoftPlay"** from the
   channel dropdown — this is where freshness reports and RAG indexing warnings are
   logged (`objectSpyPanel.ts`'s own `outputChannel`).
6. Run **SoftPlay: Open Settings** from the Command Palette (Ctrl/Cmd+Shift+P).
   Under **GitHub Copilot**, link Copilot and pick a model — generation scenarios
   (1, 2, 6) need a real model call and will simply be greyed out / fail fast
   without one. Freshness/retrieval scenarios (0, 4, 5) don't need Copilot at all.
7. Scenarios 1–4 and 6 create throwaway Java files DIRECTLY AT THE REPO ROOT (not
   in a subfolder) — this is not a style choice: a plain (non-zip) "Choose Files…"
   upload always records an EMPTY `relativePath` regardless of which folder the
   file was picked from (`settingsPanel.ts`'s own front-end code hard-codes
   `relativePath: ''` for that path — only a `.zip` upload preserves internal
   folder structure). Freshness re-checking later resolves a recipe's `sourcePath`
   against `<workspace-root>/<fileName>` — so if the source file isn't ALSO sitting
   at the workspace root when you check freshness, Scenario 4 will report `MISSING`
   instead of the `STALE` result it's actually testing for. **Clean these files up
   at the end** (see Wrap-up) — they're scratch content, not part of the fixture
   corpus from the previous step.

---

## Scenario 0 — baseline retrieval + the F16 skip-summary (no Copilot needed)

This repo's own `.github/rag/` already contains exactly what this scenario needs:
4 valid fixture recipes (`walkthrough-fixtures/`) sitting alongside
`bdd-java-framework-guide.md` (a real file that fails to parse — no YAML
frontmatter — the actual, reproduced F16 scenario).

1. From the Command Palette, run **SoftPlay: Check RAG Source Freshness**. (Not
   the Settings panel's own "Check Freshness" button here — that one shows results
   IN the panel but never logs to the Output channel, since it doesn't wire up an
   `onWarn` callback the way the Command Palette version does; use it in Scenario 4
   instead, where either surface works.)
2. Switch to the **Output → SoftPlay** channel.

**Expected:**
- One `[UNVERIFIABLE]` (or similar) line per fixture recipe — hand-authored recipes
  have no `sourcePath`/`sourceHash`, so freshness has nothing to check them against;
  this is the correct, honest state for them, not a bug.
- A line in the RAG indexing output reading approximately:
  `Indexed 4 valid recipe(s); skipped 1 file(s) that could not be read or parsed as a
  recipe — see the reason(s) above.`
  — this is the F16 fix. Without it, a `.github/rag/` folder visibly containing a
  file (`bdd-java-framework-guide.md`) that silently contributes ZERO recipes to the
  index had no visible trace anywhere. Confirm you also see the PER-FILE reason
  (`Skipping .../bdd-java-framework-guide.md — Missing YAML frontmatter...`) logged
  just above the summary line.

3. Open the Object Spy panel (**SoftPlay: Open Panel**) and, in whatever surface
   lets you enter or generate a scenario/request, use text like:
   *"verify the order was inserted into the database"* (or open the API-request
   flow and describe the same). Generate/send it.
4. Check the Output channel (or the actual prompt sent, if visible) for a RAG
   section referencing `postgres-query-one` — the fixture whose title/tags most
   closely match that phrasing (already confirmed via `retrieveRagMatches()`
   directly against these exact 4 fixtures before this walkthrough was written —
   see the previous turn's verification output).

---

## Scenario 1 — a successful generation (happy path)

1. At the repo root, create `OrderValidator.java`:

   ```java
   package com.acme.testkit.util;

   public class OrderValidator {
     public boolean isValid(int quantity, double price) {
       return quantity > 0 && price > 0;
     }
   }
   ```

2. Settings panel → **Generate RAG Corpus Format** → **Choose Files…** → select
   `OrderValidator.java` → **Generate**.
3. Watch the live progress list under the Generate button.

**Expected:** one line reaches `success`, and a new file appears under
`.github/rag/` (likely `order-validator-is-valid.md` or similar). Open it — it
should have valid YAML frontmatter, a `sourcePath`/`sourceHash`/`sourceHashScheme`
trio (this IS a real per-capability generation, so the F09 scheme should read
`sha256-with-same-file-deps-v1`), and a body with `Use:`/`Requires:`/`API:` lines
plus one fenced call example referencing `isValid(...)` with exactly 2 arguments.

---

## Scenario 2 — nested-class ownership (F03)

1. At the repo root, create `RetryPolicy.java`:

   ```java
   package com.acme.testkit.util;

   public class RetryPolicy {
     public void run(Runnable action) {
       action.run();
     }

     public static class Backoff {
       public long delayMillis(int attempt) {
         return attempt * 100L;
       }
     }
   }
   ```

2. Generate from this file the same way as Scenario 1.

**Expected:** TWO recipes get generated — one for `run` and one for `delayMillis`.
Open the `delayMillis` recipe and confirm its `sourcePath` reads
`RetryPolicy.java#delayMillis` (a bare filename, no folder prefix — a plain
"Choose Files…" upload never records one; see Prerequisites step 7) and that
nothing in it claims `Backoff.delayMillis` belongs to `RetryPolicy`. Before F03's
fix, `Backoff`'s method would have been mislabeled as belonging to the OUTER
class `RetryPolicy` — this is the concrete, visible difference to look for.

---

## Scenario 3 — cancellation (F14)

Pick ONE of these two (the second is more visually confirmable since the panel
stays open and you can watch it happen):

**A. Close the panel mid-generation.** Upload 3–4 files at once (reuse
`OrderValidator.java`, `RetryPolicy.java`, plus one or two more trivial classes at
the repo root),
click **Generate**, and close the Settings panel tab within a second or two —
before the batch would normally finish. Reopen Settings afterward and check
`.github/rag/` — the file count should be LESS than what a full run would have
produced, and nothing partially-written or corrupted should exist (every file that
does exist should be a complete, valid recipe — cancellation never leaves a
half-written file, only a whole one or none at all).

**B. Re-trigger Generate while the first batch is still running.** Upload the same
3–4 files, click **Generate**, then WITHOUT waiting for it to finish, click
**Generate** again (same files, or add one more first). Watch the live progress
list: some of the FIRST batch's lines should read `skipped` with a message like
*"Cancelled."* or *"Cancelled after the model responded — not saved."* — this is
the exact F14 fix (the loop-top check and the post-response check,
respectively) — while the SECOND batch's own lines proceed normally to `success`.

**Expected either way:** no recipe from a CANCELLED unit is ever written — check
`.github/rag/` against the progress list to confirm every `success` line has a
matching file and every `skipped` line does not.

---

## Scenario 4 — dependency-aware staleness (F09's main fix, live)

This is the single most valuable scenario to run by hand — it's the one place a
"passing unit test" and "actually works in the running extension" could plausibly
diverge, since it touches real file-system freshness resolution.

1. At the repo root (see the note in Prerequisites step 7 — this MUST be at the
   root, not a subfolder, for freshness re-checking to find it again in step 4
   below), create `OrderCalculator.java`:

   ```java
   package com.acme.testkit.util;

   public class OrderCalculator {
     public double totalWithTax(double subtotal) {
       return applyTax(subtotal);
     }

     public double applyTax(double subtotal) {
       return subtotal * 1.08;
     }
   }
   ```

2. Generate from this file (as in Scenario 1) — you should get two recipes,
   `totalWithTax` and `applyTax`.
3. Check freshness — either the Settings panel's **Check Freshness** button (see
   results in-panel) or the Command Palette's **SoftPlay: Check RAG Source
   Freshness** (see results in the Output channel) both work here; unlike
   Scenario 0, this step doesn't depend on the `onWarn`-only F16 summary line.
   Confirm BOTH recipes report `FRESH`.
4. Now edit `OrderCalculator.java` **only inside `applyTax`** — change the tax
   rate, e.g. `1.08` → `1.10`. Do **not** touch `totalWithTax`'s own lines at all.
5. Save the file, then check freshness again the same way.

**Expected:**
- `applyTax`'s own recipe reports `STALE` (its own excerpt changed — expected
  under either hashing scheme).
- `totalWithTax`'s recipe **also** now reports `STALE`, even though not one
  character of `totalWithTax`'s own source excerpt changed. This is the F09 fix:
  `totalWithTax` calls `applyTax` in the SAME file, so its `sourceHash` was
  computed (at generation time, step 2 above) over BOTH excerpts together
  (`SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES`) — a real behavior change in
  a same-file dependency is no longer invisible. Before this session's fix,
  `totalWithTax` would have stayed `FRESH` here — a real, reproducible false
  negative.

---

## Scenario 5 (optional / advanced) — source-root ambiguity and symlink containment

These two F09 sub-fixes are real but require deliberately unusual workspace setups
to trigger; skip unless you want the deeper check.

**Ambiguity:** open a SECOND folder in the SAME VS Code window (multi-root:
File → Add Folder to Workspace…) that also has a copy of `OrderCalculator.java`
directly at ITS OWN root (same reasoning as Prerequisites step 7 — bare filename,
no folder component). Run **Check Freshness** again — the affected recipe's
`detail` text should now include a note like *"N other open workspace folder(s)
ALSO have a file at this same relative path"* rather than silently picking one
with no trace.

**Symlink containment:** (POSIX/WSL only — Windows symlinks need elevated
privileges or Developer Mode) create a symlink inside your workspace folder
pointing OUTSIDE it (e.g. `ln -s /etc some-workspace-subdir/escape`), give a
recipe a hand-edited `sourcePath` that routes through that symlinked directory,
and confirm **Check Freshness** reports `MISSING` (never actually reads whatever
the symlink really points to) rather than silently following it.

---

## Scenario 6 (best-effort) — a rejected/quarantined draft (F04)

Model output isn't fully controllable, so this can't be forced deterministically
— but it's worth attempting once. Try generating from a file whose method takes
an unusual number of parameters (e.g. 4–5 primitive `int`/`String` params with
generic names) — a model is more likely to produce a plausible-but-wrong-arity
example in this shape. If a generation IS rejected, its message names the reason
and points at a saved draft under `.github/rag-drafts/` (a sibling folder,
structurally unreachable by the real indexer's own recursive glob — confirm this
draft never shows up in Scenario 0's retrieval). If nothing gets rejected after a
couple of tries, that's fine — this scenario's value is confirming the
quarantine PATH works when it does trigger, not forcing a specific trigger.

---

## Wrap-up

1. Delete the scratch Java files created at the repo root: `OrderValidator.java`,
   `RetryPolicy.java`, `OrderCalculator.java`, plus anything added for Scenario 3's
   extra files or Scenario 6's attempt(s).
2. Delete every `.github/rag/*.md` file generated during Scenarios 1, 2, 3, and 6
   (anything NOT under `walkthrough-fixtures/` and not `bdd-java-framework-guide.md`
   itself) — these were throwaway generations from scratch files, not part of the
   real fixture corpus.
3. If Scenario 5's optional multi-root/symlink setup was done, remove the added
   workspace folder and any symlink created for it.
4. Record the outcome of each scenario (pass/fail/skipped, with any surprises)
   wherever this session's release-gate status is being tracked.
