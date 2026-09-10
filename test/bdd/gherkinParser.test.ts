import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseFeatureFile, buildFilteredScenarioText, buildFilteredScenarioParts } from '../../src/bdd/gherkinParser';

// --- Baseline smoke coverage (this module had zero existing tests) -------

test('parses feature name, description, and a simple scenario', () => {
  const feature = parseFeatureFile(
    `Feature: Login\n` + `  As a user I want to log in\n\n` + `Scenario: Successful login\n` + `  Given I am on the login page\n` + `  When I submit valid credentials\n` + `  Then I see the dashboard\n`
  );
  assert.equal(feature.name, 'Login');
  assert.match(feature.description, /As a user/);
  assert.equal(feature.scenarios.length, 1);
  const scenario = feature.scenarios[0];
  assert.equal(scenario.kind, 'Scenario');
  assert.equal(scenario.name, 'Successful login');
  assert.equal(scenario.steps.length, 3);
  assert.deepEqual(
    scenario.steps.map((s) => s.effectiveKeyword),
    ['Given', 'When', 'Then']
  );
});

test('resolves And/But/* to the nearest preceding Given/When/Then', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\nScenario: Y\n  Given a precondition\n  And another precondition\n  When an action\n  And another action\n  Then a result\n  But not this other result\n`
  );
  const steps = feature.scenarios[0].steps;
  assert.deepEqual(
    steps.map((s) => s.effectiveKeyword),
    ['Given', 'Given', 'When', 'When', 'Then', 'Then']
  );
});

test('parses scenario and feature tags', () => {
  const feature = parseFeatureFile(`@feature-tag\nFeature: X\n\n@smoke @regression\nScenario: Y\n  Given a step\n`);
  assert.deepEqual(feature.tags, ['feature-tag']);
  assert.deepEqual(feature.scenarios[0].tags, ['smoke', 'regression']);
});

test('parses a Background block shared before scenarios', () => {
  const feature = parseFeatureFile(`Feature: X\n\nBackground:\n  Given a shared precondition\n\nScenario: Y\n  When an action\n`);
  assert.ok(feature.background);
  assert.equal(feature.background!.steps.length, 1);
  assert.equal(feature.scenarios[0].steps.length, 1);
});

test('buildFilteredScenarioText includes only selected steps, with resolved keywords', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario: Y\n  Given a\n  And b\n  When c\n  Then d\n`);
  const scenario = feature.scenarios[0];
  // Deselect index 0 ("Given a") — index 1 ("And b") should now read as "Given b".
  const text = buildFilteredScenarioText(scenario, [1, 2, 3]);
  assert.doesNotMatch(text, /Given a\b/);
  assert.match(text, /Given b/);
  assert.match(text, /When c/);
  assert.match(text, /Then d/);
});

test('buildFilteredScenarioParts exposes per-step texts separately, never including a deselected step', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario: Y\n  Given a\n  And b\n  When c\n  Then d\n`);
  const scenario = feature.scenarios[0];
  const parts = buildFilteredScenarioParts(scenario, [1, 2, 3]);
  assert.equal(parts.stepTexts.length, 3);
  assert.match(parts.stepTexts[0], /Given b/); // "And b" resolved to "Given b" since "Given a" was deselected
  assert.match(parts.stepTexts[1], /When c/);
  assert.match(parts.stepTexts[2], /Then d/);
  assert.ok(!parts.stepTexts.some((t) => /\ba\b/.test(t) && !/Given b/.test(t)), 'the deselected step must not appear anywhere');
});

test('buildFilteredScenarioText is exactly buildFilteredScenarioParts\' pieces joined together', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario Outline: Y\n  When step <a>\n\nExamples:\n  | a |\n  | 1 |\n`);
  const scenario = feature.scenarios[0];
  const parts = buildFilteredScenarioParts(scenario, [0]);
  const text = buildFilteredScenarioText(scenario, [0]);
  const rebuilt = [parts.header, ...parts.stepTexts, ...parts.exampleTexts].filter((b) => b.trim().length > 0).join('\n\n');
  assert.equal(text, rebuilt);
});

