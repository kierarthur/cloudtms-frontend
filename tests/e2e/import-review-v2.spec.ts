import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });

const IMPORT_ID = '10000000-0000-4000-8000-000000000001';
const NEW_IMPORT_ID = '10000000-0000-4000-8000-000000000002';
const HASH = 'a'.repeat(64);
const PREVIEW = 'b'.repeat(64);

const contract = {
  ok: true,
  schema_contract_version: 'IMPORT_REVIEW_DB_V1',
  apply_envelope_version: 'IMPORT_REVIEW_APPLY_V1',
  apply_operation_version: 'IMPORT_APPLY_OPERATION_V2',
  correction_operation_version: 'IMPORT_CORRECTION_OPERATION_V2',
  follow_up_component_version: 'IMPORT_REVIEW_FOLLOW_UP_COMPONENT_V1',
  tsfin_follow_up_settlement_version: 'IMPORT_REVIEW_TSFIN_SETTLEMENT_V1',
  incremental_apply_version: 'IMPORT_REVIEW_INCREMENTAL_APPLY_V1',
  review_ui_contract_version: 'IMPORT_REVIEW_UI_V6',
  email_grouping_version: 'TIMESHEET_QUERY_RECIPIENT_EMAIL_V1',
  canonical_correction_carrier_version: 'BANKING_PAY_CANONICAL_CORRECTION_CARRIER_V1',
  legacy_contracts_supported: false
};

function header(status = 'READY', importId = IMPORT_ID) {
  const editable = ['STAGED', 'IN_REVIEW', 'BLOCKED', 'READY'].includes(status);
  const commands = editable ? ['SAVE_SELECTIONS', 'REFRESH', 'ABANDON', 'RESOLVE_DAILY_TIMESHEET', ...(status === 'READY' ? ['APPLY'] : [])] : ['VIEW_APPLY_STATUS'];
  return {
    import: {
      id: importId, filename: importId === NEW_IMPORT_ID ? 'replacement.xlsx' : 'review-fixture.xlsx', source_system: importId === NEW_IMPORT_ID ? 'NHSP' : 'HEALTHROSTER', source_route: importId === NEW_IMPORT_ID ? 'NHSP' : 'HR_WEEKLY',
      coverage_mode: 'COMPLETE_ALL', coverage_start_date: '2026-07-01', coverage_end_date: '2026-07-07'
    },
    state: {
      status, follow_up_status: 'NOT_REQUIRED', state_version: 7, preview_generation: 3,
      preview_fingerprint: PREVIEW, ui_state: {}, read_only: !editable,
      editability: {
        read_only: !editable, can_edit_selections: editable, can_resolve_daily_timesheet: editable,
        can_refresh: editable, can_abandon: editable, can_apply: status === 'READY',
        can_view_apply_status: !editable, can_retry_follow_up: false, allowed_commands: commands
      },
      apply_contract: { selected_action_ids: ['action-1'], reference_invalidation_action_ids: [], request_hash: HASH }
    },
    evidence: { source_file_sha256: HASH, parser_version: 'CLOUDTMS_IMPORT_REVIEW_PARSER_V1:HR_WEEKLY', preview_fingerprint: PREVIEW, preview_generation: 3 },
    confirmation_summary: {
      selected_total: 1, selected_change_count: 1, selected_email_count: 2, selected_email_issue_count: 1,
      selected_email_reminder_count: 1, selected_reference_invalidation_count: 0, blocking_count: 0
    }
  };
}

function action(actionId: string, candidateId: string, candidate: string, clientId: string, client: string, selected: boolean) {
  return {
    action_id: actionId, action_kind: 'INCLUDE_SHIFT', action_category: 'READY', selectable: true, selected,
    batch_eligible: selected,
    candidate_id: candidateId, candidate_name: candidate, client_id: clientId, client_name: client,
    week_ending_date: '2026-07-05', work_date: '2026-07-02', evidence_fingerprint: HASH,
    imported_evidence: { work_date: '2026-07-02', start: '08:00', end: '16:00', break_minutes: 30, worked_minutes: 450, role: 'RN' },
    current_evidence: null, difference_codes: ['NEW_SHIFT'], outcome_label: 'TMS will add shift',
    branch_badges: selected
      ? [{ code: 'READY_ACTION:INCLUDE_SHIFT', label: 'TMS to add shift', count: 1, tone: 'READY' }]
      : [{ code: 'DEFERRED_ACTION', label: 'Deferred', count: 1, tone: 'DEFERRED' }],
    summary: { candidate_name: candidate, client_name: client, work_date: '2026-07-02', week_ending_date: '2026-07-05', start_time: '08:00', end_time: '16:00', break_minutes: 30, role: 'RN' }
  };
}

