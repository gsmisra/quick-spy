import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { findUncoveredSteps } from '../../src/panel/stepCoverageChecker';
import type { LinkedScenario } from '../../src/panel/featureFilePanel';

/**
 * S03 (external review, "Multi-scenario AI step-definition generation
 * review", 2026-09-11): `runLlmRefinement()` published whatever code came
 * back with NO check that it actually contained a step definition for
 * every checked Gherkin step. `findUncoveredSteps()` is the (deliberately
 * best-effort, non-blocking) coverage check now run before publishing —
 * see its own doc comment in stepCoverageChecker.ts for the exact matching
 * strategy. No fake-vscode harness needed here: `LinkedScenario` is a
 * type-only import, elided from the compiled JS, so this module has zero
 * runtime `vscode` dependency and can be exercised directly.
 */

function makeScenario(overrides: Partial<LinkedScenario> = {}): LinkedScenario {
  return {
    featureName: 'Shopping',
    featureFilePath: '/fixtures/shopping.feature',
    scenarioName: 'Add product to basket',
    scenarioKind: 'Scenario',
    rawText: 'Scenario: Add product to basket\n\n    When I add "hat" to my basket\n\n    Then the basket contains 1 items',
    backgroundRawText: undefined,
    stepTexts: ['When I add "hat" to my basket', 'Then the basket contains 1 items'],
    exampleTexts: [],
    selectedStepCount: 2,
    totalStepCount: 2,
    javaClassName: 'AddProductBasket',
    pythonModuleName: 'add_product_basket',
    ...overrides
  };
}

test('S03: reports every checked step with no matching step definition (the reproduced bug — one unrelated definition only)', () => {
  const scenario = makeScenario();
  const code = `
    public class AddProductBasket {
      @When("I search for {string}")
      public void iSearchFor(String term) { }
    }
  `;
  const uncovered = findUncoveredSteps(scenario, code, 'java');
  assert.deepEqual(uncovered, ['When I add "hat" to my basket', 'Then the basket contains 1 items']);
});

test('S03: reports nothing when every checked step has a genuinely matching Java step definition', () => {
  const scenario = makeScenario();
  const code = `
    public class AddProductBasket {
      @When("I add {string} to my basket")
      public void iAddToBasket(String item) { }

      @Then("the basket contains {int} items")
      public void basketContains(int count) { }
    }
  `;
  assert.deepEqual(findUncoveredSteps(scenario, code, 'java'), []);
});

test('S03: reports nothing when every checked step has a genuinely matching Python step definition', () => {
  const scenario = makeScenario();
  const code = `
    @when(parsers.parse('I add "{item}" to my basket'))
    def add_to_basket(item):
        pass

    @then(parsers.parse('the basket contains {count:d} items'))
    def basket_contains(count):
        pass
  `;
  // Note: parsers.parse(...) still has a plain string literal as the FIRST
  // argument to the decorator itself — pytest-bdd's own common pattern —
  // so the same simple string-literal extraction still finds it.
  assert.deepEqual(findUncoveredSteps(scenario, code, 'python'), []);
});

test('S03: a genuinely PARTIAL match (different wording, not just different parameters) is still reported as uncovered', () => {
  const scenario = makeScenario();
  const code = `
    @When("I place {string} into my cart")
    public void iPlace(String item) { }
    @Then("the basket contains {int} items")
    public void basketContains(int count) { }
  `;
  const uncovered = findUncoveredSteps(scenario, code, 'java');
  assert.deepEqual(uncovered, ['When I add "hat" to my basket']);
});

test('S03: Background steps are checked when the request was NOT a partial selection', () => {
  const scenario = makeScenario({
    backgroundRawText: 'Background:\n    Given I am logged in\n    And my cart is empty'
  });
  const code = `
    @When("I add {string} to my basket")
    public void a(String s) {}
    @Then("the basket contains {int} items")
    public void b(int n) {}
  `;
  const uncovered = findUncoveredSteps(scenario, code, 'java');
  assert.deepEqual(uncovered, ['Given I am logged in', 'And my cart is empty']);
});

test('S03: Background steps are NOT checked for a partial ("bare snippet") selection — matches buildLlmPrompt()\'s own scope', () => {
  const scenario = makeScenario({
    selectedStepCount: 1,
    totalStepCount: 2,
    backgroundRawText: 'Background:\n    Given I am logged in'
  });
  // No step definitions at all for Background OR the checked step — but
  // Background must be silently excluded either way for a partial request.
  const uncovered = findUncoveredSteps(scenario, '// nothing here', 'java');
  assert.deepEqual(uncovered, ['When I add "hat" to my basket', 'Then the basket contains 1 items']);
});

test('S03: Scenario Outline <placeholders> and quoted literals both normalize to the same wildcard — a parameterized definition still matches', () => {
  const scenario = makeScenario({
    scenarioKind: 'Scenario Outline',
    stepTexts: ['When I add "<item>" to my basket']
  });
  const code = `@When("I add {string} to my basket")\npublic void a(String s) {}`;
  assert.deepEqual(findUncoveredSteps(scenario, code, 'java'), []);
});

test('S03: no linked scenario at all means nothing to check', () => {
  assert.deepEqual(findUncoveredSteps(undefined, '// anything', 'java'), []);
});

test('S03: an empty checked-step set (defensive — should not happen in practice) reports nothing', () => {
  const scenario = makeScenario({ stepTexts: [], selectedStepCount: 0, totalStepCount: 0 });
  assert.deepEqual(findUncoveredSteps(scenario, '// anything', 'java'), []);
});
