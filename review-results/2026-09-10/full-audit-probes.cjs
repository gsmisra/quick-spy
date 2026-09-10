// Review-only reproducible probes against compiled production code. No network/model calls.
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../..');
const req = p => require(path.join(root, 'out-test/src', p));
const results = [];
const record = (name, observed) => results.push({name, observed});
async function main() {
 const {validateSourceGrounding} = req('rag/ragSourceGrounding');
 const {scrubSecretsFromRecipe} = req('rag/ragSecretScrubber');
 const {capabilitiesForFile} = req('rag/ragCapabilityExtraction');
 const {selectSourceHashInput} = req('rag/ragSourceIdentity');
 const {buildRagIndex} = req('rag/ragIndexBuilder');
 const {retrieveRagMatches,formatRagPromptSection} = req('rag/ragRetriever');
 const {retrieveHybridMatches,rankSemanticCandidates} = req('rag/ragHybridRetriever');
 const {CachingEmbeddingProvider} = req('rag/ragEmbeddingCache');
 const {retrieveForOperations} = req('rag/ragOperationRetrieval');
 const {resolveRagTargets} = req('rag/ragRecipeNormalizer');
 const cap={name:'find',kind:'method',ownerClassName:'Helper',signature:'public int find(int id)',excerpt:'public int find(int id) { return id; }'};
 record('Wrong invocation passes because declaration supplies valid count',validateSourceGrounding('API: public int find(int id)\nOwner: Helper\n```java\nFake.find();\n```', ['acme.Helper'],cap,'acme'));
 record('No usage example passes',validateSourceGrounding('Owner: Helper\nAPI: public int find(int id)',undefined,cap,undefined));
 record('Typed Python signature corrupted',scrubSecretsFromRecipe('API: def login(password: str, user: str):'));
 const match={id:'helper',title:'Helper',body:'Use: fetch rows\nAPI: fetch_rows()\n```python\nfetch_rows()\n```',score:1,filePath:'/helper.md',imports:{python:['from framework.db import fetch_rows'],java:['import static acme.Helper.find;']}};
 record('Python import rendering',formatRagPromptSection([match],'python').section);
 record('Java static import rendering',formatRagPromptSection([match],'java').section);
 const recipe=(id,title,filePath)=>({filePath,relativePath:filePath,mtimeMs:0,frontmatter:{id,title,tags:[],automationMode:['api'],language:['java']},body:title});
 const index=await buildRagIndex([recipe('same','alpha lookup','/a.md'),recipe('same','beta delete','/b.md')]);
 const provider={id:'fake',embedQuery:async()=>[1,0],embedDocuments:async texts=>texts.map(t=>t.includes('alpha')?[1,0]:[0,1])};
 record('Duplicate IDs lexical versus hybrid',{lexical:await retrieveRagMatches(index,'alpha lookup','java','api',3),hybrid:await retrieveHybridMatches(index,provider,'alpha lookup','java','api',{topK:3})});
 try {await retrieveHybridMatches(index,{...provider,embedQuery:async()=>{throw Error('synthetic provider outage');}},'alpha lookup','java','api');record('Provider failure fallback','returned');}catch(e){record('Provider failure fallback',e.message);}
 record('Mismatched vector dimensions accepted',await rankSemanticCandidates(index.recipes,{...provider,embedDocuments:async texts=>texts.map(()=>[1])},'alpha','java','api'));
 let queryCalls=0;
 const cached=new CachingEmbeddingProvider({id:'asymmetric',embedQuery:async()=>{queryCalls++;return [0,1];},embedDocuments:async texts=>texts.map(()=>[1,0])});
 record('Query cache dispatch',{vector:await cached.embedQuery('query'),queryCalls});
 const source='public class Helper {\n public int find(int id) { return adjust(id); }\n private int adjust(int id) { return id + 1; }\n}';
 const before=capabilitiesForFile('Helper.java',source),after=capabilitiesForFile('Helper.java',source.replace('id + 1','id + 99'));
 record('Private dependency drift hash unchanged',{before:selectSourceHashInput(before[0],before),after:selectSourceHashInput(after[0],after)});
 record('Same-name methods across owners',capabilitiesForFile('helpers.py','class A:\n    def run(self):\n        return 1\n\nclass B:\n    def run(self):\n        return 2\n'));
 const ownerCaps=capabilitiesForFile('helpers.py','class A:\n    def run(self):\n        return 1\n\nclass B:\n    def run(self):\n        return 2\n');
 record('Cross-owner target collision',resolveRagTargets(ownerCaps.map(c=>({fileName:'helpers.py',content:c.excerpt,capabilityName:c.namingId??c.name}))));
 const idx4=await buildRagIndex([1,2,3,4].map(n=>recipe('h'+n,'lookup customer','/'+n+'.md')));
 const candidates=await retrieveForOperations(idx4,[{operationId:'op',text:'lookup customer'}],'java','api');
 const stale=new Set(candidates.map(c=>c.match.filePath));
 record('Stale top-three hide fresh fourth',{retrieved:candidates.map(c=>c.match.id),afterFreshness:candidates.filter(c=>!stale.has(c.match.filePath)).length,freshIndexRecipes:idx4.recipes.filter(r=>!stale.has(r.filePath)).map(r=>r.frontmatter.id)});
 fs.writeFileSync(path.join(__dirname,'full-audit-probe-results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
