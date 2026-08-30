const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainPath = path.resolve(__dirname, '../../js/main.js');
const source = fs.readFileSync(mainPath, 'utf8');

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

const helperSource = extractFunction('invoiceModalEmailPolicyState', 'renderInvoiceModalContent');
const context = {};
vm.runInNewContext(`${helperSource}; this.invoiceModalEmailPolicyState = invoiceModalEmailPolicyState;`, context);
const policyState = context.invoiceModalEmailPolicyState;

test('delivery-suppressed invoices keep Email unavailable with a client-policy hint', () => {
  const state = policyState({
    invoice: { do_not_send: false },
    raw: { issue: { route_policy: { delivery_suppressed: true } } },
    header_snapshot_json: { meta: {} }
  });

  assert.equal(state.disabled, true);
  assert.equal(state.reason_code, 'INVOICE_DELIVERY_SUPPRESSED');
  assert.equal(state.hint, 'Invoices are not sent to this client under its invoicing policy.');
});

test('legacy self-bill evidence fails closed even if route-policy data is absent', () => {
  for (const meta of [{ self_bill: true }, { source: 'TSFIN_SEGMENTS' }]) {
    const state = policyState({ invoice: {}, raw: {}, header_snapshot_json: { meta } });
    assert.equal(state.disabled, true);
    assert.equal(state.reason_code, 'INVOICE_DELIVERY_POLICY_UNAVAILABLE');
  }
});

test('resolved backend policy outranks the frozen self-bill marker', () => {
  const state = policyState({
    invoice: { do_not_send: false },
    raw: {
      email_delivery_policy: { resolved: true, delivery_suppressed: false },
      issue: { route_policy: { delivery_suppressed: true } }
    },
    header_snapshot_json: { meta: { self_bill: true, source: 'TSFIN_SEGMENTS' } }
  });

  assert.equal(state.disabled, false);
  assert.equal(state.reason_code, null);
  assert.equal(state.hint, '');
});

test('do-not-send invoices have their distinct explanation', () => {
  const state = policyState({ invoice: { do_not_send: true } });
  assert.equal(state.disabled, true);
  assert.equal(state.reason_code, 'DO_NOT_SEND');
  assert.equal(state.hint, 'This invoice is marked as not to be sent.');
});

test('ordinary invoices remain emailable', () => {
  const state = policyState({
    invoice: { do_not_send: false },
    raw: { issue: { route_policy: { delivery_suppressed: false } } },
    header_snapshot_json: { meta: { self_bill: false, source: 'ORDINARY' } }
  });
  assert.equal(state.disabled, false);
  assert.equal(state.reason_code, null);
  assert.equal(state.hint, '');
});

test('invoice modal always renders Email and preserves policy-disabled state through view-mode refresh', () => {
  const rendererStart = source.indexOf('function renderInvoiceModalContent');
  const rendererEnd = source.indexOf('\nasync function ', rendererStart);
  const renderer = source.slice(rendererStart, rendererEnd > rendererStart ? rendererEnd : rendererStart + 30000);

  assert.match(renderer, /invoiceModalEmailPolicyState\(invData\)/);
  assert.match(renderer, /data-action="inv-email"/);
  assert.match(renderer, /data-invoice-email-policy=/);
  assert.match(renderer, /title="\$\{escapeHtml\(emailPolicy\.hint\)\}"/);
  assert.match(renderer, /tabindex="0"/);
  assert.match(renderer, /pointer-events:none/);

  assert.match(
    source,
    /if \(el\.getAttribute\('data-disabled'\) === '1' \|\| el\.getAttribute\('data-disabled'\) === 'true'\) \{\s*el\.disabled = true;\s*return;/
  );
});
