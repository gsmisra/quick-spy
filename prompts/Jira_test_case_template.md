# Jira Manual Test Case — CSV Template

This file controls exactly what "Generate Manual Test Cases in CSV" (Total
Agentic Mode) produces. It is sent to the LLM verbatim as part of the
prompt — edit the **Columns** list and the **Rules** below to match your
team's own Jira import format. This file lives at
`.github/Jira_test_case_template.md` in your workspace once SoftPlay first
creates it, and is safe to edit, rename fields, or commit to source control
like any other `.github/*.md` file this extension reads.

## Columns

Produce ONE CSV file with exactly these columns, in exactly this order:

1. `Summary` — a short, one-line title for the test case.
2. `Description` — one or two sentences describing what this test verifies and why.
3. `Test Data` — any specific input values, credentials (never real secrets — see below), or preconditions this test needs.
4. `Step #` — the step number within this test case, starting at 1.
5. `Step Explanation` — the action to perform for this step, written as a clear, single imperative instruction (e.g. "Click the 'Submit' button").
6. `Expected Result` — what should happen after this step, specific enough for a manual tester to judge pass/fail without guessing.
7. `Label` — one or more short Jira labels for this test case (e.g. `regression`, `smoke`, `api`), space-separated in a single cell.
8. `Component` — the application component/module this test case belongs to.

## Rules

- One CSV row per STEP, not per test case — a test case with 4 steps produces 4 rows sharing the same `Summary`/`Description`/`Test Data`/`Label`/`Component`, each with its own `Step #`/`Step Explanation`/`Expected Result`. This is the shape Jira's own CSV test-case importers expect.
- Cover every distinct scenario/requirement found in the ingested input files and any linked feature file/scenario — do not invent scenarios that aren't grounded in the actual input.
- Never include a real password, API key, token, or other secret in any cell — use a placeholder (e.g. `<TEST_USER_PASSWORD>`) instead, exactly like this extension's own Auto Password Encryption standard for generated automation code.
- Output ONLY the CSV — a header row exactly matching the column list above, followed by the data rows. No commentary before or after, no fenced code block wrapper, no explanation of what you did.
- Quote any cell containing a comma, quotation mark, or newline per standard CSV rules (a literal `"` inside a quoted cell is escaped as `""`).
