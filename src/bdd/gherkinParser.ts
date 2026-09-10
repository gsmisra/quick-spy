/**
 * A small, dependency-free Gherkin parser — deliberately not the official
 * `@cucumber/gherkin` package: that pulls in a large dependency tree (and a
 * WASM-backed matcher in recent versions) for what this extension only ever
 * needs for two things — splitting a .feature file into individually
 * selectable Scenario/Scenario Outline segments (see featureFilePanel.ts),
 * and handing the LLM the EXACT raw text of whichever one the user picked,
 * verbatim. Gherkin's line-oriented grammar is simple enough that a
 * line-by-line parser handles the real-world shape of feature files
 * (Feature/Background/Scenario/Scenario Outline/Examples, step keywords,
 * tags, data tables, doc strings) without needing a full formal grammar.
 *
 * Not handled (rare enough in practice to be an accepted gap rather than a
 * silent-wrong-answer risk): the Gherkin `Rule:` keyword (a newer addition,
 * groups scenarios under a rule) and non-English keyword dialects (`# language:`
 * headers) — both parse as plain text rather than being recognized
 * specially, which degrades to "this scenario's raw text still displays and
 * is still selectable/sendable to the LLM correctly" rather than breaking.
 */

export interface GherkinStep {
  /** The literal keyword as written: Given/When/Then/And/But/*. */
  keyword: string;
  text: string;
  dataTable?: string[][];
  docString?: string;
  /** `keyword` resolved to Given/When/Then per Gherkin's own rule (an
   * And/But/* step takes the keyword of the nearest preceding Given/When/Then
   * above it in the same block, or Given if it's the first step) — computed
   * once here rather than left to the LLM, so a step still reads
   * standalone-correct in buildFilteredScenarioText() below even when steps
   * around it were deselected and never make it into the LLM prompt. Mirrors
   * the resolution rule in prompts/senior-qe-instructions.md section 5. */
  effectiveKeyword: 'Given' | 'When' | 'Then';
  /** Exact original text of this step — its keyword line plus any data
   * table/doc string lines that follow it, verbatim (leading indentation
   * included, trailing blank lines trimmed). Used by featureFilePanel.ts to
   * render one syntax-highlighted, individually checkable line per step, and
   * by buildFilteredScenarioText() to reconstruct a scenario down to only
   * the steps the user selected without hand-reformatting anything. */
  rawText: string;
}

export interface GherkinExamples {
  name: string;
  tags: string[];
  header: string[];
  rows: string[][];
  /** Exact original text of this Examples block (its own tag line(s), the
   * `Examples:` line, and its full table), verbatim. */
  rawText: string;
}

export interface GherkinScenario {
  kind: 'Scenario' | 'Scenario Outline';
  name: string;
  tags: string[];
  steps: GherkinStep[];
  examples: GherkinExamples[];
  /** Exact original text of this scenario block (its tags line(s) through
   * its last step/Examples table), verbatim — what actually gets sent to
   * the LLM, never a re-serialized reconstruction. */
  rawText: string;
}

export interface GherkinFeature {
  name: string;
  description: string;
  tags: string[];
  background: { steps: GherkinStep[]; rawText: string } | undefined;
  scenarios: GherkinScenario[];
}

const STEP_KEYWORDS = ['Given', 'When', 'Then', 'And', 'But', '*'];

