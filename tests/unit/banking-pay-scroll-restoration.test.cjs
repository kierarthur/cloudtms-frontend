const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

test('restores Banking Pay workbench scroll before the replacement tab can paint at zero', () => {
  const functionStart = mainSource.indexOf('async function bankingRerender(tabKey = null)');
  const functionEnd = mainSource.indexOf('\nfunction bankingIsActionBlocked(', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart, 'bankingRerender must be present');

  const source = mainSource.slice(functionStart, functionEnd);
  const setTabIndex = source.indexOf('await fr.setTab(nextTabKey);');
  const immediateRestoreIndex = source.indexOf('restoreScrollSnapshot(workbenchScrollSnapshotToRestore);', setTabIndex);
  const settledPaintIndex = source.indexOf('await waitForNextPaint();', immediateRestoreIndex);
  const settledRestoreIndex = source.indexOf('restoreScrollSnapshot(workbenchScrollSnapshotToRestore);', immediateRestoreIndex + 1);

  assert.ok(setTabIndex >= 0, 'the Banking Pay tab must still rerender through the modal frame');
  assert.ok(immediateRestoreIndex > setTabIndex, 'scroll must be restored immediately after the replacement DOM is installed');
  assert.ok(settledPaintIndex > immediateRestoreIndex, 'the settled layout pass must happen after the pre-paint restore');
  assert.ok(settledRestoreIndex > settledPaintIndex, 'scroll must be reapplied after layout settles');
});
