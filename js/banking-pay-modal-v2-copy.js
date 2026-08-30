/* Approved Banking Pay copy; source: Modal Structure Bible, canonical MSG ledger.
 * This module contains presentation only, never financial classification.
 */
(function (root) {
  'use strict';
  const messages = Object.freeze({
  "MSG-001": "Action Required",
  "MSG-002": "No payments requiring action match the current Banking Pay filters.",
  "MSG-003": "No payments currently need action.",
  "MSG-004": "Payment route, candidate and client filters apply to Ready to pay, Action Required and Blocked for Pay. Selections outside the current filters remain saved, but those payments cannot be included in this Draft.",
  "MSG-005": "Choose the candidates to include, then create a Draft.",
  "MSG-006": "Ready to pay",
  "MSG-007": "Ready to pay £{amount}",
  "MSG-008": "{number} candidates included",
  "MSG-009": "{selected} of {available} candidates on this page included",
  "MSG-010": "Include all eligible payments for every candidate",
  "MSG-011": "Remove all eligible payments for every candidate",
  "MSG-012": "No candidates currently have payments ready to include.",
  "MSG-013": "No candidates currently have payments ready to include.",
  "MSG-014": "No candidates with payments ready to include match the current Banking Pay filters.",
  "MSG-015": "No payments are currently blocked.",
  "MSG-016": "No blocked payments match the current Banking Pay filters.",
  "MSG-017": "Deductions",
  "MSG-018": "Yes",
  "MSG-019": "—",
  "MSG-020": "No Ready Timesheet is linked to this candidate's selected payments.",
  "MSG-030": "Insufficient funds to deduct",
  "MSG-031": "Insufficient funds to deduct",
  "MSG-032": "There is not enough pay available in this run to make this deduction.",
  "MSG-033": "There is not enough pay available in this run to make this deduction.",
  "MSG-034": "Deduction scheduled for this pay run",
  "MSG-035": "Can be deducted now: £{amount}",
  "MSG-036": "This deduction cannot be made because there is not enough pay available in this run.",
  "MSG-037": "£{recoverable} will be deducted in this pay run. £{outstanding} is still outstanding before this deduction.",
  "MSG-038": "Nothing can be deducted in this pay run. £{outstanding} remains outstanding.",
  "MSG-040": "Payment was originally PAYE. Candidate is now paid through an umbrella company.",
  "MSG-041": "Payment was originally PAYE. Candidate is now paid through an umbrella company. Choose how this payment should be handled.",
  "MSG-042": "Payment was originally through an umbrella company. Candidate is now PAYE.",
  "MSG-043": "Payment was originally through an umbrella company. Candidate is now PAYE. Choose how this payment should be handled.",
  "MSG-044": "Payment method changed",
  "MSG-045": "Rate decision required",
  "MSG-046": "Amount decision required",
  "MSG-047": "Review suggested payment change",
  "MSG-048": "Original payment arrangement",
  "MSG-049": "Suggested new payment arrangement",
  "MSG-050": "Original rate",
  "MSG-051": "Suggested rate",
  "MSG-052": "Original payment amount",
  "MSG-053": "Original client charge",
  "MSG-060": "Bank account setup in progress",
  "MSG-061": "CloudTMS is setting up this bank account for payment. This payment will update automatically when the setup finishes.",
  "MSG-062": "Bank account setup failed",
  "MSG-063": "CloudTMS could not finish setting up this bank account. Try again, or contact support if it keeps failing.",
  "MSG-064": "Umbrella company inactive",
  "MSG-065": "This umbrella company is inactive. Reactivate it before trying to pay the affected candidates.",
  "MSG-066": "Candidate bank details are missing.",
  "MSG-067": "The umbrella company's bank details are missing.",
  "MSG-068": "Account name check required.",
  "MSG-069": "Check account name",
  "MSG-070": "The account name does not match the bank details.",
  "MSG-071": "The account name is a close match. Check the name and bank details before accepting them.",
  "MSG-072": "The bank could not check the account name. Check the bank details before deciding whether to accept them.",
  "MSG-073": "The account name does not match the bank details. Check both before accepting them.",
  "MSG-074": "The account name matches and this bank account is ready for payment. Banking Pay is updating the candidate now.",
  "MSG-075": "The account name check is complete. Review the result before this payment can be included. Banking Pay is updating the candidate now.",
  "MSG-076": "The account name check has started. This payment will update automatically when the result is ready.",
  "MSG-077": "Bank account needs setting up.",
  "MSG-078": "The bank details have been checked, but this account has not yet been set up for payments.",
  "MSG-079": "Enter why you are accepting this account-name mismatch. The reason will be saved in the audit history. These exact bank details will no longer block Draft creation.",
  "MSG-090": "Payment issue not identified",
  "MSG-091": "CloudTMS could not identify why this payment is blocked. It will not be included. Refresh Banking Pay; if it remains blocked, contact support.",
  "MSG-092": "CloudTMS could not identify why this payment is blocked. It will not be included. Refresh Banking Pay; if it remains blocked, contact support.",
  "MSG-093": "This Timesheet payment cannot be included because CloudTMS could not confirm its current status. Open the Timesheet or refresh Banking Pay.",
  "MSG-094": "This payment is missing its bank-account owner. Refresh Banking Pay and try again.",
  "MSG-095": "This payment is missing its bank-account owner. Refresh Banking Pay and try again.",
  "MSG-096": "The bank details changed or could not be confirmed. Refresh Banking Pay and try again.",
  "MSG-097": "The bank-details review window could not be opened. Refresh Banking Pay and try again.",
  "MSG-098": "This payment case could not be identified. Refresh Banking Pay and try again.",
  "MSG-099": "This candidate could not be identified. Refresh Banking Pay and try again.",
  "MSG-100": "This Timesheet could not be identified. Refresh Banking Pay and try again.",
  "MSG-101": "CloudTMS could not identify the candidate and Timesheet for this expense action. Refresh Banking Pay and try again.",
  "MSG-110": "Create Draft is unavailable while selected payments are updating.",
  "MSG-111": "Banking Pay is loading the latest payment list.",
  "MSG-112": "Banking Pay is loading the latest payment list.",
  "MSG-113": "This payment list is out of date. Refresh Banking Pay before creating a Draft.",
  "MSG-114": "A newer Banking Pay list is available. Open the latest list before creating a Draft.",
  "MSG-115": "Include at least one candidate with a payment ready to pay.",
  "MSG-116": "Select candidates",
  "MSG-117": "Some bank-account checks failed ({failed}/{attempted}). The affected payments cannot be included until the bank details are corrected or checked again.",
  "MSG-118": "Bank details were checked when this list was prepared. Use Refresh if those details have changed.",
  "MSG-119": "A PAYE Draft already exists. Cancel or delete it before creating another PAYE Draft.",
  "MSG-120": "A PAYE payment batch already exists for this payroll week. Creating another requires extra security checks. Usually the existing batch should be replaced or cancelled instead.",
  "MSG-121": "To continue, confirm your password, complete 2FA and confirm that you want to create another PAYE batch.",
  "MSG-130": "",
  "MSG-131": ""
});
  function message(id, values = {}) {
    if (!Object.prototype.hasOwnProperty.call(messages, id)) throw new Error('Unknown Banking Pay message');
    return messages[id].replace(/\{([a-zA-Z_]+)\}/g, (_, name) => {
      if (!Object.prototype.hasOwnProperty.call(values, name)) throw new Error('Missing Banking Pay message value');
      return String(values[name]);
    });
  }
  function paymentMethodMessage(source, target, withAction = false) {
    if (source === 'PAYE' && target === 'UMBRELLA') return message(withAction ? 'MSG-041' : 'MSG-040');
    if (source === 'UMBRELLA' && target === 'PAYE') return message(withAction ? 'MSG-043' : 'MSG-042');
    return message('MSG-091');
  }
  const api = Object.freeze({ messages, message, paymentMethodMessage });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CloudTMSBankingPayCopyV2 = api;
})(typeof window === 'object' ? window : this);
