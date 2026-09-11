// Review only: real parser, picker selection handler and generation controller.
// Copilot/redaction/UI boundaries are mocked. No live AI call or source modification.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');const results=[],prompts=[];
const fixture=`Feature: Shopping
  Background:
    Given I open the shop

  Scenario: Search catalog
    When I search for "boots"
    Then I see catalog results

  Scenario Outline: Add product to basket
    When I add "<product>" to my basket
    And I set quantity to <quantity>
    Then the basket contains <quantity> items

    Examples:
      | product | quantity |
      | hat     | 1        |
      | coat    | 2        |

  Scenario: Remove product
    When I remove "hat" from my basket
    Then the basket is empty

  Scenario Outline: Apply discount
    When I apply discount "<code>"
    Then the discount is <amount>
    Examples:
      | code | amount |
      | SAVE | 10     |
`;
fs.writeFileSync(path.join(__dirname,'scenario-switch.feature'),fixture);
const actualLoad=Module._load;
class CTS{constructor(){this.token={isCancellationRequested:false};}cancel(){this.token.isCancellationRequested=true;}dispose(){}}
const warnings=[];
Module._load=function(id,parent){
 if(id==='vscode')return {CancellationTokenSource:CTS,window:{showWarningMessage:async x=>warnings.push(x)},workspace:{asRelativePath:p=>p}};
 if(parent?.filename.endsWith('objectSpyPanel.js')){
  if(id==='path'||id==='fs')return actualLoad.apply(this,arguments);
  if(id==='../cache/fileCache')return {readFileCachedSync:p=>fs.readFileSync(p,'utf8')};
  if(id==='../security/secretVault')return {TOKEN_MARKER:'ENC[v1:'};
  if(id==='../security/uiPasswordRedactor')return {encryptPasswordLiteralsInCode:async(ctx,code)=>({code,count:0})};
  if(id==='../security/chatInstructionRedactor')return {encryptCredentialsInFreeText:async(ctx,text)=>({text,count:0})};
  if(id==='../llm/copilotClient')return {findModel:async()=>({countTokens:async()=>100,maxInputTokens:100000}),extractCodeBlock:s=>s.replace(/^```\w*\n|\n```$/g,''),CopilotUnavailableError:class extends Error{},PromptTooLargeError:class extends Error{}};
  if(id==='./ragTraceabilityBanner')return {prependRagTraceabilityBanner:code=>({code,observedMatches:[]})};
  return {};
 }
 return actualLoad.apply(this,arguments);
};
const {parseFeatureFile}=require(path.join(root,'out/bdd/gherkinParser'));
const {FeatureFilePanel}=require(path.join(root,'out/panel/featureFilePanel'));
const {ObjectSpyPanel}=require(path.join(root,'out/panel/objectSpyPanel'));
const feature=parseFeatureFile(fixture);
let selected;
const picker=new FeatureFilePanel(s=>selected=s,()=>{});picker.feature=feature;picker.filePath='/fixtures/shopping.feature';
function pick(index,steps){picker.handleMessage({type:'select',payload:{index,selectedStepIndices:steps??feature.scenarios[index].steps.map((_,i)=>i)}});return selected;}
function controller(language='java'){
 const c=Object.create(ObjectSpyPanel.prototype);
 c.context={};c.settingsStore={get:()=>({copilotEnabled:true,copilotModelId:'fake',automationMode:'ui',language,languageVersion:language==='java'?'17':'3.11',browserChannel:'chrome',ragEnabled:false})};
 c.outputChannel={appendLine(){}};c.buildRagSection=async()=>({section:'',matches:[]});c.recordReceivedTokens=async()=>{};
 c.postLlmStart=()=>{c.suggestedAtStart=c.currentSuggestedBaseName();};c.postLlmChunk=()=>{};c.postLlmDone=code=>{c.output=code;};c.postLlmError=e=>{throw Error(e);};
 c.streamCopilotResponse=async prompt=>{prompts.push(prompt);return '```java\n// simulated provider response\n```';};return c;
}
async function main(){
 let reference='page.getByPlaceholder("Search").fill("boots");\npage.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Search")).click();';
 for(const language of ['java','python']){
  reference=language==='java'?'page.getByPlaceholder("Search").fill("boots");\npage.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Search")).click();':'page.get_by_placeholder("Search").fill("boots")\npage.get_by_role("button", name="Search").click()';
  const c=controller(language);c.linkedScenario=pick(0);await c.runLlmRefinement([],reference,'');const first=prompts.at(-1);
  c.linkedScenario=pick(1);await c.runLlmRefinement([],reference,'');const second=prompts.at(-1);
  assert(first.includes('Scenario: Search catalog'));assert(!first.includes('Scenario Outline: Add product'));
  assert(second.includes('Scenario Outline: Add product to basket'));assert(!second.includes('Scenario: Search catalog'));
  assert(second.includes('| coat    | 2'));assert.equal(c.linkedScenario.stepTexts.length,3);
  results.push({case:'first then second '+language,scenarioIsolation:'PASS',outlineRows:'PASS',selectedSteps:c.linkedScenario.stepTexts,oldRecordingStillPresent:second.includes(reference),newBasketLocatorPresent:second.includes('setName("Add to basket")'),linkedFeaturePathIncluded:second.includes('/fixtures/shopping.feature')});
  fs.writeFileSync(path.join(__dirname,language+'-second-prompt.txt'),second);
  c.linkedScenario=pick(1,[1,2]);await c.runLlmRefinement([],reference,'');
  const partial=prompts.at(-1);assert(!partial.includes('When I add "<product>"'));assert(partial.includes('When I set quantity to <quantity>'));
  results.push({case:'partial second '+language,selectedSteps:c.linkedScenario.stepTexts,uncheckedStepAbsent:true,examplesRetained:partial.includes('| coat    | 2')});
  c.linkedScenario=pick(2);await c.runLlmRefinement([],reference,'');assert(prompts.at(-1).includes('Scenario: Remove product'));assert(!prompts.at(-1).includes('Scenario Outline: Add product'));
  c.linkedScenario=pick(1);await c.runLlmRefinement([],reference,'');c.linkedScenario=pick(3);await c.runLlmRefinement([],reference,'');assert(prompts.at(-1).includes('Scenario Outline: Apply discount'));assert(!prompts.at(-1).includes('| coat    | 2'));results.push({case:'outline then another outline '+language,scenarioAndExampleIsolation:'PASS'});
 }
 reference='page.getByPlaceholder("Search").fill("boots");';
 const c=controller();c.linkedScenario=pick(0);let resume,entered;
 const ready=new Promise(r=>entered=r);c.buildRagSection=async()=>{entered();await new Promise(r=>resume=r);return {section:'',matches:[]};};
 const pending=c.runLlmRefinement([],reference,'');await ready;c.linkedScenario=pick(1);resume();await pending;
 results.push({case:'switch during preparation',fileNameAtStart:c.suggestedAtStart,promptNowTargetsSecond:prompts.at(-1).includes('Scenario Outline: Add product'),firstRecordingStillPresent:prompts.at(-1).includes(reference)});
 const streaming=controller();streaming.linkedScenario=pick(0);let finishStream,streamEntered;
 const streamingReady=new Promise(r=>streamEntered=r);streaming.streamCopilotResponse=async()=>{streamEntered();return new Promise(r=>finishStream=r);};
 const streamingRun=streaming.runLlmRefinement([],reference,'');await streamingReady;streaming.linkedScenario=pick(1);finishStream('```java\n// Search catalog result\n```');await streamingRun;
 results.push({case:'switch during model response',currentlyLinked:streaming.linkedScenario.scenarioName,acceptedOutput:streaming.output,cancelled:streaming.llmCancellation.token.isCancellationRequested});
 const wrong=controller();wrong.linkedScenario=pick(1);
 wrong.streamCopilotResponse=async()=> '```java\n@When("I search for {string}")\npublic void search(String text) {}\n```';
 await wrong.runLlmRefinement([],reference,'');
 results.push({case:'wrong first-scenario definitions returned for second',acceptedOutput:wrong.output,secondScenarioHasThreeSteps:wrong.linkedScenario.stepTexts.length});
 const empty=controller();empty.linkedScenario=pick(1);await empty.runLlmRefinement([],'','');results.push({case:'second scenario without recording',warnings});
 fs.writeFileSync(path.join(__dirname,'scenario-switch-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