export function parseFeatureFile(content: string): GherkinFeature {
  const lines = content.split(/\r?\n/);

  let featureName = '';
  const descriptionLines: string[] = [];
  let featureTags: string[] = [];
  let background: { steps: GherkinStep[]; rawText: string } | undefined;
  const scenarios: GherkinScenario[] = [];

  let pendingTags: string[] = [];
  let i = 0;

  // Feature: / description lines / tags, up to the first Background:/Scenario:
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    if (trimmed.startsWith('@')) {
      pendingTags.push(...parseTags(trimmed));
      i++;
      continue;
    }
    if (/^Feature:/i.test(trimmed)) {
      featureName = trimmed.replace(/^Feature:/i, '').trim();
      featureTags = pendingTags;
      pendingTags = [];
      i++;
      // Description lines: anything before the next Background:/Scenario:/tag.
      while (i < lines.length && !isBlockStart(lines[i].trim())) {
        if (lines[i].trim()) {
          descriptionLines.push(lines[i].trim());
        }
        i++;
      }
      break;
    }
    i++;
  }

  // Background: (optional, at most one)
  if (i < lines.length && /^Background:/i.test(lines[i].trim())) {
    const start = i;
    i++;
    const steps: GherkinStep[] = [];
    i = consumeSteps(lines, i, steps);
    background = { steps, rawText: lines.slice(start, i).join('\n').trimEnd() };
    pendingTags = [];
  }

  // Scenario: / Scenario Outline: blocks, each through its Examples (if any).
  let pendingTagsStartLine = -1;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    if (trimmed.startsWith('@')) {
      if (pendingTagsStartLine === -1) {
        pendingTagsStartLine = i;
      }
      pendingTags.push(...parseTags(trimmed));
      i++;
      continue;
    }
    const outlineMatch = /^Scenario Outline:|^Scenario Template:/i.test(trimmed);
    const scenarioMatch = /^Scenario:/i.test(trimmed);
    if (!outlineMatch && !scenarioMatch) {
      i++; // stray line between blocks — tolerate rather than abort the whole parse
      continue;
    }

    const kind: GherkinScenario['kind'] = outlineMatch ? 'Scenario Outline' : 'Scenario';
    const name = trimmed.replace(/^Scenario Outline:|^Scenario Template:|^Scenario:/i, '').trim();
    const tags = pendingTags;
    // Include this scenario's own tag line(s) — if any — in rawText.
    const blockStart = pendingTagsStartLine !== -1 ? pendingTagsStartLine : i;
    pendingTags = [];
    pendingTagsStartLine = -1;
    i++;

    const steps: GherkinStep[] = [];
    i = consumeSteps(lines, i, steps);

    const examples: GherkinExamples[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || t.startsWith('#')) {
        i++;
        continue;
      }
      const exBlockStart = i;
      let exampleTags: string[] = [];
      if (t.startsWith('@')) {
        // Tags directly before "Examples:" belong to that Examples block —
        // but if what follows isn't actually Examples:, they belong to the
        // NEXT scenario instead; peek ahead. Consumes the COMPLETE run of
        // consecutive tag lines (blank lines/comments tolerated in between)
        // into a lookahead buffer FIRST, before deciding what they belong
        // to — a one-line-only lookahead here used to check just the tag
        // line's immediate next line, so a SECOND tag line on its own line
        // (`@one` then `@two`, each before "Examples:") made that check see
        // another tag line instead of "Examples:", fail, and silently drop
        // the entire Examples block for this scenario — both tags (and the
        // table they belonged to) were attributed to the NEXT scenario
        // instead. See the dedicated test for the exact repro.
        const tagsBlockStart = i;
        const tagsHere: string[] = [];
        let j = i;
        while (j < lines.length) {
          const lineJ = lines[j].trim();
          if (lineJ.startsWith('@')) {
            tagsHere.push(...parseTags(lineJ));
            j++;
            continue;
          }
          if (!lineJ || lineJ.startsWith('#')) {
            j++;
            continue;
          }
          break;
        }
        if (j < lines.length && /^Examples:/i.test(lines[j].trim())) {
          exampleTags = tagsHere;
          i = j;
        } else {
          // These tags actually belong to the NEXT scenario, not an
          // Examples block here — rewind `i` to the FIRST tag line in this
          // run so the OUTER loop's own tag-handling branch re-parses the
          // whole run fresh on its next iteration, rather than this loop
          // recording it AND the outer loop recording it again (which
          // would duplicate the tag). This scenario's own rawText slice,
          // computed right after this inner loop ends, correctly stops
          // before this line either way.
          i = tagsBlockStart;
          break;
        }
      }
      if (!/^Examples:/i.test(lines[i].trim())) {
        break; // next Scenario:/Scenario Outline: or EOF
      }
      const exampleName = lines[i].trim().replace(/^Examples:/i, '').trim();
      i++;
      const table = consumeTable(lines, i);
      i = table.nextIndex;
      if (table.rows.length > 0) {
        const exRawText = lines.slice(exBlockStart, i).join('\n').trimEnd();
        examples.push({ name: exampleName, tags: exampleTags, header: table.rows[0], rows: table.rows.slice(1), rawText: exRawText });
      }
    }

    const rawText = lines.slice(Math.max(blockStart, 0), i).join('\n').trimEnd();
    scenarios.push({ kind, name, tags, steps, examples, rawText });
  }

  return {
    name: featureName,
    description: descriptionLines.join('\n'),
    tags: featureTags,
    background,
    scenarios
  };
}

