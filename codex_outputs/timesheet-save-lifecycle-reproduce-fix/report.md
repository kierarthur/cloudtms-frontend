# Timesheet Save Lifecycle / Lazy Refresh / Authorise Gate Report

## Summary
- Reproduced Repro A before patch through a real UI line mutation on target timesheet `125661ed-7919-4561-9792-93a1417dfe32`: manual-upsert succeeded but Authorise stayed disabled with stale lifecycle authority (`MISSING_ROW_SIGNATURE` in this run, same stale gate class as `LATEST_TIMESHEET_DETAILS_REFRESH_REQUIRED`).
- Applied one narrow frontend change in `js/main.js`: after a save response requests lifecycle authority, do not defer the lightweight affected-row refresh behind a save-response display signature.
- Verified with patched frontend asset route interception that Repro A passed and the Authorise button became enabled after lightweight lifecycle authority.
- Verified Repro B sequence (already-authorised reopen -> Unauthorise -> edit -> Save) passed after patch. Save used normal TEST backend, not Codex Worker.

## Scope
Frontend only. Backend source was inspected read-only. No backend code, SQL, migrations, Worker deploy, payment, remittance, settlement, webhook, or drain actions were run.

## Safety confirmations
- TEST-only endpoints used: frontend `https://testmode.arthur-rai.co.uk`, backend `https://test-cloudtms-backend.kier-88a.workers.dev`.
- No production endpoint or Codex backend route was used.
- No destructive SQL or prohibited RPC was run; DB diagnostics used only `public.codex_debug_select_sql` with bounded SELECT queries via `curl -4`.
- Secrets were not printed; environment checks reported presence/length only.
- Backend `wrangler.toml` was not modified. No TEST or production deploy was performed.
- Policy X: no Banking Pay/payment economics, VAT, PAYE/umbrella, draft economics, settlement, provider execution, or remittance logic changed.

## Source/runtime used
- Frontend repo: `/workspace/TEST-Frontend`.
- Backend source: `/workspace/cloudtms-backend`, read-only inspection.
- Runtime backend: normal TEST backend only.
- Wrangler tail target: `test-cloudtms-backend`.

## Previous Codex patch status, if present
Preflight `rg` found existing lifecycle/save diagnostic and lifecycle-gate code in `js/main.js`, including `refreshAndAdoptSimpleTimesheetLifecycleRowAfterSave`, `refreshTimesheetLifecycleAffectedRows`, `applyTimesheetLifecyclePatchToModal`, `ensureSimpleTimesheetLifecycleHydrated`, `authoriseTimesheet`, `unauthoriseTimesheet`, `SUMMARY_ROTATION`, and `_updateButtons`. The workspace was not treated as verified.

## Preflight inspection
- `git status --short` was clean before changes.
- Frontend lifecycle/save loci were present in `js/main.js`.
- Backend read-only search confirmed routes/functions for `manual-upsert`, `lifecycle-affected-rows`, summary, authorise, unauthorise, and details.

