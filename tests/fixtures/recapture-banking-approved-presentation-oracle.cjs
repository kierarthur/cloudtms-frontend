// Deliberate, tightly bounded recapture for presentation functions whose
// user-facing wording/layout was approved in the Banking Pay visual policy.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {rendererDeclarations}=require('./banking-detail-syntax.cjs');
const root=path.resolve(__dirname,'../..');
const main=fs.readFileSync(path.join(root,'js/main.js'),'utf8').replaceAll('\r\n','\n');
const oraclePath=path.join(root,'tests/fixtures/banking-pay-legacy-display-oracle.json');
const original=fs.readFileSync(oraclePath,'utf8').replaceAll('\r\n','\n');
const oracle=JSON.parse(original);
const declarations=rendererDeclarations(main);
const approved=new Set(['renderCaseActionButtons','renderComponentRows']);
for(const snippet of oracle.snippets){
  if(!approved.has(snippet.name))continue;
  const current=declarations.get(snippet.name);
  if(!current?.source)throw new Error(`Missing approved presentation declaration: ${snippet.name}`);
  snippet.source=current.source;
  snippet.sha256=createHash('sha256').update(current.source).digest('hex');
}
const expected=JSON.stringify(oracle,null,2)+'\n';
if(process.argv.includes('--check')){
  if(original!==expected)throw new Error('Approved Banking presentation oracle is stale; recapture it deliberately without --check');
  console.log(JSON.stringify({checked:[...approved]}));
}else{
  fs.writeFileSync(oraclePath,expected);
  console.log(JSON.stringify({recaptured:[...approved]}));
}
