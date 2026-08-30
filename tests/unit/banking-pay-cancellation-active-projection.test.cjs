const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

function functionBody(name) {
  const markers = [`function ${name}`, `async function ${name}`];
  const start = markers.map((marker) => source.indexOf(marker)).filter((value) => value >= 0).sort((a, b) => a - b)[0];
  assert.ok(Number.isInteger(start) && start >= 0, `${name} missing`);
  const boundaries = [source.indexOf('\nfunction ', start + 10), source.indexOf('\nasync function ', start + 10)].filter((value) => value > start);
  const end = boundaries.length ? Math.min(...boundaries) : source.length;
  return source.slice(start, end);
}

function buildProjectionContext(initialData) {
  const child = { data: initialData, correction: {} };
  const selected = { data: initialData };
  const context = {
    window: {
      modalCtx: { banking: { pay: { selected, child } } }
    },
    Number,
    String,
    Array,
    Object,
    Error
  };
  vm.runInNewContext(`${functionBody('buildBankingPayCancellationActiveProjection')}\n${functionBody('applyBankingPayCancellationActiveProjection')}\nthis.applyProjection = applyBankingPayCancellationActiveProjection;`, context);
  return { context, child, selected };
}

test('active cancellation projection removes cancelled lines while retaining historical rows', () => {
  const historicalOverview = [{ pay_batch_candidate_id: 'a' }, { pay_batch_candidate_id: 'b' }, { pay_batch_candidate_id: 'c' }];
  const historicalCandidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const initialData = {
    id: 'batch-1',
    batch: { id: 'batch-1' },
    overview_items: historicalOverview,
    candidates: historicalCandidates
  };
  const { context, child, selected } = buildProjectionContext(initialData);
  const projection = context.applyProjection({
    pay_batch_id: 'batch-1',
    active_overview_candidate_count: 2,
    active_overview_amount_pence: 3000,
    original_overview_amount_pence: 6000,
    active_paye_schedule_line_count: 1,
    active_paye_schedule_amount_pence: 1000,
    projection_complete: true,
    latest_correction_request: { id: 'request-1' },
    rows: [
      { pay_batch_candidate_id: 'a', include_in_active_overview: true, include_in_active_paye_schedule: true, active_payment_amount_pence: 1000 },
      { pay_batch_candidate_id: 'b', include_in_active_overview: false, include_in_active_paye_schedule: false, active_payment_amount_pence: 0, payment_display_state: 'CANCELLED' },
      { pay_batch_candidate_id: 'c', include_in_active_overview: true, include_in_active_paye_schedule: false, active_payment_amount_pence: 2000, work_status: 'BLOCKED' }
    ]
  }, 'batch-1');

  assert.deepEqual(Array.from(projection.active_overview_rows, (row) => row.pay_batch_candidate_id), ['a', 'c']);
  assert.deepEqual(Array.from(projection.active_paye_schedule_rows, (row) => row.pay_batch_candidate_id), ['a']);
  assert.equal(selected.data.overview_items.length, 3);
  assert.equal(selected.data.candidates.length, 3);
  assert.equal(selected.data.total_bank_out, 30);
  assert.equal(child.activeOverviewProjectionAuthoritative, true);
  assert.equal(child.activePayeScheduleProjectionAuthoritative, true);
});

test('all-cancelled status produces an authoritative empty active schedule without deleting history', () => {
  const initialData = {
    id: 'batch-2',
    batch: { id: 'batch-2' },
    overview_items: [{ pay_batch_candidate_id: 'a' }],
    candidates: [{ id: 'a' }]
  };
  const { context, selected } = buildProjectionContext(initialData);
  const projection = context.applyProjection({
    pay_batch_id: 'batch-2',
    active_overview_candidate_count: 0,
    active_overview_amount_pence: 0,
    original_overview_amount_pence: 1000,
    active_paye_schedule_line_count: 0,
    active_paye_schedule_amount_pence: 0,
    projection_complete: true,
    latest_correction_request: { id: 'request-2' },
    rows: [{ pay_batch_candidate_id: 'a', include_in_active_overview: false, include_in_active_paye_schedule: false }]
  }, 'batch-2');
  assert.equal(projection.active_overview_rows.length, 0);
  assert.equal(projection.active_paye_schedule_rows.length, 0);
  assert.equal(selected.data.overview_items.length, 1);
  assert.equal(selected.data.candidates.length, 1);
  assert.equal(selected.data.total_bank_out, 0);
});

