const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');

function loadBrowserModules(...names) {
  const context = vm.createContext({
    window: {},
    console,
    Date,
    Intl,
    Object,
    Set,
    String
  });
  names.forEach(name => {
    const source = fs.readFileSync(path.join(root, 'js', name), 'utf8');
    new vm.Script(source, { filename: name }).runInContext(context);
  });
  return context.window;
}

function action(code, group = 'MANAGER_APPROVAL') {
  return {
    code,
    label: code.replaceAll('_', ' '),
    group,
    enabled: true,
    prominent: true
  };
}

test('each Office surface exposes only its complete approved Candidate action block', () => {
  const window = loadBrowserModules('candidate-office-ui-policy-v1.js');
  const policy = window.CloudTMSCandidateOfficeUiPolicy;

  assert.deepEqual(Array.from(policy.APPROVED_BUTTONS_BY_SURFACE.SIMPLE_TIMESHEET), [
    'SEND_MANAGER_REMINDER',
    'RENEW_MANAGER_REQUEST',
    'REJECT_CANDIDATE_SUBMISSION',
    'RETRY_FINALISATION',
    'RETRY_PAPER_PREPARATION',
    'RESEND_QR_PACK',
    'ISSUE_REPLACEMENT_PAPER_PACK',
    'ROUTE:SWITCH_TO_MANUAL',
    'ROUTE:SWITCH_DAILY_TO_MANUAL',
    'ROUTE:CONVERT_QR_TO_MANUAL',
    'ROUTE:ALLOW_ELECTRONIC_AGAIN',
    'ROUTE:ALLOW_QR_AGAIN',
    'ROUTE:REISSUE_QR'
  ]);
  assert.deepEqual(Array.from(policy.APPROVED_BUTTONS_BY_SURFACE.BULK_PROCESS), [
    'SEND_MANAGER_REMINDER',
    'RENEW_MANAGER_REQUEST',
    'REJECT_CANDIDATE_SUBMISSION',
    'RETRY_FINALISATION',
    'RETRY_PAPER_PREPARATION',
    'ROUTE:SWITCH_TO_MANUAL',
    'ROUTE:SWITCH_DAILY_TO_MANUAL',
    'ROUTE:CONVERT_QR_TO_MANUAL',
    'ROUTE:ALLOW_ELECTRONIC_AGAIN',
    'ROUTE:ALLOW_QR_AGAIN'
  ]);
  assert.deepEqual(Array.from(policy.APPROVED_BUTTONS_BY_SURFACE.BULK_AUTHORISE), [
    'REJECT_CANDIDATE_SUBMISSION'
  ]);
  for (const surface of ['TIMESHEET_SUMMARY', 'INVOICE_GENERATOR', 'INVOICE_ISSUER']) {
    assert.deepEqual(Array.from(policy.APPROVED_BUTTONS_BY_SURFACE[surface]), []);
    assert.equal(policy.isButtonApproved(surface, 'SEND_MANAGER_REMINDER'), false);
  }

  assert.equal(policy.assertOfficeButtonApproved('BULK_PROCESS', 'SEND_MANAGER_REMINDER'), true);
  assert.equal(policy.assertOfficeButtonApproved('BULK_AUTHORISE', 'REJECT_CANDIDATE_SUBMISSION'), true);
  assert.equal(policy.isButtonApproved('BULK_PROCESS', 'ISSUE_REPLACEMENT_PAPER_PACK'), false);
  assert.equal(policy.isButtonApproved('BULK_PROCESS', 'RESEND_QR_PACK'), false);
  assert.equal(policy.isButtonApproved('BULK_AUTHORISE', 'ISSUE_REPLACEMENT_PAPER_PACK'), false);
  assert.equal(policy.isButtonApproved('BULK_AUTHORISE', 'RESEND_QR_PACK'), false);
  assert.equal(policy.assertOfficeButtonApproved('SIMPLE_TIMESHEET', 'SEND_MANAGER_REMINDER'), true);
});

