# Current read-only evidence used to prepare this pack

## Audit date and safety

- Date: 28 August 2026 (Europe/London).
- Read-only repository inspection/fetch and read-only Miget inspection only.
- No application code, database object, row, deployment, feature flag or TEST data changed.
- No LIVE database/resource was accessed.

## Repository observations

| Repository/ref | Observed remote commit | Observation |
| --- | --- | --- |
| `TEST-Frontend origin/main` | `b66b2a61d3d266ef4e9a3d410061274ca74a7a8e` | Latest fetched head during audit; later implementation must re-fetch. |
| `cloudtms-backend origin/test` | `a965f4461257abc58625824f87b1b9e2aace0327` | Latest fetched head during audit; later implementation must re-fetch. |

Current local clones contain unrelated user changes and diverge from remote. They must be preserved. The implementation plan requires clean isolated worktrees from the then-current approved heads.

Recent repository changes inspected since the earlier planning audit were unrelated Candidate/Timesheet work and did not implement or replace this Banking Pay candidate redesign.

## Controlling source hashes at pack creation

| Source | Lines | SHA-256 |
| --- | ---: | --- |
| Root `AGENTS.md` | 663 | `87848FC901D2389C16700BDF7D67F61CDFC154E88D84009520A66C41F7D8302C` |
| Frontend `AGENTS.md` | 426 | `1DEEC9F472525E5F5B6ECF125C8A52644F92F1C3F0DE8CD3557C08D394AC847D` |
| Backend `AGENTS.md` | 466 | `FC6ED9457214FFF7110DD8131848C1EC12024551C91E03D189C286F25CF5A3FC` |
| Existing `BANKING_PAY_BIBLE.md` | 538 | `66546FC546519A38BB485496FBC77AE16071E5D099FD2F436BD172129BA7D218` |
| Canonical functionality/message audit | 670 | `AFD124655E4020FA061209E23914BB25D853F05BB6546DFB9DAA718F76206D6F` |
| Controlling candidate redesign plan | 1,344 | `2E576905373CEEAD0683684AE589D0FFD8F03040840424808D3D4C3D44838B90` |

These are provenance observations, not permanent implementation pins. Current files/heads/installed definitions must be re-proved at Phase 0.

## Canonical ledger counts mechanically verified

- 136 unique `BP-*` IDs.
- 89 unique `MSG-*` IDs.
- 30 unique visible main pre-Draft `banking:pay:*` actions.

The earlier heading that said 29 actions was a counting error; its table and current frontend both contain 30. This pack uses 30 everywhere.

## Current Miget TEST observations

The permanent CloudTMS Miget Operations route returned authenticated/read-only current state for:

- `agency_test` — healthy PostgreSQL 17.11;
- `mytms_test` — healthy;
- no credentials;
- no LIVE call.

Agency TEST observations included:

- 1,332 non-system functions;
- 229 relations;
- 269 triggers;
- 183 policies;
- release ledger: 201 migrations and 406 repeatables at the time of inspection;
- newest releases unrelated to this redesign.

## Current installed Workbench authorities inspected

Exact current signatures/definitions or catalogue metadata were re-read for:

- `pay_workbench_filters_sanitise_v1`
- `pay_workbench_session_canonical_signature_v1`
- `pay_workbench_session_open_shared_v2`
- `pay_workbench_session_get_progress_light`
- `pay_workbench_session_get_preview_page`
- `pay_workbench_session_get_candidate_preview`
- `private.pay_workbench_preview_effective_section_v1`
- `pay_workbench_preview_line_contract_ok`
- `pay_workbench_session_set_selected_rows`
- `pay_workbench_revalidate_zero_retained_recovery_headroom_v1`
- `pay_workbench_session_apply_case_resolution`
- `pay_workbench_session_clear_case_resolution`
- `pay_workbench_session_apply_decision_operations`
- `pay_workbench_session_set_timesheet_exclusion`
- `pay_workbench_session_clear_all_decisions`
- `pay_workbench_session_discard`
- `pay_workbench_session_refresh_current_authority_v1`
- `pay_workbench_prepare_draft`
- `pay_workbench_enqueue_payee_readiness_ensure`
- `pay_workbench_contract_version_get_v1`
- `_pay_workbench_candidate_projection_contract`

Findings:

- Database remains financial/effective-section/selection/recovery authority.
- Current candidate preview is not a safe Ready-only page because it returns mixed effective sections.
- Current global all-page Ready selection exists.
- Atomic candidate-wide all-page selection does not exist.
- The planned candidate summary, Ready-only candidate page, Action/Updating task view, passive Blocked view and candidate-wide selection contracts do not currently exist.
- Current preview page publishes current amount normalization and `is_recognised_finance_deduction` facts that must be reused/factored rather than replaced with a new equation.

## Current frontend facts rechecked

