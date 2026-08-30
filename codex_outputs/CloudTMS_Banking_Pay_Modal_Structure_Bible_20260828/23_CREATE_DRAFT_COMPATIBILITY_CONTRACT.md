# Create Draft — unchanged handoff and release-blocking proof

## 1. Controlling requirement

The user's 28 August instruction makes this an explicit activation/release gate: the simplified Banking Pay screen must supply the same existing Create Draft contract. A correct-looking headline is not enough. The redesign must not make the Draft service accept a different contract to compensate for incomplete candidate-page data.

The compact candidate list is a presentation of existing selected payments. Candidate IDs, candidate amounts, Timesheet counts and the current page are never substitutes for payment-row IDs, row contracts or the complete selected set.

The implementation is still incomplete. This document records proven component/database compatibility and the remaining integration tests. It is not permission to activate v2 or evidence that a real Draft was created.

## 2. Existing ownership chain — preserve it

| Boundary | Existing owner | Required preservation |
| --- | --- | --- |
| User click | `banking:pay:createDraft` delegated handler in frontend `js/main.js` | Current action gate; synchronous busy/double-submission lock; date and decisions; matching-key cleanup. |
| Frontend preparation | `bankingPayCreateDraft` | Current context/signature/filter/page/readiness/security checks and error/operation handling. |
| Exact selected-payment reread | `refreshCurrentSelectedPreviewRowsForCreateDraft` inside that owner | Read all pages of both physical `canonical_preview_lines` and `blocked_for_pay`; include only existing Draft-eligible effective Ready rows. |
| Request construction | Existing selected-row/economic-key builders and `applyDraftSubsetForScope` | Global reviewed IDs and separately scoped Draft IDs/contracts/keys; no candidate aggregate substitution. |
| HTTP boundary | `POST /api/banking/pay/batch/create-draft` | Existing preflight and submission request/response contract, authorization and same-week PAYE safeguards. No v2 replacement endpoint. |
| Worker validation | `handleBankingPayCreateDraft` | Independent selected-row reread, exact global-set comparison, current filters, contracts and readiness. |
| Operation input | `buildDraftCreateOperationInputFromSessionSelection` | Exact reviewed IDs/revision, actor, scoped contracts, source signature and snapshot. |
| Final database lock | `public.pay_workbench_prepare_draft` | Current operation/session locks, exact selected-set/revision validation, current effective section and all later checks. |
| Frozen scope | `pay_workbench_prepare_draft_scope_seed` and current downstream owners | Existing frozen artefacts only after Draft; no live fallback or changed economic key. |

The full existing frontend and Worker Draft owners are source-hash guarded. No implementation change has been made to either owner.

## 3. Fields and meanings that must not change

| Field family | Meaning |
| --- | --- |
| `session_id`, `session_version`, `session_signature` | The current existing Workbench context, not a candidate/modal identity. |
| `expected_progress_counter_version`, `progress_counter_version` | Accepted selection/review revision; must not be advanced silently to accept an unreviewed change. |
| `pay_date`, `week_ending_cutoff_date` | Existing date/cutoff semantics and validation. |
| `candidate_filter_id`, `client_filter_id`, pay-channel aliases | Existing session/filter semantics. Main sorting, paging, and Action/Blocked list search never become Draft filters. |
| `selected_preview_row_ids` | Complete globally reviewed selected physical payment-row IDs. Not the currently displayed candidate page or the selected Timesheet IDs. |
| `draft_selected_preview_row_ids`, `scoped_selected_preview_row_ids` | The existing subset for the selected PAYE/Umbrella/Candidate/Client scope. Filtering this subset must not unselect another channel. |
| Selected/scoped/Draft `*_preview_row_contracts` | Existing row identity, effective section, candidate/client/Timesheet, economic key, channel, signed amount and readiness fields. |
| Selected/scoped/Draft `*_economic_keys` | Existing aligned key records; `TS_DAY` stays a `YYYY-MM-DD` date. No candidate-level key or new derivation ladder. |
| Recovery proof fields | Existing physical section, effective section, overlay version/digest and signed recoverable amount. A physically Blocked deduction that is effectively Ready must not disappear from Draft. |
| `preview_decisions_json` | Existing sanitized allow-list. Display rows, case-state arrays and resolution mutations remain excluded. |
| Same-week PAYE override/proof | Existing reason, explicit confirmation, verified actor/time and password/2FA checks. Not bypassed by a positive v2 display gate. |
| Operation review fields | `expected_workbench_selected_preview_row_ids`, `expected_workbench_progress_counter_version`, `selection_review_contract_version`, reviewed actor and readiness snapshot. |

These are existing meanings, not a new request schema. All current aliases, allowed fields, limits, errors and operation responses remain with the existing owners.

## 4. Bounded candidate display versus complete Draft selection

The old Draft reader already supports a revision-bound review without a complete browser ID array. The new presenter uses that existing contract deliberately:

```
session_id / session_version / progress_counter_version: accepted rendered revision
selected_preview_row_ids: []
selected_set_complete: false
captured_from_rendered_workbench: true
```

