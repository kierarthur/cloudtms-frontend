const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

test('Banking Pay progress polling ignores bookkeeping-only counter changes', () => {
  const functionStart = mainSource.indexOf('const startOrResumeWorkbenchSessionPoll =');
  const functionEnd = mainSource.indexOf(
    '\n  const refreshAuthoritativeProgressAfterSessionAcquisition =',
    functionStart
  );
  assert.ok(functionStart >= 0 && functionEnd > functionStart, 'session poll must be present');

  const source = mainSource.slice(functionStart, functionEnd);
  const fingerprintStart = source.indexOf('const fingerprint = JSON.stringify({');
  const fingerprintEnd = source.indexOf('\n        });', fingerprintStart);
  assert.ok(fingerprintStart >= 0 && fingerprintEnd > fingerprintStart, 'visible-state fingerprint must be present');

  const fingerprintSource = source.slice(fingerprintStart, fingerprintEnd);
  assert.doesNotMatch(
    fingerprintSource,
    /progress_counter_version/,
    'bookkeeping-only counter updates must not rebuild the complete Banking modal'
  );
  assert.match(fingerprintSource, /preview_row_count/);
  assert.match(fingerprintSource, /selected_row_count/);
  assert.match(fingerprintSource, /job_counts\?\.unresolved_failed/);
});

test('Banking Pay progress polling renders terminal state at most once per changed fingerprint', () => {
  const functionStart = mainSource.indexOf('const startOrResumeWorkbenchSessionPoll =');
  const functionEnd = mainSource.indexOf(
    '\n  const refreshAuthoritativeProgressAfterSessionAcquisition =',
    functionStart
  );
  const source = mainSource.slice(functionStart, functionEnd);

  assert.match(source, /if \(readyNow && pollVisualState\.readyVisual\) \{[\s\S]*?if \(fingerprintChanged\) await rerenderQuietly\(\);[\s\S]*?return;/);
  assert.match(source, /if \(authoritativePollState\.obsolete \|\| authoritativePollState\.replacementRequired \|\| authoritativePollState\.failure\) \{[\s\S]*?if \(fingerprintChanged\) await rerenderQuietly\(\);[\s\S]*?return;/);
  assert.doesNotMatch(
    source,
    /if \(fingerprintChanged\) \{\s*await rerenderQuietly\(\);\s*\}\s*const pollVisualState/,
    'the old unconditional render before terminal-state handling must stay removed'
  );
});
