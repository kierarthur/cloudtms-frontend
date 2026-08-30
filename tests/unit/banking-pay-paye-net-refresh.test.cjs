const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'js', 'main.js'), 'utf8');

test('manual PAYE save waits for a complete refreshed projection before reporting success', () => {
  assert.match(source, /const mutationResult = await postJson\(`\/api\/banking\/pay\/batch\/\$\{encodeURIComponent\(id\)\}\/paye-net\/manual`/);
  assert.match(source, /await refreshChildAfterPayeNetMutation\(mutationResult\);/);
  assert.match(source, /await waitForChildBatchLoadIdle\(\);/);
  assert.match(source, /activeOverviewProjectionAuthoritative !== true/);
  assert.match(source, /activePayeScheduleProjectionAuthoritative !== true/);
  assert.match(source, /markChildSectionStale\('current_payment_status', 'paye-net-mutation'/);
  assert.match(source, /loadChildSectionPage\('current_payment_status', \{/);
  assert.match(source, /forceRetry: true/);
  assert.match(source, /active_payment_amount_pence/);
  assert.match(source, /The saved PAYE amount is not yet reflected in Current Payment Status/);
});

test('Sage import uses the same post-commit projection barrier', () => {
  assert.match(source, /const mutationResult = await postJson\(`\/api\/banking\/pay\/batch\/\$\{encodeURIComponent\(id\)\}\/paye-net\/sage`/);
  const calls = source.match(/await refreshChildAfterPayeNetMutation\(mutationResult\);/g) || [];
  assert.equal(calls.length, 2);
});

test('standalone PAYE Entry refreshes the complete parent projection before success', () => {
  assert.match(source, /const refreshPayeEntryAfterMutation = async \(mutationResult\) =>/);
  assert.match(source, /await waitForPayeEntryLoadIdle\(\);/);
  assert.match(source, /const refreshed = await refreshParentBankingSurfaces\(\);/);
  assert.match(source, /const paymentStatus = await loadCompleteBankingPayCancellationProjectionStatus\(id\);/);
  assert.match(source, /applyBankingPayCancellationActiveProjection\(paymentStatus, id\)/);
  assert.match(source, /childState\.sections\.current_payment_status = refreshedSection/);
  assert.match(source, /childState\.sectionPages\.current_payment_status = refreshedSection/);
  assert.match(source, /applyBankingPayStage3StatusPage\(childState\.correction, paymentStatus/);
  const calls = source.match(/await refreshPayeEntryAfterMutation\(mutationResult\);/g) || [];
  assert.equal(calls.length, 2);
});
