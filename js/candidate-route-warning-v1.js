(() => {
  'use strict';
  const CATALOGUE_VERSION = '2026-08-13';
  const definition = (title, body, buttons, extra = {}) => Object.freeze({ title, body, buttons: Object.freeze(buttons), ...extra });
  const WARNINGS = Object.freeze({
    W01: definition('Convert this timesheet to Manual?', 'The candidate will no longer be able to submit this version electronically.\n\nCloudTMS staff will be responsible for entering and processing the timesheet.\n\nUse this only where the candidate has supplied the timesheet outside the electronic route, or CloudTMS staff need to intervene.', ['Go Back', 'Convert to Manual'], { reason_required: true }),
    ELECTRONIC_UNSIGNED_TO_MANUAL: null,
    W02: definition('The candidate has already signed this electronic timesheet', 'It is awaiting hiring-manager approval. Converting it to Manual will cancel the current electronic approval request and the manager’s approval link will stop working.\n\nThe candidate’s signed electronic submission will remain in the audit history but will not apply to the new Manual version.\n\nUse Reject Candidate Submission instead where the candidate can simply correct and resubmit the timesheet.', ['Go Back', 'Continue to Manual conversion'], { reason_required: true }),
    CANDIDATE_SIGNED_MANAGER_PENDING_TO_MANUAL: null,
    W03: definition('The hiring manager has already signed and approved this electronic timesheet', 'Converting it to Manual will retire the completed electronic approval. The candidate and manager signatures and the signed electronic timesheet will remain in the audit history, but they will not apply to the new Manual version.\n\nThis action should be used only where the candidate or hiring manager has reported that the submitted hours are wrong, or another exceptional office intervention is required.', ['Go Back', 'Continue to Manual conversion'], { reason_required: true }),
    MANAGER_APPROVED_TO_MANUAL: null,
    W04: definition('Unauthorise this timesheet first', 'This timesheet has been authorised in CloudTMS. It cannot be converted to Manual until the existing Unauthorise process has been completed. Unprocess it afterwards where the normal lifecycle requires it.', ['Close'], { blocking: true }),
    ROUTE_CHANGE_REQUIRES_UNAUTHORISE: null,
    W05: definition('This timesheet cannot be converted', 'This timesheet has financial history and its submission route cannot be changed. Use the appropriate additional-timesheet, correction, credit or reversal process.', ['Close'], { blocking: true }),
    ROUTE_CHANGE_FINANCIAL_HISTORY_BLOCK: null,
    W06: definition('This timesheet is controlled by an import', 'Candidate-entered hours are not permitted for this timesheet. The submission route cannot be changed. Expenses must use the separate expense-timesheet route.', ['Close'], { blocking: true }),
    ROUTE_CHANGE_IMPORT_AUTHORITATIVE_BLOCK: null,
    W07: definition('Does the candidate need to resubmit instead?', 'Use Reject Candidate Submission where the candidate can correct and resubmit the timesheet themselves.\n\nConvert to Manual only when CloudTMS staff need to enter or process the replacement timesheet on the candidate’s behalf.', ['Go Back', 'Use Reject Candidate Submission', 'Continue to Manual conversion'], { decision_code: 'REJECT_OR_MANUAL' }),
    REJECT_OR_MANUAL: null,
    W08: definition('A QR Pack has already been issued', 'The candidate may already have printed the documents. Converting this timesheet to Manual will invalidate the current code and the issued QR Pack can no longer be returned.\n\nCloudTMS staff will become responsible for entering and processing the replacement timesheet. The issued QR Pack will remain in the audit history.', ['Go Back', 'Continue to Manual conversion'], { reason_required: true }),
    QR_ISSUED_TO_MANUAL: null,
    W09: definition('A signed timesheet has already been returned', 'Converting it to Manual will retire the signed returned evidence. The signed document will remain in the audit history but will not apply to the new Manual generation.\n\nContinue only if the candidate or hiring manager has reported that the submitted hours are wrong, or another exceptional office intervention is required.', ['Go Back', 'Continue to Manual conversion'], { reason_required: true }),
    QR_SIGNED_TO_MANUAL: null,
    W10: definition('Enable Electronic Submission?', 'This will make the Manual timesheet eligible for Electronic submission again. Previous signatures and signed documents remain in the audit history and are not reused.\n\nThe action is available only where the current client and timesheet policy permits Electronic submission.', ['Go Back', 'Enable Electronic Submission']),
    FRESH_ELECTRONIC_RESUBMISSION_REQUIRED: null,
    W11: definition('Enable QR submission?', 'This Manual timesheet is not eligible for Electronic submission, but the server permits the QR route. Enabling it does not claim that a QR Pack has already been created or sent.\n\nWhen the Candidate workflow has the required current submission facts, CloudTMS will prepare the QR Pack through the normal pack lifecycle.', ['Go Back', 'Enable QR submission']),
    FRESH_PAPER_RESUBMISSION_REQUIRED: null,
    W12: definition('Create a Replacement QR Pack?', 'The current QR Pack and code will be invalidated. Any printed copy can no longer be returned. A replacement QR Pack with a new code will be generated and the worker will be notified.\n\nThe worker must sign the replacement QR Timesheet before returning it.', ['Go Back', 'Create Replacement QR Pack and Notify Worker']),
    QR_REPLACEMENT_PACK_REQUIRED: null,
    W13: definition('Restore the previous electronic approval?', 'CloudTMS has proved that the current hours, signatures, signed document and financial content are identical to the previous electronic submission. Restoring it will make that exact approved electronic generation current again.\n\nNo worker resubmission will be requested.', ['Go Back', 'Restore exact electronic version']),
    EXACT_ELECTRONIC_RESTORE_PROVEN: null,
    W14: definition('Remove the incomplete expense claim?', 'The candidate has started an expense claim but has not completed it. Do you want to remove the incomplete claim and continue?', ['No', 'Yes — remove claim and continue'], { reason_required: true }),
    CANDIDATE_INCOMPLETE_EXPENSE_CLAIM_REMOVE_CONFIRM: null
  });
  const ALIASES = Object.freeze({
    ELECTRONIC_UNSIGNED_TO_MANUAL: 'W01', CANDIDATE_SIGNED_MANAGER_PENDING_TO_MANUAL: 'W02',
    MANAGER_APPROVED_TO_MANUAL: 'W03', ROUTE_CHANGE_REQUIRES_UNAUTHORISE: 'W04',
    ROUTE_CHANGE_FINANCIAL_HISTORY_BLOCK: 'W05', ROUTE_CHANGE_IMPORT_AUTHORITATIVE_BLOCK: 'W06',
    REJECT_OR_MANUAL: 'W07', QR_ISSUED_TO_MANUAL: 'W08', QR_SIGNED_TO_MANUAL: 'W09',
    FRESH_ELECTRONIC_RESUBMISSION_REQUIRED: 'W10', FRESH_PAPER_RESUBMISSION_REQUIRED: 'W11',
    QR_REPLACEMENT_PACK_REQUIRED: 'W12', EXACT_ELECTRONIC_RESTORE_PROVEN: 'W13',
    CANDIDATE_INCOMPLETE_EXPENSE_CLAIM_REMOVE_CONFIRM: 'W14'
  });
  const REASONS = Object.freeze([
    Object.freeze({ code: 'CANDIDATE_SUPPLIED_MANUAL_TIMESHEET', label: 'Candidate supplied a Manual timesheet', note_required: false }),
    Object.freeze({ code: 'CANDIDATE_REPORTED_HOURS_INCORRECT', label: 'Candidate reported that the hours are incorrect', note_required: false }),
    Object.freeze({ code: 'HIRING_MANAGER_REPORTED_HOURS_INCORRECT', label: 'Hiring manager reported that the hours are incorrect', note_required: false }),
    Object.freeze({ code: 'ELECTRONIC_SUBMISSION_TECHNICAL_FAILURE', label: 'Electronic submission technical failure', note_required: false }),
    Object.freeze({ code: 'OTHER_EXCEPTIONAL_OFFICE_INTERVENTION', label: 'Other exceptional office intervention', note_required: true })
  ]);
  function getCandidateRouteWarningDefinition(code) {
    const key = String(code || '').trim().toUpperCase();
    const canonical = ALIASES[key] || key;
    const item = WARNINGS[canonical];
    if (!item) throw Object.assign(new Error(`Unknown Candidate route warning: ${key || '(empty)'}`), { code: 'CANDIDATE_OFFICE_WARNING_UNKNOWN' });
    return item;
  }
  const getCandidateRouteDecisionDefinition = getCandidateRouteWarningDefinition;
  const getCandidateInterventionReasons = () => REASONS;
  const assertKnownCandidateWarningCode = code => { getCandidateRouteWarningDefinition(code); return true; };
  Object.assign(window, { CloudTMSCandidateRouteWarnings: Object.freeze({ CATALOGUE_VERSION, WARNINGS, ALIASES, getCandidateRouteWarningDefinition, getCandidateRouteDecisionDefinition, getCandidateInterventionReasons, assertKnownCandidateWarningCode }) });
})();