- Main renderer currently exposes the corrected 30 action names recorded in the action ledger.
- Current main Ready amount is a loaded/displayed-line calculation and is not the required selected full-session headline.
- Current exact Timesheet navigation can consume explicit UUIDs and keep Banking Pay open.
- Existing filter modal exposes ALL/PAYE/Umbrella, canonical Candidate and canonical Client; pay date/week cutoff remain Workbench authority.
- Current v2 candidate table/search/modal design is not present.

## Evidence limitation and response

This pack does not claim implementation-time hashes or performance samples in advance. Phase 0 and the performance baseline protocol require fresh evidence at the exact implementation heads and deployment.

That is not an unresolved product decision and must never be used to alter the settled contract.

## Implementation execution refresh — 28 August 2026

This section is the first live amendment to the working Bible after the user authorised full TEST-only implementation, testing, push and deployment. It records evidence only; it does not weaken or replace any settled product requirement.

### Current source authority and dirty-work preservation

- Fresh fetch resolved frontend `origin/main` to `b66b2a61d3d266ef4e9a3d410061274ca74a7a8e`.
- Fresh fetch resolved backend `origin/test` to `cdf8c8b729bfec3c8dc1fc9d3d3b857ec8ef99d6`.
- The original frontend clone had unrelated uncommitted Timesheet withdrawal-history work and was behind the remote head.
- The original backend clone had unrelated uncommitted Office/Candidate/database-release work and a substantially divergent local history.
- Neither original clone was reset, stashed, restored, overwritten or used as the implementation worktree.
- Clean isolated worktrees were created from the exact remote heads at `.codex-worktrees/banking-pay-frontend-20260828` and `.codex-worktrees/banking-pay-backend-20260828`.
- The backend advance from the pack observation to `cdf8c8b7` is an unrelated unified-Outbox recipient-name repeatable. No Banking Pay v2 capability appeared in the refreshed catalogue.

### Current instruction and controlling-source hashes

| Source | Lines | Current SHA-256 | Result against pack provenance |
| --- | ---: | --- | --- |
| Root `AGENTS.md` | 663 | `87848FC901D2389C16700BDF7D67F61CDFC154E88D84009520A66C41F7D8302C` | Exact match. |
| Frontend `AGENTS.md` | 426 | `12D2DB00E94FAE90C4A324F7AAFAA532349F24F7D2938B6FD3076CBF510A24FD` | Text comparison found no semantic diff; saved line endings differ from the snapshot bytes. |
| Backend `AGENTS.md` | 491 | `BE3D2C8770AE67B4C24124544426F9F186B80B3DCB713FC3287B1659A55D3201` | Newer rules add PostgREST schema-cache proof, protected TEST UPGRADE standing authority, stricter SQL first-use/contract/security gates and unrelated Candidate boundaries. These strengthen this implementation and are controlling. |
| Existing `BANKING_PAY_BIBLE.md` | 538 | `66546FC546519A38BB485496FBC77AE16071E5D099FD2F436BD172129BA7D218` | Exact match. |
| Candidate redesign plan | 1,344 | `2E576905373CEEAD0683684AE589D0FFD8F03040840424808D3D4C3D44838B90` | Exact match. |
| Canonical audit | 670 | `AFD124655E4020FA061209E23914BB25D853F05BB6546DFB9DAA718F76206D6F` | Exact match. |

### Fresh Miget TEST preflight

- All nine required `CloudTMS Miget Operations` tools were visible in the implementation task.
- The parity route returned `accepted=true`, `authenticated=true`, no credentials and no secrets.
- `agency_test` and `mytms_test` were both re-proved healthy; no LIVE database inspection call was made.
- Fresh `agency_test` catalogue: PostgreSQL 17.11, 1,332 non-system functions, 229 relations, 269 triggers, 183 policies and five extensions.
- Fresh release ledger: 201 migrations and 407 repeatables. The newest repeatable was the unrelated unified-Outbox recipient display-name authority from backend `cdf8c8b7`.
- Performance snapshot: eight sessions, no lock waiters, no ungranted locks, zero oldest-transaction age and 99.99% cache hit. `pg_stat_statements` was not installed, so query-plan proof must use the repository-approved bounded diagnostic/rollback routes rather than pretending aggregate statement evidence exists.
- All eight planned public v2 RPC names were searched exactly and each returned zero matches.
- `npm run db:check` passed at the refreshed backend head with 201 migrations and 407 repeatables before any database source edit.

### Phase 0 status

`IN_PROGRESS`. The source/dirty-work/Miget/name-conflict gates above pass. Exact installed definitions, current frontend/backend action and route ownership, amount projection ownership, filter/Draft semantics, characterization tests and performance baseline remain mandatory before implementation code starts.

### Installed-definition and repository-contract parity

The exact installed `agency_test` definitions were retrieved through the permanent read-only Miget route. Connector line endings were normalised before hashing. Every installed definition below matched the canonical hash in the refreshed backend `supabase/release/current-contract.json`:

- filters, signature, shared-session open and progress-light owners;
- preview-page and candidate-preview readers;
- private effective-section classifier and public line-contract validator;
- selected-row mutation and zero-retained recovery revalidator;
- apply/clear case resolution, decision operations, Timesheet exclusion and clear-all-decisions owners;
- discard, refresh-current-authority and prepare-Draft owners;
- payee-readiness enqueue, contract-version and candidate-projection contracts.

