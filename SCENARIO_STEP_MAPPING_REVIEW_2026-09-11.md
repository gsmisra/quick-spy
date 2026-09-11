# Multi-scenario AI step-definition generation review

**Result: scenario selection works in the controlled tests, but correct generated step-definition mapping is not enforced.** Switching scenarios can mix the selected scenario, the recorded reference flow, and the generated result. These defects can explain the reported first-scenario/second-scenario behavior.

No application fixes were made. Only review fixtures, diagnostic scripts and this report were added.

## What was tested

Used one feature containing a shared Background, a normal Scenario, a Scenario Outline with two Examples rows, another normal Scenario, and another Outline with different Examples. Exercised the actual compiled parser, FeatureFilePanel selection handler and ObjectSpyPanel.runLlmRefinement. Tested Java and Python prompt generation, full and partial step selections, sequential scenario changes, and changes during asynchronous generation.

The Copilot/model response, UI and redaction boundaries were simulated. Thus these checks establish what the application sends and accepts; they do **not** establish what a real Copilot model generates or whether generated code executes. No real Cucumber/pytest-bdd match/run was performed. The deliberately incorrect response below is test input, not an observed live model response.

- Production TypeScript compilation: passed.
- Current complete test suite: **834 passed, 0 failed**.
- Additional scenario-switch diagnostic assertions: passed; recorded problematic behavior below.
- Application source and existing tests were not modified.

Artifacts in `review-results/2026-09-11/`:

- `scenario-switch.feature`: reproducible feature fixture.
- `scenario-switch-probes.cjs`: review-only executable diagnostics.
- `scenario-switch-results.json`: recorded results.
- `java-second-prompt.txt` / `python-second-prompt.txt`: actual second-scenario prompt text from the controller, using synthetic reference code.
- `test-suite.txt`: complete unit-test output.

Reproduce: `npm run compile`, then `node review-results/2026-09-11/scenario-switch-probes.cjs`.

## First scenario, then second: observed results

| Check | Result |
| --- | --- |
| Select Scenario 1, Search catalog | Its own Gherkin steps reach its prompt. |
| Then select Scenario 2, Add product to basket | The new Gherkin block contains Scenario 2, not Scenario 1. No scenario-index off-by-one reproduced. |
| Outline Examples | Both product/quantity rows retained; placeholders remain available. |
| Partial selection of Scenario 2 | Unchecked step omitted; selected `And` correctly becomes its effective `When`; Examples retained. |
| Outline → normal Scenario | New scenario selected without the old Outline block. |
| Outline → another Outline | Correct second Outline and its Examples; previous Examples do not leak into the Gherkin block. |
| Reference recording after switching | Search recording remains in the basket-generation prompt if the user has not replaced it. |
| Switch while preparation is awaiting RAG | Output filename selected for Scenario 1, final prompt targets Scenario 2. |
| Switch while model response is pending | Scenario 1 response is accepted after Scenario 2 becomes linked. |
| Return wrong Scenario 1 definitions for Scenario 2 | Accepted and displayed without a missing/unrelated-step error. |

## Expected mapping for the second scenario

For the full selected Outline, the required mapping is:

| Gherkin step | Expected definition shape (Java illustration) | Data requirement |
| --- | --- | --- |
| `Given I open the shop` (Background) | `@Given("I open the shop")` | Shared setup definition. |
| `When I add "<product>" to my basket` | `@When("I add {string} to my basket")` | Pass the product argument to the basket action. |
| `And I set quantity to <quantity>` | `@When("I set quantity to {int}")` | Pass the quantity argument to the quantity action. |
| `Then the basket contains <quantity> items` | `@Then("the basket contains {int} items")` | Assert against the quantity argument. |

The same three Outline definitions must support both `hat/1` and `coat/2`; they must not hardcode the first Examples row. Search-only definitions do not implement these basket steps. The application currently asks for this linkage in its instructions, but does not check the returned definitions against this mapping.

## Findings

### S01 — P1: scenario changes can alter an in-flight generation request

**Locations:** `src/panel/objectSpyPanel.ts:230–237`, `1526`, `1628–1641`, `1677–1690`, `1711–1733`, `2249`.

The selection callback replaces `this.linkedScenario` without cancelling or invalidating the current generation. Generation reads that mutable field repeatedly across asynchronous operations. The suggested output filename is assigned at the beginning, while the final prompt reads the scenario again later.

**Reproduced:** start generating Search catalog, pause preparation, select Add product to basket, resume. The suggested filename remains `SearchCatalog`, but the outgoing prompt targets Add product to basket using the search recording.

**Also reproduced:** pause the first scenario's model response, select the second scenario, complete the first response. The linked scenario is Add product to basket, but `// Search catalog result` is accepted. Selection alone does not cancel the request; the existing request-identity check only protects against a newer generation request.