The empty array means **the display has not supplied the complete payment list**. It does not mean there are no selected payments. The existing Draft reader then fetches the complete current payment list and verifies the reviewed revision. After successful verification, that existing reader writes the complete IDs and `server_selected_preview_row_ids_provided=true` as it does today.

`js/banking-pay-modal-v2-draft-review.js` builds this immutable review snapshot from a validated summary. It makes no network request, does no financial calculation, sets no readiness flag and creates no Draft request. It is not connected to the main application yet.

Mandatory integration rules:

1. Publish this snapshot in the same synchronous adoption as the new candidate summary and legacy session aliases.
2. Do not leave a previous complete selected-ID array marked `provided=true` after a bounded selection update.
3. Do not stamp candidate IDs, selected Timesheet IDs, or loaded child-row IDs as a complete payment list.
4. Do not use the filtered display `global.selected_ready_count` as the legacy all-channel selected count. Existing complete-session readiness remains separately owned by the current Workbench reader.
5. Preserve the original first-canonical-page requirement. Never invent `first_page_applied=true` from a successful candidate summary. A changed session/version requires the established page/context initialization path.
6. Keep Draft disabled while selection, reconciliation, read-back or required refresh is unsettled. An enabled display gate does not bypass the Draft owner's final checks.
7. If another user/window changes the reviewed revision, keep the existing review-required error and no-operation/no-batch outcome. No automatic resubmission.

## 5. Existing limits remain separate from screen pagination

- The 100-candidate main page and 100-line child page do not limit a Draft to 100 payments.
- The existing frontend reread uses 100-row pages with its existing maximum-page/row guards.
- The existing Worker independently rereads selected physical rows in 1,000-row pages with its existing 50,000-row safety boundary.
- The database preparation function's bounded supplied-ID validation argument is not the full Draft manifest. Keep the existing operation-input/full-set and validation-sample distinction; do not send 105 IDs into an argument capped at 100 merely because the candidate has 105 payments.
- Do not remove these guards to make a large fixture pass. Any separate capacity/performance change requires its own evidence and scope review.

## 6. Fresh current TEST source proof

The permanent Miget Operations connector was freshly rediscovered with all nine tools visible. Its parity call authenticated successfully, and `agency_test` reported the expected healthy service. Read-only definition retrieval returned these exact current owners. Their complete normalized definitions match the disposable local PostgreSQL definitions:

| Function | SHA-256 of LF-normalized `pg_get_functiondef` |
| --- | --- |
| `pay_workbench_prepare_draft` | `5a879bc899cff1b1f08a7da0f4cfc1705ef9d3065697f22a20c9b8609ffedfb3` |
| `pay_workbench_prepare_draft_scope_seed` | `36e242fb406949ffe4112288d34a271bb32c4a5b61cd883c8e3fc7cb2ed2ecf7` |
| `pay_workbench_session_get_preview_page` | `99309bf519fa791b05249f74fc0c3de2079006f9eed64fd3dbf3e6ca25486b48` |

Frontend full Draft function hash: `44769a01d72b56afc4e498a3a2c934f74c3e0971cf9f4975fa7f485543f997ab`.

Worker full Draft owner boundary hash: `fa41380e83f7a6050dbadab046516cb3b8e42e1260896dd1c60e3c347b61ffd8`.

Hashes are evidence observations, not pinned deployment heads. Recheck current source and installed definitions before release. Matching these three functions does not prove that the entire local database has been rebuilt against the latest Rota-inclusive head.

## 7. Executed tests

### Frontend owner comparison

`tests/unit/banking-pay-modal-v2-draft-contract.test.cjs`: 31 tests pass. It executes the unchanged actual Draft reader, row-contract helpers and request-projection block from `js/main.js`, with explicit in-memory transport/adoption seams.

Cases include one/some/105 selected payments, promoted/unticked deductions, PAYE/Umbrella, Candidate/Client filters, expenses/adjustments, no selected scope, missing/stale revision, wrong session/version/section, missing continuation, original first-page gates and sanitized decision payloads. A complete legacy review and an incomplete revision-bound v2 review produce identical payment contracts/request projections.

With the existing shared-selection, recovery, TS_TOTAL and Draft-safety suites, 73 tests pass.

### Real local database selection and unchanged Draft consumers

Backend `tests/28082026_1548_banking_pay_draft_contract_selection.sql` and `tests/banking-pay-modal-v2-draft-contract.test.cjs`: 17 tests pass with both local PostgreSQL and frontend-root opt-ins present; none skipped in the recorded run.

