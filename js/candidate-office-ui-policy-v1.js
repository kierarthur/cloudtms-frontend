(() => {
  'use strict';

  const MANAGER_JOURNEY_ACTIONS = Object.freeze([
    'BEGIN_PHONE_REVIEW',
    'RECORD_PHONE_REVIEW_PROGRESS',
    'PREPARE_PHONE_SIGNATURE',
    'APPROVE_BY_PHONE',
    'REFUSE_BY_PHONE'
  ]);

  const CANDIDATE_APP_ACTIONS = Object.freeze([
    'RESUBMIT_REJECTED',
    'MARK_NO_WORK'
  ]);

  const EVIDENCE_TAB_ACTIONS = Object.freeze([
    'VIEW_PAPER_PACK',
    'REVIEW_PAPER_RETURN'
  ]);

  const OFFICE_HIDDEN_ACTIONS = Object.freeze([
    'CANCEL_MANAGER_REQUEST'
  ]);

  // A button may be added here only after the user has approved the complete
  // button and modal-design proposal for that Office surface. Server-owned
  // eligibility is still required before any approved button is rendered.
  const APPROVED_BUTTONS_BY_SURFACE = Object.freeze({
    SIMPLE_TIMESHEET: Object.freeze([
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
    ]),
    TIMESHEET_SUMMARY: Object.freeze([]),
    BULK_PROCESS: Object.freeze([
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
    ]),
    BULK_AUTHORISE: Object.freeze([
      'REJECT_CANDIDATE_SUBMISSION'
    ]),
    INVOICE_GENERATOR: Object.freeze([]),
    INVOICE_ISSUER: Object.freeze([])
  });

  const normalize = value => String(value || '').trim().toUpperCase();
  const managerJourney = new Set(MANAGER_JOURNEY_ACTIONS);
  const candidateApp = new Set(CANDIDATE_APP_ACTIONS);
  const evidenceTab = new Set(EVIDENCE_TAB_ACTIONS);
  const officeHidden = new Set(OFFICE_HIDDEN_ACTIONS);

  function ownerOf(actionCode) {
    const code = normalize(actionCode);
    if (managerJourney.has(code)) return 'MANAGER_JOURNEY';
    if (candidateApp.has(code)) return 'CANDIDATE_APP';
    if (evidenceTab.has(code)) return 'OFFICE_EVIDENCE';
    if (officeHidden.has(code)) return 'BACKEND_ONLY';
    return 'OFFICE';
  }

  function isButtonApproved(surface, actionCode) {
    const codes = APPROVED_BUTTONS_BY_SURFACE[normalize(surface)] || [];
    return codes.includes(normalize(actionCode));
  }

  function assertOfficeButtonApproved(surface, actionCode) {
    const code = normalize(actionCode);
    const owner = ownerOf(code);
    if (owner !== 'OFFICE') {
      const error = new Error(
        owner === 'MANAGER_JOURNEY'
          ? 'Manager approval decisions are completed by the manager journey and are not Office actions.'
          : owner === 'CANDIDATE_APP'
            ? 'This action is completed by the Candidate app and is not an Office action.'
            : owner === 'OFFICE_EVIDENCE'
              ? 'Candidate documents are viewed through the existing Evidence tab and not through a new Candidate action button.'
              : 'This backend action is not exposed in the Office frontend.'
      );
      error.code = owner === 'MANAGER_JOURNEY'
        ? 'CANDIDATE_OFFICE_MANAGER_DECISION_FORBIDDEN'
        : owner === 'CANDIDATE_APP'
          ? 'CANDIDATE_OFFICE_CANDIDATE_ACTION_FORBIDDEN'
          : owner === 'OFFICE_EVIDENCE'
            ? 'CANDIDATE_OFFICE_EVIDENCE_TAB_ACTION_REQUIRED'
            : 'CANDIDATE_OFFICE_ACTION_NOT_EXPOSED';
      throw error;
    }
    if (!isButtonApproved(surface, code)) {
      const error = new Error('This Office action button has not been approved for this modal or surface.');
      error.code = 'CANDIDATE_OFFICE_UI_ACTION_NOT_APPROVED';
      throw error;
    }
    return true;
  }

  Object.assign(window, {
    CloudTMSCandidateOfficeUiPolicy: Object.freeze({
      MANAGER_JOURNEY_ACTIONS,
      CANDIDATE_APP_ACTIONS,
      EVIDENCE_TAB_ACTIONS,
      OFFICE_HIDDEN_ACTIONS,
      APPROVED_BUTTONS_BY_SURFACE,
      ownerOf,
      isButtonApproved,
      assertOfficeButtonApproved
    })
  });
})();