test('financial completion remains successful when the cancelled batch modal is no longer selected', () => {
  const context = {
    window: { modalCtx: { banking: { pay: {} } } },
    Number,
    String,
    Array,
    Object,
    Error
  };
  vm.runInNewContext(`${functionBody('buildBankingPayCancellationActiveProjection')}\n${functionBody('applyBankingPayCancellationActiveProjection')}\nthis.applyProjection = applyBankingPayCancellationActiveProjection;`, context);
  const projection = context.applyProjection({
    pay_batch_id: 'batch-cancelled',
    active_overview_candidate_count: 0,
    active_overview_amount_pence: 0,
    active_paye_schedule_line_count: 0,
    active_paye_schedule_amount_pence: 0,
    projection_complete: true,
    rows: []
  }, 'batch-cancelled');
  assert.equal(projection.modal_state_applied, false);
  assert.equal(projection.modal_state_reason, 'NO_SELECTED_PAYMENT_BATCH');
  assert.equal(context.window.__bankingPayCancellationActiveProjection, projection);
});

test('financial completion never overwrites a different batch selected while cancellation finishes', () => {
  const initialData = { id: 'batch-now-selected', batch: { id: 'batch-now-selected' }, total_bank_out: 12 };
  const { context, selected } = buildProjectionContext(initialData);
  const projection = context.applyProjection({
    pay_batch_id: 'batch-that-finished',
    active_overview_candidate_count: 0,
    active_overview_amount_pence: 0,
    active_paye_schedule_line_count: 0,
    active_paye_schedule_amount_pence: 0,
    projection_complete: true,
    rows: []
  }, 'batch-that-finished');
  assert.equal(projection.modal_state_applied, false);
  assert.equal(projection.modal_state_reason, 'DIFFERENT_PAYMENT_BATCH_SELECTED');
  assert.equal(selected.data.total_bank_out, 12);
});

test('Overview and PAYE renderers prefer dedicated active projection rows including an empty projection', () => {
  const overview = functionBody('renderBankingPayBatchChildModalOverview');
  const paye = functionBody('renderBankingPayBatchChildModalPayeWorksheetTab');
  assert.match(overview, /activeOverviewProjectionPresent/);
  assert.match(overview, /data\.active_overview_rows/);
  assert.match(overview, /No active payment lines remain in this batch/);
  assert.ok(overview.indexOf('if (activeOverviewProjectionPresent)') < overview.indexOf('child.sections?.overview_items?.rows'));
  assert.match(paye, /activePayeProjectionPresent/);
  assert.match(paye, /activePayeProjectionRows\.map/);
  assert.match(paye, /if \(!activePayeProjectionPresent\) data\.candidates/);
});

test('batch modal load completes sequential bounded status paging before its first authoritative render', () => {
  const start = source.indexOf('const loadBatch = async (opts = {}) =>');
  const end = source.indexOf('\n  const firstRefreshText', start);
  assert.ok(start >= 0 && end > start);
  const loadBatch = source.slice(start, end);
  assert.match(loadBatch, /loadCompleteBankingPayCancellationProjectionStatus\(id\)/);
  assert.match(loadBatch, /applyBankingPayCancellationActiveProjection/);
  const loadedAt = loadBatch.indexOf('if (!await applyLoadedData(obj)) return;');
  const hydratedAt = loadBatch.indexOf('await hydrateCancellationActiveProjection()', loadedAt);
  const renderedAt = loadBatch.indexOf('await rerenderChild()', hydratedAt);
  assert.ok(loadedAt >= 0 && hydratedAt > loadedAt && renderedAt > hydratedAt);
  assert.doesNotMatch(loadBatch, /for\s*\([^)]*candidate|Promise\.all/);

  const completeProjection = functionBody('loadCompleteBankingPayCancellationProjectionStatus');
  assert.match(completeProjection, /bankingPayPaymentStatusPage\(id, \{/);
  assert.match(completeProjection, /limit: 100/);
  assert.match(completeProjection, /rows\.length < 10000/);
  assert.doesNotMatch(completeProjection, /Promise\.all/);
});