function isBlockStart(trimmed: string): boolean {
  return (
    trimmed.startsWith('@') ||
    /^Background:/i.test(trimmed) ||
    /^Scenario:/i.test(trimmed) ||
    /^Scenario Outline:/i.test(trimmed) ||
    /^Scenario Template:/i.test(trimmed)
  );
}

/** Consumes step lines (Given/When/Then/And/But/*), each optionally followed
 * by a data table or a doc string, until a non-step line is reached.
 * Returns the index just past the last consumed line. */
function consumeSteps(lines: string[], start: number, out: GherkinStep[]): number {
  let i = start;
  // Resets to Given at the start of every block (Background steps and each
  // Scenario/Scenario Outline's steps resolve And/But/* independently) —
  // matches the "or Given if it's the very first step" rule.
  let lastEffective: 'Given' | 'When' | 'Then' = 'Given';
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    const stepMatch = STEP_KEYWORDS.find((k) => new RegExp('^' + escapeRegExp(k) + '\\s').test(trimmed) || trimmed === k);
    if (!stepMatch) {
      break;
    }
    const stepStart = i;
    const keyword = stepMatch;
    const text = trimmed.slice(stepMatch.length).trim();
    i++;

    let dataTable: string[][] | undefined;
    let docString: string | undefined;

    if (i < lines.length && lines[i].trim().startsWith('|')) {
      const table = consumeTable(lines, i);
      dataTable = table.rows;
      i = table.nextIndex;
    } else if (i < lines.length && (lines[i].trim().startsWith('"""') || lines[i].trim().startsWith('```'))) {
      const fence = lines[i].trim().slice(0, 3);
      i++;
      const docLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        docLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      docString = docLines.join('\n');
    }

    const effectiveKeyword: 'Given' | 'When' | 'Then' =
      keyword === 'Given' || keyword === 'When' || keyword === 'Then' ? keyword : lastEffective;
    lastEffective = effectiveKeyword;
    const rawText = lines.slice(stepStart, i).join('\n').trimEnd();

    out.push({ keyword, text, dataTable, docString, effectiveKeyword, rawText });
  }
  return i;
}

export interface FilteredScenarioParts {
  /** Tags line(s) + the "Scenario:"/"Scenario Outline:" name line. */
  header: string;
  /** One entry per SELECTED step, in original scenario order, each already
   * rendered with its *effective* keyword (see `withEffectiveKeyword()`) —
   * never includes a deselected step's text under any circumstances (see
   * `buildFilteredScenarioText()`'s own doc comment on why that guarantee
   * matters). */
  stepTexts: string[];
  /** Raw text of every Examples block belonging to this scenario — current
   * behavior includes ALL of a Scenario Outline's Examples regardless of
   * step selection (Examples aren't individually selectable the way steps
   * are), matching `buildFilteredScenarioText()`'s existing behavior
   * exactly. */
  exampleTexts: string[];
}

/** The structural pieces `buildFilteredScenarioText()` below joins into one
 * string — exposed separately so a caller that needs PER-STEP granularity
 * (rag/ragOperationPlanner.ts's shared operation planner — see its own doc
 * comment) doesn't have to re-implement this same selection/
 * effective-keyword logic, or fall back to re-parsing the ALREADY-FLATTENED
 * text `buildFilteredScenarioText()` produces. */
export function buildFilteredScenarioParts(scenario: GherkinScenario, selectedStepIndices: readonly number[]): FilteredScenarioParts {
  const selected = new Set(selectedStepIndices);
  const header: string[] = [];
  if (scenario.tags.length) {
    header.push(`@${scenario.tags.join(' @')}`);
  }
  header.push(`${scenario.kind}: ${scenario.name}`);

  const stepTexts = scenario.steps
    .map((step, index) => (selected.has(index) ? withEffectiveKeyword(step) : undefined))
    .filter((block): block is string => block !== undefined);

  const exampleTexts = scenario.examples.map((ex) => ex.rawText);

  return { header: header.join('\n'), stepTexts, exampleTexts };
}

