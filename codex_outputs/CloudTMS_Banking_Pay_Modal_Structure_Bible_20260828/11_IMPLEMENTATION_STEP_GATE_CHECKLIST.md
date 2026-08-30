# Implementation step-gate checklist

## Universal rule

Every phase is closed before the next starts. A failed or blank required item blocks dependent work. Capability remains false throughout Phases 0–7.

## Phase 0 — current-authority preflight, no implementation

### Entry

- [ ] Explicit implementation authority exists for the exact TEST scope.
- [ ] No LIVE, payment/provider or destructive authority is inferred.

### Worktree/source

- [ ] Fetch current frontend `main` and backend `test`.
- [ ] Record exact commits and timestamps.
- [ ] Record existing dirty/local divergence.
- [ ] Create isolated clean worktrees without altering dirty clones.
- [ ] Re-read root/frontend/backend `AGENTS.md` and `BANKING_PAY_BIBLE.md`.
- [ ] Compare their hashes with pack snapshots and record changes.

### Miget/database

- [ ] CloudTMS Miget Operations exposes all required read-only tools.
- [ ] Parity route authenticated/read-only; no credentials returned.
- [ ] `agency_test` proved; no LIVE call.
- [ ] Exact installed definitions/signatures/defaults/owners/ACLs/hashes retrieved for every reused function.
- [ ] Current release ledger and security/performance summary captured.
- [ ] Planned v2 public RPC names confirmed absent/no conflict.

### Current source inventory

- [ ] Re-extract all 136 BP requirements/current owners.
- [ ] Re-extract all 89 message triggers/current wording.
- [ ] Re-extract exactly 30 visible actions.
- [ ] Re-extract nested/compatibility handlers.
- [ ] Re-extract current routes/RPC calls/request payload builders.
- [ ] Re-extract current amount display helper chain.
- [ ] Re-extract current filters and Draft scope semantics.

### Exit

- [ ] No unexplained contract-affecting drift.
- [ ] Current evidence report complete.
- [ ] All later work references exact refreshed heads, not historical hashes.

## Phase 1 — characterization and failing contracts

### Before implementation code

- [ ] Populate every `BP-*`, `MSG-*` and action ledger row with current owner and planned test ID.
- [ ] Freeze current action request payloads and response/error/no-op shapes.
- [ ] Freeze amount oracle for AMT-001–AMT-019.
- [ ] Freeze current global/individual selection and recovery behaviour.
- [ ] Freeze filter/channel/Draft behaviour.
- [ ] Freeze Timesheets summary navigation behaviour.
- [ ] Capture performance baseline.

### Required new contract tests

- [ ] Four main cells/one line/no expansion.
- [ ] No new search.
- [ ] 100 candidates/full-result server sort.
- [ ] Selected-only amount/deductions/Timesheets.
- [ ] Candidate atomic selection.
- [ ] Candidate Ready-only before paging.
- [ ] Action/Updating/Blocked classification.
- [ ] Indefinite snooze exclusion.
- [ ] Same-revision atomic settlement.
- [ ] Draft manifest equivalence.

### Exit

- [ ] Tests fail against pre-v2 source only for expected missing v2 behaviour.
- [ ] Existing regression suites remain green.
- [ ] No runtime behaviour changed.

## Phase 2 — additive database contracts

### Design/source

- [ ] Exact planned RPC signatures/defaults/results frozen in contract tests.
- [ ] Private amount projection reuses/factors current display authority.
- [ ] Effective section and line contract reused.
- [ ] Recovery revalidator/economics not duplicated.
- [ ] Candidate selection is one transaction and one public revision.
- [ ] Task/blocker dedupe keys are stable and server-owned.
- [ ] Selected Timesheet token is exact, selected-only and revision-bound.

### Security

- [ ] Safe fixed search path.
- [ ] Statement/lock timeouts.
- [ ] Exact owner/language/volatility/SECURITY DEFINER.
- [ ] Revoke PUBLIC/anon/authenticated where service-only.
- [ ] Narrow service/release grants only.
- [ ] No table/RLS/browser-role broadening.
- [ ] No dynamic caller SQL/sort concatenation.

### Runtime proof before release

- [ ] Repository database checks/plan pass.
- [ ] Rollback-only complete pending-state compile passes.
- [ ] Real first-use fixture calls pass, not compilation only.
- [ ] Illegal `pg_catalog.coalesce/nullif/least/greatest` guard passes.
- [ ] UUID aggregate rules pass.
- [ ] Every cursor/sort/filter/amount/selection/task/blocker fixture passes.
- [ ] Query plans and budgets pass.
- [ ] Source hashes and object properties recorded.

