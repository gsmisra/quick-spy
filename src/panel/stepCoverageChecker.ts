import { LinkedScenario } from './featureFilePanel';

/**
 * S03 (external review, "Multi-scenario AI step-definition generation
 * review", 2026-09-11): after a "Start AI Code Generation" response
 * arrived, the code was extracted and published with NO check at all that
 * it actually contained a step definition for every checked Gherkin step —
 * reproduced with a hand-crafted response containing only ONE, entirely
 * unrelated step definition, accepted verbatim with no warning.
 *
 * This module is a best-effort, PURELY TEXTUAL coverage check — never a
 * hard gate. A response is still published even when this finds gaps (see
 * objectSpyPanel.ts's own use of `findUncoveredSteps()`); the point is to
 * make a real gap VISIBLE to the user rather than silently invisible, per
 * the review's own suggested correction ("report unresolved mappings
 * explicitly"). It is deliberately NOT a full Cucumber Expression engine or
 * a real compiler/AST parse — it extracts each `@Given`/`@When`/`@Then`
 * (Java) or `@given`/`@when`/`@then` (Python) annotation/decorator's own
 * string-literal matcher from the generated code, then compares each
 * checked Gherkin step's sentence against every matcher using a coarse
 * SHAPE comparison: quoted literals, Scenario Outline `<placeholders>`,
 * bare numbers, and Cucumber Expression `{placeholders}` are all normalized
 * to the same wildcard marker before comparing, since a genuinely correct
 * definition and its step should agree on every OTHER word even though the
 * literal parameter values differ. This mirrors Cucumber's own actual
 * runtime step-matching closely enough to catch the reproduced bug (a
 * definition for a completely different sentence) without this project
 * needing to embed a real Cucumber Expression/regex compiler.
 */

// `[^)]*?` (rather than requiring the quote immediately after `(`) also
// matches pytest-bdd's common `@when(parsers.parse('...'))`/`parsers.re(...)`
// wrapping, not just a bare string literal directly inside the decorator —
// as long as nothing between the decorator and the literal itself closes a
// parenthesis first, which holds for every real wrapping form in practice.
const JAVA_STEP_DEF_PATTERN = /@(?:Given|When|Then)\s*\([^)]*?(["'])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const PYTHON_STEP_DEF_PATTERN = /@(?:given|when|then)\s*\([^)]*?(["'])((?:\\.|(?!\1)[\s\S])*?)\1/g;

const STEP_KEYWORD_LINE = /^\s*(Given|When|Then|And|But|\*)\s+\S/i;

/** Reduces a step sentence (or a step-definition matcher string) to a
 * coarse, parameter-blind SHAPE: every quoted literal, Scenario Outline
 * `<placeholder>`, Cucumber Expression `{placeholder}`, and bare number
 * collapses to the SAME wildcard marker, everything else is
 * lowercased/whitespace-normalized. Two sentences with the same shape are
 * treated as a match — the same practical outcome a real Cucumber Expression
 * match would have, without implementing one. */
function normalizeForMatch(sentence: string): string {
  return sentence
    .replace(/^\s*(Given|When|Then|And|But|\*)\s+/i, '')
    .replace(/"[^"]*"|'[^']*'/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    // Covers plain Cucumber Expression placeholders ({string}, {int}, {}),
    // AND pytest-bdd parsers.parse()'s format-spec style ({count:d}) — any
    // brace-delimited content, not just bare letters.
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/-?\d+(\.\d+)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** A step's own sentence is always its RAW text's first line — a
 * multi-line data table/doc string that may follow is auxiliary detail,
 * never part of the sentence Cucumber actually matches against. */
function stepSentence(stepRawText: string): string {
  const newlineIndex = stepRawText.indexOf('\n');
  return (newlineIndex === -1 ? stepRawText : stepRawText.slice(0, newlineIndex)).trim();
}

function extractStepDefinitionShapes(generatedCode: string, language: 'java' | 'python'): Set<string> {
  const pattern = language === 'java' ? JAVA_STEP_DEF_PATTERN : PYTHON_STEP_DEF_PATTERN;
  pattern.lastIndex = 0;
  const shapes = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(generatedCode))) {
    shapes.add(normalizeForMatch(match[2]));
  }
  return shapes;
}

/** Every individual step LINE inside a raw Background/scenario block —
 * `backgroundRawText` covers potentially several steps at once (unlike
 * `stepTexts`, which is already one entry per step), so this splits back
 * out just the lines that open a new step. */
function stepLinesFrom(rawBlock: string): string[] {
  return rawBlock.split('\n').filter((line) => STEP_KEYWORD_LINE.test(line));
}

/**
 * Returns every checked Gherkin step (as its own readable sentence, e.g.
 * `When I add "hat" to my basket`) that this coverage check found NO
 * plausible step definition for in `generatedCode` — empty when nothing
 * looks uncovered, or when there's no linked scenario at all (nothing to
 * check). Background is only included when `!isPartialSelection` — a
 * partial ("bare snippet") selection deliberately excludes Background from
 * both the prompt and the expected output (see buildLlmPrompt()'s own
 * "Restricted scope" section), so checking it there would falsely flag
 * completely correct, intentionally-scoped output as incomplete.
 */
export function findUncoveredSteps(linkedScenario: LinkedScenario | undefined, generatedCode: string, language: 'java' | 'python'): string[] {
  if (!linkedScenario) {
    return [];
  }
  const isPartialSelection = linkedScenario.selectedStepCount < linkedScenario.totalStepCount;
  const definedShapes = extractStepDefinitionShapes(generatedCode, language);

  const stepsToCheck: string[] = [...linkedScenario.stepTexts];
  if (!isPartialSelection && linkedScenario.backgroundRawText) {
    stepsToCheck.push(...stepLinesFrom(linkedScenario.backgroundRawText));
  }

  const uncovered: string[] = [];
  for (const raw of stepsToCheck) {
    const sentence = stepSentence(raw);
    const shape = normalizeForMatch(sentence);
    if (shape && !definedShapes.has(shape)) {
      uncovered.push(sentence);
    }
  }
  return uncovered;
}