test('implements the V6 incremental review workflow on desktop and narrow Chromium', async ({ page }) => {
  test.setTimeout(90_000);
  const verifyDeployedAsset = process.env.VERIFY_DEPLOYED_IMPORT_REVIEW_V6_FULL === '1';
  const localFiles = new Map([
    ['/index.html', resolve(__dirname, '../../index.html')],
    ['/js/main.js', resolve(__dirname, '../../js/main.js')],
    ['/js/import-review-v1.js', resolve(__dirname, '../../js/import-review-v1.js')],
    ['/css/import-review-v1.css', resolve(__dirname, '../../css/import-review-v1.css')]
  ]);
  const hashes = new Map(Array.from(localFiles, ([key, file]) => [key, createHash('sha256').update(readFileSync(file)).digest('hex')]));
  let selectedOne = true;
  let eligibleClients: Array<{ client_id: string; client_name: string }> = [];
  let eligibilityRequestCount = 0;
  let createReviewPayload: Record<string, any> | null = null;
  let createdReview = false;
  let failCreatedReviewLoad = false;
  let refreshRequestCount = 0;
  let nativeDialogCount = 0;
  let scopeAuthorityMode: 'AUTHORITATIVE' | 'VALIDATION_ONLY' | 'MIXED' = 'AUTHORITATIVE';
  let scopeSourceRoute = 'NHSP';
  let finalConfirmationMode = false;
  const intercepted = new Set<string>();

  page.on('dialog', async (dialog) => {
    nativeDialogCount += 1;
    await dialog.dismiss();
  });

  if (!verifyDeployedAsset) {
    await page.route('https://testmode.arthur-rai.co.uk/**', async (route) => {
      const url = new URL(route.request().url());
      const key = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = localFiles.get(key);
      if (!file) return route.continue();
      intercepted.add(key);
      let body = readFileSync(file);
      if (key === '/index.html') {
        body = Buffer.from(body.toString('utf8').replace('</head>', '<script>window.__IMPORT_REVIEW_V6_PATCHED_ASSET__=true;</script></head>'));
      }
      return route.fulfill({ status: 200, body, contentType: key.endsWith('.css') ? 'text/css' : key.endsWith('.js') ? 'application/javascript' : 'text/html' });
    });
  } else {
    for (const asset of ['/js/main.js', '/js/import-review-v1.js']) {
      const deployedAssetResponse = await page.request.get(`https://testmode.arthur-rai.co.uk${asset}?full-runtime-proof=${Date.now()}`, {
        headers: { 'cache-control': 'no-cache' }
      });
      expect(deployedAssetResponse.status()).toBe(200);
      expect(createHash('sha256').update(await deployedAssetResponse.body()).digest('hex')).toBe(hashes.get(asset));
    }
  }

  await page.route('**/api/import-review/contract', (route) => route.fulfill({ json: { ok: true, data: contract } }));
  await page.route('**/api/import-reviews**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/import-reviews') {
      if (route.request().method() === 'POST') {
        createReviewPayload = JSON.parse(route.request().postData() || '{}');
        createdReview = true;
        return route.fulfill({ status: 201, json: { ok: true, data: { import_id: NEW_IMPORT_ID, status: 'BLOCKED' } } });
      }
      const items = [{ import_id: IMPORT_ID, filename: 'review-fixture.xlsx', source_route: 'HR_WEEKLY', coverage_start_date: '2026-07-01', coverage_end_date: '2026-07-07', status: 'READY', updated_at_utc: '2026-07-22T08:00:00Z' }];
      if (createdReview) items.unshift({ import_id: NEW_IMPORT_ID, filename: 'replacement.xlsx', source_route: 'NHSP', coverage_start_date: '2026-07-01', coverage_end_date: '2026-07-07', status: 'BLOCKED', updated_at_utc: '2026-07-22T08:01:00Z' });
      return route.fulfill({ json: { ok: true, data: { items, page_size: 25, next_cursor: null } } });
    }
    if (path === `/api/import-reviews/staged/${NEW_IMPORT_ID}/scope`) {
      return route.fulfill({ json: { ok: true, data: {
        import_id: NEW_IMPORT_ID, filename: 'replacement.xlsx', source_route: scopeSourceRoute, source_system: scopeSourceRoute === 'HR_DAILY' ? 'HEALTHROSTER_DAILY' : scopeSourceRoute === 'HR_WEEKLY' ? 'HEALTHROSTER' : 'NHSP', source_file_sha256: HASH,
        parser_version: 'CLOUDTMS_IMPORT_REVIEW_PARSER_V1:NHSP', coverage_start_date: '2026-07-01', coverage_end_date: '2026-07-07', staged_row_count: 2,
        authority_mode: scopeAuthorityMode, authority_summary: { mode: scopeAuthorityMode, source_route: scopeSourceRoute, basis: 'TEST_SERVER_OWNED_AUTHORITY' },
        scope_clients: [
          { source_client_key: 'client:test', source_display_label: 'Test Client source', client_id: '30000000-0000-4000-8000-000000000001', resolved_display_name: 'Test Client', resolved: true },
          { source_client_key: 'client:unmatched', source_display_label: 'Made up Trust', client_id: null, resolved_display_name: null, resolved: false }
        ],
        candidate_options: [
          { source_candidate_key: 'candidate:matched', source_display_label: 'Smith Jane', candidate_id: '40000000-0000-4000-8000-000000000001', resolved_display_name: 'Jane Smith', resolved: true },
          { source_candidate_key: 'candidate:unmatched', source_display_label: 'Unknown Worker', candidate_id: null, resolved_display_name: null, resolved: false }
        ], candidate_page: 1, candidate_total: 2, candidate_total_pages: 1, candidate_has_previous: false, candidate_has_next: false, review_already_created: false,
        overlapping_unfinished_reviews: [{ import_id: IMPORT_ID, state_version: 4, filename: 'earlier.xlsx', status: 'IN_REVIEW', coverage_start_date: '2026-07-01', coverage_end_date: '2026-07-07' }]
      } } });
    }
    if (path === `/api/import-reviews/${NEW_IMPORT_ID}/refresh` || path === `/api/import-reviews/${IMPORT_ID}/refresh`) {
      const body = JSON.parse(route.request().postData() || '{}');
      expect(body).toMatchObject({ expected_state_version: 7, max_actions: 5000 });
      refreshRequestCount += 1;
      return route.fulfill({ json: { ok: true, data: { status: 'READY', state_version: 8 } } });
    }
    if (path === `/api/import-reviews/${NEW_IMPORT_ID}/actions`) {
      if (failCreatedReviewLoad) return route.fulfill({ status: 409, json: { ok: false, error: { code: 'TIMESHEET_QUERY_CLIENT_REQUIRED', message: 'A query recipient needs attention.' } } });
      return route.fulfill({ json: { ok: true, data: { items: [], view_counts: { PENDING: 2, READY: 0, EMAIL: 0, NO_ACTION: 0 }, page_number: 1, total_pages: 1, total_items: 0, has_previous: false, has_next: false } } });
    }
    if (path === `/api/import-reviews/${NEW_IMPORT_ID}`) return route.fulfill({ json: { ok: true, data: header('BLOCKED', NEW_IMPORT_ID) } });
    if (path === `/api/import-reviews/${IMPORT_ID}/selections`) {
      const body = JSON.parse(route.request().postData() || '{}');
      selectedOne = body.action_changes?.[0]?.selected ?? selectedOne;
      return route.fulfill({ json: { ok: true, data: { state_version: 8, status: 'READY', preview_generation: 3, preview_fingerprint: PREVIEW } } });
    }
    if (path === `/api/import-reviews/${IMPORT_ID}/actions`) {
      const view = url.searchParams.get('view');
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('page_size') || 25);
      if (String(view || '').startsWith('CONFIRM_')) {
        const total = view === 'CONFIRM_STANDARD' ? 26 : 0;
        const start = (pageNumber - 1) * pageSize;
        const items = view === 'CONFIRM_STANDARD'
          ? Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_unused, index) => {
            const position = start + index + 1;
            return { ...action(`confirm-${position}`, `candidate-${Math.ceil(position / 5)}`, `Candidate ${Math.ceil(position / 5)}`, 'client-1', 'Alpha Trust', true), candidate_section_total_count: Math.min(5, total - (Math.ceil(position / 5) - 1) * 5), client_section_total_count: total };
          })
          : [];
        const totalPages = total ? Math.ceil(total / pageSize) : 0;
        return route.fulfill({ json: { ok: true, data: { items, view_counts: { PENDING: 0, READY: 26, EMAIL: 0, NO_ACTION: 0 }, confirmation_counts: { selected_total: 26, standard: 26, non_standard: 0, amendment: 0, reversal_replacement: 0, cancellation: 0, reversal_only: 0, validation: 0, email: 0, reference: 0 }, page_number: pageNumber, page_size: pageSize, total_pages: totalPages, total_items: total, has_previous: pageNumber > 1, has_next: pageNumber < totalPages } } });
      }
      if (view === 'EMAIL') {
        const base = { action_kind: 'EMAIL_ISSUE', action_category: 'EMAIL', selectable: true, selected: true, recipient_email: 'shared@example.test', recipient_group_key: 'RECIPIENT_EMAIL:stable', week_ending_date: '2026-07-05', work_date: '2026-07-02', outcome_label: 'Send new query', evidence_rows: [{ imported_evidence: { work_date: '2026-07-02', start: '08:00', end: '16:00', break_minutes: 30, worked_minutes: 450, role: 'RN' }, current_evidence: { work_date: '2026-07-02', start: '08:30', end: '16:00', break_minutes: 30, worked_minutes: 420, role: 'RN' }, difference_codes: ['START_TIME', 'WORKED_HOURS'] }], summary: { start_time: '08:00', end_time: '16:00', break_minutes: 30, role: 'RN', work_date: '2026-07-02' } };
        return route.fulfill({ json: { ok: true, data: { items: [
          { ...base, action_id: 'email-1', client_id: 'client-1', client_name: 'Alpha Trust', contract_id: 'contract-1', contract_label: 'Ward A · RN' },
          { ...base, action_id: 'email-2', client_id: 'client-2', client_name: 'Beta Trust', contract_id: 'contract-2', contract_label: 'Ward B · RN' }
        ], view_counts: { PENDING: 0, READY: 2, EMAIL: 2, NO_ACTION: 0 }, page_number: 1, total_pages: 1, total_items: 2, has_previous: false, has_next: false } } });
      }
      const item = pageNumber === 1
        ? action('action-1', 'candidate-1', 'Jane Smith', 'client-1', 'Alpha Trust', selectedOne)
        : action('action-2', 'candidate-2', 'Adam Jones', 'client-2', 'Beta Trust', true);
      return route.fulfill({ json: { ok: true, data: { items: [item], view_counts: { PENDING: 0, READY: 2, EMAIL: 2, NO_ACTION: 0 }, page_number: pageNumber, total_pages: 2, total_items: 2, has_previous: pageNumber > 1, has_next: pageNumber < 2 } } });
    }
    if (path === `/api/import-reviews/${IMPORT_ID}`) {
      const data = header('READY');
      if (finalConfirmationMode) {
        data.state.apply_contract.selected_action_ids = Array.from({ length: 26 }, (_unused, index) => `confirm-${index + 1}`);
        data.confirmation_summary.selected_total = 26;
        data.confirmation_summary.selected_change_count = 26;
      }
      return route.fulfill({ json: { ok: true, data } });
    }
    return route.fulfill({ status: 404, json: { ok: false, message: `unhandled ${path}` } });
  });
  await page.route('**/api/healthroster/autoprocess/clients', (route) => {
    eligibilityRequestCount += 1;
    return route.fulfill({ json: { ok: true, data: { items: eligibleClients } } });
  });
  await page.route('**/api/nhsp/import', (route) => route.fulfill({ json: { ok: true, data: { import_id: NEW_IMPORT_ID } } }));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  if (verifyDeployedAsset) {
    expect(await page.evaluate(() => (window as any).__IMPORT_REVIEW_V6_PATCHED_ASSET__)).not.toBe(true);
  } else {
    expect(await page.evaluate(() => (window as any).__IMPORT_REVIEW_V6_PATCHED_ASSET__)).toBe(true);
    expect(intercepted.has('/index.html')).toBe(true);
    expect(intercepted.has('/js/main.js')).toBe(true);
    expect(intercepted.has('/js/import-review-v1.js')).toBe(true);
  }
  expect(hashes.get('/js/import-review-v1.js')).toBe(createHash('sha256').update(readFileSync(localFiles.get('/js/import-review-v1.js')!)).digest('hex'));

  await page.evaluate(() => {
    const original = (window as any).authFetch;
    (window as any).__IMPORT_REVIEW_ELIGIBILITY_CACHE_MODES__ = [];
    (window as any).authFetch = function (...args: any[]) {
      if (String(args[0] || '').includes('/api/healthroster/autoprocess/clients')) {
        (window as any).__IMPORT_REVIEW_ELIGIBILITY_CACHE_MODES__.push(args[1]?.cache || null);
      }
      return original.apply(this, args);
    };
  });

  await page.evaluate(() => (window as any).openImportsModal());
  await expect(page.locator('#irv1Home')).toBeVisible();
  await expect(page.getByText('Approved contract IMPORT_REVIEW_UI_V6')).toBeVisible();
  await expect(page.locator('[data-ir-client="HR_WEEKLY"] option')).toHaveCount(1);
  await expect(page.locator('[data-ir-client="HR_DAILY"] option')).toHaveCount(1);
  await expect(page.locator('[data-ir-drop="NHSP"] select')).toHaveCount(0);
  expect(eligibilityRequestCount).toBe(1);

  eligibleClients = [{ client_id: '30000000-0000-4000-8000-000000000001', client_name: 'Test Client' }];
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cloudtms:client-saved', { detail: { client: { id: '30000000-0000-4000-8000-000000000001' } } })));
  expect(await page.evaluate(() => (window as any).CloudTmsImportReviewV1._state.home.clients.length)).toBe(0);
  await page.locator('[data-ir-action="reload-home"]').click();
  await expect(page.locator('[data-ir-client="HR_WEEKLY"] option', { hasText: 'Test Client' })).toHaveCount(1);
  await expect(page.locator('[data-ir-client="HR_DAILY"] option', { hasText: 'Test Client' })).toHaveCount(1);
  expect(eligibilityRequestCount).toBe(2);

  eligibleClients = [];
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cloudtms:client-saved', { detail: { client: { id: '30000000-0000-4000-8000-000000000001' } } })));
  await page.locator('[data-ir-action="reload-home"]').click();
  await expect(page.locator('[data-ir-client="HR_WEEKLY"] option')).toHaveCount(1);
  await expect(page.locator('[data-ir-client="HR_DAILY"] option')).toHaveCount(1);
  expect(eligibilityRequestCount).toBe(3);
  expect(await page.evaluate(() => (window as any).__IMPORT_REVIEW_ELIGIBILITY_CACHE_MODES__)).toEqual(['no-store', 'no-store', 'no-store']);

  await page.evaluate(() => { (window as any).uploadImportFileToR2 = async () => ({ fileKey: 'mock/replacement.xlsx', filename: 'replacement.xlsx' }); });
  await page.locator('[data-ir-drop="NHSP"] [data-ir-file]').setInputFiles({ name: 'replacement.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('fixture') });
  await expect(page.locator('#irv1Coverage')).toBeVisible();
  await expect(page.locator('#irv1Coverage')).toHaveAttribute('data-authority-mode', 'AUTHORITATIVE');
  await expect(page.getByText('Complete authoritative file – all candidates')).toBeVisible();
  await expect(page.getByText('Complete authoritative file – selected candidates')).toBeVisible();
  await expect(page.getByText(/Their imported shifts may be added or amended in CloudTMS/)).toBeVisible();
  await expect(page.getByText('Partial authoritative file')).toBeVisible();
  await expect(page.locator('[data-ir-action="coverage-create"]')).toBeDisabled();

  await expect(page.locator('.irv1-scope-chip.is-matched[data-mapping-status="matched"]')).toHaveCount(1);
  await expect(page.locator('.irv1-scope-chip.is-unmatched[data-mapping-status="unmatched"]')).toHaveCount(1);
  await page.locator('input[name="irCoverage"][value="PARTIAL"]').check();
  await expect(page.getByText('Candidates found in this partial file')).toBeVisible();
  await expect(page.locator('.irv1-candidate-row')).toHaveCount(2);
  await expect(page.locator('.irv1-candidate-row.is-matched')).toHaveCount(1);
  await expect(page.locator('.irv1-candidate-row.is-unmatched')).toHaveCount(1);
  await expect(page.locator('[data-ir-coverage-candidate]')).toHaveCount(0);
  await expect(page.locator('[data-ir-action="coverage-create"]')).toBeDisabled();

  await page.locator('input[name="irCoverage"][value="COMPLETE_ALL"]').check();
  await expect(page.getByText('Candidates covered by all shifts for this period')).toBeVisible();
  await expect(page.locator('.irv1-candidate-row')).toHaveCount(2);
  await expect(page.locator('[data-ir-coverage-candidate]')).toHaveCount(0);

  await page.locator('input[name="irCoverage"][value="COMPLETE_SELECTED_CANDIDATES"]').check();
  await expect(page.locator('[data-ir-coverage-candidate]')).toHaveCount(2);
  await page.locator('[data-ir-coverage-candidate="candidate:matched"]').check();
  await page.locator('input[name="irCoverage"][value="PARTIAL"]').check();
  await expect(page.locator('[data-ir-coverage-candidate]')).toHaveCount(0);
  await page.locator('input[name="irCoverage"][value="COMPLETE_SELECTED_CANDIDATES"]').check();
  await expect(page.locator('[data-ir-coverage-candidate="candidate:matched"]')).toBeChecked();

  await page.locator('[data-ir-action="coverage-cancel"]').click();
  await expect(page.locator('#modalTitle')).toHaveText('Discard staged import?');
  await page.getByRole('button', { name: 'Keep reviewing' }).click();
  await expect(page.locator('#irv1Coverage')).toBeVisible();

  await page.locator('#btnCloseModal').click();
  await expect(page.locator('#modalTitle')).toHaveText('Discard staged import?');
  await page.getByRole('button', { name: 'Keep reviewing' }).click();
  await expect(page.locator('#irv1Coverage')).toBeVisible();
  expect(nativeDialogCount).toBe(0);

  await page.locator('#btnCloseModal').click();
  await expect(page.locator('#modalTitle')).toHaveText('Discard staged import?');
  await page.getByRole('button', { name: 'Discard import' }).click();
  await expect(page.locator('#modalBack')).toBeHidden();
  expect(nativeDialogCount).toBe(0);

  await page.evaluate(() => {
    (window as any).showModal(
      'Import review parent',
      [{ key: 'main', label: 'Review' }],
      () => '<div id="importParentProof">Parent import review remains available.</div>',
      async () => true,
      false,
      null,
      { kind: 'test-import-parent', noParentGate: true }
    );
  });
  await expect(page.locator('#modalTitle')).toHaveText('Import review parent');
  await expect(page.locator('#importParentProof')).toBeVisible();

  await page.evaluate(() => {
    (window as any).openCandidatePicker(async () => {
      throw new Error('Due to security reasons when linking a candidate they must have a valid contract. Please create the contract and try again.');
    }, {
      title: 'Link candidate',
      force_constrained_source: true,
      source_rows: [{ id: 'candidate-test-1', first_name: 'Jane', last_name: 'Smith', display_name: 'Jane Smith', active: true }]
    });
  });
  await expect(page.locator('#modalTitle')).toHaveText('Link candidate');
  await page.locator('#pickerTBody tr[data-id="candidate-test-1"]').click();
  await page.locator('#btnSave').click();
  await expect(page.locator('#modalTitle')).toHaveText('Candidate could not be linked');
  await expect(page.getByText(/Due to security reasons when linking a candidate/)).toBeVisible();
  expect(nativeDialogCount).toBe(0);
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#modalTitle')).toHaveText('Link candidate');
  await expect(page.locator('#pickerTBody tr[data-id="candidate-test-1"]')).toHaveClass(/active/);
  await expect(page.locator('#pickerSearch')).toBeVisible();
  await page.locator('#btnCloseModal').click();
  await expect(page.locator('#modalTitle')).toHaveText('Import review parent');
  await expect(page.locator('#importParentProof')).toBeVisible();

  await page.evaluate(() => {
    (window as any).openClientPicker(async () => {
      throw new Error('The selected client cannot be linked to this import row.');
    }, {
      title: 'Link client',
      force_constrained_source: true,
      source_rows: [{ id: 'client-test-1', name: 'Test Client', display_name: 'Test Client', active: true }]
    });
  });
  await expect(page.locator('#modalTitle')).toHaveText('Link client');
  await page.locator('#pickerTBody tr[data-id="client-test-1"]').click();
  await page.locator('#btnSave').click();
  await expect(page.locator('#modalTitle')).toHaveText('Client could not be linked');
  await expect(page.getByText(/selected client cannot be linked/)).toBeVisible();
  expect(nativeDialogCount).toBe(0);
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#modalTitle')).toHaveText('Link client');
  await expect(page.locator('#pickerTBody tr[data-id="client-test-1"]')).toHaveClass(/active/);
  await page.locator('#btnCloseModal').click();
  await expect(page.locator('#modalTitle')).toHaveText('Import review parent');
  await expect(page.locator('#importParentProof')).toBeVisible();
  await page.locator('#btnCloseModal').click();

  scopeAuthorityMode = 'VALIDATION_ONLY';
  scopeSourceRoute = 'HR_DAILY';
  await page.evaluate(() => (window as any).openImportsModal());
  await page.locator('[data-ir-drop="NHSP"] [data-ir-file]').setInputFiles({ name: 'validation.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('fixture') });
  await expect(page.locator('#irv1Coverage')).toHaveAttribute('data-authority-mode', 'VALIDATION_ONLY');
  await expect(page.getByText('Complete validation file – all candidates')).toBeVisible();
  await expect(page.getByText('Complete validation file – selected candidates')).toBeVisible();
  await expect(page.getByText('Partial validation file')).toBeVisible();
  await expect(page.getByText(/No timesheet hours or financial values will be changed/)).toHaveCount(3);
  await page.locator('#btnCloseModal').click();
  await page.getByRole('button', { name: 'Discard import' }).click();

  scopeAuthorityMode = 'MIXED';
  scopeSourceRoute = 'HR_WEEKLY';
  await page.evaluate(() => (window as any).openImportsModal());
  await page.locator('[data-ir-drop="NHSP"] [data-ir-file]').setInputFiles({ name: 'mixed.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('fixture') });
  await expect(page.locator('#irv1Coverage')).toHaveAttribute('data-authority-mode', 'MIXED');
  await expect(page.getByText('Complete mixed file – all candidates')).toBeVisible();
  await expect(page.getByText('Complete mixed file – selected candidates')).toBeVisible();
  await expect(page.getByText('Partial mixed file')).toBeVisible();
  await page.locator('#btnCloseModal').click();
  await page.getByRole('button', { name: 'Discard import' }).click();

  scopeAuthorityMode = 'AUTHORITATIVE';
  scopeSourceRoute = 'NHSP';
  await page.evaluate(() => (window as any).openImportsModal());
  await expect(page.locator('#irv1Home')).toBeVisible();
  await page.locator('[data-ir-drop="NHSP"] [data-ir-file]').setInputFiles({ name: 'replacement.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('fixture') });
  await expect(page.locator('#irv1Coverage')).toBeVisible();

  await page.locator('input[name="irCoverage"][value="COMPLETE_ALL"]').check();
  await page.locator('[data-ir-action="overlap-replace"]').click();
  await expect(page.locator('[data-ir-action="coverage-create"]')).toBeEnabled();
  failCreatedReviewLoad = true;
  await page.locator('[data-ir-action="coverage-create"]').click();
  await expect(page.locator('#irv1Home')).toBeVisible();
  await expect(page.getByText(/The review was created, but its next screen could not be loaded safely/)).toBeVisible();
  failCreatedReviewLoad = false;
  await page.locator(`[data-ir-action="continue"][data-import-id="${NEW_IMPORT_ID}"]`).click();
  await expect(page.locator('#irv1Review')).toBeVisible();
  await expect(page.locator('[data-ir-action="review-view"][data-view="EMAIL"]')).toHaveCount(0);
  expect(refreshRequestCount).toBe(1);
  expect(createReviewPayload).not.toBeNull();
  expect(createReviewPayload?.coverage_mode).toBe('COMPLETE_ALL');
  expect(createReviewPayload?.scope_candidates).toEqual([]);
  expect(createReviewPayload?.scope_clients).toHaveLength(2);
  for (const client of createReviewPayload?.scope_clients || []) {
    expect(Object.keys(client).sort()).toEqual(['client_id', 'source_client_key', 'source_display_label']);
  }
  expect(JSON.stringify(createReviewPayload)).not.toContain('resolved_display_name');
  expect(JSON.stringify(createReviewPayload)).not.toContain('"resolved"');

  await page.locator('[data-ir-action="home"]').click();
  await expect(page.locator('#irv1Home')).toBeVisible();
  await page.locator(`[data-ir-action="continue"][data-import-id="${IMPORT_ID}"]`).click();

  await expect(page.locator('#irv1Review')).toBeVisible();
  expect(refreshRequestCount).toBe(2);
  await page.locator('[data-ir-action="review-view"][data-view="READY"]').click();
  await page.locator('details[data-ir-expand-key^="candidate:"] > summary').click();
  await page.locator('details[data-ir-expand-key^="week:"] > summary').click();
  await expect(page.getByText('TMS will add shift', { exact: true })).toBeVisible();
  await expect(page.locator('.irv1-branch-badge.is-ready', { hasText: 'TMS to add shift' })).toHaveCount(0);
  const first = page.locator('[data-ir-select="action-1"]');
  await first.uncheck();
  await page.locator('[data-ir-action="review-page"][data-page="2"]').click();
  await page.locator('details[data-ir-expand-key^="candidate:"] > summary').click();
  await page.locator('details[data-ir-expand-key^="week:"] > summary').click();
  await expect(page.locator('[data-ir-select="action-2"]')).toBeChecked();
  await page.locator('[data-ir-action="review-page"][data-page="1"]').click();
  await expect(page.locator('details[data-ir-expand-key^="candidate:"]')).toHaveAttribute('open', '');
  await expect(page.locator('details[data-ir-expand-key^="client:"]')).toHaveCount(0);
  await expect(page.locator('details[data-ir-expand-key^="week:"]')).toHaveAttribute('open', '');
  await expect(page.locator('[data-ir-select="action-1"]')).not.toBeChecked();
  await expect(page.locator('.irv1-branch-badge.is-deferred', { hasText: 'Deferred' })).toHaveCount(0);

  await page.locator('[data-ir-action="review-view"][data-view="EMAIL"]').click();
  await expect(page.getByText('One email to shared@example.test')).toHaveCount(1);
  await expect(page.getByText('Alpha Trust')).toBeVisible();
  await expect(page.getByText('Beta Trust')).toBeVisible();
  await expect(page.getByText('Shift 1')).toHaveCount(6);
  await expect(page.getByText('Start differs')).toHaveCount(2);

  finalConfirmationMode = true;
  await page.locator('[data-ir-action="apply-preview"]').click();
  await expect(page.getByText('Final confirmation')).toBeVisible();
  await expect(page.getByText('1 new issue(s)')).toBeVisible();
  await expect(page.getByText('1 explicit reminder(s)')).toBeVisible();
  await expect(page.locator('[data-ir-action="apply-confirm"]')).toBeDisabled();
  await page.locator('.irv1-confirm-section').filter({ hasText: 'Standard imported shifts' }).locator('summary').first().click();
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await page.locator('[data-ir-action="confirm-page"][data-section="STANDARD"][data-page="2"]').click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await page.locator('[data-ir-confirm-page-size="STANDARD"]').selectOption('50');
  await expect(page.getByText('Page 1 of 1')).toBeVisible();
  await page.locator('[data-ir-confirm-ack]').check();
  await expect(page.locator('[data-ir-action="apply-confirm"]')).toBeEnabled();

  await page.setViewportSize({ width: 412, height: 915 });
  await expect(page.getByText('Final confirmation')).toBeVisible();
  const narrowLayout = await page.evaluate(() => {
    const grid = document.querySelector('.irv1-settings-grid') as HTMLElement;
    const modal = document.querySelector('#modal') as HTMLElement;
    const bounds = modal.getBoundingClientRect();
    const shellBounds = (document.querySelector('.irv1-shell') as HTMLElement).getBoundingClientRect();
    return {
      gridColumnCount: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
      modalLeft: bounds.left,
      modalRight: bounds.right,
      shellLeft: shellBounds.left,
      shellRight: shellBounds.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(narrowLayout.gridColumnCount).toBe(1);
  expect(narrowLayout.modalLeft).toBeGreaterThanOrEqual(0);
  expect(narrowLayout.modalRight).toBeLessThanOrEqual(narrowLayout.viewportWidth);
  expect(narrowLayout.shellLeft).toBeGreaterThanOrEqual(narrowLayout.modalLeft);
  expect(narrowLayout.shellRight).toBeLessThanOrEqual(narrowLayout.modalRight);
});

test('normal TEST deployment exposes the reviewed V6 asset and contract', async ({ page }) => {
  test.skip(
    process.env.VERIFY_DEPLOYED_IMPORT_REVIEW_V6 !== '1',
    'Post-deployment runtime proof; set VERIFY_DEPLOYED_IMPORT_REVIEW_V6=1 only after the reviewed DB, Worker and frontend are deployed together.'
  );
  const localAsset = readFileSync(resolve(__dirname, '../../js/import-review-v1.js'));
  const deployedAssetResponse = await page.request.get(`https://testmode.arthur-rai.co.uk/js/import-review-v1.js?runtime-proof=${Date.now()}`, {
    headers: { 'cache-control': 'no-cache' }
  });
  expect(deployedAssetResponse.status()).toBe(200);
  expect(createHash('sha256').update(await deployedAssetResponse.body()).digest('hex'))
    .toBe(createHash('sha256').update(localAsset).digest('hex'));
  await page.goto('/');
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 30_000 });
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/import-review/contract'));
  const eligibilityPromise = page.waitForResponse((response) => response.url().endsWith('/api/healthroster/autoprocess/clients'));
  await page.evaluate(() => (window as any).openImportsModal());
  const response = await responsePromise;
  const eligibilityResponse = await eligibilityPromise;
  const payload = await response.json();
  expect(response.status()).toBe(200);
  expect(eligibilityResponse.status()).toBe(200);
  expect(eligibilityResponse.headers()['cache-control']).toContain('no-store');
  const deployed = payload?.data || payload;
  expect(deployed).toMatchObject(contract);
  await expect(page.locator('#irv1Home')).toBeVisible();
  await expect(page.getByText('Approved contract IMPORT_REVIEW_UI_V6')).toBeVisible();
  const refreshedEligibilityPromise = page.waitForResponse((next) => next.url().endsWith('/api/healthroster/autoprocess/clients'));
  await page.locator('[data-ir-action="reload-home"]').click();
  const refreshedEligibilityResponse = await refreshedEligibilityPromise;
  expect(refreshedEligibilityResponse.status()).toBe(200);
  expect(refreshedEligibilityResponse.headers()['cache-control']).toContain('no-store');
  await page.setViewportSize({ width: 412, height: 915 });
  const deployedModalBounds = await page.locator('#modal').evaluate((modal) => {
    const bounds = modal.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, viewport: window.innerWidth };
  });
  expect(deployedModalBounds.left).toBeGreaterThanOrEqual(0);
  expect(deployedModalBounds.right).toBeLessThanOrEqual(deployedModalBounds.viewport);
});
