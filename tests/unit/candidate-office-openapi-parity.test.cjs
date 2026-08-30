const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontend = path.join(__dirname, '..', '..');
const apiSource = fs.readFileSync(path.join(frontend, 'js', 'candidate-office-api-v1.js'), 'utf8');
const contractSource = fs.readFileSync(path.join(frontend, 'js', 'candidate-office-contract-v1.js'), 'utf8');
const backendCandidates = [
  process.env.CLOUDTMS_BACKEND_REPO,
  path.resolve(frontend, '..', 'cloudtms-backend'),
  process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'OneDrive - Arthur Rai', 'Documents', 'GitHub', 'cloudtms-backend')
].filter(Boolean);
const backend = backendCandidates.find(candidate => fs.existsSync(path.join(candidate, 'docs', 'candidate-app', 'CLOUDTMS_OFFICE_CANDIDATE_API_V1.yaml')));
const openApi = backend
  ? fs.readFileSync(path.join(backend, 'docs', 'candidate-app', 'CLOUDTMS_OFFICE_CANDIDATE_API_V1.yaml'), 'utf8')
  : null;

test('frontend fixed Office routes exist in the frozen OpenAPI', { skip: !openApi && 'backend OpenAPI checkout not available' }, () => {
  const requiredPaths = [
    '/api/candidate-app/office-capabilities',
    '/api/candidate-app/timesheets/{timesheetId}/office-detail',
    '/api/candidate-app/timesheets/office-projections',
    '/api/candidate-app/timesheets/{timesheetId}/route-preview',
    '/api/candidate-app/timesheets/{timesheetId}/route-confirm',
    '/api/candidate-app/timesheets/{timesheetId}/reject-preview',
    '/api/candidate-app/timesheets/{timesheetId}/reject',
    '/api/candidate-app/workflows/{workflowId}/actions/{action}',
    '/api/candidate-app/manager-reminder-batches/preview',
    '/api/candidate-app/manager-reminder-batches',
    '/api/candidate-app/manager-reminder-batches/{batchId}',
    '/api/candidate-app/workflows/{workflowId}/paper-pack',
    '/api/candidate-app/workflows/{workflowId}/paper-return-review',
    '/api/candidate-app/workflows/{workflowId}/components/{componentId}/document',
    '/api/candidate-app/workflows/{workflowId}/signature/prepare',
    '/api/candidate-app/uploads/{ticket}'
  ];
  requiredPaths.forEach(route => assert.match(openApi, new RegExp(`^  ${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'm'), route));

  assert.match(apiSource, /invokeOfficeCandidateAction[\s\S]*normalized\.invocation\.path/);
  assert.doesNotMatch(apiSource, /candidate-broker|public Candidate broker/i);
});

test('frontend exact-identity and idempotency fields remain present in the frozen OpenAPI', { skip: !openApi && 'backend OpenAPI checkout not available' }, () => {
  assert.match(openApi, /name: expected_row_signature, in: query/);
  assert.match(openApi, /required: \[expected_timesheet_id, expected_row_signature, expected_context_sha256, action, idempotency_key\]/);
  assert.match(openApi, /required: \[expected_timesheet_id, expected_row_signature, context_sha256, reason, idempotency_key\]/);
  assert.match(apiSource, /params\.set\('expected_row_signature', identity\.expected_row_signature\)/);
  assert.match(apiSource, /normalized\.invocation\.idempotency === 'REQUIRED'/);
  assert.match(apiSource, /key\.length > 200/);
});

test('generic workflow invocation is constrained to the frozen Office action catalogue', { skip: !openApi && 'backend OpenAPI checkout not available' }, () => {
  const expected = [
    'remind', 'renew', 'cancel', 'cancel-manager-handoff', 'phone-review',
    'phone-progress', 'phone-approve', 'phone-refuse', 'retry-finalisation',
    'retry-paper-preparation'
  ];
  const enumMatch = openApi.match(/enum: \[remind, renew, cancel, cancel-manager-handoff, phone-review, phone-progress, phone-approve, phone-refuse, retry-finalisation, retry-paper-preparation\]/);
  assert.ok(enumMatch, 'workflow action path must retain the exact closed action enum');
  expected.forEach(action => assert.match(enumMatch[0], new RegExp(`\\b${action}\\b`)));
  assert.doesNotMatch(enumMatch[0], /resubmit|mark-no-work/i);
});

test('frontend contract-version constants are exact OpenAPI constants', { skip: !openApi && 'backend OpenAPI checkout not available' }, () => {
  const versions = [
    'CLOUDTMS_OFFICE_CANDIDATE_API_V1',
    'OFFICE_CANDIDATE_CAPABILITIES_V1',
    'OFFICE_CANDIDATE_TIMESHEET_V1',
    'OFFICE_CANDIDATE_PROJECTION_BATCH_V1',
    'OFFICE_CANDIDATE_ACTION_V1',
    'OFFICE_CANDIDATE_REJECTION_PREVIEW_V1',
    'OFFICE_CANDIDATE_REMINDER_BATCH_PREVIEW_V1',
    'OFFICE_CANDIDATE_REMINDER_BATCH_RESULT_V1',
    'OFFICE_CANDIDATE_MUTATION_RESULT_V1'
  ];
  versions.forEach(version => {
    assert.match(contractSource, new RegExp(version));
    assert.match(openApi, new RegExp(version));
  });
});

test('Candidate bridge loads only after the existing application and workbench support modules', () => {
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const mainIndex = html.indexOf('./js/main.js?');
  const bulkIndex = html.indexOf('./js/bulk-authorise-evidence-controller.js');
  const bridgeIndex = html.indexOf('./js/candidate-office-bridge-v1.js');
  const bootstrapIndex = html.indexOf('./js/candidate-office-bootstrap-v1.js');

  assert.ok(mainIndex >= 0 && bulkIndex > mainIndex);
  assert.ok(bridgeIndex > bulkIndex);
  assert.ok(bootstrapIndex > bridgeIndex);
});

test('Candidate Office state is reset at every authentication transition', () => {
  const main = fs.readFileSync(path.join(frontend, 'js', 'main.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(frontend, 'js', 'candidate-office-bridge-v1.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(frontend, 'js', 'candidate-office-bootstrap-v1.js'), 'utf8');

  assert.match(main, /cloudtms:office-session-ready/);
  assert.match(main, /cloudtms:office-session-cleared/);
  assert.match(bootstrap, /CloudTMSCandidateOfficeBridge\?\.deactivate\?\.\(\)/);
  assert.match(bootstrap, /addEventListener\('cloudtms:office-session-cleared'/);
  assert.match(bridge, /requestedGeneration !== authorityGeneration \|\| !canSurface\(surface\)/);
  assert.match(bridge, /function deactivate\(\)/);
  assert.match(bridge, /cache\.clear\(\)/);
});
