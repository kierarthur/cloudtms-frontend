const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

test('Clear all Decisions fails closed unless the server confirms implicit-all selection', () => {
  const start = source.indexOf('const resetPayPreviewAndDecisions = async');
  const end = source.indexOf("if (a === 'banking:pay:clearAllDecisions')", start);
  assert.ok(start >= 0 && end > start, 'clear decisions implementation must exist');
  const body = source.slice(start, end);

  assert.match(body, /clearResult\?\.server_selected_preview_row_ids_provided !== true/);
  assert.match(body, /selection_intent_mode \|\| clearResult\?\.selected_preview_row_mode/);
  assert.match(body, /!== 'IMPLICIT_ALL'/);
  assert.match(body, /BANKING_PAY_CLEAR_DECISIONS_CONTRACT_INVALID/);
  assert.match(body, /markImplicitAllSelection\(clearResult\.server_selected_preview_row_ids\)/);
});

test('background preview work preserves an authoritative explicit-empty selection', () => {
  const applyStart = source.indexOf('function applyPayWorkbenchPreviewToState');
  const applyEnd = source.indexOf('\nfunction ', applyStart + 1);
  assert.ok(applyStart >= 0 && applyEnd > applyStart, 'preview apply function must exist');
  const applyBody = source.slice(applyStart, applyEnd);
  assert.match(applyBody, /preserveExistingAuthoritativeServerSelection/);
  assert.match(applyBody, /preserveAuthoritativeServerSelection/);
  assert.match(applyBody, /existingAuthoritativeServerSelectionProvided/);

  const recomputeStart = source.indexOf('const recomputePayWizardLiveTruth =');
  const recomputeEnd = source.indexOf('\n  return decisions;', recomputeStart);
  assert.ok(recomputeStart >= 0 && recomputeEnd > recomputeStart, 'recompute function must exist and return decisions');
  const recomputeBody = source.slice(recomputeStart, recomputeEnd);
  assert.match(recomputeBody, /mode === 'EXPLICIT_NONE' \? 'EXPLICIT_NONE' : 'IMPLICIT_ALL'/);
  assert.doesNotMatch(recomputeBody, /server_selected_preview_row_ids_provided\s*=\s*false/);
});