test('manager PHONE decisions and Candidate-app recovery remain non-Office actions', () => {
  const window = loadBrowserModules('candidate-office-ui-policy-v1.js');
  const policy = window.CloudTMSCandidateOfficeUiPolicy;

  for (const code of policy.MANAGER_JOURNEY_ACTIONS) {
    assert.equal(policy.ownerOf(code), 'MANAGER_JOURNEY');
    assert.throws(
      () => policy.assertOfficeButtonApproved('SIMPLE_TIMESHEET', code),
      error => error.code === 'CANDIDATE_OFFICE_MANAGER_DECISION_FORBIDDEN'
    );
  }

  for (const code of policy.CANDIDATE_APP_ACTIONS) {
    assert.equal(policy.ownerOf(code), 'CANDIDATE_APP');
    assert.throws(
      () => policy.assertOfficeButtonApproved('SIMPLE_TIMESHEET', code),
      error => error.code === 'CANDIDATE_OFFICE_CANDIDATE_ACTION_FORBIDDEN'
    );
  }

  for (const code of policy.EVIDENCE_TAB_ACTIONS) {
    assert.equal(policy.ownerOf(code), 'OFFICE_EVIDENCE');
    assert.throws(
      () => policy.assertOfficeButtonApproved('SIMPLE_TIMESHEET', code),
      error => error.code === 'CANDIDATE_OFFICE_EVIDENCE_TAB_ACTION_REQUIRED'
    );
  }

  assert.equal(policy.ownerOf('CANCEL_MANAGER_REQUEST'), 'BACKEND_ONLY');
  assert.throws(
    () => policy.assertOfficeButtonApproved('SIMPLE_TIMESHEET', 'CANCEL_MANAGER_REQUEST'),
    error => error.code === 'CANDIDATE_OFFICE_ACTION_NOT_EXPOSED'
  );
});

