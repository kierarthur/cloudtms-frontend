const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainPath = path.join(__dirname, '..', '..', 'js', 'main.js');
const mainSource = fs.readFileSync(mainPath, 'utf8').replace(/\r\n/g, '\n');

function extractFunction(name) {
  const start = mainSource.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const endMarker = '\n// ─────────────────────────────────────────────────────────────────────────────\n// UPDATED: showModal';
  const end = mainSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${name} end marker must exist`);
  return mainSource.slice(start, end).trim();
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    async json() { return body; }
  };
}

function loadApiListOutbox(handler) {
  const context = vm.createContext({
    URLSearchParams,
    API: value => value,
    authFetch: handler
  });
  vm.runInContext(`${extractFunction('apiListOutbox')}\nthis.apiListOutbox = apiListOutbox;`, context);
  return context.apiListOutbox;
}

test('unified Outbox page 2 is resolved with a signed cursor and never a non-zero offset', async () => {
  const requests = [];
  const apiListOutbox = loadApiListOutbox(async (requestUrl) => {
    const url = new URL(requestUrl, 'https://example.test');
    requests.push(url);
    const cursor = url.searchParams.get('cursor');
    if (!cursor) {
      return response({
        total_count: 120,
        items: Array.from({ length: 50 }, (_, index) => ({ id: `first-${index}` })),
        has_more: true,
        next_cursor: 'signed-page-2'
      });
    }
    assert.equal(cursor, 'signed-page-2');
    return response({
      total_count: 120,
      items: Array.from({ length: 50 }, (_, index) => ({ id: `second-${index}` })),
      has_more: true,
      next_cursor: 'signed-page-3'
    });
  });

  const result = await apiListOutbox({ limit: 50, offset: 50, sort_by: 'created_at_utc', sort_dir: 'desc' });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(url => url.searchParams.get('offset')), ['0', '0']);
  assert.equal(requests[1].searchParams.get('cursor'), 'signed-page-2');
  assert.equal(result.items.length, 50);
  assert.equal(result.items[0].id, 'second-0');
  assert.equal(result.offset, 50);
  assert.equal(result.next_cursor, 'signed-page-3');
  assert.equal(result.has_more, true);
});

test('unified Outbox direct page jumps remain bounded and preserve the cursor snapshot', async () => {
  const requests = [];
  const apiListOutbox = loadApiListOutbox(async (requestUrl) => {
    const url = new URL(requestUrl, 'https://example.test');
    requests.push(url);
    const cursor = url.searchParams.get('cursor');
    if (!cursor) {
      assert.equal(url.searchParams.get('limit'), '300');
      return response({
        total_count: 320,
        items: Array.from({ length: 300 }, (_, index) => ({ id: `bridge-${index}` })),
        has_more: true,
        next_cursor: 'signed-page-7',
        snapshot_at_utc: '2026-08-03T10:00:00.000Z'
      });
    }
    assert.equal(cursor, 'signed-page-7');
    return response({
      total_count: 320,
      items: Array.from({ length: 20 }, (_, index) => ({ id: `last-${index}` })),
      has_more: false,
      next_cursor: null,
      snapshot_at_utc: '2026-08-03T10:00:00.000Z'
    });
  });

  const result = await apiListOutbox({ limit: 50, offset: 300, sort_by: 'created_at_utc', sort_dir: 'desc' });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(url => url.searchParams.get('offset')), ['0', '0']);
  assert.equal(result.items.length, 20);
  assert.equal(result.items[0].id, 'last-0');
  assert.equal(result.offset, 300);
  assert.equal(result.has_more, false);
  assert.equal(result.snapshot_at_utc, '2026-08-03T10:00:00.000Z');
});

test('channel-specific Outbox pagination retains the existing offset contract', async () => {
  const requests = [];
  const apiListOutbox = loadApiListOutbox(async (requestUrl) => {
    const url = new URL(requestUrl, 'https://example.test');
    requests.push(url);
    return response({ total_count: 75, items: [{ id: 'email-page-2' }], limit: 50, offset: 50 });
  });

  const result = await apiListOutbox({ limit: 50, offset: 50, channel: 'EMAIL' });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('channel'), 'EMAIL');
  assert.equal(requests[0].searchParams.get('offset'), '50');
  assert.equal(requests[0].searchParams.has('cursor'), false);
  assert.equal(result.items[0].id, 'email-page-2');
});
