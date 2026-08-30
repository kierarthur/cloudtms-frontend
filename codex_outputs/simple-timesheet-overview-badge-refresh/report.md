# Simple timesheet modal overview badge refresh report

## Static/runtime limitation statement

No backend code change or backend deploy was needed. I did not run Wrangler tail because the normal TEST backend lifecycle response was visible through the UI action completing and DB read-only checks were sufficient. I did not commit raw DB output, raw Playwright scripts, screenshots, or raw backend logs.

## Issue reproduction

The user-supplied bug matched the static code path: `authoriseTimesheet` / `unauthoriseTimesheet` reconciled modal state and refreshed footer buttons, but when the result was considered a critical patch the footer path only called `_updateButtons()` and did not patch the already-rendered Overview Stage row. The Overview Stage badges were created by `renderTimesheetOverviewTab`; tab switching re-ran that renderer, explaining why Lines → Overview corrected the text.

I verified the patched flow with the target simple timesheet modal on Overview using the patched `js/main.js` asset routed into the normal TEST frontend.

## Exact reproduction/verification steps used

1. Opened `https://testmode.arthur-rai.co.uk/?e2e=1&modal=timesheet&timesheetId=e36049f3-21eb-4682-bd64-3706f46066e0`.
2. Logged in using available TEST e2e credentials without printing them.
3. Registered Playwright route interception before navigation for `/js/main.js` and fulfilled it from `/workspace/TEST-Frontend/js/main.js`.
4. Confirmed the target simple timesheet modal was on the Overview tab.
5. Clicked `Authorise` and stayed on Overview.
6. Observed the Stage row update immediately from `Stage UnpaidAwaiting Authorisation` to `Stage UnpaidAuthorised for Payment` without tab switching.
7. Clicked `Unauthorise`, confirmed the UI confirmation, and stayed on Overview.
8. Observed the Stage row update immediately to `Stage Awaiting Authorisation Unpaid` without tab switching.

## Starting/final target timesheet state

Read-only TEST DB diagnostics were run through `public.codex_debug_select_sql` after a `curl -4` smoke test. The target row existed for `timesheet_id = e36049f3-21eb-4682-bd64-3706f46066e0`, `candidate_id = 6fad0e88-ab7f-4760-88fa-a9a0250b1d5e`, `contract_id = 3cb8e4ab-d1cc-4e73-bc19-3885a6e3d801`, and week ending `2026-07-12`. The bounded baseline showed `processing_status = PENDING_AUTH`; timestamp/payment columns were present but values were not printed.

Mutation performed: Authorise, then Unauthorise, through the simple modal UI lifecycle buttons for the single target timesheet only. Final state was restored to `PENDING_AUTH` according to the after-state DB check.

## Root cause

The simple modal Overview Stage row is rendered as static DOM by `renderTimesheetOverviewTab`. Lifecycle actions patched modal state and buttons, but the successful critical-patch footer branch did not refresh the already-rendered Stage badge DOM. A later tab switch re-rendered the Overview content from the now-updated modal state, which made the badge appear correct only after navigation.

A related display condition also suppressed the `Authorised for Payment` badge when the pay state was fully paid. That contradicted the requirement that authorised status must remain visible even when paid/payment badges also show.

## Functions/blocks changed

- `renderTimesheetOverviewTab`: removed the `!isEffectivelyPaid` suppression from the authorised lifecycle badge and changed the tooltip so the Authorised badge can coexist with Paid/payment badges.
- Added `refreshSimpleTimesheetOverviewLifecycleBadgesIfVisible`: a small display-only helper that patches only the Overview Stage row lifecycle pill when the active simple timesheet modal is on Overview.
- Timesheet footer Authorise/Unauthorise handlers inside `_updateButtons`: after each successful lifecycle call, they invoke the helper before deciding whether any broader fallback refresh is required.
- Existing `patchOpenTimesheetOverviewLifecycleStageBadge`: aligned the Authorised tooltip with the display-only paid-safe wording.

## Functions inspected requiring zero changes

