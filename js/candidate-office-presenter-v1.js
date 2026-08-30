(() => {
  'use strict';
  const STATUS = Object.freeze({
    CREATED: ['Candidate submission created', 'neutral'],
    WORKER_DRAFT: ['Candidate draft in progress', 'neutral'],
    WORKER_SUBMITTED: ['Candidate submission received', 'info'],
    WORKER_SUBMITTED_PENDING_REVIEW_DOCUMENT: ['Preparing review documents', 'info'],
    READY_FOR_MANAGER_APPROVAL: ['Ready for manager approval', 'info'],
    AWAITING_MANAGER_APPROVAL: ['Awaiting Manager Approval', 'danger'],
    MANAGER_APPROVED_PENDING_FINAL_DOCUMENT: ['Manager approved — preparing final document', 'success'],
    MANAGER_APPROVED: ['Manager Approved', 'success'],
    READY_TO_FINALISE: ['Ready to finalise', 'success'],
    AWAITING_PAPER_RETURN: ['QR Pack issued — awaiting signed return', 'warning'],
    RECEIVED: ['Signed return received', 'warning'],
    FINALISED: ['Candidate submission finalised', 'success'],
    REFUSED: ['Refused by Client', 'danger'],
    REJECTED: ['Rejected — resubmission required', 'danger'],
    CANCELLED: ['Cancelled', 'neutral'], SUPERSEDED: ['Superseded', 'neutral'], EXPIRED: ['Expired', 'warning'],
    INVOICED_NOT_PAID: ['Invoiced (Not paid)', 'warning'], AUTHORISED: ['Authorised', 'success'], PAID: ['Paid', 'success'],
    MANUAL: ['Manual', 'neutral'],
    UNASSIGNED: ['Candidate not assigned', 'danger'], CLIENT_UNRESOLVED: ['Client unresolved', 'danger'],
    RATE_MISSING: ['Rate missing', 'danger'], PAY_CHANNEL_MISSING: ['Pay channel missing', 'danger'],
    READY_FOR_HR: ['Ready for HR review', 'info'], READY_FOR_INVOICE: ['Ready for invoice', 'success'],
    PENDING_AUTH: ['Pending authorisation', 'warning'], AWAITING_MANUAL_SIGNATURE: ['Awaiting manual signature', 'warning'],
    UNPROCESSED: ['Unprocessed', 'neutral'], PLANNED: ['Planned', 'neutral'], OPEN: ['Open', 'neutral'],
    SUBMITTED: ['Submitted', 'info'], INVOICED: ['Invoiced', 'warning'], AVAILABLE: ['Available', 'neutral'],
    DRAFT: ['Draft', 'neutral']
  });
  const APPROVED_CANDIDATE_SUBMISSION_STATUS = Object.freeze({
    AWAITING_CANDIDATE_SUBMISSION: ['Awaiting Candidate Submission', 'neutral'],
    CANDIDATE_SUBMITTED: ['Candidate Submitted', 'info'],
    AWAITING_MANAGER_APPROVAL: ['Awaiting Manager Approval', 'warning'],
    MANAGER_APPROVED: ['Manager Approved', 'success'],
    QR_AWAITING_SIGNED_RETURN: ['QR Awaiting Signed Return', 'warning'],
    QR_PACK_PREPARING: ['QR Pack Preparing', 'info'],
    FINALISING_SUBMISSION: ['Finalising Submission', 'info'],
    FINALISATION_NEEDS_ATTENTION: ['Finalisation Needs Attention', 'danger'],
    QR_PACK_NEEDS_ATTENTION: ['QR Pack Needs Attention', 'danger'],
    REFUSED_BY_CLIENT: ['Refused by Client', 'danger'],
    REJECTED_BY_AGENCY: ['Rejected by Agency', 'danger'],
    CANDIDATE_SUBMISSION_CANCELLED: ['Candidate Submission Cancelled', 'neutral'],
    CANDIDATE_SUBMISSION_COMPLETE: ['Candidate Submission Complete', 'success'],
    STATUS_UNAVAILABLE: ['Status unavailable', 'neutral']
  });
  const PAPER = Object.freeze({
    PREPARING: ['QR Status — Preparing', 'info'], BACKOFF: ['QR Pack preparation waiting to retry', 'warning'],
    READY: ['QR Pack ready', 'success'], RETURN_RECEIVED: ['Signed QR Pack received', 'success'],
    FAILED_RETRYABLE: ['QR Pack preparation failed', 'danger'], FAILED_TERMINAL: ['QR Pack preparation failed', 'danger'],
    RETIRED: ['QR Pack retired', 'neutral'], STALE: ['QR Pack is out of date', 'warning']
  });
  const QR_STATE_EXPLANATIONS = Object.freeze({
    BACKOFF: 'CloudTMS is waiting until the server-owned retry time.',
    FAILED_RETRYABLE: 'CloudTMS can retry this failed QR Pack preparation.',
    FAILED_TERMINAL: 'This QR Pack needs Office review before another action.',
    RETIRED: 'This QR Pack and its code are no longer valid.',
    STALE: 'This QR Pack no longer matches the current timesheet.'
  });
  const OFFICE_ACTION_LABELS = Object.freeze({
    SEND_MANAGER_REMINDER: 'Send Manager Reminder',
    RENEW_MANAGER_REQUEST: 'Request Manager Approval Again',
    CANCEL_MANAGER_REQUEST: 'Cancel Manager Approval Request',
    REJECT_CANDIDATE_SUBMISSION: 'Reject Candidate Submission',
    RETRY_FINALISATION: 'Retry Finalisation',
    VIEW_PAPER_PACK: 'View QR Pack',
    REVIEW_PAPER_RETURN: 'View returned QR documents',
    RETRY_PAPER_PREPARATION: 'Retry QR Pack Preparation',
    RESEND_QR_PACK: 'Resend QR Pack',
    ISSUE_REPLACEMENT_PAPER_PACK: 'Create Replacement QR Pack and Notify Worker'
  });
  const tone = value => ['success', 'danger', 'warning', 'info', 'neutral'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'neutral';
  const OFFICE_FRONTEND_FORBIDDEN_ACTIONS = new Set([
    ...(window.CloudTMSCandidateOfficeUiPolicy?.MANAGER_JOURNEY_ACTIONS || []),
    ...(window.CloudTMSCandidateOfficeUiPolicy?.CANDIDATE_APP_ACTIONS || []),
    ...(window.CloudTMSCandidateOfficeUiPolicy?.EVIDENCE_TAB_ACTIONS || []),
    ...(window.CloudTMSCandidateOfficeUiPolicy?.OFFICE_HIDDEN_ACTIONS || [])
  ]);
  const formatDateTime = value => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(date);
    const read = type => parts.find(part => part.type === type)?.value || '';
    return `${read('day')}/${read('month')}/${read('year')} ${read('hour')}:${read('minute')}:${read('second')}`;
  };
  const sourceStatusView = projection => {
    const server = projection.candidate_status || {};
    const code = String(server.code || '').toUpperCase();
    const known = STATUS[code];
    if (!known) return Object.freeze({ code: 'UNAVAILABLE', label: 'Candidate status unavailable', tone: 'neutral', unavailable: true });
    return Object.freeze({ code, label: known[0], tone: tone(known[1]), unavailable: false });
  };
  const approvedStatusView = code => {
    const normalized = String(code || 'STATUS_UNAVAILABLE').toUpperCase();
    const selected = APPROVED_CANDIDATE_SUBMISSION_STATUS[normalized]
      || APPROVED_CANDIDATE_SUBMISSION_STATUS.STATUS_UNAVAILABLE;
    return Object.freeze({
      code: APPROVED_CANDIDATE_SUBMISSION_STATUS[normalized] ? normalized : 'STATUS_UNAVAILABLE',
      label: selected[0],
      tone: selected[1],
      unavailable: !APPROVED_CANDIDATE_SUBMISSION_STATUS[normalized] || normalized === 'STATUS_UNAVAILABLE'
    });
  };
  const candidateSubmissionApplies = projection => ['ELECTRONIC', 'QR'].includes(
    String(projection?.current_identity?.route_family || '').toUpperCase()
  );
  const isReceivedDailySubmission = projection => {
    const workflow = projection.workflow;
    const manager = projection.manager_approval;
    // A current Daily PHONE receipt is written only after the signed document
    // is attached. RECEIVED on PAPER still means a return awaiting processing.
    // This is Candidate completion, not Office financial authorisation.
    return String(projection.current_identity?.route_family || '').toUpperCase() === 'ELECTRONIC'
      && String(workflow?.workflow_kind || '').toUpperCase() === 'DAILY'
      && String(workflow?.state || '').toUpperCase() === 'RECEIVED'
      && String(workflow?.route || '').toUpperCase() === 'PHONE'
      && workflow?.is_current_action_workflow === true
      && workflow?.historical === false
      && String(manager?.method || '').toUpperCase() === 'PHONE'
      && String(manager?.state || '').toUpperCase() === 'APPROVED'
      && String(projection.paper_pack?.state || '').toUpperCase() === 'NOT_APPLICABLE';
  };
  function presentApprovedCandidateSubmissionStatus(projection) {
    // Candidate lifecycle presentation is route-owned, not finance-owned. A
    // terminal financial status on Manual (non-QR), HealthRoster, NHSP or any
    // other import-authoritative row must never manufacture Candidate truth.
    if (!candidateSubmissionApplies(projection)) return null;
    const source = sourceStatusView(projection);
    const sourceCode = String(source?.code || '').toUpperCase();
    const workflowState = String(projection.workflow?.state || '').toUpperCase();
    const routeFamily = String(projection.current_identity?.route_family || '').toUpperCase();
    const paperState = String(projection.paper_pack?.state || 'NOT_APPLICABLE').toUpperCase();
    const lifecycleCode = workflowState || sourceCode;
    const enabledActionCodes = new Set((projection.available_actions || [])
      .filter(action => action?.enabled === true)
      .map(action => String(action.code || '').toUpperCase()));

    // One closed precedence catalogue owns every Office Candidate surface. The
    // furthest confirmed QR lifecycle state wins, so mutually exclusive stages
    // can never be displayed together.
    if (source.unavailable && !workflowState) return approvedStatusView('STATUS_UNAVAILABLE');
    if (lifecycleCode === 'REJECTED') return approvedStatusView('REJECTED_BY_AGENCY');
    if (lifecycleCode === 'REFUSED') return approvedStatusView('REFUSED_BY_CLIENT');
    if (['CANCELLED', 'SUPERSEDED', 'EXPIRED'].includes(lifecycleCode)) return approvedStatusView('CANDIDATE_SUBMISSION_CANCELLED');
    if (workflowState === 'FINALISED') return approvedStatusView('CANDIDATE_SUBMISSION_COMPLETE');
    if (isReceivedDailySubmission(projection)) return approvedStatusView('CANDIDATE_SUBMISSION_COMPLETE');
    // Authorised/invoiced/paid is Office financial truth, not proof that the
    // Candidate used or completed the Candidate submission workflow. Historic
    // pre-app records with no durable workflow therefore remain blank.
    if (!workflowState && ['FINALISED', 'AUTHORISED', 'INVOICED_NOT_PAID', 'PAID'].includes(sourceCode)) return null;
    if (enabledActionCodes.has('RETRY_FINALISATION')) return approvedStatusView('FINALISATION_NEEDS_ATTENTION');
    if (['FAILED_RETRYABLE', 'FAILED_TERMINAL', 'RETIRED', 'STALE'].includes(paperState)) return approvedStatusView('QR_PACK_NEEDS_ATTENTION');
    if (paperState === 'RETURN_RECEIVED' || ['RECEIVED', 'MANAGER_APPROVED_PENDING_FINAL_DOCUMENT', 'READY_TO_FINALISE'].includes(lifecycleCode)) return approvedStatusView('FINALISING_SUBMISSION');
    if (paperState === 'READY' && lifecycleCode === 'AWAITING_PAPER_RETURN') return approvedStatusView('QR_AWAITING_SIGNED_RETURN');
    if (['PREPARING', 'BACKOFF'].includes(paperState)) return approvedStatusView('QR_PACK_PREPARING');
    if (['CREATED', 'WORKER_DRAFT'].includes(lifecycleCode)) return approvedStatusView('AWAITING_CANDIDATE_SUBMISSION');
    if (['WORKER_SUBMITTED', 'WORKER_SUBMITTED_PENDING_REVIEW_DOCUMENT', 'READY_FOR_MANAGER_APPROVAL'].includes(lifecycleCode)) return approvedStatusView('CANDIDATE_SUBMITTED');
    if (lifecycleCode === 'AWAITING_MANAGER_APPROVAL') return approvedStatusView('AWAITING_MANAGER_APPROVAL');
    if (lifecycleCode === 'MANAGER_APPROVED' || projection.manager_approval?.state === 'APPROVED') return approvedStatusView('MANAGER_APPROVED');
    if (!projection.workflow && ['QR', 'ELECTRONIC'].includes(routeFamily)) return approvedStatusView('AWAITING_CANDIDATE_SUBMISSION');
    if (projection.workflow || ['QR', 'ELECTRONIC'].includes(routeFamily)) return approvedStatusView('STATUS_UNAVAILABLE');
    return null;
  }
  const actionView = action => Object.freeze({
    ...action,
    label: OFFICE_ACTION_LABELS[String(action?.code || '').toUpperCase()] || action.label,
    disabled_text: action.enabled ? '' : (action.disabled_reason || 'This action is not currently available.')
  });
  function managerStatusLabel(state) {
    const normalized = String(state || '').trim().toUpperCase();
    if (normalized === 'APPROVED') return 'Manager Approved';
    if (normalized === 'REFUSED') return 'Refused by Client';
    return 'Awaiting Manager Approval';
  }
  function presentCandidateManagerApproval(manager, actions = []) {
    if (!manager) return null;
    const method = String(manager.method || '').toUpperCase();
    const managerActions = actions
      .filter(action => action.group === 'MANAGER_APPROVAL')
      .filter(action => window.CloudTMSCandidateOfficeUiPolicy?.ownerOf(action.code) === 'OFFICE')
      .map(actionView);
    const availability = manager.state === 'EXPIRED' ? 'Expired' : manager.state === 'APPROVED' ? 'Completed' : manager.reminder_eligible ? 'Eligible' : manager.provider_handoff_in_progress ? 'Blocked while provider handoff is in progress' : 'Not yet eligible';
    const displayStatus = managerStatusLabel(manager.state);
    const emailFields = [
      ['Status', displayStatus],
      ['Reminder availability', availability],
      ['Resends used', manager.resend_count ?? '—'],
      ['Resends remaining', manager.resends_remaining ?? '—'],
      ['Last provider-accepted send', formatDateTime(manager.provider_accepted_at_utc)],
      ['Next reminder eligibility', formatDateTime(manager.next_reminder_at_utc)],
      ['Request expiry', formatDateTime(manager.expires_at_utc)],
      ['Request generation', manager.request_generation ?? '—'],
      ['Delivery status', manager.delivery_state || '—'],
      ['Provider status', manager.provider_status || '—'],
      ['Provider handoff / lease', manager.provider_handoff_in_progress ? 'In progress' : 'Not in progress']
    ];
    const phoneFields = [['Status', displayStatus]];
    return Object.freeze({
      ...manager,
      title: 'Manager approval',
      availability,
      status_label: displayStatus,
      fields: Object.freeze((method === 'PHONE' ? phoneFields : emailFields).map(Object.freeze)),
      actions: Object.freeze(managerActions)
    });
  }
  function presentCandidatePaperPack(paper, actions = []) {
    if (!paper || String(paper.state).toUpperCase() === 'NOT_APPLICABLE') return null;
    const state = String(paper.state || '').toUpperCase();
    const display = PAPER[state] || ['QR Pack status unavailable', 'neutral'];
    return Object.freeze({
      ...paper, state, label: display[0], tone: display[1], explanation: QR_STATE_EXPLANATIONS[state] || null,
      fields: Object.freeze([
        ['QR generation', paper.delivery_generation ?? '—'], ['Pages', paper.page_count ?? '—'],
        ['Issued', formatDateTime(paper.issued_at_utc)], ['Returned', formatDateTime(paper.returned_at_utc)],
        ['Attempts', paper.attempt_count ?? 0], ['Next retry', formatDateTime(paper.next_retry_at_utc)]
      ].map(Object.freeze)),
      actions: Object.freeze(actions.filter(action => action.group === 'PAPER').map(actionView))
    });
  }
  function presentCandidateRejections(rejections = []) {
    return Object.freeze(rejections.map(item => Object.freeze({
      ...item,
      label: item.state === 'REFUSED' ? 'Refused by Client' : 'Rejected by Agency',
      historical: item.rejection_actionable !== true,
      action: item.recovery_action && window.CloudTMSCandidateOfficeUiPolicy?.ownerOf(item.recovery_action.code) === 'OFFICE'
        ? actionView(item.recovery_action)
        : null
    })));
  }
  function presentCandidateOfficeDetail(projection, { surface = 'SIMPLE_TIMESHEET' } = {}) {
    const sourceStatus = sourceStatusView(projection);
    const status = presentApprovedCandidateSubmissionStatus(projection);
    const phoneWorkflow = String(projection.manager_approval?.method || '').toUpperCase() === 'PHONE';
    const receivedDaily = isReceivedDailySubmission(projection);
    const actions = projection.available_actions
      .filter(action => !OFFICE_FRONTEND_FORBIDDEN_ACTIONS.has(String(action?.code || '').toUpperCase()))
      .filter(action => !(receivedDaily && String(action?.code || '').toUpperCase() === 'RETRY_FINALISATION'))
      .filter(action => !(phoneWorkflow && ['SEND_MANAGER_REMINDER', 'RENEW_MANAGER_REQUEST', 'CANCEL_MANAGER_REQUEST'].includes(String(action?.code || '').toUpperCase())))
      .map(actionView);
    const resendSupported = projection.available_actions.some(action => String(action?.code || '').toUpperCase() === 'RESEND_QR_PACK');
    const resendPlaceholderEligible = !resendSupported
      && String(projection.workflow?.state || '').toUpperCase() === 'AWAITING_PAPER_RETURN'
      && String(projection.paper_pack?.state || '').toUpperCase() === 'READY'
      && !!projection.paper_pack?.issued_at_utc;
    if (resendPlaceholderEligible) {
      actions.push(Object.freeze({
        code: 'RESEND_QR_PACK',
        label: OFFICE_ACTION_LABELS.RESEND_QR_PACK,
        group: 'PAPER',
        enabled: false,
        prominent: false,
        placeholder: true,
        disabled_reason: 'Backend support for safely resending this unchanged QR Pack is pending.',
        disabled_text: 'Backend support for safely resending this unchanged QR Pack is pending.'
      }));
    }
    const evidenceActions = projection.available_actions
      .filter(action => window.CloudTMSCandidateOfficeUiPolicy?.ownerOf(action.code) === 'OFFICE_EVIDENCE')
      .map(actionView);
    return Object.freeze({
      surface, identity: projection.current_identity, status,
      source_status_code: sourceStatus.code,
      workflow: projection.workflow,
      manager: presentCandidateManagerApproval(projection.manager_approval, actions),
      paper: presentCandidatePaperPack(projection.paper_pack, actions),
      rejections: presentCandidateRejections(projection.rejections),
      diagnostics: Object.freeze(projection.diagnostics.map(item => Object.freeze({ ...item, label: item.code === 'EXPENSE_EMAIL_MISSING' ? 'Expense Email missing' : item.message, tone: item.severity === 'INFO' ? 'info' : item.severity === 'ERROR' ? 'danger' : 'warning' }))),
      evidence_actions: Object.freeze(evidenceActions),
      primary_action: projection.primary_action && !OFFICE_FRONTEND_FORBIDDEN_ACTIONS.has(String(projection.primary_action.code || '').toUpperCase())
        && !(receivedDaily && String(projection.primary_action.code || '').toUpperCase() === 'RETRY_FINALISATION')
        ? actionView(projection.primary_action)
        : null,
      actions: Object.freeze(actions),
      observed_at: formatDateTime(projection.observed_at_utc),
      projection
    });
  }
  function presentCandidateOfficeSummary(projection) {
    const detail = presentCandidateOfficeDetail(projection, { surface: 'TIMESHEET_SUMMARY' });
    return Object.freeze({ identity: detail.identity, status: detail.status, source_status_code: detail.source_status_code, manager: detail.manager, primary_action: detail.primary_action, diagnostics: detail.diagnostics, projection });
  }
  Object.assign(window, { CloudTMSCandidateOfficePresenter: Object.freeze({ STATUS, APPROVED_CANDIDATE_SUBMISSION_STATUS, PAPER, OFFICE_FRONTEND_FORBIDDEN_ACTIONS, formatDateTime, managerStatusLabel, candidateSubmissionApplies, presentApprovedCandidateSubmissionStatus, presentCandidateOfficeSummary, presentCandidateOfficeDetail, presentCandidateManagerApproval, presentCandidatePaperPack, presentCandidateRejections }) });
})();
