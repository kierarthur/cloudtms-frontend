const test=require('node:test');const assert=require('node:assert/strict');
const fixture=require('../fixtures/banking-pay-v2-table-page.cjs');
const load=()=>require('../../js/banking-pay-modal-v2-mutation.js');
const invalidations=()=>({scope:'ALL_PREVIOUS_DETAILS',ready:true,actions:true,updating:true,blocked:true});
const movement=()=>({identity:fixture.id(2000),candidate_id:fixture.id(1),row_key:'original-key',
 from:'canonical_preview_lines',to:'blocked_lines',selected:false});
const envelope=()=>({session_id:fixture.id(1000),session_version:2,progress_counter_version:4,scope_hash:'a'.repeat(64),
 state_changed:true,movements:[movement()],movements_complete:true,movement_count:1,movement_digest:'b'.repeat(64),invalidations:invalidations()});
test('explicit complete and large-scope movement evidence stay distinct',()=>{
 const p=envelope();assert.equal(load().validateMovements(p,fixture.id(1)),p);
 Object.assign(p,{movements:[],movements_complete:false,movement_count:5000});
 assert.equal(load().validateMovements(p,fixture.id(1)),p);assert.notEqual(p.movement_count,p.movements.length);
});
for(const [label,change] of Object.entries({
 missingFlag:p=>delete p.movements_complete,wrongFlag:p=>p.movements_complete='true',missingCount:p=>delete p.movement_count,
 missingDigest:p=>delete p.movement_digest,badDigest:p=>p.movement_digest='bad',countDisagrees:p=>p.movement_count=2,
 incompletePretendsEmpty:p=>Object.assign(p,{movements:[],movements_complete:false,movement_count:0}),
 partialArray:p=>Object.assign(p,{movements_complete:false,movement_count:5000}),
 missingInvalidation:p=>delete p.invalidations.blocked,retainedReady:p=>p.invalidations.ready=false,
 scopedInvalidation:p=>p.invalidations.scope='SOME_DETAILS',duplicate:p=>{p.movements.push({...p.movements[0]});p.movement_count=2;},
 otherCandidate:p=>p.movements[0].candidate_id=fixture.id(99),missingPhysical:p=>delete p.movements[0].identity,
 unchangedSection:p=>p.movements[0].to=p.movements[0].from,stringSelected:p=>p.movements[0].selected='false',
 noopWithMovement:p=>p.state_changed=false
}))test(`reject movement ambiguity ${label}`,()=>{
 const p=envelope();change(p);assert.throws(()=>load().validateMovements(p,fixture.id(1)),/INVALID_RESPONSE/);
});
test('large movement settlement discards every prior cached section instead of patching an incomplete array',()=>{
 const p={...envelope(),movements:[],movements_complete:false,movement_count:5000};
 const previous={summary:fixture.page(),ui:{surface:'main'},ready:{old:true},actions:{old:true},actionDetail:{old:true},blocked:{old:true},blockedDetail:{old:true}};
 const next=load().selectionDetailPages(previous,p,null);
 assert.deepEqual(next,{ready:null,actions:null,actionDetail:null,blocked:null,blockedDetail:null});
 assert.equal(previous.ready.old,true,'accepted old snapshot is never mutated during staging');
});
test('an already-open Ready view requires its complete current replacement; no old row may be retained',()=>{
 const p=envelope(),previous={summary:fixture.page(),ui:{surface:'candidate'},ready:{candidate_id:fixture.id(1),rows:[{identity:'old'}]}};
 const open={cursor:null,limit:100};
 assert.throws(()=>load().selectionDetailPages(previous,p,open),/INVALID_RESPONSE/);
 p.ready_page={ok:true,contract:'BANKING_PAY_MODAL_STRUCTURE_V2',contract_version:1,...Object.fromEntries(
  ['session_id','session_version','progress_counter_version','scope_hash'].map(k=>[k,p[k]])),candidate_id:fixture.id(1),rows:[],candidate:null,
  total_count:0,has_more:false,next_cursor:null,page_number:0,has_previous:false,previous_cursor:null,page_anchor:null};
 assert.equal(load().selectionDetailPages(previous,p,open).ready,p.ready_page);
 p.ready_page.progress_counter_version=3;
 assert.throws(()=>load().selectionDetailPages(previous,p,open),/INVALID_RESPONSE/);
});
test('candidate selection cannot silently close an open Action or Blocked workflow',()=>{
 for(const surface of ['actions','actionDetail','blocked','blockedDetail'])
  assert.throws(()=>load().selectionDetailPages({ui:{surface}},envelope(),null),/INVALID_RESPONSE/);
});