Current ownership, search paths, security mode and ACLs also matched the repository contract. Public Workbench service RPCs remain executable only by `service_role` and `postgres`; the private effective-section helper remains private to `postgres`. No installed/runtime drift was found in the financial, effective-section, selection, recovery or Draft owners this redesign must preserve.

### Current Workbench storage facts

- `banking_pay_workbench_preview_rows` is the bounded current projection store. It owns candidate/session/revision identity, effective section, selected/selection state, current status, economic key, Timesheet identity, ordinal and canonical `row_json`.
- Existing indexes support current session/section and session/candidate reads, including Ready candidate and Ready page access. The redesign may add an index only if a proved set-wise query plan requires it.
- `banking_pay_workbench_sessions` owns the current filters, selected-row count, selected-row identifiers, section counts, progress/version/generation authority and full Workbench scope.
- `banking_pay_workbench_session_overrides` and selection-carry registrations preserve explicit user choices across rebuilds. Candidate-wide selection must use the existing selection authority and must not bypass these stores.

### Read-only browser baseline

The signed-in normal TEST frontend was observed without creating a Draft or executing a payment/provider action.

- Current main Ready has nine columns: selection, line type, Candidate, Client, Week/Date, Channel, Amount, State and Action.
- Cases / Resolutions and Blocked are currently rendered in the same main surface, confirming the decluttering need and the exact functionality that must be moved rather than deleted.
- Five open-to-first-useful-render observations were approximately 3.576 s, 3.648 s, 3.787 s, 6.154 s and 6.265 s. Median was 3.787 s; the slowest observation was 6.265 s.
- The current session alternated between a smaller and fuller rendered graph while displaying the existing safe refresh failure. The performance figures are therefore an honest UI baseline, not a claim that the current financial authority was healthy during every sample.
- The failure remained visible and no Draft was created. The redesign must preserve that fail-closed behaviour and must not convert a failed refresh into an empty or apparently valid view.
- Browser evidence included no new Banking Pay selection mutation. Exact TEST fixture identity and restoration proof remain required before the first financial-state mutation test.

### Pre-edit characterization suites

- Frontend Banking Pay source/unit/static suite: 298 tests passed, zero failed, zero skipped.
- Backend Banking Pay source suite: 752 tests discovered; 734 passed, 17 were intentionally skipped and one failed at the untouched refreshed head.
- The pre-existing backend failure is `banking-pay-legacy-monolith-authority-reassert.test.cjs`. Its expected replay list includes an unrelated Candidate weekly-manager repeatable whose current source does not match the test's monolith-detection predicate. No Banking Pay v2 source existed when this baseline was taken.
- That baseline failure was recorded, not hidden and not attributed to this redesign. It was subsequently closed by restoring the exact current replay authority; no expected contract was weakened.

## Final deployed evidence addendum — 29 August 2026

The earlier sections are the pre-implementation baseline and remain deliberately preserved. The final current TEST observations are:

- Main Ready presentation is exactly `Include | Candidate | Deductions | Ready to pay`, one physical non-wrapping line per candidate and 100 candidates per page.
- Candidate, Deductions and Ready to pay are the only sortable headers; sorting is server-owned over the complete filtered result before pagination.
- There is no main search, row expansion, View button or action column.
- The selected-only Timesheets shortcut updated the existing Timesheets Summary with exactly one selected Timesheet in the exercised fixture. When the candidate was unselected, the shortcut became disabled and no unticked Timesheet was included.
- Candidate Banking opened from the main row and retained the complete Ready-only existing line controls and breakdown. Action Required, Updating and Blocked remained separate owners.
- Action Required displayed the approved plain-language payment-method change: `Payment was originally PAYE. Candidate is now paid through an umbrella company.` The old `PAYE > UMBR` shorthand and old sentence were absent. The reverse wording is implemented and tested.
- Blocked for Pay displayed only genuine current blockers. All four observed rows used `Insufficient funds to deduct`; no recovery-headroom jargon or indefinite snooze appeared. Indefinite snoozes remain in Snoozes only.
- Real candidate CLEAR changed the candidate and headline from £450.00 / one included candidate to £0.00 / zero included candidates, disabled the selected-only Timesheets shortcut and kept Deductions truthful. SELECT restored the exact starting authority. The final readback was ALL selected, £450.00, one included candidate, Deductions `—`, Timesheets enabled.
- The live table row and each of its four cells measured 40 px high with 5 px vertical cell padding after the compact-row fix.
- Two historical unresolved `DEAD` refresh failures remain visible and keep Create Draft fail-closed. They were not drained or hidden. This is correct current-data behaviour, not a v2 empty state.

No real Create Draft was clicked. Its safety proof is the unchanged handler/Worker/database owner, the compatibility suites and the real disabled/fail-closed state described in `23_CREATE_DRAFT_COMPATIBILITY_CONTRACT.md`.
