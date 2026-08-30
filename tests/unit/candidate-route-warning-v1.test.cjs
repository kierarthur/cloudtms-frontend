const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');

function warnings() {
  const source = fs.readFileSync(path.join(root, 'js', 'candidate-route-warning-v1.js'), 'utf8');
  const context = vm.createContext({ window: {}, Object, String, Error });
  new vm.Script(source, { filename: 'candidate-route-warning-v1.js' }).runInContext(context);
  return context.window.CloudTMSCandidateRouteWarnings;
}

const expected = Object.freeze({
  W01: {
    title: 'Convert this timesheet to Manual?',
    body: 'The candidate will no longer be able to submit this version electronically.\n\nCloudTMS staff will be responsible for entering and processing the timesheet.\n\nUse this only where the candidate has supplied the timesheet outside the electronic route, or CloudTMS staff need to intervene.',
    buttons: ['Go Back', 'Convert to Manual']
  },
  W02: {
    title: 'The candidate has already signed this electronic timesheet',
    body: 'It is awaiting hiring-manager approval. Converting it to Manual will cancel the current electronic approval request and the manager’s approval link will stop working.\n\nThe candidate’s signed electronic submission will remain in the audit history but will not apply to the new Manual version.\n\nUse Reject Candidate Submission instead where the candidate can simply correct and resubmit the timesheet.',
    buttons: ['Go Back', 'Continue to Manual conversion']
  },
  W03: {
    title: 'The hiring manager has already signed and approved this electronic timesheet',
    body: 'Converting it to Manual will retire the completed electronic approval. The candidate and manager signatures and the signed electronic timesheet will remain in the audit history, but they will not apply to the new Manual version.\n\nThis action should be used only where the candidate or hiring manager has reported that the submitted hours are wrong, or another exceptional office intervention is required.',
    buttons: ['Go Back', 'Continue to Manual conversion']
  },
  W04: {
    title: 'Unauthorise this timesheet first',
    body: 'This timesheet has been authorised in CloudTMS. It cannot be converted to Manual until the existing Unauthorise process has been completed. Unprocess it afterwards where the normal lifecycle requires it.',
    buttons: ['Close']
  },
  W05: {
    title: 'This timesheet cannot be converted',
    body: 'This timesheet has financial history and its submission route cannot be changed. Use the appropriate additional-timesheet, correction, credit or reversal process.',
    buttons: ['Close']
  },
  W06: {
    title: 'This timesheet is controlled by an import',
    body: 'Candidate-entered hours are not permitted for this timesheet. The submission route cannot be changed. Expenses must use the separate expense-timesheet route.',
    buttons: ['Close']
  },
  W07: {
    title: 'Does the candidate need to resubmit instead?',
    body: 'Use Reject Candidate Submission where the candidate can correct and resubmit the timesheet themselves.\n\nConvert to Manual only when CloudTMS staff need to enter or process the replacement timesheet on the candidate’s behalf.',
    buttons: ['Go Back', 'Use Reject Candidate Submission', 'Continue to Manual conversion']
  },
  W08: {
    title: 'A QR Pack has already been issued',
    body: 'The candidate may already have printed the documents. Converting this timesheet to Manual will invalidate the current code and the issued QR Pack can no longer be returned.\n\nCloudTMS staff will become responsible for entering and processing the replacement timesheet. The issued QR Pack will remain in the audit history.',
    buttons: ['Go Back', 'Continue to Manual conversion']
  },
  W09: {
    title: 'A signed timesheet has already been returned',
    body: 'Converting it to Manual will retire the signed returned evidence. The signed document will remain in the audit history but will not apply to the new Manual generation.\n\nContinue only if the candidate or hiring manager has reported that the submitted hours are wrong, or another exceptional office intervention is required.',
    buttons: ['Go Back', 'Continue to Manual conversion']
  },
  W10: {
    title: 'Enable Electronic Submission?',
    body: 'This will make the Manual timesheet eligible for Electronic submission again. Previous signatures and signed documents remain in the audit history and are not reused.\n\nThe action is available only where the current client and timesheet policy permits Electronic submission.',
    buttons: ['Go Back', 'Enable Electronic Submission']
  },
  W11: {
    title: 'Enable QR submission?',
    body: 'This Manual timesheet is not eligible for Electronic submission, but the server permits the QR route. Enabling it does not claim that a QR Pack has already been created or sent.\n\nWhen the Candidate workflow has the required current submission facts, CloudTMS will prepare the QR Pack through the normal pack lifecycle.',
    buttons: ['Go Back', 'Enable QR submission']
  },
  W12: {
    title: 'Create a Replacement QR Pack?',
    body: 'The current QR Pack and code will be invalidated. Any printed copy can no longer be returned. A replacement QR Pack with a new code will be generated and the worker will be notified.\n\nThe worker must sign the replacement QR Timesheet before returning it.',
    buttons: ['Go Back', 'Create Replacement QR Pack and Notify Worker']
  },
  W13: {
    title: 'Restore the previous electronic approval?',
    body: 'CloudTMS has proved that the current hours, signatures, signed document and financial content are identical to the previous electronic submission. Restoring it will make that exact approved electronic generation current again.\n\nNo worker resubmission will be requested.',
    buttons: ['Go Back', 'Restore exact electronic version']
  },
  W14: {
    title: 'Remove the incomplete expense claim?',
    body: 'The candidate has started an expense claim but has not completed it. Do you want to remove the incomplete claim and continue?',
    buttons: ['No', 'Yes — remove claim and continue']
  }
});

test('W01-W14 titles, bodies and button order match the frozen catalogue exactly', () => {
  const api = warnings();
  assert.equal(api.CATALOGUE_VERSION, '2026-08-13');
  for (const [code, value] of Object.entries(expected)) {
    const actual = api.getCandidateRouteWarningDefinition(code);
    assert.equal(actual.title, value.title, `${code} title`);
    assert.equal(actual.body, value.body, `${code} body`);
    assert.deepEqual(Array.from(actual.buttons), value.buttons, `${code} buttons`);
  }
});

test('every named server warning alias resolves to its exact canonical warning', () => {
  const api = warnings();
  for (const [alias, code] of Object.entries(api.ALIASES)) {
    assert.equal(api.getCandidateRouteWarningDefinition(alias), api.WARNINGS[code], alias);
  }
});

test('unknown route warnings fail closed', () => {
  const api = warnings();
  assert.throws(
    () => api.getCandidateRouteWarningDefinition('W99'),
    error => error.code === 'CANDIDATE_OFFICE_WARNING_UNKNOWN'
  );
});

test('new Candidate Office modules do not use native alert, confirm or prompt', () => {
  const files = fs.readdirSync(path.join(root, 'js'))
    .filter(name => /^candidate-(?:office|route-warning).*\.js$/.test(name));
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, 'js', file), 'utf8');
    assert.doesNotMatch(source, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/, file);
  }
});