/**
 * Reconstructs a scenario down to only the steps the user checked in
 * featureFilePanel.ts's per-step checkboxes — the exact text handed to the
 * LLM as the "linked Gherkin scenario" (see objectSpyPanel.ts's
 * buildLlmPrompt) so a deselected step never becomes part of the analysis
 * context or gets a step definition generated for it, even though its
 * matching Playwright Codegen action may still be sitting in the reference
 * code above it. Every retained step is printed with its *effective*
 * keyword (Given/When/Then — see GherkinStep.effectiveKeyword) rather than
 * its literal one, so a kept "And"/"But"/"*" still reads correctly on its
 * own even when the Given/When/Then it originally followed was deselected
 * and is no longer present in this reconstruction to give it context.
 */
export function buildFilteredScenarioText(scenario: GherkinScenario, selectedStepIndices: readonly number[]): string {
  const { header, stepTexts, exampleTexts } = buildFilteredScenarioParts(scenario, selectedStepIndices);
  return [header, ...stepTexts, ...exampleTexts].filter((block) => block.trim().length > 0).join('\n\n');
}

/** Swaps a step's rawText's first line to print its resolved
 * Given/When/Then instead of a literal And/But/* whose meaning depended on
 * context that may no longer be present — see buildFilteredScenarioText().
 * Left untouched when the literal keyword already IS the effective one. */
function withEffectiveKeyword(step: GherkinStep): string {
  if (step.keyword === step.effectiveKeyword) {
    return step.rawText;
  }
  const newlineIndex = step.rawText.indexOf('\n');
  const firstLine = newlineIndex === -1 ? step.rawText : step.rawText.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? '' : step.rawText.slice(newlineIndex);
  const indent = firstLine.match(/^\s*/)?.[0] ?? '';
  const afterKeyword = firstLine.slice(indent.length + step.keyword.length);
  return `${indent}${step.effectiveKeyword}${afterKeyword}${rest}`;
}

function consumeTable(lines: string[], start: number): { rows: string[][]; nextIndex: number } {
  const rows: string[][] = [];
  let i = start;
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    rows.push(splitTableRow(lines[i]));
    i++;
  }
  return { rows, nextIndex: i };
}

/** Splits ONE `| a | b |`-shaped row into its cells, honoring Gherkin's own
 * cell-escaping rules (`\|` -> a literal pipe, `\\` -> a literal backslash,
 * `\n` -> a newline within a cell) — scanning character by character and
 * splitting ONLY on an UNESCAPED `|`, rather than splitting on every `|`
 * first and unescaping each already-split piece afterward (the previous
 * approach: `line.split('|')` then `.replace(/\\\|/g, '|')` per cell).
 * That order is backwards — `split('|')` doesn't know a `|` was preceded
 * by a backslash, so it cuts the row at an ESCAPED pipe too, before the
 * unescape regex ever gets a chance to run on the (now wrongly-split)
 * pieces. `| a\|b | c |` — a valid two-cell row, `['a|b', 'c']` — used to
 * come out as three cells (`'a\\'`, `'b'`, `'c'`) instead. */
function splitTableRow(rawLine: string): string[] {
  const line = rawLine.trim();
  const cells: string[] = [];
  let current = '';
  // Skip the row's own leading '|' (if present) — same effective bounds as
  // the old `split('|').slice(1, -1)`, just escape-aware from here on.
  let i = line.startsWith('|') ? 1 : 0;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === '|' || next === '\\') {
        current += next;
        i++;
        continue;
      }
      if (next === 'n') {
        current += '\n';
        i++;
        continue;
      }
      // An unrecognized escape (e.g. a lone trailing backslash, or "\x") —
      // keep the backslash literally rather than silently dropping it.
      current += ch;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  // A well-formed row ends with '|', which already closed the last cell
  // above and left `current` empty — but tolerate a row missing its
  // trailing '|' by keeping whatever's left rather than silently dropping
  // it.
  if (current.trim().length > 0) {
    cells.push(current.trim());
  }
  return cells;
}

function parseTags(line: string): string[] {
  return line
    .split(/\s+/)
    .filter((t) => t.startsWith('@'))
    .map((t) => t.slice(1));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