- `authoriseTimesheet`: lifecycle RPC flow/signature and reconciliation were left unchanged.
- `unauthoriseTimesheet`: lifecycle RPC flow/signature and reconciliation were left unchanged.
- `applyTimesheetLifecyclePatchToModal`: already updates modal data/state surfaces; no change needed.
- `ensureTsRefreshAndRepaintOverview`: fallback broader refresh path left unchanged.
- `fetchTimesheetRelated`: no change needed.
- `openTimesheet`: modal structure and tab renderer registration left unchanged.

## Files/functions not inspected

I did not inspect or modify bulk process modal internals, bulk authorise modal internals, Banking Pay payment economics, backend lifecycle RPC source, DB schema definitions beyond read-only column verification, or SQL functions. They were outside this targeted display-refresh scope.

## Implementation plan executed

1. Locate the simple timesheet Overview renderer and Stage badge logic.
2. Locate the footer Authorise/Unauthorise completion path.
3. Add a minimal helper that checks active modal/entity/tab, finds only the Stage row controls, recomputes authorised/awaiting state from already-reconciled modal surfaces, and updates/removes only lifecycle pills.
4. Call the helper immediately after successful Authorise/Unauthorise UI lifecycle actions, after modal state has been patched by the existing lifecycle functions.
5. Remove the paid-state suppression from the Authorised badge in the Overview renderer.
6. Verify syntax, patched asset loading, immediate badge update, no tab switch requirement, and no full modal body replacement.

## Why the fix is minimal

The fix does not change lifecycle authority, RPC names, request payloads, modal architecture, tab registration, button permissions, payment economics, or backend code. It only patches the existing Overview Stage row lifecycle pill after the existing successful state reconciliation path.

## Browser verification using patched frontend asset

Patched asset proof:

- Route interception for `/js/main.js` fired once.
- Intercepted URL: `https://testmode.arthur-rai.co.uk/js/main.js`.
- Fulfilled from `/workspace/TEST-Frontend/js/main.js`.
- Patched file SHA-256 during verification: `10f89df9636c3334617539b3253b290e5c1763cb61d32d9ce76c3d897dae901b`.
- Runtime helper proof: `window.__refreshSimpleTimesheetOverviewLifecycleBadgesIfVisible` existed.

Immediate badge evidence:

- Before Authorise: `Stage UnpaidAwaiting Authorisation`.
- After Authorise, still on Overview: `Stage UnpaidAuthorised for Payment`.
- After Unauthorise, still on Overview: `Stage Awaiting Authorisation Unpaid`.

Switching tabs is no longer needed: both action checks completed while `currentTabKey` remained `overview`.

No flicker/full modal reset evidence:

- The active tab remained `overview` after both actions.
- A DOM-state proof showed the same `#modalBody` element was retained across the lifecycle badge patch.
- A static DOM proof also showed modal width/height delta `0` while patching the badge helper directly.

Paid authorised badge evidence:

- Static DOM-state proof set the modal state to authorised plus paid and invoked the patched helper while on Overview. The Stage row became `Stage Authorised for Payment Loading timesheet state…`, proving the authorised badge is not suppressed by paid state.
- The renderer condition was also changed so full re-rendered Overview content includes the authorised badge even when `effectivePaidStatus === 'PAID'`.

## DB diagnostic summary

- `curl -4` smoke RPC passed with HTTP 200.
- Schema preflight query ran against `information_schema.columns` for `timesheets`, `timesheets_financials`, and `contract_weeks`.
- Target baseline and after-state checks were bounded to the single target timesheet id.
- Final after-state remained `processing_status = PENDING_AUTH`.
- No keys, headers, raw sensitive rows, or full payloads were printed/committed.

## Wrangler tail summary

Wrangler tail was not used. No backend confirmation beyond normal UI completion and read-only DB checks was required.

## Safety confirmation

- Secrets printed: no.
- Destructive SQL/RPC/actions: no.
- TEST deploy: no.
- PROD deploy: no.
- Backend changed: no.
- Backend `wrangler.toml` modified: no.
- Policy X drift: no; payment/economic logic was not changed.
- Raw DB outputs committed: no.
- Raw tail files committed: no.
- Cloudflare Codex Worker deployed: no.
- Playwright routed backend requests to Codex backend: no; normal TEST backend was used as requested.
- Requests escaped to normal TEST backend: normal TEST backend was intentionally used; no Codex backend routing was configured.