test('QR documents remain in the existing Evidence tab rather than a new review modal', () => {
  const presenterSource = fs.readFileSync(path.join(root, 'js', 'candidate-office-presenter-v1.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(root, 'js', 'candidate-office-controller-v1.js'), 'utf8');
  const modalSource = fs.readFileSync(path.join(root, 'js', 'candidate-office-modal-v1.js'), 'utf8');
  assert.match(presenterSource, /EVIDENCE_TAB_ACTIONS/);
  assert.doesNotMatch(controllerSource, /openCandidatePaperReturnReviewModal/);
  assert.doesNotMatch(modalSource, /openCandidatePaperReturnReviewModal|paper-return-review/);
});

test('Candidate confirmations adapt onto the existing CloudTMS modal owner', () => {
  const modalSource = fs.readFileSync(path.join(root, 'js', 'candidate-office-modal-v1.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  const candidateCss = fs.readFileSync(path.join(root, 'css', 'candidate-office-v1.css'), 'utf8');
  assert.match(modalSource, /typeof showModal !== 'function'/);
  assert.match(modalSource, /frameEntity: 'candidate-office-dialog'/);
  assert.match(mainSource, /opts\.frameEntity/);
  assert.match(modalSource, /showModal\(title, \[\{ key: 'main', label: 'Confirm' \}\]/);
  assert.doesNotMatch(modalSource, /document\.body\.appendChild\(backdrop\)|candidate-office-dialog-backdrop/);
  assert.match(modalSource, /noParentGate: true/);
  assert.match(modalSource, /showSave: false/);
  assert.match(modalSource, /showApply: false/);
  assert.match(modalSource, /closest\('\[data-candidate-office-dialog\]'\)/);
  assert.match(modalSource, /window\.addEventListener\('keydown', onKeyDown, true\)/);
  assert.match(modalSource, /window\.removeEventListener\('keydown', onKeyDown, true\)/);
  assert.match(modalSource, /modalBody\(\)\?\.addEventListener\('input', onBodyInput\)/);
  assert.match(modalSource, /modalBody\(\)\?\.removeEventListener\('input', onBodyInput\)/);
  assert.match(modalSource, /event\.key !== 'Tab'/);
  assert.match(candidateCss, /#modal:has\(\[data-candidate-office-slot="1"\]\) \.modal-b \{ flex:1 1 auto; min-height:0; overflow:auto;/);
  assert.match(candidateCss, /#modal:has\(\[data-candidate-office-dialog\]\) \{ width:min\(1100px,calc\(100vw - 24px\)\) !important; min-width:0 !important;/);
  assert.match(candidateCss, /\.scrollable-evidence \{ max-width:100%; overflow:auto !important; \}/);
  assert.match(candidateCss, /\.ts-evidence-table \{ min-width:980px; table-layout:fixed; \}/);
  assert.match(candidateCss, /\.ts-evidence-table th,[\s\S]*\.ts-evidence-table td \{ padding:8px 12px;/);
  assert.match(candidateCss, /\.ts-evidence-table td \{ padding:8px 12px; vertical-align:top; white-space:normal; overflow-wrap:anywhere;/);
  assert.match(candidateCss, /\.ts-evidence-table th:last-child,[\s\S]*width:260px;/);
  assert.match(candidateCss, /\.ctms-timesheet-evidence-table \.ctms-evidence-actions \{ display:flex; flex-wrap:wrap;/);
  assert.match(candidateCss, /#modal\.bulk-process-workbench:has\(\[data-candidate-office-slot="1"\]\) #bulkProcessWorkbenchGrid \{ grid-template-columns:1fr !important;/);
  assert.match(candidateCss, /#bulkProcessRightPane \{ grid-row:1; max-height:none !important; \}/);
});

test('Timesheet fast-open hydration cannot visually replace a tab deliberately chosen by the user', () => {
  const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.match(main, /this\.__timesheetHydrationTabIntent/);
  assert.match(main, /window\.modalCtx\.__timesheetHydrationTabIntent = tabIntent/);
  assert.match(main, /expires_at: Date\.now\(\) \+ 5000/);
  assert.match(main, /String\(intent\.key\) !== String\(k \|\| ''\)/);
  assert.match(main, /await Promise\.resolve\(top\.setTab\(t\.key\)\)/);
});

test('Issues fragment contains actual Candidate issues and not ordinary lifecycle progress', () => {
  const window = loadBrowserModules(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-surface-v1.js'
  );
  const render = window.CloudTMSCandidateOfficeSurface.renderCandidateIssuesFragment;

  assert.equal(render({
    status: { code: 'AWAITING_MANAGER_APPROVAL', label: 'Awaiting Manager Approval', tone: 'danger' },
    diagnostics: []
  }), '');

  const refused = render({
    status: { code: 'REFUSED', label: 'Refused by Client', tone: 'danger' },
    diagnostics: []
  });
  assert.match(refused, /Refused by Client/);

  const diagnostics = render({
    status: { code: 'AWAITING_MANAGER_APPROVAL', label: 'Awaiting Manager Approval', tone: 'danger' },
    diagnostics: [{ label: 'Hours exceed the expected range', tone: 'warning' }]
  });
  assert.match(diagnostics, /Hours exceed the expected range/);
  assert.doesNotMatch(diagnostics, /Awaiting Manager Approval/);
});

test('technical retry and QR confirmations do not display manager-request facts', () => {
  const modalSource = fs.readFileSync(path.join(root, 'js', 'candidate-office-modal-v1.js'), 'utf8');
  assert.match(modalSource, /managerRequestCodes = new Set\(\['SEND_MANAGER_REMINDER', 'RENEW_MANAGER_REQUEST'\]\)/);
  assert.match(modalSource, /managerRequestCodes\.has\(code\) \? managerContext\(projection\) : ''/);
  assert.match(modalSource, /code === 'CANCEL_MANAGER_REQUEST'[\s\S]+CANDIDATE_OFFICE_ACTION_NOT_EXPOSED/);
  assert.doesNotMatch(modalSource, /Cancel manager approval request\?/);
});

test('presenter strips manager-owned, Candidate-owned and EMAIL-only actions from PHONE Office views', () => {
  const window = loadBrowserModules(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js'
  );
  const presenter = window.CloudTMSCandidateOfficePresenter;
  const projection = {
    current_identity: { row_key: 'row-1' },
    candidate_status: { code: 'AWAITING_MANAGER_APPROVAL', label: 'Awaiting Manager Approval', tone: 'danger' },
    workflow: { state: 'AWAITING_MANAGER_APPROVAL' },
    manager_approval: { method: 'PHONE', state: 'PENDING' },
    paper_pack: { state: 'NOT_APPLICABLE' },
    rejections: [{
      state: 'REJECTED',
      rejection_actionable: true,
      recovery_action: action('RESUBMIT_REJECTED', 'RECOVERY')
    }],
    diagnostics: [],
    primary_action: action('APPROVE_BY_PHONE'),
    available_actions: [
      action('BEGIN_PHONE_REVIEW'),
      action('APPROVE_BY_PHONE'),
      action('REFUSE_BY_PHONE'),
      action('RESUBMIT_REJECTED', 'RECOVERY'),
      action('MARK_NO_WORK', 'RECOVERY'),
      action('SEND_MANAGER_REMINDER')
    ],
    observed_at_utc: '2026-08-13T08:00:00Z'
  };

  const view = presenter.presentCandidateOfficeDetail(projection);
  assert.deepEqual(Array.from(view.actions, item => item.code), []);
  assert.equal(view.primary_action, null);
  assert.equal(view.rejections[0].action, null);
  assert.equal(view.manager.title, 'Manager approval');
  assert.deepEqual(Array.from(view.manager.fields, item => Array.from(item)), [
    ['Status', 'Awaiting Manager Approval']
  ]);
  assert.doesNotMatch(JSON.stringify(view.manager.fields), /PHONE|Phone/);
});

test('manager approval presentation includes every settled Office detail without method or decision controls', () => {
  const window = loadBrowserModules(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js'
  );
  const manager = window.CloudTMSCandidateOfficePresenter.presentCandidateManagerApproval({
    method: 'EMAIL',
    state: 'PENDING',
    request_generation: 4,
    resend_count: 2,
    resends_remaining: 3,
    provider_accepted_at_utc: '2026-08-12T08:00:00Z',
    next_reminder_at_utc: '2026-08-13T08:00:00Z',
    expires_at_utc: '2026-08-14T08:00:00Z',
    delivery_state: 'SENT',
    provider_status: 'ACCEPTED',
    provider_handoff_in_progress: false,
    reminder_eligible: true
  }, [
    action('SEND_MANAGER_REMINDER'),
    action('APPROVE_BY_PHONE')
  ]);

  const fields = new Map(Array.from(manager.fields, item => Array.from(item)));
  assert.equal(fields.has('Method'), false);
  assert.equal(fields.get('Request generation'), 4);
  assert.equal(fields.get('Resends used'), 2);
  assert.equal(fields.get('Resends remaining'), 3);
  assert.equal(fields.get('Reminder availability'), 'Eligible');
  assert.deepEqual(Array.from(manager.actions, item => item.code), ['SEND_MANAGER_REMINDER']);
});

test('surface renders an agreed Simple action only when the server returns it enabled', () => {
  const window = loadBrowserModules(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-surface-v1.js'
  );
  const html = window.CloudTMSCandidateOfficeSurface.renderCandidateOfficeCard({
    status: { code: 'AWAITING_MANAGER_APPROVAL', label: 'Awaiting Manager Approval', tone: 'danger' },
    manager: null,
    paper: null,
    rejections: [],
    diagnostics: [],
    actions: [action('SEND_MANAGER_REMINDER'), { ...action('RETRY_FINALISATION', 'TECHNICAL'), enabled: false }],
    observed_at: '13/08/2026 09:00:00'
  });

  assert.match(html, /data-candidate-office-action="SEND_MANAGER_REMINDER"/);
  assert.match(html, /data-candidate-office-server-enabled="1"/);
  assert.doesNotMatch(html, /data-candidate-office-action="RETRY_FINALISATION"/);
  assert.match(html, /Awaiting Manager Approval/);
});

test('Office presentation uses QR wording and hides ineligible buttons', () => {
  const window = loadBrowserModules(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  const presenter = window.CloudTMSCandidateOfficePresenter;
  const qr = presenter.presentCandidatePaperPack({
    state: 'PREPARING',
    retryable: false,
    delivery_generation: 3,
    page_count: 4
  }, []);
  const html = window.CloudTMSCandidateOfficeSurface.renderCandidateOfficeCard({
    status: { code: 'AWAITING_PAPER_RETURN', label: 'QR Pack issued — awaiting signed return', tone: 'warning' },
    manager: null,
    paper: qr,
    rejections: [],
    diagnostics: [],
    actions: [{ ...action('RETRY_PAPER_PREPARATION', 'PAPER'), enabled: false }],
    observed_at: '13/08/2026 09:00:00'
  });

  assert.match(html, /QR Pack/);
  assert.doesNotMatch(html, /QR Status — Preparing/);
  assert.equal((html.match(/data-candidate-status-code=/g) || []).length, 1);
  assert.doesNotMatch(html, />PAPER|>Paper|paper pack|paper documents/i);
  assert.doesNotMatch(html, /<button/i);
});

test('QR Pack failures use Office wording rather than raw backend PAPER reason codes', () => {
  const window = loadBrowserModules(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  const qr = window.CloudTMSCandidateOfficePresenter.presentCandidatePaperPack({
    state: 'FAILED_RETRYABLE',
    reason_code: 'CANDIDATE_PAPER_PACK_RENDER_FAILED',
    retryable: true
  }, []);
  const html = window.CloudTMSCandidateOfficeSurface.renderCandidateOfficeCard({
    status: { code: 'AWAITING_PAPER_RETURN', label: 'QR Pack issued — awaiting signed return', tone: 'warning' },
    manager: null, paper: qr, rejections: [], diagnostics: [], actions: [], observed_at: '13/08/2026 09:00:00'
  });
  assert.match(html, /CloudTMS can retry this failed QR Pack preparation/);
  assert.doesNotMatch(html, /CANDIDATE_PAPER|PAPER PACK RENDER FAILED/);
});

test('surface policy hides approved actions unless the current server action is enabled', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'candidate-office-surface-v1.js'), 'utf8');
  const eligibleGate = source.indexOf('.filter(action => action?.enabled === true || action?.placeholder === true)');
  const approvalGate = source.indexOf('.filter(action => window.CloudTMSCandidateOfficeUiPolicy?.isButtonApproved');
  assert.ok(eligibleGate > -1, 'server eligibility gate missing');
  assert.ok(approvalGate > eligibleGate, 'surface approval must be checked after server eligibility');
});

test('Resend QR Pack is a non-operational placeholder only for an issued unsigned pack awaiting return', () => {
  const window = loadBrowserModules(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  const base = {
    current_identity: { row_key: 'row-qr' },
    candidate_status: { code: 'AWAITING_PAPER_RETURN', label: 'QR Pack issued — awaiting signed return', tone: 'warning' },
    workflow: { state: 'AWAITING_PAPER_RETURN', route: 'PAPER' },
    manager_approval: null,
    paper_pack: { state: 'READY', issued_at_utc: '2026-08-13T08:00:00Z', page_count: 3 },
    rejections: [], diagnostics: [], primary_action: null, available_actions: [], observed_at_utc: '2026-08-13T08:00:00Z'
  };
  const view = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeDetail(base);
  const html = window.CloudTMSCandidateOfficeSurface.renderCandidateActionsFragment(view);
  assert.match(html, /data-candidate-office-action="RESEND_QR_PACK"/);
  assert.match(html, /disabled aria-disabled="true"/);
  assert.match(html, /Backend support for safely resending this unchanged QR Pack is pending/);

  const unsent = structuredClone(base);
  unsent.paper_pack.issued_at_utc = null;
  const unsentHtml = window.CloudTMSCandidateOfficeSurface.renderCandidateActionsFragment(
    window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeDetail(unsent)
  );
  assert.doesNotMatch(unsentHtml, /RESEND_QR_PACK/);

  const bridge = fs.readFileSync(path.join(root, 'js', 'candidate-office-bridge-v1.js'), 'utf8');
  assert.doesNotMatch(bridge, /\/qr-resend|send-qr|resend-qr/i);
});

test('Evidence fragment shows the unsigned combined PDF as audit-only and never as signed authority', () => {
  const window = loadBrowserModules(
    'candidate-office-ui-policy-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js'
  );
  const viewAction = {
    code: 'VIEW_PAPER_PACK', label: 'View current paper pack', group: 'PAPER', enabled: true, prominent: false,
    invocation: { kind: 'HTTP', method: 'GET', path: '/paper-pack', fixed_body: {}, required_user_inputs: [], idempotency: 'NONE' }
  };
  const projection = {
    current_identity: { row_key: 'row-qr' },
    candidate_status: { code: 'AWAITING_PAPER_RETURN', label: 'QR Pack issued — awaiting signed return', tone: 'warning' },
    workflow: { state: 'AWAITING_PAPER_RETURN', route: 'PAPER' }, manager_approval: null,
    paper_pack: { state: 'READY', issued_at_utc: '2026-08-13T08:00:00Z', page_count: 4 },
    rejections: [], diagnostics: [], primary_action: null, available_actions: [viewAction], observed_at_utc: '2026-08-13T08:00:00Z'
  };
  const html = window.CloudTMSCandidateOfficeSurface.renderCandidateEvidenceFragment(
    window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeDetail(projection)
  );
  assert.match(html, /Unsigned QR Pack/);
  assert.match(html, /Audit copy only/);
  assert.match(html, /cannot make the timesheet eligible for Authorisation/);
  assert.match(html, />View</);
  assert.match(html, />Download</);
  assert.doesNotMatch(html, /Signed QR Pack received|eligible for Authorisation<\/strong>/i);
});

test('QR Pack viewing reserves a user-initiated window and validates the returned PDF', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'candidate-office-bridge-v1.js'), 'utf8');
  const reserve = source.indexOf("window.open('about:blank', '_blank')");
  const freshLoad = source.indexOf('await loadSlot(slot, { force: true })', reserve);
  assert.ok(reserve > -1 && freshLoad > reserve, 'the viewer must be reserved synchronously before the first awaited request');
  assert.match(source, /result\.slice\(0, 5\)\.text\(\)/);
  assert.match(source, /signature !== '%PDF-'/);
  assert.match(source, /const frame = viewerDocument\.createElement\('iframe'\)/);
  assert.match(source, /frame\.src = url/);
  assert.match(source, /frame\.title = 'Unsigned QR Pack'/);
});

test('returned official document classifications use the settled Evidence labels', () => {
  const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  for (const [code, label] of [
    ['TIMESHEET', 'Timesheet'], ['MILEAGE', 'Mileage'], ['TRAVEL', 'Travel'],
    ['ACCOMMODATION', 'Accommodation'], ['OTHER', 'Other']
  ]) {
    assert.match(main, new RegExp(`${code}: '${label}'`));
  }
});

test('controller enforces the same approval policy before invoking a typed action', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'candidate-office-controller-v1.js'), 'utf8');
  assert.match(source, /assertOfficeButtonApproved\(context\.surface, action\.code\)/);
  assert.match(source, /assertOfficeButtonApproved\(context\.surface, `ROUTE:\$\{context\.action\}`\)/);
  assert.match(source, /assertOfficeButtonApproved\(context\.surface, 'REJECT_CANDIDATE_SUBMISSION'\)/);
  assert.match(source, /Candidate-app destinations cannot be executed by the Office frontend/);
  assert.doesNotMatch(source, /cloudtms:candidate-office-client-destination/);
  assert.doesNotMatch(source, /if \(action\.requires_confirmation \|\| action\.requires_reason/);
  assert.match(source, /await modals\.openCandidateManagerActionModal/);
  assert.match(source, /await modals\.openCandidateTypedActionModal/);
});

test('summary batch reminder creator is also gated by explicit surface approval', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'candidate-office-bridge-v1.js'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'js', 'candidate-office-controller-v1.js'), 'utf8');
  assert.match(source, /isButtonApproved\('TIMESHEET_SUMMARY', 'SEND_MANAGER_REMINDER_BATCH'\)/);
  assert.match(controller, /assertOfficeButtonApproved\('TIMESHEET_SUMMARY', 'SEND_MANAGER_REMINDER_BATCH'\)/);
});

test('legacy route clicks remain untouched until their exact replacement route is approved', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'candidate-office-bridge-v1.js'), 'utf8');
  const gate = source.indexOf('isButtonApproved(surface, `ROUTE:${routeAction}`)');
  const intercept = source.indexOf('event.preventDefault(); event.stopImmediatePropagation();', gate);
  assert.ok(gate > -1, 'route approval gate missing');
  assert.ok(intercept > gate, 'legacy route interception must occur only after approval');
  assert.match(source, /document\.addEventListener\('click', onLegacyRouteClick, true\)/);
  assert.match(source, /legacyAction === 'allow-qr-again'\) routeAction = 'ALLOW_QR_AGAIN'/);
  assert.match(source, /legacyAction === 'allow-electronic-again'\) routeAction = 'ALLOW_ELECTRONIC_AGAIN'/);
});

