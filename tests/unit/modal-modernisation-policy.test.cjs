const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const modalJs = fs.readFileSync(path.join(root, 'js/modal-modernisation.js'), 'utf8');
const modalCss = fs.readFileSync(path.join(root, 'css/modal-modernisation.css'), 'utf8');

test('modal modernisation is additive and does not replace showModal', () => {
  assert.match(html, /css\/modal-modernisation\.css/);
  assert.match(html, /js\/modal-modernisation\.js/);
  assert.doesNotMatch(modalJs, /function\s+showModal\s*\(/);
  assert.match(modalJs, /window\.__applyCloudTmsModalModernisation = apply/);
});
test('money fields normalise to two decimals without treating hours or IDs as money', () => {
  assert.match(modalJs, /const isMoneyInput = \(input\) =>/);
  assert.match(modalJs, /const fixed = value\.toFixed\(2\)/);
  assert.match(modalJs, /hour\(\?:s\)\?/);
  assert.match(modalJs, /(?:id\|uuid)/);
  assert.match(modalJs, /document\.addEventListener\('blur'/);
});

test('read-only internal IDs and approved technical copy are suppressed', () => {
  assert.match(modalJs, /const hideUserFacingInternalIds = \(copyRoot\) =>/);
  assert.match(modalJs, /Operation\|Timesheet\|Candidate\|Client\|Contract\|Batch\|Session/);
  assert.match(modalJs, /Supported content includes formatted text, colours, links, tables/);
  assert.match(modalJs, /signature is stored on your user record/);
});

test('Banking Pay inner scroll hosts hand off wheel and touch scrolling at boundaries', () => {
  assert.match(modalJs, /const handOffBankingWheel = \(event\) =>/);
  assert.match(modalJs, /const handOffBankingTouch = \(event\) =>/);
  assert.match(modalJs, /outer\.scrollTop \+= event\.deltaY/);
  assert.match(modalCss, /#bankingPayReadyScrollHost[\s\S]*overscroll-behavior-y: auto !important/);
  assert.match(modalCss, /touch-action: pan-x pan-y/);
});
