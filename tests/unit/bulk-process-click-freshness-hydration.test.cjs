const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainPath = path.resolve(__dirname, '../../js/main.js');
const mainSource = fs.readFileSync(mainPath, 'utf8');

test('deferred Bulk Process binders cannot start a competing context hydration during click reconciliation', () => {
  const functionStart = mainSource.indexOf('const ensureHydratedActiveContext = async (options = {}) => {');
  assert.notEqual(functionStart, -1, 'ensureHydratedActiveContext must exist');

  const profileResolution = mainSource.indexOf('const requestedProfile = (() => {', functionStart);
  assert.notEqual(profileResolution, -1, 'requested profile resolution must exist');

  const guard = mainSource.indexOf('if (state.__bulk_process_row_change_in_progress === true) {', functionStart);
  assert.ok(guard > functionStart && guard < profileResolution, 'row-change ownership guard must run before deferred profile hydration can start');

  const guardedBlock = mainSource.slice(guard, profileResolution);
  assert.match(guardedBlock, /state\.__bulk_process_row_context_hydration_inflight/);
  assert.match(guardedBlock, /await ownedHydration/);
  assert.match(guardedBlock, /return false/);
});

test('an already-hydrated context binds a newly activated scope without fetching it again', () => {
  const functionStart = mainSource.indexOf('const ensureHydratedActiveContext = async (options = {}) => {');
  const contextReadyStart = mainSource.indexOf('if (contextReady) {', functionStart);
  const hydrationStart = mainSource.indexOf('const hydrationIdentity = liveIdentity;', contextReadyStart);
  assert.ok(contextReadyStart > functionStart && hydrationStart > contextReadyStart);

  const contextReadyBlock = mainSource.slice(contextReadyStart, hydrationStart);
  assert.match(contextReadyBlock, /boundScopeIdentity\[requestedScope\] = liveIdentity/);
  assert.match(contextReadyBlock, /if \(!needsScopeBinding\) return true/);
  assert.match(contextReadyBlock, /await rerenderWorkbench\(\{ reason: 'scope-enable', force: true \}\)/);
  assert.doesNotMatch(contextReadyBlock, /loadActiveRowContext\(/);
});