## DB diagnostics
- Redacted env check: required Supabase and Cloudflare variables present.
- DB smoke passed (`select now()`).
- Diagnostic RPC exists: `public.codex_debug_select_sql(p_sql text, p_limit integer)`.
- Schema check run for `timesheets`, `timesheets_financials`, `contract_weeks`, `settings_defaults`.
- Baseline state: `{'version': 1, 'booking_id': 'bk_cw_6090b6e6ea634105897a82e45e407f24', 'is_current': True, 'revoked_at': '2026-07-02T21:43:47.607+00:00', 'updated_at': '2026-07-02T21:43:55.960573+00:00', 'contract_id': '3cb8e4ab-d1cc-4e73-bc19-3885a6e3d801', 'paid_at_utc': None, 'sheet_scope': 'WEEKLY', 'total_hours': 0.84, 'timesheet_id': '125661ed-7919-4561-9792-93a1417dfe32', 'cw_updated_at': '2026-07-02T21:43:55.960573+00:00', 'safe_signature': 'e511be792523b0a70602fec4afab607f', 'cw_timesheet_id': '125661ed-7919-4561-9792-93a1417dfe32', 'submission_mode': 'MANUAL', 'contract_week_id': '6090b6e6-ea63-4105-897a-82e45e407f24', 'reference_number': None, 'processing_status': 'PENDING_AUTH', 'financial_is_stale': False, 'authorised_at_server': None, 'contract_week_status': 'SUBMITTED', 'financial_is_current': True, 'financial_updated_at': '2026-07-02T21:45:56.827939+00:00', 'locked_by_invoice_id': None, 'tf_authorised_at_utc': None}`.
- After pre-patch Repro A Save state: `{'version': 1, 'booking_id': 'bk_cw_6090b6e6ea634105897a82e45e407f24', 'is_current': True, 'revoked_at': '2026-07-02T21:43:47.607+00:00', 'updated_at': '2026-07-02T22:38:44.264402+00:00', 'contract_id': '3cb8e4ab-d1cc-4e73-bc19-3885a6e3d801', 'paid_at_utc': None, 'sheet_scope': 'WEEKLY', 'total_hours': 0.92, 'timesheet_id': '125661ed-7919-4561-9792-93a1417dfe32', 'cw_updated_at': '2026-07-02T22:38:44.264402+00:00', 'safe_signature': '39ed23080c0ae0b1017a7c9fd88ad361', 'cw_timesheet_id': '125661ed-7919-4561-9792-93a1417dfe32', 'submission_mode': 'MANUAL', 'contract_week_id': '6090b6e6-ea63-4105-897a-82e45e407f24', 'reference_number': None, 'processing_status': 'PENDING_AUTH', 'financial_is_stale': False, 'authorised_at_server': None, 'contract_week_status': 'SUBMITTED', 'financial_is_current': True, 'financial_updated_at': '2026-07-02T22:38:44.264402+00:00', 'locked_by_invoice_id': None, 'tf_authorised_at_utc': None}`.
- Final state: `{'version': 1, 'booking_id': 'bk_cw_6090b6e6ea634105897a82e45e407f24', 'is_current': True, 'revoked_at': '2026-07-02T22:54:57.502+00:00', 'updated_at': '2026-07-02T22:55:21.238812+00:00', 'contract_id': '3cb8e4ab-d1cc-4e73-bc19-3885a6e3d801', 'paid_at_utc': None, 'sheet_scope': 'WEEKLY', 'total_hours': 0.92, 'timesheet_id': '125661ed-7919-4561-9792-93a1417dfe32', 'cw_updated_at': '2026-07-02T22:55:21.238812+00:00', 'safe_signature': '7f218cc0744efcb721d02135f81a5bd4', 'cw_timesheet_id': '125661ed-7919-4561-9792-93a1417dfe32', 'submission_mode': 'MANUAL', 'contract_week_id': '6090b6e6-ea63-4105-897a-82e45e407f24', 'reference_number': None, 'processing_status': 'PENDING_AUTH', 'financial_is_stale': False, 'authorised_at_server': None, 'contract_week_status': 'SUBMITTED', 'financial_is_current': True, 'financial_updated_at': '2026-07-02T22:55:21.238812+00:00', 'locked_by_invoice_id': None, 'tf_authorised_at_utc': None}`.

## Wrangler tail setup/result
- Tail command used `npx wrangler tail test-cloudtms-backend --format=json` before mutation actions.
- Tail captured actual mutation traffic. Latest tail summary: stdout lines=6633, bytes=528903; found={'manual-upsert': True, 'authorise': True, 'unauthorise': True, 'details': True, 'lifecycle-affected-rows': True}; stderr contained only Wrangler startup/status text.