- Two independent rollback runs start from the same synthetic fixture. One replays old individual controls; the other uses the new candidate operation.
- The candidate has 107 positive payments split across PAYE/Umbrella plus two eligible deductions; a second candidate remains selected and unchanged.
- Complete selected counts are 111 after candidate SELECT, 110 after one individual untick, and 2 after candidate CLEAR. The final two belong to the untouched second candidate; CLEAR does not wipe another candidate's selection.
- Both paths produce identical contracts from the **unchanged Worker Draft reader**, for ALL/PAYE/UMBRELLA at every stage.
- Actual current PostgreSQL preview-page payloads, across three physical pages, pass the **unchanged frontend Draft reader** and produce identical request projections.
- The real locked database Draft selection guard is called. An uncommitted synthetic refresh blocker immediately after that guard prevents further preparation: exact selection reaches the expected refresh blocker; omitted payment, candidate ID substitution, duplicate ID and stale revision stop at the existing selection-review guard instead.
- All 30 lock-guard checks pass: five variants, three selection stages, two old/new flows. No batch or batch item is created. Synthetic operations/jobs are rolled back inside each call; the entire fixture is rolled back afterward.

The first cross-boundary run exposed a fixture error: a JSON-only Timesheet UUID was overwritten by the original reader's null physical foreign key. The fixture now creates rollback-only synthetic Timesheets and populates the physical FK. No application guard was weakened to make it pass.

## 8. Still required before activation/release

These are open gates, not waived by the tests above:

- Connect the review snapshot and all relevant legacy aliases to the actual single adoption controller; prove they represent the same accepted revision.
- Connect the actual existing Create Draft button once, preserving synchronous busy state, permissions, same-week PAYE, password/2FA, preflight, operation polling and error cleanup.
- Intercept the actual browser submission in an isolated fixture and compare complete preflight/final request bodies with the legacy path, including date, signature, revision and override fields. No real hosted Draft should be created merely for this comparison.
- Exercise Candidate SELECT/CLEAR, individual and grouped selection, all-pages header selection, each moved resolution/bank/snooze action, manual refresh, filter changes and progress adoption before the same Draft handoff.
- Test same-count/different-payment changes, another window changing the selection during creation, transport uncertainty, modal closure/reopen and failed reconciliation; no double submission or stale retry.
- Extend full economic/frozen-overlap fixtures and prove the existing downstream frozen-scope contracts unchanged. The current synthetic lock proof stops intentionally before preparation; it is not full Draft execution proof.
- Measure the complete open-modal and Create Draft path. Moving to small display pages does not justify claiming the existing complete-selection reread became faster.
- Complete current-head clean database replay, complete release/security/contract tests, protected TEST installation, API-path proof and deployed-asset browser tests.

## 9. Additional display safety check found during integration (STEP-060)

The original screen requires TWO existing readiness authorities: the recomputed session/candidate/line/job counters and the continuous-scope `draft_safe` result. The initial unpublished v2 display helper included only the first. The final Draft owners remained unchanged and v2 remained disabled; no Draft or hosted change resulted.

The adapter must call both original read-only owners and retain their blockers before an enabled button is possible. The existing scope check covers unapplied generations, shadow-only checking and unresolved/active background work. Do not recreate those rules in JavaScript or replace them with the existence of Ready rows. The compact response separately carries the original whole-session selected counts; a PAYE-filtered count must never overwrite an all-channel compatibility count. A rollback-contained actual first-use comparison and both transport boundary negatives are required before this component can close.

## 10. Verdict for this step

The selected-payment contract is demonstrably compatible at the tested frontend, Worker and locked database boundaries. The original financial/Draft owners remain unchanged. Full application integration and release acceptance remain open; capability remains disabled.

## 11. Final integrated verdict — 29 August 2026

This section supersedes the open-gate wording in sections 8–10 without deleting the historical evidence trail.

### Contract result

- The v2 shell is connected to the actual existing `banking:pay:createDraft` button exactly once.
- The existing synchronous busy state, permissions, PAYE conflicting-Draft check, password/2FA handling, complete physical Ready/Blocked reread, selection review, preflight, Worker request, operation polling and error cleanup remain owned by the original code.
- Candidate summaries, displayed candidate totals and child pages are never used as the Draft manifest.
- The v2 adoption bridge clears stale physical-page compatibility markers so the old Draft handler must reread the complete current physical authority.
- Candidate, individual, grouped and all-page selection all settle through the shared accepted revision before Create Draft can be enabled.
- The original server `draft_safe` authority and original whole-session counters are both required; neither Ready-row existence nor a visible-page count can widen readiness.

### Final executable proof

The final current-source Create Draft compatibility run passes **91/91**. It includes:

- one, some and 105 selected payments;
- selected and unticked deductions and recovery promotion/demotion;
- PAYE, Umbrella and current filters;
- stale revision, wrong session, wrong section and missing continuation;
- same count with different selected identities;
- selection change during preparation and uncertain/failed reconciliation;
- candidate-wide, individual, grouped and full-scope selection;
- exact old/new request-projection comparison;
- unchanged locked database selection review with no batch or batch item created.

The broader final evidence also includes frontend Banking 801/801, backend 989/989 and local Chromium 4/4.

### Real TEST boundary

The real signed-in modal currently has two unresolved historical refresh failures. Create Draft is therefore disabled with the existing visible explanation. That is a successful fail-closed proof. A real Draft was deliberately not created because it would be a financial lifecycle action, not a UI compatibility test.

### Final status

**PASS — original Create Draft contract retained.** The redesign changes presentation and selection control only. It does not reduce, replace or reinterpret the Draft contract.