test('approved Bulk routes replace legacy Candidate labels while unapproved Bulk Authorise routes remain suppressed', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  const policy = loadBrowserModules('candidate-office-ui-policy-v1.js').CloudTMSCandidateOfficeUiPolicy;
  assert.match(source, /candidateOfficeBulkAuthoriseRouteAllowed/);
  assert.match(source, /candidateOfficeBulkProcessRouteAllowed/);
  for (const surface of ['BULK_AUTHORISE', 'BULK_PROCESS']) {
    assert.match(source, new RegExp("policy\\.isButtonApproved\\('" + surface + "', `ROUTE:\\$\\{routeAction\\}`\\)"));
  }
  for (const route of ['ALLOW_QR_AGAIN', 'ALLOW_ELECTRONIC_AGAIN', 'CONVERT_QR_TO_MANUAL']) {
    assert.ok((source.match(new RegExp(`candidateOfficeBulk(?:Authorise|Process)RouteAllowed\\('${route}'\\)`, 'g')) || []).length >= 2,
      `${route} must be approval-gated in both Bulk workbenches`);
  }
  assert.equal(policy.isButtonApproved('BULK_PROCESS', 'ROUTE:ALLOW_QR_AGAIN'), true);
  assert.equal(policy.isButtonApproved('BULK_PROCESS', 'ROUTE:ALLOW_ELECTRONIC_AGAIN'), true);
  assert.equal(policy.isButtonApproved('BULK_AUTHORISE', 'ROUTE:ALLOW_QR_AGAIN'), false);
  assert.equal(policy.isButtonApproved('BULK_AUTHORISE', 'ROUTE:ALLOW_ELECTRONIC_AGAIN'), false);
  assert.match(source, /bulkProcessActionRowAllowQrAgainBtn[\s\S]*Enable QR submission/);
  assert.match(source, /bulkProcessActionRowAllowElectronicAgainBtn[\s\S]*Enable Electronic Submission/);
});