**Impact:** the badge, saved filename and code can refer to different scenarios. This is a confirmed lifecycle defect, distinct from model accuracy.

**Suggested correction, not implemented:** snapshot scenario/selected steps/recording/settings at generation start, bind output metadata to that snapshot, and cancel or clearly retain an explicitly labeled old request when selection changes. Ensure verification uses the generated artifact's scenario identity too, rather than the latest linked selection.

### S02 — P1: second scenario receives the first scenario's recording without a correspondence check

**Locations:** `src/panel/objectSpyPanel.ts:230–237`, `907–918`, `3155` onward, especially the Reference Playwright-generated code section and Linked Gherkin section around `3290`.

Switching the Gherkin selection does not associate a new recording with that scenario. The next request consumes whatever code is still in the shared Playwright editor. Its instructions require reusing those exact locators while also implementing every selected step.

**Reproduced:** Scenario 2's basket Outline is present, but the only recording is searching for boots. No recorded basket interaction exists. There is no warning that the recording does not cover the selected steps. This happens in both Java and Python prompt paths. The synthetic reference was deliberately left unchanged to mirror switching only the feature selection.

**Impact:** the model must reconcile incompatible inputs and may reuse search actions for basket definitions or invent missing actions. The test establishes the conflicting input, not which mistake a live model will make. Re-recording the second flow may avoid this particular condition.

**Suggested correction, not implemented:** associate recording context with scenario identity, or explicitly warn when a newly selected scenario has no matching recording. Track uncovered steps; do not describe unrelated reference actions as sufficient grounding for them.

### S03 — P1: incorrect/missing step definitions are accepted as completed output

**Locations:** `src/panel/objectSpyPanel.ts:1711–1733`, `2263–2266`; `prompts/senior-qe-instructions.md`, section 5.

After the response arrives, the path extracts a code block, optionally adds RAG traceability, and publishes it. It does not verify definition coverage, matching expressions, Outline parameterization, undefined steps, or unrelated definitions.

**Reproduced:** while Scenario 2 was linked, the simulated provider returned only:

```java
@When("I search for {string}")
public void search(String text) {}
```

The controller accepted that exact code. None of the basket Outline's three selected steps—or the full-selection Background—was implemented.

**Impact:** generation can finish normally while the feature has no usable matching definitions. The UI's completion is not proof of mapping correctness.

**Suggested correction, not implemented:** validate the selected step-to-definition mapping before treating generation as complete. Include Background where appropriate, expand Outline rows for matching checks, detect missing/ambiguous definitions and parameter mismatches, and check existing definitions if outputs are intended to coexist. Report unresolved mappings explicitly or request targeted regeneration. Comments quoting Gherkin steps are not sufficient validation of annotation/decorator patterns or method behavior.

### S04 — P2: Python generation is not given the real linked feature-file path

**Locations:** `src/panel/featureFilePanel.ts:LinkedScenario.featureFilePath`; `src/panel/objectSpyPanel.ts:3290–3345`; Python binding instructions in `prompts/senior-qe-instructions.md` section 5.

The selected object contains `/fixtures/shopping.feature`, but that path is absent from the generated prompts in both language tests. Generation supplies feature/scenario names and text, while the Python standard asks for a `@scenario('file.feature', 'Scenario Name')` binding. The model cannot determine the actual feature location from the feature title reliably.

**Impact:** even correctly named Python steps can be coupled to an invented feature filename or incorrect relative path. The probe confirms missing path context, not a live invalid binding.

**Suggested correction, not implemented:** provide an explicit feature binding path relative to the intended generated test location and the selected scenario name; validate it. Avoid permitting all-scenarios binding when generating definitions only for one selected scenario unless shared definitions are known to cover the rest.

## Other relevant behavior

- Standard UI-mode generation requires nonempty recorded code even when a complete feature scenario is linked. The probe with the second Outline and an empty recording gets “Record some user action first before triggering AI analysis.” This is the existing guard, not a new selection bug.
- There is one generated-code panel. Starting the second generation clears/replaces the first output; this is not a cumulative multi-scenario step-definition library. No prior generated-definition inventory is passed into the tested second request. Generating/saving both scenarios separately therefore still needs a shared-definition and ambiguity check before claiming the complete feature runs.
- The picker deliberately normalizes `And` to its effective keyword, so the prompt does not retain every original keyword verbatim. The tested `And` → `When` conversion is correct for definition selection.
- These probes focus on Standard mode's linked-feature AI code generation. Total Agentic mode has a different ingestion/generation flow and was not substituted for this test.

## Conclusion

The simple “second scenario accidentally uses the first scenario's Gherkin block” hypothesis was **not reproduced in sequential selection**. The confirmed risks are stale recording context, mutable scenario state during generation, and missing output mapping validation. Fixing those should precede any claim that every selected Gherkin step is mapped correctly. A final live Copilot run followed by actual BDD matching/execution is still needed to validate model-produced definitions end to end.
