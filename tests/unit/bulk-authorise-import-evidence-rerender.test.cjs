const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

const pendingDrainStart = mainSource.indexOf('if (st && st.__bulk_authorise_render_pending)');
const pendingDrainEnd = mainSource.indexOf('\n  return true;', pendingDrainStart);
assert.ok(pendingDrainStart >= 0 && pendingDrainEnd > pendingDrainStart, 'Bulk Authorise pending-render drain must be present');

const pendingDrainSource = mainSource.slice(pendingDrainStart, pendingDrainEnd);

test('queued import-evidence state forces a full DOM render before binder-only or duplicate-skip handling', () => {
  assert.match(
    pendingDrainSource,
    /const pendingImportEvidenceReason = \/\\bimport-evidence\\b\/i\.test\(pendingReason\);/
  );
  assert.match(
    pendingDrainSource,
    /if \(pendingIdentityChanged \|\| pendingImportEvidenceReason\) \{[\s\S]*await rerenderBulkAuthoriseWorkbench\(st, pendingReason\);/
  );

  const fullRenderBranch = pendingDrainSource.indexOf('if (pendingIdentityChanged || pendingImportEvidenceReason)');
  const binderOnlyBranch = pendingDrainSource.indexOf("typeof st.__runPostRenderBindings === 'function'");
  const duplicateSkip = pendingDrainSource.indexOf("decision: 'skip-duplicate-pending'");

  assert.ok(fullRenderBranch >= 0, 'import-evidence full-render branch must be present');
  assert.ok(fullRenderBranch < binderOnlyBranch, 'full DOM refresh must run before binder-only handling');
  assert.ok(fullRenderBranch < duplicateSkip, 'full DOM refresh must run before duplicate-render skipping');
});
