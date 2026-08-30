# Timesheet Unauthorise stale-modal patched-frontend verification report

## Summary
- Tested the patched local `js/main.js` without deployment by routing only `**/js/main.js*` from `https://testmode.arthur-rai.co.uk` to `/workspace/TEST-Frontend/js/main.js`.
- All API calls observed in the Playwright sessions used the normal TEST backend `https://test-cloudtms-backend.kier-88a.workers.dev`; no Codex backend Worker route was used.
- `node --check js/main.js` passed.
- `git diff --check` passed after the whitespace/line-ending cleanup in the working diff.
- The fix is **not fully proven** because the exact full second-cycle UI-button regression did not pass end-to-end.
- The first UI-button Unauthorise path did pass the key frontend assertions: it emitted the POST, sent all row-signature fields, received HTTP 200, and patched the open modal to unauthorised `PENDING_AUTH` with the backend unauthorised signature across `modalCtx.data`, `timesheetDetails.timesheet`, `timesheetDetails.tsfin`, and trusted lifecycle state.
- The full cycle did not complete because later TEST backend/runtime instability interrupted the second-cycle proof: one second Unauthorise returned HTTP 500 (`RPC timesheet_unauthorise_atomic failed 408: timeout after 12000ms`), and a later TSFIN expenses PATCH timed out from Playwright even though a final details read showed the 9.04/9.04 expenses save did persist.

## Git state
- Branch: `work`.
- Starting patched commit requested by the handover (`905486f`) was not present in this local history; the equivalent current branch commit was `f34b697 frontend: improve unauthoriseTimesheet to send signatures, preflight-refresh, and apply normalized lifecycle patches`.
- Additional frontend-only changes were made after testing showed stale lifecycle titles/datasets could still be reintroduced by footer re-rendering.
- Working tree was dirty after those frontend-only changes until committed.

## Frontend load proof
- Playwright route fulfilled `https://testmode.arthur-rai.co.uk/js/main.js` from `/workspace/TEST-Frontend/js/main.js`.
- The route fulfillment flag was true in `/tmp/prove_unauth_fix_result.json`.
- `badBackendRoutes` was empty in the captured result, confirming no API request was routed away from the normal TEST backend.

## Code changes made in this verification pass
- `clearLifecycleBusyArtifacts` now also removes `aria-disabled`, `data-disabled`, `disabled` CSS class, grayscale/opacity styles, and stale titles containing `Waiting for trusted lifecycle state` or lifecycle-update text.
- `clearLifecycleBusyArtifacts` is exposed as `window.__clearTimesheetLifecycleBusyArtifacts` so the Unauthorise footer click handler can clear stale artifacts after its post-result button re-render.
- The Unauthorise footer click handler now calls that cleanup helper immediately after `fr._updateButtons()` when `unauthoriseTimesheet` reports a complete critical patch.
- Footer lifecycle blocking now treats a trusted current lifecycle signature as sufficient to suppress stale `__timesheetLifecycleCriticalStateIncomplete` blocking; it resolves the trusted timesheet id from the footer state or modal data.

## First Unauthorise request proof
- URL: `POST /api/timesheets/125661ed-7919-4561-9792-93a1417dfe32/unauthorise`.
- Payload included all required signature fields:
  - `expected_row_signature`
  - `backend_row_signature`
  - `mutation_row_signature`
  - `row_signature`
- Example passing first-cycle request signature: `339dd1df6740376a4fb3a73961dbef3f`.
- Response status: HTTP `200`.
- Response unauthorised signature: `b93a670f836c02174391d30755cf7c48`.

## Modal state proof after first Unauthorise
- `modalCtx.data.processing_status`: `PENDING_AUTH`.
- `modalCtx.data.is_authorised`: `false`.
- `modalCtx.data.row_signature`: `b93a670f836c02174391d30755cf7c48`.
- `timesheetDetails.timesheet.processing_status`: `PENDING_AUTH`.
- `timesheetDetails.timesheet.row_signature`: `b93a670f836c02174391d30755cf7c48`.
- `timesheetDetails.tsfin.row_signature`: `b93a670f836c02174391d30755cf7c48`.
- `__timesheetLifecycleTrusted.signature`: `b93a670f836c02174391d30755cf7c48`.
- Expenses became editable after entering Edit; the script changed Travel pay/charge to `9.03 / 9.03` in editable inputs.

## Save and Authorise proof in the completed first cycle segment
- TSFIN expenses PATCH request changed Travel pay/charge to `9.03 / 9.03` and returned HTTP `200`.
- Save response signature: `3d7bd1df3c4b8a8eda0baa17933a181f`.
- Authorise request used the post-save signature `3d7bd1df3c4b8a8eda0baa17933a181f` in all four row-signature request fields.
- Authorise response status: HTTP `200`.
- Authorise response signature: `ed47e20286a11aa8bc177e98e3917404`.

## Second Unauthorise proof status
- The second UI-button Unauthorise request was emitted and used the current authorised signature `ed47e20286a11aa8bc177e98e3917404` in all four row-signature request fields.
- The normal TEST backend returned HTTP `500` with: `RPC timesheet_unauthorise_atomic failed 408: timeout after 12000ms`.
- Because the backend did not return HTTP 200 for that second Unauthorise, the full pass criteria are not met and the fix is not proven end-to-end.

## Later retry status
- A later run again proved first UI-button Unauthorise emitted a signed request and received HTTP `200` with response signature `a544605ac276a5b3c39ab7a5e722a3cc`.
- The subsequent TSFIN PATCH to `9.04 / 9.04` emitted, but Playwright timed out waiting for the response.
- A final read-only details call showed the row in `PENDING_AUTH` and Travel pay/charge persisted as `9.04 / 9.04`, so the TEST backend appears to have completed the save after the Playwright-side timeout.

## Final TEST row state observed
- Final read-only details response status: HTTP `200`.
- Summary stage observed: `PENDING_AUTH`.
- Travel pay/charge observed: `9.04 / 9.04`.
- No cleanup/restoration was attempted.

## Safety confirmations
- Frontend-only changes were made.
- No backend source was changed.
- No SQL/RPC/database schema changes were made.
- No TSFIN save logic changes were made.
- No Banking Pay / Policy X logic was changed.
- No payment, invoice issue, settlement, remittance, provider, webhook replay, migration, background drain, email/comms drain, production endpoint, production Supabase, production Cloudflare, deployment, merge, or manual PR action was used.
- No secrets, cookies, bearer tokens, Supabase keys, Cloudflare tokens, DB URLs, passwords, `.dev.vars`, or auth headers were printed into this report.
