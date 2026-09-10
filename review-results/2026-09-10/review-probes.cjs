// Review-only probes. Runs compiled application logic with an in-memory VS Code/model boundary.
// No real source, secrets, model calls, or corpus writes. Rebuild with npm test before running.
const path = require('path');
const fs = require('fs');
const Module = require('module');
const root = path.resolve(__dirname, '../..');
const req = p => require(path.join(root, 'out-test/src', p));
const results = [];
const record = (name, observed) => results.push({name, observed});
let writes = [], prompts = [], progress = [], responder;
const uri = p => ({fsPath:p, path:p, scheme:'file', toString(){return p;}});
const vscode = {
  Uri: {file:uri, joinPath:(base,...parts)=>uri(path.posix.join(base.path,...parts))},
  workspace:{
    fs:{createDirectory:async()=>{},stat:async()=>{throw new Error('not found');},writeFile:async(u,b)=>writes.push({path:u.path, text:Buffer.from(b).toString('utf8')})},
    asRelativePath:u=>typeof u==='string'?u:u.path
  }
};
const originalLoad=Module._load;
Module._load=function(id,parent,isMain){
  if(id==='vscode') return vscode;
  if(parent?.filename.endsWith('ragCorpusGenerator.js') && id==='../llm/copilotClient') return {
    CopilotUnavailableError:class extends Error {}, countModelTokens:async()=>({count:200,maxInputTokens:10000}),
    sendPrompt:async(model,prompt,onChunk,token)=>{prompts.push(prompt);onChunk(await responder(prompt,token));}
  };
  if(parent?.filename.endsWith('ragCorpusGenerator.js') && id==='../cache/fileCache') return {readFileCachedSync:()=>fs.readFileSync(path.join(root,'prompts/generate-rag-recipe.md'),'utf8')};
  return originalLoad.apply(this,arguments);
};
const {extractCapabilities,capabilitiesForFile}=req('rag/ragCapabilityExtraction');
const {resolveRagTargets,normalizeGeneratedRecipe}=req('rag/ragRecipeNormalizer');
const {validateSourceGrounding}=req('rag/ragSourceGrounding');
const {parseRagFile}=req('rag/ragFrontmatter');
const {scrubSecretsFromRecipe}=req('rag/ragSecretScrubber');
const {classifyFreshness}=req('rag/ragFreshnessChecker');
const {hashSourceContent}=req('rag/ragSourceIdentity');
const {formatRagPromptSection}=req('rag/ragRetriever');
const {packOperationCandidates}=req('rag/ragOperationPacking');
const {buildRagIndex}=req('rag/ragIndexBuilder');
const {retrieveForOperations}=req('rag/ragOperationRetrieval');
const {generateRagCorpus}=req('rag/ragCorpusGenerator');
function recipe(body,javaImport='acme.Helper',id='helper') {
 return `---\nid: ${id}\ntitle: Helper\ntags: [helper]\nautomationMode: [ui, api]\nlanguage: [java]\nimports:\n  java: ["${javaImport}"]\n---\n${body}\n`;
}
async function generate(file,response){
 writes=[];prompts=[];progress=[];responder=response;
 const token={isCancellationRequested:false};
 const counts=await generateRagCorpus({files:[file],modelId:'fake',workspaceRoot:uri('/review'),cancellationToken:token,onProgress:p=>progress.push(p),confirmOverwrite:async()=>true});
 return {counts,writes:[...writes],prompts:[...prompts],progress:[...progress]};
}
async function main(){
 const java='package acme;\npublic class Helper {\n public int find(int id) { return id; }\n public String find(String id) { return id; }\n}';
 const overloads=extractCapabilities('Helper.java',java);
 record('Overload target resolution',resolveRagTargets(overloads.map(c=>({fileName:'Helper.java',content:c.excerpt,capabilityName:c.name}))));
 const many='public class Many {\n'+Array.from({length:21},(_,i)=>` public void m${i}() {}`).join('\n')+'\n}';
 record('21 public methods', {extracted:capabilitiesForFile('Many.java',many).length});
 record('Async/multiline Python skipped alongside supported method',capabilitiesForFile('client.py','def sync_call():\n    return 1\n\nasync def async_call():\n    return 2\n\ndef multi(\n    x,\n):\n    return x\n').map(c=>c.name));
 record('Java nested class ownership',extractCapabilities('Outer.java','public class Outer {\n public static class Inner {\n public void run() {}\n }\n}').map(c=>({name:c.name,owner:c.ownerClassName})));
 record('Commented-out Java extracted',extractCapabilities('Helper.java','public class Helper {\n/*\n public void removed() {}\n*/\n public void live() {}\n}').map(c=>c.name));
 record('Python nested function is not public API',extractCapabilities('h.py','def outer():\n    def inner():\n        return 1\n    return inner()\n').map(c=>c.name));
 const cap=overloads[0];
 record('Valid Java import statement rejected',validateSourceGrounding('API: public int find(int id)\n```java\nh.find(1);\n```',['import acme.Helper;'],cap,'acme'));
 record('Wrong signature and owner accepted',validateSourceGrounding('API: public void find()\n```java\nFake.find();\n```',['acme.DoesNotExist'],cap,'acme'));
 record('Secret scrub corrupts Python type annotations',scrubSecretsFromRecipe('API: def login(password: str, user: str):\n```python\nlogin(password, user)\n```'));
 const plainNormalized=normalizeGeneratedRecipe('Helper.java',recipe('This find helper is unavailable.'));
 record('No callable example accepted with valid YAML',{normalization:plainNormalized.status,grounding:validateSourceGrounding('This find helper is unavailable.',['acme.Helper'],cap,'acme')});
 const n1=normalizeGeneratedRecipe('Helper.java',recipe('```java\nh.find(1);\n```'),'one',cap.excerpt,'find');
 const n2=normalizeGeneratedRecipe('Helper.java',recipe('```java\nh.find(1);\n```'),'two',cap.excerpt,'find');
 record('Distinct source identities retain duplicate model IDs',[parseRagFile(n1.content).value.frontmatter.id,parseRagFile(n2.content).value.frontmatter.id]);
 const batchA={fileName:'helper.java',content:'a'},batchB={fileName:'helper.py',content:'b'};
 record('Filename depends on batch composition',{alone:resolveRagTargets([batchA]),together:resolveRagTargets([batchA,batchB])});
 const collision=resolveRagTargets([batchA,batchB,{fileName:'helper-java.java',content:'c'}]);
 record('Secondary generated filename collision',collision);
 const dependencyOld='package acme;\npublic class Helper {\n private int multiplier=2;\n public int find(int id) { return id * multiplier; }\n}';
 const dependencyNew=dependencyOld.replace('multiplier=2','multiplier=3');
 const depcap=extractCapabilities('Helper.java',dependencyOld)[0];
 record('Changed supporting field still fresh',classifyFreshness({sourcePath:'Helper.java#find',sourceHash:hashSourceContent(depcap.excerpt)},{kind:'found',content:dependencyNew,resolvedPath:'/review/Helper.java'}));
 const mk=(id,body,score=1)=>({id,title:id,body,score,filePath:id+'.md',imports:{java:['acme.Helper']}});
 const signatureBody='Use: '+'description '.repeat(160)+'\nRequires: Open connection and caller cleanup\nAPI: find(Connection connection, int id)\n```java\nh.find(connection,id);\n```';
 const formatted=formatRagPromptSection([mk('find',signatureBody)],'java');
 record('Required contract prose lost while code preserved',{included:formatted.includedMatches.length,hasRequires:formatted.section.includes('Requires:'),hasAPI:formatted.section.includes('API:'),hasCall:formatted.section.includes('h.find(connection,id)')});
 const operations=[{operationId:'a',text:'alpha'},{operationId:'b',text:'beta'}];
 const candidates=[{match:mk('large','```java\n'+'x'.repeat(900)+'\n```'),coveredOperationIds:['a'],bestScore:1},{match:mk('small','```java\nx();\n```'),coveredOperationIds:['b'],bestScore:.9}];
 const smallSection=formatRagPromptSection([candidates[1].match],'java').section;
 const packed=await packOperationCandidates(candidates,operations,'java',{maxInputTokens:smallSection.length+5,safetyMargin:1,mandatoryTokens:0,countTokens:async s=>s.length});
 record('Packing drops fitting smaller candidate (deterministic fake tokenizer)',{smallFits:true,included:packed.includedMatches.map(m=>m.id)});
 const index=await buildRagIndex(['one','two'].map((p,i)=>({filePath:p+'.md',relativePath:p+'.md',mtimeMs:0,frontmatter:{id:'duplicate',title:i?'beta':'alpha',tags:[],language:['java'],automationMode:['ui']},body:i?'beta':'alpha'})));
 record('Duplicate IDs collapse distinct retrieved contracts',(await retrieveForOperations(index,operations,'java','ui',1)).map(c=>({file:c.match.filePath,operations:c.coveredOperationIds})));
 const secretFile={fileName:'Helper.java',content:'package acme;\npublic class Helper {\n public String getPassword() { String password="SYNTHETIC_REVIEW_SECRET"; return password; }\n}'};
 const rejected=await generate(secretFile,async()=> 'REVIEW NEEDED: password="SYNTHETIC_REVIEW_SECRET"');
 record('Secret handling boundaries',{rawSourceSecretSent:rejected.prompts.some(p=>p.includes('SYNTHETIC_REVIEW_SECRET')),rawSecretInDraft:rejected.writes.some(w=>w.text.includes('SYNTHETIC_REVIEW_SECRET')),counts:rejected.counts});
 const cancelled=await generate({fileName:'Helper.java',content:'package acme;\npublic class Helper {\n public int find(int id) { return id; }\n}'},async(p,t)=>{t.isCancellationRequested=true;return recipe('API: public int find(int id)\n```java\nh.find(1);\n```');});
 record('Cancellation after response before write',{counts:cancelled.counts,written:cancelled.writes.map(w=>w.path)});
 const integration=await generate({fileName:'Helper.java',content:java},async()=>recipe('API: public int find(int id)\n```java\nh.find(1);\n```'));
 record('Actual generator overload path',{counts:integration.counts,files:integration.writes.map(w=>w.path),errors:integration.progress.filter(p=>p.status==='error').map(p=>p.message)});
 const conventionalImport=await generate({fileName:'Helper.java',content:java.split(' public String')[0]+'\n}'},async()=>recipe('API: public int find(int id)\n```java\nh.find(1);\n```','import acme.Helper;'));
 record('Actual generator rejects conventional Java import',{counts:conventionalImport.counts,drafts:conventionalImport.writes.map(w=>w.path)});
 const realCorpus=fs.readFileSync(path.join(root,'.github/rag/bdd-java-framework-guide.md'),'utf8');
 const parsed=parseRagFile(realCorpus);
 record('Existing workspace corpus parse',{ok:parsed.ok,error:parsed.error,bodyCharacters:parsed.ok?parsed.value.body.length:undefined});
 if(parsed.ok){const built=formatRagPromptSection([mk(parsed.value.frontmatter.id,parsed.value.body)],'java');record('Existing workspace corpus can be packed',{included:built.includedMatches.length,sectionCharacters:built.section.length});}
 fs.writeFileSync(path.join(__dirname,'probe-results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Module._load=originalLoad;});
