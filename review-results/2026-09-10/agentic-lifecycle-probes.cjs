// Executes the real controller with deferred model/parser boundaries; no UI, network or disk writes.
const path=require('path'), fs=require('fs'), Module=require('module');
const root=path.resolve(__dirname,'../..');
const results=[]; let resolveGeneration, generationEntered;
const entered=new Promise(r=>generationEntered=r);
class Panel { clear(){this.content='';} hasContent(){return Boolean(this.content);} hasCode(){return Boolean(this.content);} show(){} startGenerating(){} finish(s){this.content=s;} showError(s){this.error=s;} dispose(){} }
class CTS {constructor(){this.token={isCancellationRequested:false};} cancel(){this.token.isCancellationRequested=true;} dispose(){} }
const vscode={CancellationTokenSource:CTS,workspace:{workspaceFolders:[]}};
const original=Module._load;
Module._load=function(id,parent){
 if(id==='vscode')return vscode;
 if(parent?.filename.endsWith('agenticModeController.js')){
  if(id==='path'||id==='./agenticTypes')return original.apply(this,arguments);
  if(id.includes('aiCodePanel'))return {AiCodePanel:Panel};
  if(id.includes('generatedFeaturePanel'))return {GeneratedFeaturePanel:Panel};
  if(id.includes('vscodeCopilotToolCallingModel'))return {VSCodeCopilotToolCallingModel:class{}};
  if(id==='./agenticChains')return {buildAgenticFeatureFileChain:()=>({invoke:async input=>{results.push({name:'actual chain input',input});generationEntered();return new Promise(r=>resolveGeneration=r);}})};
  if(id.includes('copilotClient'))return {CopilotUnavailableError:class extends Error{}};
  if(id==='./textIngestion')return {detectAgenticFileKind:()=> 'text'};
  return {};
 }
 return original.apply(this,arguments);
};
const {AgenticModeController}=require(path.join(root,'out-test/src/agentic/agenticModeController'));
async function main(){
 const c=new AgenticModeController({}, {get:()=>({language:'java',languageVersion:'17'})},()=>undefined,{appendLine(){}});
 c.resolveModel=async()=>({});c.buildIngestedContext=()=> 'selected input';
 c.buildSystemInstructions=async()=> 'mandatory';
 c.measureAgenticRequestTokens=async(model,system,context,request)=>{results.push({name:'budgeted input',system,context,request});return 100;};
 c.buildRagSection=async()=>'';c.recordReceivedTokens=async()=>{};c.refreshInstructionFiles=async()=>{};c.estimateTokens=async()=>{};
 const generation=c.generateFeatureFile();await entered;c.reset();resolveGeneration('Feature: old request result');await generation;
 results.push({name:'Result after Clear Data',content:c.generatedFeaturePanel.content});
 let resolveParse;
 c.buildIngestedFile=async()=>new Promise(r=>resolveParse=r);
 const ingest=c.ingestFiles([{fileName:'old.txt',base64:'aGVsbG8='}]);
 c.reset();resolveParse({id:'old',fileName:'old.txt',kind:'text',sizeBytes:5,rawText:'hello',config:{}});await ingest;
 results.push({name:'Files after Clear Data during parsing',files:c.getFiles()});
 fs.writeFileSync(path.join(__dirname,'agentic-lifecycle-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
