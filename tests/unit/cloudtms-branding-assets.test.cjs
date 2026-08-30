const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function inspectPng(relativePath) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    bytes: bytes.length,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

test('Office CloudTMS branding uses the exact supplied artwork at responsive header and login surfaces', () => {
  assert.deepEqual(inspectPng('assets/branding/cloudtms-office-logo-black.png'), {
    bytes: 204343,
    width: 1448,
    height: 1086,
    sha256: '0a2a5535e05a0ae70919426f52447e5126deeb96f0bed462615dadcd3dda5697'
  });
  assert.match(html, /rel="preload" as="image" href="\.\/assets\/branding\/cloudtms-office-logo-black\.png"/);
  assert.match(html, /<div class="brand" role="img" aria-label="CloudTMS" title="CloudTMS">\s*<img src="\.\/assets\/branding\/cloudtms-office-logo-black\.png"/);
  assert.match(html, /<div class="auth-login-logo" role="img" aria-label="CloudTMS">\s*<img src="\.\/assets\/branding\/cloudtms-office-logo-black\.png"/);
  assert.match(html, /\.auth-login-stack\{[\s\S]*width:min\(520px,92vw\)[\s\S]*gap:18px/);
  assert.match(html, /\.auth-login-logo\{[\s\S]*width:min\(360px,76vw\)[\s\S]*aspect-ratio:102 \/ 37/);
  assert.match(html, /\.auth-login-logo img\{[\s\S]*width:142\.16%[\s\S]*top:-93\.25%/);
  assert.doesNotMatch(html, /#loginOverlay::before/);
  assert.match(html, /@media \(max-width:640px\)\{[\s\S]*\.brand\{ flex-basis:84px; width:84px; height:30px/);
  assert.doesNotMatch(html, /<span class="row-dot"><\/span>\s*CloudTMS/);
});

test('future My TMS app artwork is retained exactly but is not prematurely rendered by Office CloudTMS', () => {
  assert.deepEqual(inspectPng('assets/branding/my-tms-app-logo-black.png'), {
    bytes: 199331,
    width: 1254,
    height: 1254,
    sha256: '0c0eb876096276f54363d651b1a1be3ae5943875d4b0a9e2e35fe5c878a473b2'
  });
  assert.doesNotMatch(html, /my-tms-app-logo-black\.png/);
});
