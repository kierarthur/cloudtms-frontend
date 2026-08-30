const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const main = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);
const start = main.indexOf('const qrTimesheetSendIdempotencyTokens = new Map();');
const end = main.indexOf('async function handleBulkAuthoriseAddAdditionalManual', start);
assert.ok(start >= 0 && end > start);
const source = `${main.slice(start, end)}
globalThis.qrTestApi = {
  enqueueQrTimesheetEmail,
  qrTimesheetSendIdempotencyTokens
};`;

function harness(responses) {
  let uuid = 0;
  const bodies = [];
  const context = {
    console,
    encodeURIComponent,
    Map,
    Date,
    Math,
    crypto: { randomUUID: () => `token-${++uuid}` },
    window: {},
    getTsLoggers: () => ({
      LOGM() {}, L() {}, GC() {}, GE() {}
    }),
    apiPostJson: async (_url, body) => {
      bodies.push(body);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response || {
        ok: true,
        queued: true,
        mail_outbox_id: `mail-${bodies.length}`,
        recipient_available: true
      };
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.qrTestApi, bodies };
}

function rejection(status, code) {
  return Object.assign(new Error(code || `HTTP ${status}`), {
    status,
    json: code ? { error_code: code } : {}
  });
}

test('successful deliberate QR resend clears its token so the next resend is new', async () => {
  const { api, bodies } = harness([]);
  await api.enqueueQrTimesheetEmail('ts-1', { context: 'bulk_process', silent: true });
  await api.enqueueQrTimesheetEmail('ts-1', { context: 'bulk_process', silent: true });
  assert.notEqual(bodies[0].idempotency_key, bodies[1].idempotency_key);
});

test('known QR rejection clears its token before a deliberate retry', async () => {
  const { api, bodies } = harness([
    rejection(400, 'NO_HOURS_RECORDED'),
    { ok: true, queued: true, mail_outbox_id: 'mail-2', recipient_available: true }
  ]);
  await assert.rejects(
    api.enqueueQrTimesheetEmail('ts-2', { context: 'bulk_process', silent: true }),
    /NO_HOURS_RECORDED/
  );
  await api.enqueueQrTimesheetEmail('ts-2', { context: 'bulk_process', silent: true });
  assert.notEqual(bodies[0].idempotency_key, bodies[1].idempotency_key);
});

test('uncertain QR response retains its token for an idempotent replay', async () => {
  const { api, bodies } = harness([
    rejection(503, ''),
    { ok: true, queued: true, mail_outbox_id: 'mail-2', recipient_available: true }
  ]);
  await assert.rejects(
    api.enqueueQrTimesheetEmail('ts-3', { context: 'bulk_process', silent: true })
  );
  await api.enqueueQrTimesheetEmail('ts-3', { context: 'bulk_process', silent: true });
  assert.equal(bodies[0].idempotency_key, bodies[1].idempotency_key);
});
