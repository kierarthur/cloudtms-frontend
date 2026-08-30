const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

const section = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
};

const policySource = section(
  'const OFFICE_AUTH_REFRESH_INVALID_CODES',
  'function scheduleOfficeAuthRefreshRetry'
);
const context = vm.createContext({});
vm.runInContext(`${policySource}\nglobalThis.classifyRefreshFailure = getOfficeAuthRefreshFailureDisposition;`, context);

test('only explicit backend invalid-session codes are definitive logout decisions', () => {
  const definitiveCodes = [
    'REFRESH_COOKIE_MISSING',
    'REFRESH_TOKEN_INVALID',
    'REFRESH_CLAIMS_INVALID',
    'REFRESH_EXPIRED',
    'REFRESH_SESSION_MISSING',
    'REFRESH_USER_DISABLED',
    'REFRESH_SESSION_VERSION_CHANGED'
  ];
  for (const code of definitiveCodes) {
    assert.equal(context.classifyRefreshFailure(401, { code }).kind, 'invalid', code);
  }
});

test('network-edge responses and uncoded 401 responses remain retryable', () => {
  for (const [status, payload] of [
    [0, {}],
    [401, {}],
    [401, { error: 'Unauthorised' }],
    [408, {}],
    [429, {}],
    [500, {}],
    [503, {}]
  ]) {
    assert.equal(context.classifyRefreshFailure(status, payload).kind, 'transient', `${status}`);
  }
});

test('refresh preserves the session on transient failures and retries with bounded backoff', () => {
  const refreshSource = section('async function refreshToken()', 'async function apiForgot');
  assert.match(refreshSource, /scheduleOfficeAuthRefreshRetry\(\)/);
  assert.match(refreshSource, /return markRefreshTemporarilyUnavailable\(0, 'REFRESH_NETWORK_ERROR'\)/);
  assert.match(refreshSource, /return markRefreshTemporarilyUnavailable\(res\.status, disposition\.code/);
  assert.match(refreshSource, /disposition\.kind === 'invalid'[\s\S]*forceLoggedOutUi/);
  assert.doesNotMatch(refreshSource, /catch \{\s*forceLoggedOutUi/);

  const scheduleSource = section('function scheduleOfficeAuthRefreshRetry()', 'function scheduleRefresh()');
  assert.match(scheduleSource, /OFFICE_AUTH_REFRESH_RETRY_DELAYS_MS\[index\]/);
  assert.match(scheduleSource, /refreshToken\(\)\.catch/);
});

test('request retry does not globally log out after an endpoint-specific 401', () => {
  const authFetchSource = section('async function authFetch(', '// single, de-duplicated definition');
  assert.match(authFetchSource, /refreshResult !== true/);
  assert.match(authFetchSource, /AUTH_REFRESH_TEMPORARILY_UNAVAILABLE/);
  assert.match(authFetchSource, /AUTH_REQUEST_UNAUTHORISED_AFTER_REFRESH/);
  const afterRenewal = authFetchSource.slice(authFetchSource.indexOf("AUTH_REQUEST_UNAUTHORISED_AFTER_REFRESH") - 600);
  assert.doesNotMatch(afterRenewal, /clearSession\(\)/);
  assert.doesNotMatch(afterRenewal, /openLogin\(/);
});

test('the existing two-hour idle policy remains unchanged', () => {
  assert.match(source, /policy:\s*\{ idle_logout_seconds: 7200, idle_warning_seconds: 300 \}/);
  assert.match(source, /p\?\.idle_logout_seconds \?\? 7200/);
});

test('the deployed HTML requests the new refresh-resilience asset', () => {
  assert.match(indexHtml, /office-auth-refresh=20260826-r1/);
});
