const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

test('Banking tab rerenders resolve the existing in-file renderers before global fallbacks', () => {
  assert.match(
    mainSource,
    /if \(fnName === 'renderBankingPayTab' && typeof renderBankingPayTab === 'function'\) return renderBankingPayTab;/
  );
  assert.match(
    mainSource,
    /if \(fnName === 'renderBankingLoansSnoozesTab' && typeof renderBankingLoansSnoozesTab === 'function'\) return renderBankingLoansSnoozesTab;/
  );
  assert.match(
    mainSource,
    /if \(fnName === 'renderBankingIdTab' && typeof renderBankingIdTab === 'function'\) return renderBankingIdTab;/
  );
  assert.match(
    mainSource,
    /const fn = localFn \|\| \(\(typeof window\[fnName\] === 'function'\)/
  );
});