test('buildFilteredScenarioParts includes Examples text regardless of step selection (not individually selectable)', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario Outline: Y\n  When step <a>\n  Then result <b>\n\nExamples:\n  | a | b |\n  | 1 | 2 |\n`);
  const scenario = feature.scenarios[0];
  const parts = buildFilteredScenarioParts(scenario, [0]); // only the "When" step selected
  assert.equal(parts.stepTexts.length, 1);
  assert.equal(parts.exampleTexts.length, 1);
  assert.match(parts.exampleTexts[0], /Examples:/);
});

// --- Examples tag-line lookahead (the bug this fixes) ---------------------

test('a single tag line before Examples: still attaches correctly (baseline, pre-existing behavior)', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\nScenario Outline: Y\n  When step <a>\n\n@one\nExamples:\n  | a |\n  | 1 |\n`
  );
  const scenario = feature.scenarios[0];
  assert.equal(scenario.examples.length, 1);
  assert.deepEqual(scenario.examples[0].tags, ['one']);
  assert.deepEqual(scenario.examples[0].rows, [['1']]);
});

test('TWO separate tag lines before Examples: both attach, and the table is not lost — the bug this fixes', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\nScenario Outline: Y\n  When step <a>\n\n@one\n@two\nExamples:\n  | a |\n  | 1 |\n`
  );
  const scenario = feature.scenarios[0];
  assert.equal(scenario.examples.length, 1, 'Examples must not be silently dropped');
  assert.deepEqual(scenario.examples[0].tags.sort(), ['one', 'two']);
  assert.deepEqual(scenario.examples[0].rows, [['1']]);
});

test('THREE tag lines, and tag lines on the SAME line, before Examples: all attach', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\nScenario Outline: Y\n  When step <a>\n\n@one\n@two @three\n@four\nExamples:\n  | a |\n  | 1 |\n`
  );
  const scenario = feature.scenarios[0];
  assert.equal(scenario.examples.length, 1);
  assert.deepEqual(scenario.examples[0].tags.sort(), ['four', 'one', 'three', 'two']);
});

test('a comment line between two tag lines before Examples: is tolerated', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\nScenario Outline: Y\n  When step <a>\n\n@one\n# a comment\n@two\nExamples:\n  | a |\n  | 1 |\n`
  );
  const scenario = feature.scenarios[0];
  assert.equal(scenario.examples.length, 1);
  assert.deepEqual(scenario.examples[0].tags.sort(), ['one', 'two']);
});

test('a blank line between two tag lines before Examples: is tolerated', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\nScenario Outline: Y\n  When step <a>\n\n@one\n\n@two\nExamples:\n  | a |\n  | 1 |\n`
  );
  const scenario = feature.scenarios[0];
  assert.equal(scenario.examples.length, 1);
  assert.deepEqual(scenario.examples[0].tags.sort(), ['one', 'two']);
});

test('multiple Examples blocks, each with their own (possibly multi-line) tags, all attach separately', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\n` +
      `Scenario Outline: Y\n  When step <a>\n\n` +
      `@one\n@two\nExamples:\n  | a |\n  | 1 |\n\n` +
      `@three\nExamples:\n  | a |\n  | 2 |\n`
  );
  const scenario = feature.scenarios[0];
  assert.equal(scenario.examples.length, 2);
  assert.deepEqual(scenario.examples[0].tags.sort(), ['one', 'two']);
  assert.deepEqual(scenario.examples[0].rows, [['1']]);
  assert.deepEqual(scenario.examples[1].tags, ['three']);
  assert.deepEqual(scenario.examples[1].rows, [['2']]);
});

