const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const importReview = fs.readFileSync(
  path.join(root, 'js/import-review-v1.js'),
  'utf8'
);

test('candidate preview merge has one canonical implementation', () => {
  assert.equal(
    (main.match(
      /^function mergePayWorkbenchCandidatePreviewIntoState\(/gm
    ) || []).length,
    1
  );
  assert.match(
    main,
    /function bankingPayPreviewCanonicalStableKey\(row, sectionHint = ''\)/
  );
});

test('canonical correction key wins over volatile preview row identifiers', () => {
  const canonicalRead = main.indexOf(
    "canonicalCorrectionKey.startsWith('CORRECTION_CHAIN_V1|')"
  );
  const rowIdRead = main.indexOf(
    'const rowId = trimStr(',
    canonicalRead
  );
  assert.ok(canonicalRead >= 0);
  assert.ok(rowIdRead > canonicalRead);
  assert.match(
    main,
    /return `canonical-correction:\$\{canonicalCorrectionKey\}`/
  );
});

test('case-resolution buckets use the canonical correction anchor before source-carrier provenance', () => {
  assert.match(
    main,
    /timesheet_id:\s*trimStr\(\s*row\.timesheet_id\s*\|\|\s*rawComponent\.timesheet_id\s*\|\|\s*linkedTimesheetIdText\s*\|\|\s*rawSourceBasisJson\.timesheet_id\s*\)/s
  );
});

test('canonical correction modal uses the correction root before linked-scope seed aliases', () => {
  assert.match(
    main,
    /const canonicalCorrectionAnchorTimesheetId = \(\(\) => \{[\s\S]*?\^correction-chain:[\s\S]*?const anchorTimesheetId = trimStr\(pickText\(\s*canonicalCorrectionAnchorTimesheetId,\s*linkedScope\.seed_timesheet_id/s
  );
});

test('expenses and additional-code rows retain independent row identity', () => {
  assert.match(
    main,
    /Do not collapse expenses or additional-code components/
  );
  assert.match(main, /if \(rowId\) return `id:\$\{rowId\}`/);
});

test('carry state is retained and rendered as deferred or review-required work', () => {
  assert.match(main, /case_resolution_carry_pending_count/);
  assert.match(main, /case_resolution_carry_review_count/);
  assert.match(main, /resolution\$\{carryPendingCount === 1 \? '' : 's'\} deferred/);
  assert.match(main, /carried resolution\$\{carryReviewCount === 1 \? '' : 's'\} need review/);
  assert.match(
    main,
    /prior decision remains saved and will be checked automatically/
  );
});

test('canonical correction breakdown uses its dated key and correction-specific wording', () => {
  assert.match(
    main,
    /const isCanonicalCorrectionCarrierLine = \(obj\) => \{[\s\S]*?rowKey\.startsWith\('correction-chain:'\)/
  );
  assert.match(
    main,
    /const canonicalWorkDate = getLineKeyType\(line\) === 'TS_DAY' \? trimStr\(getLineKeyValue\(line\)\) : ''/
  );
  assert.match(main, /Correction date/);
  assert.match(
    main,
    /const isAutomaticCorrectionCarrierLine = \(obj\) => \{[\s\S]*?isExplicitFalse\(resolutionRequired\)[\s\S]*?isExplicitFalse\(caseNeedsResolution\)/
  );
  assert.match(main, />Correction<\/span>/);
  assert.doesNotMatch(main, /Resolved correction/);
  assert.match(
    main,
    /const resolvedRateCancelActionHtml = \(line, renderContextSection = ''\) => \{[\s\S]*?if \(isAutomaticCorrectionCarrierLine\(line\)\) return '';/
  );
  assert.match(main, /Snooze correction/);
});

test('import review contract refuses a Worker without canonical carrier support', () => {
  assert.match(
    importReview,
    /canonicalCorrectionCarrier:\s*[\r\n]+\s*'BANKING_PAY_CANONICAL_CORRECTION_CARRIER_V1'/
  );
  assert.match(
    importReview,
    /contract\.canonical_correction_carrier_version[\s\S]*CONTRACT\.canonicalCorrectionCarrier/
  );
});
