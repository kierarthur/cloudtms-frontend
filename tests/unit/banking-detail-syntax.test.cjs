const assert = require('node:assert/strict');
const test = require('node:test');
const { parse, freeNames } = require('../fixtures/banking-detail-syntax.cjs');
const free = source => freeNames(parse(source));

test('detail dependency inspection resolves nested shadowing and forward declarations', () => {
  assert.deepEqual(free('const f = outer => { const g=()=>local+outer+actual; const local=1; return g(); };'), ['actual']);
  assert.deepEqual(free('const f = () => { { const shadow=1; use(shadow); } return shadow; };'), ['shadow', 'use']);
  assert.deepEqual(free('function f(){ if (ready) { var value=1; } return value+external; }'), ['external', 'ready']);
});
test('detail dependency inspection understands destructuring and computed keys', () => {
  assert.deepEqual(free('const f=({a: renamed=defaultA,[key]: value,...rest},[first,...tail])=>renamed+value+rest+first+tail+outer;'),
    ['defaultA', 'key', 'outer']);
  assert.deepEqual(free('const f=x=>({plain:x, shorthand, [computed]:x.property+x[index]});'), ['computed', 'index', 'shorthand']);
});
test('detail dependency inspection does not treat strings or labels as dependencies', () => {
  assert.deepEqual(free('const f=()=>{ label: for (let i=0;i<3;i++){if(stop)break label;} return `fake ${real}`+"alsoFake"; };'), ['real', 'stop']);
});
test('detail dependency inspection scopes catch parameters and function names', () => {
  assert.deepEqual(free('const f=function self(){try{return self(arguments);}catch(error){return report(error);} };'), ['report']);
  assert.deepEqual(free('const f=()=>arguments;'), ['arguments']);
  assert.deepEqual(free('const f=()=>{ for(const row of rows){use(row);} return row; };'), ['row', 'rows', 'use']);
});