test('Bulk workbench action strips mount typed Candidate actions without QR replacement or resend', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.match(source, /slotHtml\('BULK_PROCESS', activeRow, \{ variant: 'actions', compact: false \}\)/);
  assert.match(source, /slotHtml\('BULK_AUTHORISE', activeRowBase, \{ variant: 'actions', compact: false \}\)/);
  const policy = loadBrowserModules('candidate-office-ui-policy-v1.js').CloudTMSCandidateOfficeUiPolicy;
  for (const surface of ['BULK_PROCESS', 'BULK_AUTHORISE']) {
    assert.equal(policy.isButtonApproved(surface, 'ISSUE_REPLACEMENT_PAPER_PACK'), false);
    assert.equal(policy.isButtonApproved(surface, 'RESEND_QR_PACK'), false);
  }
});

test('Simple Timesheet approved route controls use the exact agreed labels', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  const start = source.indexOf('const actionsHtml = (() => {');
  const end = source.indexOf('const FOOTER_ONLY_ACTION_RE', start);
  assert.ok(start > -1 && end > start, 'Simple Timesheet action block missing');
  const block = source.slice(start, end);
  assert.match(block, />\s*Convert to Manual\s*</);
  assert.match(block, />\s*Enable Electronic Submission\s*</);
  assert.match(block, />\s*Enable QR submission\s*</);
  assert.doesNotMatch(block, /Convert to Manual so you can enter hours on behalf of candidate/);
  assert.doesNotMatch(block, />\s*(?:Allow QR again|Allow electronic again|Revert to electronic)\s*</);
});

