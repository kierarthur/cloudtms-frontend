const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');

test('Expense Email missing is an informational existing-style invoice diagnostic', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'invoice-diagnostic-catalog.js'), 'utf8');
  const context = vm.createContext({ window: {}, Object, Set, String, Array });
  new vm.Script(source, { filename: 'invoice-diagnostic-catalog.js' }).runInContext(context);

  const diagnostic = context.window.invoiceDiagnosticForCode('EXPENSE_EMAIL_MISSING');
  assert.equal(diagnostic.short_label, 'Expense Email missing');
  assert.equal(diagnostic.tone, 'blue');
  assert.equal(diagnostic.family, 'INFORMATION');
  assert.match(diagnostic.long_explanation, /affected expense invoice cannot be sent/i);
  assert.match(diagnostic.long_explanation, /does not change invoice calculations or any unrelated ready work/i);

  const deduplicated = context.window.invoiceDiagnosticsForCodes([
    'EXPENSE_EMAIL_MISSING',
    'EXPENSE_EMAIL_MISSING'
  ]);
  assert.equal(deduplicated.length, 1);
});

test('Generator and Issuer consume server informational codes without changing readiness', () => {
  const modal = fs.readFileSync(path.join(root, 'js', 'invoice-batch-modal.js'), 'utf8');
  const catalogue = fs.readFileSync(path.join(root, 'js', 'invoice-diagnostic-catalog.js'), 'utf8');

  assert.match(modal, /function rowBadgeCodes\(row, mode\)/);
  assert.ok((modal.match(/\.\.\.asArray\(row\.informational_codes\)/g) || []).length >= 2);
  assert.match(modal, /renderInvoiceBatchBadges\(row, state\.mode\)/);
  assert.equal((catalogue.match(/EXPENSE_EMAIL_MISSING/g) || []).length, 1);
  assert.doesNotMatch(modal, /EXPENSE_EMAIL_MISSING/);
});