### Exit

- [ ] Protected TEST database release separately authorised/executed through repository workflow.
- [ ] Installed definitions/hash/ACL/PostgREST proof passes.
- [ ] Capability still false.

## Phase 3 — backend v2

- [ ] Contained controller/module created.
- [ ] Exact routes in API/RPC matrix.
- [ ] Strict validation for every input.
- [ ] One RPC per route; no N+1.
- [ ] Response envelopes strictly validated.
- [ ] Typed stale/no-op/business/dependency/transport errors distinct.
- [ ] No financial arithmetic.
- [ ] No sensitive logging.
- [ ] Capability discovery read-only and false.
- [ ] Old routes unchanged.
- [ ] Unit/contract/security/performance tests pass.
- [ ] TEST Worker deployment separately authorised and exact deployed source proved.

## Phase 4 — complete main frontend while disabled

- [ ] Lazy v2 module/style; minimal current-main integration.
- [ ] Legacy and v2 never mount together.
- [ ] Exactly Include/Candidate/Deductions/Ready to pay.
- [ ] One physical row, no expansion/cards/action/details/Timesheets column.
- [ ] 100 candidates.
- [ ] Full-result server sorting.
- [ ] Existing authoritative filters; no search.
- [ ] Candidate tri-state/full-session amount/deduction/Timesheet scope.
- [ ] Permanent Action Required/Blocked buttons and Updating status.
- [ ] Existing Refresh/Clear Decisions/export/Draft entry/status retained.
- [ ] Main module failure safely falls back only before mutation.
- [ ] Layout/zoom/event-propagation tests pass.
- [ ] Capability remains false.

## Phase 5 — Candidate Banking and shared settlement

- [ ] Ready-only server page filters before limit.
- [ ] Every BP-050–BP-077 capability has v2 owner.
- [ ] Every current Ready action request builder has characterized parity.
- [ ] Individual, group, candidate and global selection use one settlement controller.
- [ ] Same-revision Ready/Blocked ownership validated.
- [ ] Main and child state update atomically.
- [ ] Dynamic-sort page reconciliation bounded.
- [ ] Transport uncertainty read-back passes.
- [ ] Candidate removal/empty/close restoration passes.
- [ ] No Cases/Updating/Blocked/indefinite row in child.
- [ ] Candidate and global Ready exports pass.
- [ ] Capability remains false.

## Phase 6 — Action Required, Updating and Blocked

- [ ] Every BP-080–BP-104 capability/action present.
- [ ] Deduplication happens before pagination.
- [ ] Every affected payment/component/Timesheet accessible in detail.
- [ ] Updating has separate count and transition semantics.
- [ ] Every BP-110–BP-124 passive blocker present.
- [ ] Blocked has no ordinary selection checkbox.
- [ ] Exact approved wording/fallbacks used.
- [ ] Indefinite snoozes absent from every Banking Pay result and message.
- [ ] Snoozes tab unchanged.
- [ ] Capability remains false.

## Phase 7 — complete equivalence and performance

- [ ] 136 BP rows PASS.
- [ ] 89 MSG rows PASS.
- [ ] 30 visible action rows PASS.
- [ ] Compatibility handlers PASS.
- [ ] AMT-001–AMT-019 PASS.
- [ ] All fixture catalogue sections PASS.
- [ ] Legacy/v2 selected/frozen Draft manifests identical.
- [ ] Request/payload/query/browser/memory budgets PASS.
- [ ] No source guard violation.
- [ ] Fallback and rollback rehearsal PASS.
- [ ] No open D1/D2 deviation.
- [ ] Capability remains false until independent activation review.

## Phase 8 — controlled TEST activation

- [ ] Separate exact TEST release/activation authority.
- [ ] Database → Worker → complete frontend order followed.
- [ ] Exact deployed asset/source parity.
- [ ] Capability enabled only at clean modal/session boundary.
- [ ] Continuous open-modal selection/recovery/action scenario passes.
- [ ] All sorts/pages/filters/children pass against deployed TEST.
- [ ] Live p50/p95/request/payload/memory evidence passes.
- [ ] Any authorised fixture mutation restored exactly.
- [ ] No provider/Draft execution/post-Draft/LIVE action used unless separately authorised.
- [ ] Legacy fallback remains available.

## Phase 9 — later cleanup, separately authorised

- [ ] Sustained TEST v2 evidence period complete.
- [ ] Every deletion candidate mapped to passing replacement evidence.
- [ ] No legacy handler needed for fallback/compatibility.
- [ ] Separate cleanup plan, authority and rollback.
- [ ] Removal does not alter economics/lifecycle.