test('tag lines that hit EOF with no Examples: ever following are NOT treated as an Examples block', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario Outline: Y\n  When step <a>\n\n@one\n@two\n`);
  const scenario = feature.scenarios[0];
  assert.equal(scenario.examples.length, 0);
});

test('tag lines that turn out to belong to the NEXT scenario are left for it, not swallowed here', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\n` +
      `Scenario Outline: Y\n  When step <a>\n\n` +
      `@belongs-to-next\nScenario: Z\n  Given another step\n`
  );
  assert.equal(feature.scenarios.length, 2);
  assert.equal(feature.scenarios[0].examples.length, 0);
  assert.deepEqual(feature.scenarios[1].tags, ['belongs-to-next']);
  assert.equal(feature.scenarios[1].name, 'Z');
});

test('filtered scenario text RETAINS the Examples table even when tags spanned multiple lines', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\nScenario Outline: Y\n  When step <a>\n\n@one\n@two\nExamples:\n  | a |\n  | 1 |\n`
  );
  const scenario = feature.scenarios[0];
  const text = buildFilteredScenarioText(scenario, [0]);
  assert.match(text, /Examples:/);
  assert.match(text, /\|\s*a\s*\|/);
  assert.match(text, /\|\s*1\s*\|/);
});

// --- Escaped pipes in table cells (the bug this fixes) --------------------

test('an ordinary table with no escaping parses normally', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario Outline: Y\n  When step <a> <b>\n\nExamples:\n  | a | b |\n  | 1 | 2 |\n`);
  const ex = feature.scenarios[0].examples[0];
  assert.deepEqual(ex.header, ['a', 'b']);
  assert.deepEqual(ex.rows, [['1', '2']]);
});

test('an escaped pipe inside a cell does not corrupt the row\'s cell count — the bug this fixes', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario Outline: Y\n  When step <a> <b>\n\nExamples:\n  | a | b |\n  | x\\|y | z |\n`);
  const ex = feature.scenarios[0].examples[0];
  assert.deepEqual(ex.rows, [['x|y', 'z']]);
});

test('a data table (not just Examples) also honors escaped pipes', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\nScenario: Y\n  Given the following data:\n    | col1  | col2 |\n    | a\\|b | c    |\n`
  );
  const step = feature.scenarios[0].steps[0];
  assert.deepEqual(step.dataTable, [
    ['col1', 'col2'],
    ['a|b', 'c']
  ]);
});

test('an escaped backslash before a real delimiter is decoded to one literal backslash, not treated as escaping the pipe', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario Outline: Y\n  When step <a> <b>\n\nExamples:\n  | a | b |\n  | x\\\\ | y |\n`);
  const ex = feature.scenarios[0].examples[0];
  assert.deepEqual(ex.rows, [['x\\', 'y']]);
});

test('a newline escape within a cell becomes a real newline character', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario Outline: Y\n  When step <a>\n\nExamples:\n  | a |\n  | line1\\nline2 |\n`);
  const ex = feature.scenarios[0].examples[0];
  assert.deepEqual(ex.rows, [['line1\nline2']]);
});

test('empty cells are preserved as empty strings, not skipped', () => {
  const feature = parseFeatureFile(`Feature: X\n\nScenario Outline: Y\n  When step <a> <b>\n\nExamples:\n  | a | b |\n  |   | y |\n`);
  const ex = feature.scenarios[0].examples[0];
  assert.deepEqual(ex.rows, [['', 'y']]);
});

test('multiple escaped pipes in a single row all parse correctly', () => {
  const feature = parseFeatureFile(
    `Feature: X\n\nScenario Outline: Y\n  When step <a> <b> <c>\n\nExamples:\n  | a | b | c |\n  | x\\|y | 1\\|2\\|3 | z |\n`
  );
  const ex = feature.scenarios[0].examples[0];
  assert.deepEqual(ex.rows, [['x|y', '1|2|3', 'z']]);
});
