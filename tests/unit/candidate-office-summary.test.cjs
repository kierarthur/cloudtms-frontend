const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');

function load(...names) {
  const context = vm.createContext({ window: {}, console, Date, Intl, Object, Set, String });
  names.forEach(name => new vm.Script(
    fs.readFileSync(path.join(root, 'js', name), 'utf8'),
    { filename: name }
  ).runInContext(context));
  return context.window;
}

function projection(code, label, tone, overrides = {}) {
  return {
    current_identity: { row_key: 'row-1', route_family: 'ELECTRONIC' },
    candidate_status: { code, label, tone },
    workflow: null,
    manager_approval: null,
    paper_pack: { state: 'NOT_APPLICABLE' },
    rejections: [],
    diagnostics: [],
    primary_action: null,
    available_actions: [],
    observed_at_utc: '2026-08-13T08:00:00Z',
    ...overrides
  };
}

test('Summary renders only the complete user-approved Candidate Submission catalogue', () => {
  const window = load(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );

  const cases = [
    [projection('CREATED', 'wrong', 'danger'), 'Awaiting Candidate Submission'],
    [projection('WORKER_SUBMITTED', 'wrong', 'danger'), 'Candidate Submitted'],
    [projection('AWAITING_MANAGER_APPROVAL', 'wrong', 'success'), 'Awaiting Manager Approval'],
    [projection('MANAGER_APPROVED', 'wrong', 'danger'), 'Manager Approved'],
    [projection('AWAITING_PAPER_RETURN', 'wrong', 'danger', { paper_pack: { state: 'READY' } }), 'QR Awaiting Signed Return'],
    [projection('AWAITING_PAPER_RETURN', 'wrong', 'danger', { paper_pack: { state: 'PREPARING' } }), 'QR Pack Preparing'],
    [projection('READY_TO_FINALISE', 'wrong', 'danger'), 'Finalising Submission'],
    [projection('MANAGER_APPROVED', 'wrong', 'success', { available_actions: [{ code: 'RETRY_FINALISATION', enabled: true }] }), 'Finalisation Needs Attention'],
    [projection('AWAITING_PAPER_RETURN', 'wrong', 'success', { paper_pack: { state: 'FAILED_RETRYABLE' } }), 'QR Pack Needs Attention'],
    [projection('REFUSED', 'wrong', 'success'), 'Refused by Client'],
    [projection('REJECTED', 'wrong', 'success'), 'Rejected by Agency'],
    [projection('CANCELLED', 'wrong', 'success'), 'Candidate Submission Cancelled'],
    [projection('FINALISED', 'wrong', 'danger', { workflow: { state: 'FINALISED', historical: true } }), 'Candidate Submission Complete'],
    [projection('FUTURE_UNKNOWN_STATE', 'wrong', 'success'), '']
  ];
  const rendered = cases.map(([input, expected]) => {
    const view = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(input);
    const html = window.CloudTMSCandidateOfficeSurface.renderCandidateSummaryCell(view);
    if (expected) assert.match(html, new RegExp(`>${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
    else assert.equal(html, '');
    assert.doesNotMatch(html, /<button/i);
    return html;
  }).join('');

  assert.doesNotMatch(rendered, /PHONE|Phone|EMAIL|Email/);
  assert.match(rendered, /Refused by Client/);
  assert.doesNotMatch(rendered, /Candidate Refused by Manager|Manager refused/);
});

test('all Office surfaces leave Manual non-QR and import-authoritative records blank even after financial completion', () => {
  const window = load(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  const routes = [
    ['Manual', 'MANUAL_NON_QR', 'PAID'],
    ['Manual adjustment', 'MANUAL_NON_QR', 'INVOICED_NOT_PAID'],
    ['HealthRoster import-authoritative', 'IMPORT_AUTHORITATIVE', 'AUTHORISED'],
    ['HealthRoster adjustment', 'IMPORT_AUTHORITATIVE', 'INVOICED_NOT_PAID'],
    ['NHSP import-authoritative', 'IMPORT_AUTHORITATIVE', 'PAID'],
    ['NHSP adjustment', 'IMPORT_AUTHORITATIVE', 'FINALISED']
  ];
  const surfaces = ['TIMESHEET_SUMMARY', 'SIMPLE_TIMESHEET', 'BULK_PROCESS', 'BULK_AUTHORISE'];

  for (const [name, routeFamily, code] of routes) {
    const input = projection(code, 'raw financial terminal label', 'success', {
      current_identity: { row_key: `row-${name}`, route_family: routeFamily }
    });
    assert.equal(window.CloudTMSCandidateOfficePresenter.candidateSubmissionApplies(input), false, name);
    for (const surface of surfaces) {
      const view = surface === 'TIMESHEET_SUMMARY'
        ? window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(input)
        : window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeDetail(input, { surface });
      assert.equal(view.status, null, `${name} must be blank in ${surface}`);
      const html = window.CloudTMSCandidateOfficeSurface.renderCandidateFragment(view, {
        surface,
        variant: surface === 'SIMPLE_TIMESHEET' ? 'stage' : 'compact'
      });
      assert.doesNotMatch(html, /Candidate Submission|Status unavailable/, `${name} must not invent Candidate truth in ${surface}`);
    }
  }
});

test('unknown server status fails closed as a blank Summary cell instead of showing technical text', () => {
  const window = load(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  const view = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(
    projection('FUTURE_UNKNOWN_STATE', 'Server supplied text', 'success')
  );
  const html = window.CloudTMSCandidateOfficeSurface.renderCandidateSummaryCell(view);

  assert.equal(html, '');
  assert.doesNotMatch(html, /Server supplied text/);
  assert.doesNotMatch(html, /candidate-office-badge--success/);
});

test('financial completion never manufactures Candidate completion without a durable Candidate workflow', () => {
  const window = load(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  for (const code of ['FINALISED', 'AUTHORISED', 'INVOICED_NOT_PAID', 'PAID']) {
    const legacy = projection(code, code, 'success');
    const view = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(legacy);
    assert.equal(view.status, null, `${code} without a Candidate workflow is not Candidate completion proof`);
  }
  const current = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(
    projection('UNPROCESSED', 'Unprocessed', 'neutral')
  );
  assert.equal(current.status.label, 'Awaiting Candidate Submission');
  const completed = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(
    projection('PAID', 'Paid', 'success', { workflow: { state: 'FINALISED', historical: true } })
  );
  assert.equal(completed.status.label, 'Candidate Submission Complete');
});

test('all four Office surfaces render the complete raw-state matrix through the same approved catalogue', () => {
  const window = load(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  const cases = [
    [projection('CREATED', 'Candidate submission created', 'neutral'), 'Awaiting Candidate Submission'],
    [projection('WORKER_DRAFT', 'Candidate draft in progress', 'neutral'), 'Awaiting Candidate Submission'],
    [projection('WORKER_SUBMITTED', 'Candidate submission received', 'info'), 'Candidate Submitted'],
    [projection('WORKER_SUBMITTED_PENDING_REVIEW_DOCUMENT', 'Preparing review documents', 'info'), 'Candidate Submitted'],
    [projection('READY_FOR_MANAGER_APPROVAL', 'Ready for manager approval', 'info'), 'Candidate Submitted'],
    [projection('AWAITING_MANAGER_APPROVAL', 'Awaiting Manager Approval', 'warning'), 'Awaiting Manager Approval'],
    [projection('MANAGER_APPROVED', 'Manager Approved', 'success'), 'Manager Approved'],
    [projection('AWAITING_PAPER_RETURN', 'QR Pack issued — awaiting signed return', 'warning', { paper_pack: { state: 'READY' } }), 'QR Awaiting Signed Return'],
    [projection('AWAITING_PAPER_RETURN', 'wrong', 'warning', { paper_pack: { state: 'PREPARING' } }), 'QR Pack Preparing'],
    [projection('AWAITING_PAPER_RETURN', 'wrong', 'warning', { paper_pack: { state: 'BACKOFF' } }), 'QR Pack Preparing'],
    [projection('RECEIVED', 'Signed return received', 'warning', { paper_pack: { state: 'RETURN_RECEIVED' } }), 'Finalising Submission'],
    [projection('MANAGER_APPROVED_PENDING_FINAL_DOCUMENT', 'Manager approved — preparing final document', 'success'), 'Finalising Submission'],
    [projection('READY_TO_FINALISE', 'Ready to finalise', 'success'), 'Finalising Submission'],
    [projection('MANAGER_APPROVED', 'Manager Approved', 'success', { available_actions: [{ code: 'RETRY_FINALISATION', enabled: true }] }), 'Finalisation Needs Attention'],
    [projection('AWAITING_PAPER_RETURN', 'wrong', 'warning', { paper_pack: { state: 'FAILED_RETRYABLE' } }), 'QR Pack Needs Attention'],
    [projection('AWAITING_PAPER_RETURN', 'wrong', 'warning', { paper_pack: { state: 'FAILED_TERMINAL' } }), 'QR Pack Needs Attention'],
    [projection('AWAITING_PAPER_RETURN', 'wrong', 'warning', { paper_pack: { state: 'RETIRED' } }), 'QR Pack Needs Attention'],
    [projection('AWAITING_PAPER_RETURN', 'wrong', 'warning', { paper_pack: { state: 'STALE' } }), 'QR Pack Needs Attention'],
    [projection('REFUSED', 'wrong', 'danger'), 'Refused by Client'],
    [projection('REJECTED', 'Rejected — resubmission required', 'danger'), 'Rejected by Agency'],
    [projection('CANCELLED', 'Cancelled', 'neutral'), 'Candidate Submission Cancelled'],
    [projection('SUPERSEDED', 'Superseded', 'neutral'), 'Candidate Submission Cancelled'],
    [projection('EXPIRED', 'Expired', 'neutral'), 'Candidate Submission Cancelled'],
    [projection('FINALISED', 'Candidate submission finalised', 'success', { workflow: { state: 'FINALISED', historical: true } }), 'Candidate Submission Complete'],
    [projection('AUTHORISED', 'Authorised', 'success', { workflow: { state: 'FINALISED', historical: true } }), 'Candidate Submission Complete'],
    [projection('INVOICED_NOT_PAID', 'Invoiced (Not paid)', 'warning', { workflow: { state: 'FINALISED', historical: true } }), 'Candidate Submission Complete'],
    [projection('PAID', 'Paid', 'success', { workflow: { state: 'FINALISED', historical: true } }), 'Candidate Submission Complete'],
    [projection('FUTURE_UNKNOWN_STATE', 'raw unknown label', 'danger'), '']
  ];
  const surfaces = ['TIMESHEET_SUMMARY', 'SIMPLE_TIMESHEET', 'BULK_PROCESS', 'BULK_AUTHORISE'];
  const forbidden = [
    'Candidate submission created', 'Candidate draft in progress', 'Candidate submission received',
    'Preparing review documents', 'Ready for manager approval', 'Manager approved — preparing final document',
    'Ready to finalise', 'QR Pack issued — awaiting signed return', 'Signed return received',
    'Candidate submission finalised', 'Rejected — resubmission required', 'Pending authorisation', 'Unprocessed'
  ];

  for (const [input, expected] of cases) {
    for (const surface of surfaces) {
      const view = surface === 'TIMESHEET_SUMMARY'
        ? window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(input)
        : window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeDetail(input, { surface });
      const variant = surface === 'SIMPLE_TIMESHEET' ? 'stage' : 'compact';
      const html = window.CloudTMSCandidateOfficeSurface.renderCandidateFragment(view, { surface, variant });
      if (expected) assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${surface} must show ${expected}`);
      else if (surface === 'TIMESHEET_SUMMARY' || surface === 'BULK_PROCESS' || surface === 'BULK_AUTHORISE') assert.equal(html, '');
      for (const raw of forbidden) assert.equal(html.includes(raw), false, `${surface} leaked raw status: ${raw}`);
    }
  }
});

test('Summary integration renders embedded projections immediately and keeps a bounded exact fallback', () => {
  const bridge = fs.readFileSync(path.join(root, 'js', 'candidate-office-bridge-v1.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');

  assert.doesNotMatch(main, /mountCandidateStatus\(\)/);
  assert.doesNotMatch(main, /CloudTMSCandidateOfficeBridge\.mountSummaryBadge\(wrap, rowObj\)/);
  assert.equal((main.match(/CloudTMSCandidateOfficeBridge\.mountSummaryBadge\(td, (?:row|r)\)/g) || []).length, 3,
    'full render, patched rows and newly inserted rows must all mount the dedicated Candidate Submission cell');
  assert.match(main, /candidate_submission:\s*\{ selectable: true \}/);
  assert.match(main, /placeDefault\('candidate_submission', processingKey\)/);
  assert.match(main, /typeof pref\.order === 'number'/);
  assert.doesNotMatch(main, /cols\.splice\(candidateIndex, 0, 'candidate_submission', 'issue_codes'\)/);
  assert.match(main, /label = 'Candidate Submission'/);
  assert.doesNotMatch(main, /c === 'candidate_submission'\s*\? false/);
  assert.doesNotMatch(main, /th\.draggable = c !== 'candidate_submission'/);
  assert.doesNotMatch(main, /colKey === 'candidate_submission'\) return/);
  assert.match(main, /sortKeyRaw === 'candidate_submission'\s*\? 'week_ending_date'/);
  assert.match(main, /sortSummaryRowsByCandidateStatus\(uniqueRows, sortDir\)/);
  assert.match(main, /qs\.set\('include_candidate_projection', 'true'\)/);
  assert.match(bridge, /function embeddedSummaryResult\(row\)/);
  assert.match(bridge, /row\?\.candidate_office_projection_loaded !== true/);
  assert.match(bridge, /normalizeOfficeCandidateProjection\(\s*rawProjection,\{ surface: 'TIMESHEET_SUMMARY', rowIdentity: identity \}/);
  assert.match(bridge, /const embedded = embeddedSummaryResult\(row\);/);
  assert.match(bridge, /candidate_office_projection_not_applicable === true/);
  assert.match(bridge, /if \(embedded\.notApplicable\) return/);
  assert.match(bridge, /if \(embedded\?\.notApplicable\) continue/);
  assert.match(bridge, /if \(!findProjection\('TIMESHEET_SUMMARY', identity\.row_key, identity\)\)/);
  assert.match(bridge, /async function sortSummaryRowsByCandidateStatus/);
  assert.match(bridge, /partitionProjectionIdentities\(Array\.from\(pendingRowsByExactKey\.values\(\)\)\)/);
  assert.match(bridge, /if \(surface === 'SIMPLE_TIMESHEET'\) loadSlot\(slot\);\s*else queueBatchSlot\(slot\)/);
  assert.match(bridge, /let chunk = chunks\.find\(candidate => candidate\.rows\.length < 100 && !candidate\.rowKeys\.has\(row\.row_key\)\)/);
  assert.match(bridge, /chunk = \{ rows: \[\], rowKeys: new Set\(\) \}; chunks\.push\(chunk\)/);
  assert.match(bridge, /fetchOfficeCandidateProjections\(\{ surface, identities: chunk \}\)/);
  assert.match(bridge, /function projectionMatchesRow\(projection, row\)/);
  assert.match(bridge, /row\.expected_row_signature && String\(current\.row_signature \|\| ''\) !== String\(row\.expected_row_signature\)/);
  assert.match(bridge, /if \(projectionMatchesRow\(cached, row\)\)/);
  assert.match(bridge, /cache\.delete\(cacheKey\)/);
});

test('every Office surface uses one approved status presenter and one winning QR lifecycle badge', () => {
  const window = load(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  const input = projection('AWAITING_PAPER_RETURN', 'raw paper label', 'danger', {
    paper_pack: { state: 'RETURN_RECEIVED', page_count: 4 },
    manager_approval: { method: 'EMAIL', state: 'APPROVED' }
  });
  const detail = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeDetail(input);
  const summary = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(input);
  assert.equal(detail.status.label, 'Finalising Submission');
  assert.equal(summary.status.label, 'Finalising Submission');
  const stage = window.CloudTMSCandidateOfficeSurface.renderCandidateStageFragment(detail);
  assert.equal((stage.match(/data-candidate-status-code=/g) || []).length, 1);
  assert.match(stage, /Finalising Submission/);
  assert.doesNotMatch(stage, /QR Pack ready|QR Awaiting Signed Return|Manager Approved/);
});

test('terminal Candidate truth outranks retained QR lifecycle facts on every Office surface', () => {
  const window = load(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  const surfaces = ['TIMESHEET_SUMMARY', 'SIMPLE_TIMESHEET', 'BULK_PROCESS', 'BULK_AUTHORISE'];
  for (const code of ['FINALISED', 'AUTHORISED', 'INVOICED_NOT_PAID', 'PAID']) {
    const input = projection(code, 'raw terminal label', 'danger', {
      paper_pack: { state: 'RETURN_RECEIVED', page_count: 4 },
      manager_approval: { method: 'EMAIL', state: 'APPROVED' },
      workflow: { state: 'FINALISED', historical: true }
    });
    for (const surface of surfaces) {
      const view = surface === 'TIMESHEET_SUMMARY'
        ? window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(input)
        : window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeDetail(input, { surface });
      assert.equal(view.status.label, 'Candidate Submission Complete', `${surface} must prefer ${code}`);
      const html = window.CloudTMSCandidateOfficeSurface.renderCandidateFragment(view, {
        surface,
        variant: surface === 'SIMPLE_TIMESHEET' ? 'stage' : 'compact'
      });
      assert.match(html, /Candidate Submission Complete/);
      assert.doesNotMatch(html, /Finalising Submission|QR Awaiting Signed Return|QR Pack Preparing/);
    }
  }
});

test('Summary uses the settled existing warning style for authoritative unexpected hours', () => {
  const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.match(main, /rowObj\?\.has_deviation_marker === true/);
  assert.match(main, /unexpectedHours\.className = 'pill pill-warn'/);
  assert.match(main, /unexpectedHours\.textContent = 'Unexpected hours - needs checking'/);
  assert.equal((main.match(/unexpectedHours\.textContent = 'Unexpected hours - needs checking'/g) || []).length, 3,
    'full render, patched rows and newly inserted rows must agree');
});

test('Summary Candidate refresh reuses one cursor heartbeat and patches only bounded loaded rows', () => {
  const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  const start = main.indexOf('function ensureTimesheetSummaryTargetedRefreshManager()');
  const end = main.indexOf('\nfunction renderSummary(rows)', start);
  const manager = main.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(manager, /return \{ cursor: active\.cursor \}/);
  assert.match(manager, /const loadedRows = active\.rows\.slice\(0,200\)/);
  assert.match(manager, /\/api\/timesheets\/candidate-summary-patches/);
  assert.match(manager, /if \(!requested\.length\)[\s\S]*active\.cursor = nextCursor/);
  assert.doesNotMatch(manager, /\/api\/timesheets\/summary/);
  assert.doesNotMatch(manager, /timesheet_summary_lightweight_totals_v1/);
  const heartbeatStart = main.indexOf('const candidateSummaryWatch = window.__timesheetSummaryTargetedRefresh');
  const heartbeat = main.slice(heartbeatStart, heartbeatStart + 850);
  assert.match(heartbeat, /__candidate_timesheet_summary_cursor = Number\(candidateSummaryWatch\.cursor\)/);
  assert.doesNotMatch(heartbeat, /timesheet_id|contract_week_id|identities/);
});