## Reproduction before patch
- Repro A attempted: yes.
- Repro A completed: yes for edit+Save; Authorise click was blocked by the reproduced disabled gate.
- Repro A reproduced issue: yes.
- Repro A failure point: after manual-upsert success, Authorise disabled with `MISSING_ROW_SIGNATURE`; modal had `__timesheetLifecycleCriticalStateIncomplete=true`, `__simpleTimesheetLifecycleRefreshRequired=true`, `__timesheetLifecycleTrustRequiresNetworkBeforeAuthorise=true`, `can_authorise=true`, `disabled_reasons=[]`.
- Repro B attempted: yes, but pre-patch full B was not completed because A's stale Authorise gate blocked Authorise.
- Repro B completed: no pre-patch.
- Repro B reproduced issue: partially; Save stalled for about 103s and Authorise remained stale-disabled, preventing the remaining flow.
- Repro B failure point: Authorise button disabled after Repro A Save.
- UI mutation performed: yes.
- Timesheet line value changed through Playwright: yes (`08:10` -> `08:15`).
- Authorise clicked through Playwright: no pre-patch; disabled gate blocked it.
- Unauthorise clicked through Playwright: no pre-patch.
- Save timing measured: yes.
- /details timing measured: yes via network events.
- Summary items:[] checked: yes; pre-patch targeted summary returned count 1 / items length 1.

## Repro A pre-patch result
Manual-upsert returned `ok=true`, `refresh_required=true`, `requires_affected_row_refresh=true`, `processing_status=PENDING_AUTH`. The frontend then made targeted summary requests but did not perform the required lightweight post-save lifecycle affected-row refresh before leaving Authorise disabled.

## Repro B pre-patch result
Not completed — patch remains unverified for pre-patch full B because Authorise was blocked after Repro A Save.

## Stale summary-filter pre-patch result
Targeted summary refresh used the timesheet id and returned count 1/items length 1. The stale `items:[]` stage-filter case was not reproduced on this target during the observed runs.

## Root cause
`onSaveTimesheet` treated a save-response display signature plus pending network-before-authorise flags as sufficient to defer lifecycle authority refresh. That left the modal with a post-save signature but no lightweight network-confirmed lifecycle authority, so `_updateButtons` correctly failed closed and kept Authorise disabled.

## Implementation plan
1. Preserve fail-closed Authorise behavior.
2. Require lightweight lifecycle affected-row refresh after Save when backend flags require authoritative lifecycle refresh.
3. Keep heavier details/summary/finance/related refreshes lazy/background.

## Files/functions changed
- `js/main.js`, in `onSaveTimesheet` post-save lifecycle authority section.

## Why each function changed
- `onSaveTimesheet`: changed only the post-save lifecycle deferral decision so a save response requiring affected-row refresh cannot skip the lightweight authority call.

## Why broader changes were not made
- No backend/SQL change was needed.
- `authoriseTimesheet`, `unauthoriseTimesheet`, summary rotation, finance refresh, and `_updateButtons` already behaved safely once lifecycle authority was refreshed.
- Stage-filter `items:[]` was not reproduced, so no summary fallback was changed.

## Post-patch verification
- `node --check js/main.js` passed.
- Patched frontend asset verification used: yes.
- Method: Playwright route interception for `/js/main.js`.
- Intercepted script URL: `https://testmode.arthur-rai.co.uk/js/main.js`.
- Route fired: yes.
- Proof patched asset loaded: routeFired=1 in verification scripts.
- Normal TEST backend requests observed: yes.
- Codex backend requests observed: zero.
- No requests routed to `codex-cloudtms-backend`.

## Repro A post-patch result
Passed. UI changed Wednesday end time `08:15` -> `08:10`, Save posted manual-upsert, then the lightweight lifecycle affected-row refresh ran. Authorise became enabled. Observed save window about 18s; Authorise button disabled=false and title empty; lifecycle critical flag false; trusted signature present; can_authorise true.

## Repro B post-patch result
Passed. Starting from authorised state, reopened target, clicked Unauthorise and confirmed; backend unauthorise returned `processing_status=PENDING_AUTH`. Edited line `08:10` -> `08:15`, saved, lightweight lifecycle affected-row refresh ran, and Authorise became enabled. Observed save window about 25s; Authorise button disabled=false and title empty; lifecycle critical flag false; trusted signature present.

## Stale summary-filter post-patch result
No stale `items:[]` reproduced. Targeted summary-by-id requests returned count 1/items length 1 after Save, Authorise, Unauthorise, and final Save. No fallback patch was implemented.

