// Read-only source inventory for extracting existing detail renderers safely.
// This conservative textual graph can over-report references in strings or
// shadowed locals. It is a review aid, not proof of scope or runnable UI code.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../../js/main.js'),'utf8').replaceAll('\r\n','\n');
const start=source.indexOf('function renderPayNewBatchWizard() {');
const end=source.indexOf('\nfunction ',start+1);
assert.ok(start>0&&end>start);
const render=source.slice(start,end);
const declarations=new Map();
for(const match of render.matchAll(/^(?:  )?(?:const|let) ([A-Za-z_$][\w$]*)\s*=/gm)){
  const rest=render.slice(match.index);
  let complete='';
  for(const terminal of rest.matchAll(/;(?=\n)/g)){
    const text=rest.slice(0,terminal.index+1);
    try{new vm.Script(text);complete=text;break;}catch{}
  }
  assert.ok(complete,`Incomplete declaration: ${match[1]}`);
  assert.ok(!declarations.has(match[1]),`Duplicate top-level name: ${match[1]}`);
  const value=complete.slice(complete.indexOf('=')+1).trimStart();
  const isFunction=/^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)||/^function\b/.test(value);
  declarations.set(match[1],{name:match[1],source:complete,isFunction,line:source.slice(0,start+match.index).split('\n').length});
}
const roots=process.argv.slice(2);
if(!roots.length)roots.push('renderReadyTimesheetGroupedRows','renderSimplePreviewRows','renderComponentRows','renderCaseActionButtons');
const allNames=[...declarations.keys()];
for(const root of roots){
  assert.ok(declarations.has(root),`Unknown renderer ${root}`);
  const functions=new Set(),context=new Set();
  const visit=name=>{
    if(functions.has(name)||context.has(name))return;
    const declaration=declarations.get(name);
    if(!declaration.isFunction){context.add(name);return;}
    functions.add(name);
    for(const candidate of allNames){
      if(candidate!==name&&new RegExp(`\\b${candidate.replaceAll('$','\\$')}\\b`).test(declaration.source))visit(candidate);
    }
  };
  visit(root);
  console.log(JSON.stringify({root,functions:[...functions].map(name=>({name,line:declarations.get(name).line})),
    input_context:[...context].map(name=>({name,line:declarations.get(name).line,initializer:declarations.get(name).source.slice(0,240)})),
    total_function_lines:[...functions].reduce((n,name)=>n+declarations.get(name).source.split('\n').length,0)}));
}