test('QR and Electronic enable controls require Manual-only state plus server eligibility', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.match(source, /isManualOnly && canAllowQrAgain && !canAllowElecAgain/);
  assert.match(source, /isManualOnly && canAllowElecAgain/);
  assert.match(source, />\s*Enable QR submission\s*</);
  assert.match(source, />\s*Enable Electronic Submission\s*</);
});

test('planned-week Manual and Electronic route controls remain on their existing contract-week authority', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.match(source, /isPlannedWeeklyElectronic \|\| \(candidateOfficeRouteUiReady && canSwitchToManual && \(isWeeklyElectronicWithTs \|\| isDailyElectronicWithTs\)\)/);
  assert.match(source, /data-ts-action="switch-electronic-planned"/);
  assert.match(source, />\s*Switch week back to electronic\s*</);
});

test('materialised Candidate route controls cannot fall back to legacy owners when Office authority is unavailable', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.match(source, /const candidateOfficeProjectionUiReady = !!\(/);
  assert.match(source, /const candidateOfficeRouteUiReady = candidateOfficeProjectionUiReady &&/);
  assert.match(source, /capabilities\.permissions\.change_route === true/);
  assert.match(source, /candidateOfficeRouteUiReady && tsId && !locked && canConvertQrToManualOnly/);
  assert.match(source, /candidateOfficeRouteUiReady && !importAuthoritative && tsId && !locked && isManualOnly && canAllowQrAgain/);
  assert.match(source, /candidateOfficeRouteUiReady && !importAuthoritative && tsId && !locked && isManualOnly && canAllowElecAgain/);
});

