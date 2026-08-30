import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../js/manager-authorisers.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/manager-authorisers.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('one reusable authoriser manager serves Client and Contract without broad form saves', () => {
  assert.match(source, /function openManager\(ctx\)/);
  assert.match(source, /\/api\/clients\/\$\{encodeURIComponent\(ctx\.id\)\}\/manager-authorisers/);
  assert.match(source, /\/api\/contracts\/\$\{encodeURIComponent\(ctx\.id\)\}\/manager-authorisers/);
  assert.doesNotMatch(source, /overrideclientsettings|client_update_with_settings_v1|upsertContract/);
  assert.match(source, /Save authorisers/);
});

test('Client and Contract controls use the approved positive wording and inline validation', () => {
  assert.match(source, /Only allow approved authorisers/);
  assert.match(source, /Use only this Contract’s approved authorisers/);
  assert.match(source, /Client-approved email addresses and domains will not be accepted for this Contract\./);
  assert.match(source, /This address is already approved\./);
  assert.match(source, /This domain is already approved\./);
  assert.match(source, /This address is already approved in Client settings\./);
  assert.match(source, /This domain is already approved in Client settings\./);
  assert.match(source, /Confirmation is temporarily unavailable\. Nothing was removed\./);
  assert.doesNotMatch(source, /window\.alert|window\.confirm/);
});

test('responsive assets are loaded and retain touch-friendly narrow layouts', () => {
  assert.match(html, /css\/manager-authorisers\.css\?v=20260826-r2/);
  assert.match(html, /js\/manager-authorisers\.js\?v=20260826-r1/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /flex-wrap:wrap/);
  assert.match(source, /noParentGate:true/);
  assert.match(source, /forceEdit:true/);
  assert.match(source, /document\.addEventListener\('click'/);
  assert.doesNotMatch(source, /body\.addEventListener/);
  assert.match(source, /Discard authoriser changes\?/);
  assert.match(source, /isManagerTop/);
});
