const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const helperStart = source.indexOf('  const amountFromPreviewRow =');
const helperEnd = source.indexOf('\n  const getPreviewRowId =', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Create Draft recovery-overlay helpers must be present');

const helperSource = source.slice(helperStart, helperEnd);

function installHarness() {
  const context = {
    booleanFlag: (value) => value === true || ['true', '1', 'yes'].includes(String(value || '').toLowerCase()),
    getPreviewRowId: (row) => String(row.id || row.preview_row_id || '').trim(),
    hasOwnValue: (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key),
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    isSyntheticResolvedTimesheetResidualPreviewRow: () => false,
    normalisePreviewPageSectionName: (value) => {
      const section = String(value || '').trim().toLowerCase();
      if (['ready', 'ready_to_pay', 'canonical_preview_lines'].includes(section)) return 'canonical_preview_lines';
      if (['blocked', 'blocked_for_pay'].includes(section)) return 'blocked_for_pay';
      return section || 'canonical_preview_lines';
    },
    round2: (value) => Math.round(Number(value) * 100) / 100,
    trimStr: (value) => String(value ?? '').trim(),
    upperTrim: (value) => String(value ?? '').trim().toUpperCase()
  };
  vm.runInNewContext(
    `${helperSource}\nthis.__readOverlay = readCreateDraftRecoverySelectionOverlay; this.__effectiveSection = getCreateDraftEffectivePreviewSection; this.__eligible = isDraftCreateEligiblePreviewRow;`,
    context,
    { filename: 'frontend-create-draft-recovery-overlay.js' }
  );
  return {
    readOverlay: context.__readOverlay,
    effectiveSection: context.__effectiveSection,
    eligible: context.__eligible
  };
}

const candidateId = '11111111-1111-4111-8111-111111111111';
const timesheetId = '22222222-2222-4222-8222-222222222222';

const validPromotedRecovery = () => ({
  id: '33333333-3333-4333-8333-333333333333',
  candidate_id: candidateId,
  timesheet_id: timesheetId,
  section: 'blocked_for_pay',
  status: 'READY',
  selection_state: 'SELECTED',
  selected: true,
  amount_ex_vat: -1,
  row_json: {
    candidate_id: candidateId,
    timesheet_id: timesheetId,
    line_type: 'OVERPAYMENT_RECOVERY',
    pay_channel: 'PAYE',
    presentation_section: 'READY_TO_PAY',
    selection_state: 'SELECTED',
    selected: true,
    status: 'READY',
    draftable: true,
    is_ready_for_draft: true,
    is_excluded_from_allocation: false,
    selection_allowed: true,
    amount_ex_vat: -1,
    economic_key: { timesheet_id: timesheetId, key_type: 'TS_DAY', key_value: '2026-07-05' },
    preview_contract: { ok: true, selection_allowed: false },
    selection_recovery_headroom_v1: {
      contract_version: 1,
      candidate_id: candidateId,
      pay_channel: 'PAYE',
      physical_section: 'blocked_for_pay',
      effective_section: 'canonical_preview_lines',
      selected_positive_headroom_ex_vat: 1,
      nominal_due_amount_ex_vat: 78.26,
      recoverable_amount_ex_vat: 1,
      static_recovery_eligible: true,
      overlay_digest: '0123456789abcdef0123456789abcdef',
      policy_x_authority_scope: 'PRE_DRAFT_LIVE_TRUTH'
    }
  }
});

test('frontend Draft preflight accepts a strictly certified promoted recovery', () => {
  const harness = installHarness();
  const row = validPromotedRecovery();
  assert.equal(harness.effectiveSection(row), 'canonical_preview_lines');
  assert.equal(harness.eligible(row, [row]), true);
  assert.equal(harness.readOverlay(row).overlay_digest, '0123456789abcdef0123456789abcdef');
});

test('frontend Draft preflight accepts the same strict certificate after a preview row is flattened', () => {
  const harness = installHarness();
  const nestedRow = validPromotedRecovery();
  const flattenedRow = {
    ...nestedRow,
    ...nestedRow.row_json,
    row_json: undefined,
    selection_recovery_headroom_v1: nestedRow.row_json.selection_recovery_headroom_v1
  };
  assert.equal(harness.effectiveSection(flattenedRow), 'canonical_preview_lines');
  assert.equal(harness.eligible(flattenedRow, [flattenedRow]), true);
  assert.equal(harness.readOverlay(flattenedRow).overlay_digest, '0123456789abcdef0123456789abcdef');
});

test('frontend Draft preflight rejects malformed or economically inconsistent recovery overlays', () => {
  const harness = installHarness();
  for (const mutate of [
    (row) => { row.row_json.selection_recovery_headroom_v1.overlay_digest = 'bad'; },
    (row) => { row.row_json.selection_recovery_headroom_v1.recoverable_amount_ex_vat = 2; },
    (row) => { row.row_json.selection_recovery_headroom_v1.policy_x_authority_scope = 'POST_DRAFT'; },
    (row) => { row.row_json.selection_recovery_headroom_v1.static_recovery_eligible = false; },
    (row) => { row.row_json.line_type = 'TIMESHEET_PAYMENT'; }
  ]) {
    const row = validPromotedRecovery();
    mutate(row);
    assert.equal(harness.readOverlay(row), null);
    assert.equal(harness.eligible(row, [row]), false);
  }
});

test('frontend Draft preflight does not bypass the static contract without a valid overlay', () => {
  const harness = installHarness();
  const row = validPromotedRecovery();
  delete row.row_json.selection_recovery_headroom_v1;
  row.section = 'canonical_preview_lines';
  assert.equal(harness.eligible(row, [row]), false);
});

test('frontend Draft authoritative recheck includes physically blocked promoted recoveries', () => {
  assert.match(
    source,
    /selectionAuthoritySections\s*=\s*\['canonical_preview_lines',\s*'blocked_for_pay'\]/,
    'Draft recheck must fetch both physical sections that can supply the effective Ready selection'
  );
  assert.match(
    source,
    /getCreateDraftEffectivePreviewSection\(row\)\s*!==\s*'canonical_preview_lines'/,
    'Draft scope classification must use the certified effective section rather than physical storage alone'
  );
  assert.doesNotMatch(
    source,
    /const canonicalRows = asArray\(rowsBySection\.canonical_preview_lines\)[\s\S]{0,400}isDraftCreateEligiblePreviewRow\(row, canonicalRows\)/,
    'Draft scope classification must not discard selected recoveries by inspecting only the physical Ready section'
  );
});