test('canonical Candidate projection is the only QR lifecycle presentation and action authority', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.doesNotMatch(source, /QR Timesheet Hours received|QR Completed –|QR signed upload has been received|Awaiting signed QR timesheet/);
  assert.doesNotMatch(source, /qrAwaitingSignatureUpload|reason: 'QR_UNSIGNED'/);
  assert.match(source, /Historic QR[\s\S]{0,120}columns are neither presentation authority nor Office action authority/);
  assert.match(source, /permissions\?\.view_candidate_state === true/);
  assert.match(source, /surfaces\?\.simple_timesheet === true/);
});

test('Simple Timesheet route wording uses canonical route identity rather than legacy QR artefacts', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  const start = source.indexOf('const canonicalManualNonQrRoute =');
  const end = source.indexOf('const additionalSeqForOverview', start);
  assert.ok(start > -1 && end > start, 'canonical route block missing');
  const block = source.slice(start, end);
  assert.match(block, /includes\('MANUAL_NON_QR'\)/);
  assert.match(block, /const canonicalQrRoute = !canonicalManualNonQrRoute/);
  assert.doesNotMatch(block, /qr_status|qr_token|qr_generated_at|qr_scanned_at/);
  assert.match(source, /if \(canonicalQrRoute\) return 'QR'/);
  assert.match(source, /Candidate Submission shows the current QR Pack lifecycle/);
});

test('Timesheet Processing Status uses Processed and never presents legacy QR progress', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.match(source, /\['PROCESSED',\s+'Processed'\]/);
  assert.match(source, /PENDING_AUTH:\s*'Processed'/);
  assert.match(source, /return \{ key: 'PROCESSED', label: 'Processed' \}/);
  assert.doesNotMatch(source, /QR Timesheet Hours received|QR Completed –|Awaiting signed QR timesheet/);
});

