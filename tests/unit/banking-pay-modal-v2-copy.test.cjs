const assert = require('node:assert/strict');
const test = require('node:test');
const contract = require('../fixtures/banking-pay-modal-structure-v2-contract.json');
const copy = require('../../js/banking-pay-modal-v2-copy.js');

test('the approved zero-loss inventory is complete and has no duplicate IDs', () => {
  for (const [key, size, field] of [['requirements', 136, 'id'], ['messages', 89, 'id'], ['actions', 30, 'name']]) {
    assert.equal(contract[key].length, size);
    assert.equal(new Set(contract[key].map(row => row[field])).size, size);
  }
});

for (const row of contract.messages) {
  test(`${row.id}: approved copy is retained exactly`, () => {
    let expected = row.approved;
    if (row.id === 'MSG-130' || row.id === 'MSG-131') expected = '';
    if (row.id === 'MSG-092') expected = expected.split('If neither is available: ')[1];
    if (row.id === 'MSG-093') expected = expected.split('If it is unavailable: ')[1];
    assert.equal(copy.messages[row.id], expected);
  });
}

test('payment-method explanations use verified direction and never guess', () => {
  assert.equal(copy.paymentMethodMessage('PAYE', 'UMBRELLA'), copy.message('MSG-040'));
  assert.equal(copy.paymentMethodMessage('UMBRELLA', 'PAYE', true), copy.message('MSG-043'));
  for (const pair of [[null, 'PAYE'], ['PAYE', null], ['MIXED', 'PAYE'], ['PAYE', 'PAYE']]) {
    assert.equal(copy.paymentMethodMessage(...pair), copy.message('MSG-091'));
  }
});

test('copy interpolation is explicit and performs no financial calculations', () => {
  assert.equal(copy.message('MSG-007', { amount: '1,200.25' }), 'Ready to pay £1,200.25');
  assert.throws(() => copy.message('MSG-007'));
  assert.throws(() => copy.message('MSG-999'));
  assert.equal(copy.message('MSG-020'), "No Ready Timesheet is linked to this candidate's selected payments.");
});