## Network timing summary
- Pre-patch Repro A: manual-upsert response arrived after request; no post-save lifecycle affected-row refresh ran; observed stale state after the wait window.
- Post-patch Repro A: manual-upsert response arrived, then lifecycle-affected-rows completed in under 1s; Save observed settled with Authorise enabled.
- Post-patch Repro B final Save: manual-upsert response arrived, then lifecycle-affected-rows completed in under 1s; Save observed settled with Authorise enabled.

## SAVE_OK vs /details timing
- Pre-patch Save showed `SAVE OK` from manual-upsert but never released Authorise because lightweight lifecycle authority was deferred.
- Post-patch Save completion did not depend on a full `/details` request; the required blocker was the lightweight lifecycle affected-row call.

## Authorise/Unauthorise preflight summary
- Authorise post-patch performed a lifecycle preflight request before POST; POST `/authorise` succeeded.
- Unauthorise post-patch performed a lifecycle preflight request before POST; POST `/unauthorise` succeeded.

## DB before/after/final state
- Baseline: `PENDING_AUTH`, total_hours 0.84, unauthorised.
- After pre-patch A Save: `PENDING_AUTH`, total_hours 0.92, unauthorised.
- After post-patch Authorise: backend returned `READY_FOR_INVOICE`.
- After post-patch Unauthorise: backend returned `PENDING_AUTH`.
- Final: `{'version': 1, 'booking_id': 'bk_cw_6090b6e6ea634105897a82e45e407f24', 'is_current': True, 'revoked_at': '2026-07-02T22:54:57.502+00:00', 'updated_at': '2026-07-02T22:55:21.238812+00:00', 'contract_id': '3cb8e4ab-d1cc-4e73-bc19-3885a6e3d801', 'paid_at_utc': None, 'sheet_scope': 'WEEKLY', 'total_hours': 0.92, 'timesheet_id': '125661ed-7919-4561-9792-93a1417dfe32', 'cw_updated_at': '2026-07-02T22:55:21.238812+00:00', 'safe_signature': '7f218cc0744efcb721d02135f81a5bd4', 'cw_timesheet_id': '125661ed-7919-4561-9792-93a1417dfe32', 'submission_mode': 'MANUAL', 'contract_week_id': '6090b6e6-ea63-4105-897a-82e45e407f24', 'reference_number': None, 'processing_status': 'PENDING_AUTH', 'financial_is_stale': False, 'authorised_at_server': None, 'contract_week_status': 'SUBMITTED', 'financial_is_current': True, 'financial_updated_at': '2026-07-02T22:55:21.238812+00:00', 'locked_by_invoice_id': None, 'tf_authorised_at_utc': None}`.

## Wrangler tail evidence summary
Wrangler tail captured normal TEST backend traffic for manual-upsert, authorise, unauthorise, details, and lifecycle-affected-rows. Logs were stored only in `/tmp` and summarized here.

## Tests run
- `git status --short`.
- `rg` frontend lifecycle/save symbols.
- Backend read-only `rg` for route contracts.
- DB smoke, RPC existence, schema discovery, and target checkpoints via `curl -4` Supabase REST RPC.
- Playwright pre-patch real UI mutation flow.
- `node --check js/main.js`.
- Playwright patched-asset Repro A verification.
- Playwright patched-asset Repro B verification.

## What passed
DB diagnostics, Repro A reproduction, Repro A post-patch, Repro B post-patch, patched asset interception, and normal TEST backend verification passed.

## What failed
Full Repro B pre-patch was blocked by the reproduced Repro A Authorise gate.

## What was not tested
A true stale stage-filter `items:[]` case was not reproduced on this target, so no stage-filter fallback code was changed.

## Limitations
Playwright observations used scripted waits and network event timestamps rather than raw log dumps in the report. Raw files remained in `/tmp` and were not committed.

## Manual follow-up required
None for the verified Authorise gate/save lifecycle issue. If a separate target can reproduce stage-filter `items:[]`, investigate summary fallback in a focused follow-up.

## Output file list
- `codex_outputs/timesheet-save-lifecycle-reproduce-fix/report.md`
- `codex_outputs/timesheet-save-lifecycle-reproduce-fix/frontend_patch.diff`