test('Simple Timesheet integrates Candidate state into existing modal rows', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  const bridgeSource = fs.readFileSync(path.join(root, 'js', 'candidate-office-bridge-v1.js'), 'utf8');
  assert.match(source, /candidateOfficeSlot\('stage'\)/);
  assert.match(source, /candidateOfficeSlot\('overview'\)/);
  assert.match(source, /candidateOfficeSlot\('actions'\)/);
  assert.match(source, /slotHtml\('SIMPLE_TIMESHEET', candidateIssuesIdentityRow, \{ variant: 'issues' \}\)/);
  assert.match(source, /slotHtml\('SIMPLE_TIMESHEET', candidateEvidenceIdentity, \{ variant: 'evidence' \}\)/);
  assert.match(source, /!safeBtns\.length\) return candidateOfficeProjectionUiReady \? ''/);
  assert.match(source, /openingDetailsPending \|\| \(!actionsHtml && !candidateActionsHtml\)/);
  assert.match(source, /candidateOfficeAction \|\| candidateOfficeEvidenceAction/);
  assert.match(source, /candidateOfficeServerEnabled !== '1'/);
  assert.match(source, /startsWith\('candidate-office-'\) && candidateDialogAction/);
  assert.match(source, /dataset\.initiallyDisabled === '1'/);
  assert.match(source, /String\(top\.kind \|\| ''\)\.startsWith\('candidate-office-'\)/);
  assert.match(bridgeSource, /function clampExpandedCandidateModal\(slot\)/);
  assert.match(bridgeSource, /window\.__modalAnchorsByKind\[kind\]/);
  assert.match(bridgeSource, /clampExpandedCandidateModal\(slot\)/);
});

test('single-detail fetches carry the complete row identity through load and freshness checks', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'candidate-office-bridge-v1.js'), 'utf8');
  const calls = source.match(/fetchOfficeCandidateProjection\(\{ timesheetId: [^}]+, rowIdentity: [^}]+ \}\)/g) || [];
  assert.equal(calls.length, 2);
  const simpleOnly = source.match(/surface === 'SIMPLE_TIMESHEET' && (?:row|identity)\.timesheet_id/g) || [];
  assert.equal(simpleOnly.length, 2, 'bulk refreshes must continue using the surface-specific batch projection');
});

test('Bulk Authorise mounts the compact Candidate state in both settled locations', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  const slots = source.match(/CloudTMSCandidateOfficeBridge\.slotHtml\('BULK_AUTHORISE', [^\n]+\{ compact: true \}\)/g) || [];
  assert.equal(slots.length, 1, 'left list must contain one direct compact Candidate slot');
  assert.match(source, /const candidateOfficeBadgeHtml = \(typeof window !== 'undefined' && window\.CloudTMSCandidateOfficeBridge/);
  assert.match(source, /const candidateOfficeSurface = isBulkAuthoriseSummary \? 'BULK_AUTHORISE' : 'BULK_PROCESS'/);
  assert.match(source, /slotHtml\(candidateOfficeSurface, displayRow, \{ compact: true \}\)/);
});

test('Bulk Process mounts compact Candidate state in its row list and selected-row summary', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.match(source, /slotHtml\('BULK_PROCESS', row, \{ compact: true \}\)/);
  assert.match(source, /const candidateOfficeSurface = isBulkAuthoriseSummary \? 'BULK_AUTHORISE' : 'BULK_PROCESS'/);
  assert.match(source, /slotHtml\(candidateOfficeSurface, displayRow, \{ compact: true \}\)/);
});

test('Candidate integration does not claim or reinterpret the Bulk Process pass-or-issues border', () => {
  const candidateSources = [
    'candidate-office-api-v1.js',
    'candidate-office-bootstrap-v1.js',
    'candidate-office-bridge-v1.js',
    'candidate-office-contract-v1.js',
    'candidate-office-controller-v1.js',
    'candidate-office-modal-v1.js',
    'candidate-office-presenter-v1.js',
    'candidate-office-surface-v1.js',
    'candidate-office-ui-policy-v1.js'
  ].map(name => fs.readFileSync(path.join(root, 'js', name), 'utf8')).join('\n');
  const candidateCss = fs.readFileSync(path.join(root, 'css', 'candidate-office-v1.css'), 'utf8');

  assert.doesNotMatch(candidateSources + candidateCss, /bulkProcessPreviewPaneRoot|data-bulk-process-preview-(?:pass|issue)|bulk-process-preview-(?:pass|issue)/i);
  assert.doesNotMatch(candidateSources + candidateCss, /preview border|border tooltip/i);
});
