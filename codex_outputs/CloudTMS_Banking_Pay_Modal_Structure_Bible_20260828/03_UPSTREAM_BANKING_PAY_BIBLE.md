# CloudTMS Banking Pay Bible

## 1. Status and purpose

This is the mandatory behavioural rulebook for CloudTMS Banking Pay.

Read this document in full before investigating, planning, editing, testing, publishing, installing, or deploying any change involving:

- Banking Pay or its modal;
- Workbench sessions, builds, previews, selection, cases, or resolutions;
- timesheet payments, loans, snoozes, overpayments, or recoveries;
- pay-channel or rate resolution;
- Draft creation, execution, cancellation, payment, settlement, or remittance.

This document records business and safety invariants. It is not permission to mutate data, deploy, or change policy. Current source, installed TEST definitions, and live read-only evidence must still be rechecked before every implementation.

If code, a test, a handover, or an existing screen conflicts with this Bible, do not guess which is right. Stop the affected change, identify the precise conflict, preserve the existing economic authority, and obtain an explicit policy decision if the conflict cannot be resolved from current authoritative evidence.

## 2. Change-control protocol

Every Banking Pay change must follow this order:

1. Re-fetch or otherwise establish the latest repository authority without discarding unrelated local work.
2. Confirm the exact TEST project, current Workbench session/build authority, installed database definitions, and deployed frontend/backend versions relevant to the issue.
3. Trace the behaviour end to end: source truth, build facts, preview publication, effective-section routing, frontend state adoption, user action, Draft boundary, and post-Draft consumer.
4. Classify the defect before editing: economics, identity, routing, presentation, state adoption, performance, or deployment parity.
5. Define the smallest owner boundary. Do not change an economic owner to solve a presentation problem.
6. State which Bible rules the change touches and how Policy X drift is prevented.
7. Add focused executable regression tests for the affected rule and its adjacent invariants.
8. Test current source locally and test the actual patched asset/installed definition, not an older deployed asset.
9. For live TEST mutations, use only explicit user authority, bounded identifiers, before/after evidence, and collision coordination.
10. Update this Bible only when a rule is newly approved, clarified, or independently proved. Never rewrite history to conceal a failed attempt.

No implementation may make one section look correct by corrupting another section, weakening a fence, inventing a fallback, duplicating an economic line, or forcing a full modal rebuild as a substitute for correct in-memory adoption.

## 3. Policy X — immutable financial boundary

Policy X applies to all Banking Pay work:

- Before a Draft is created, Banking Pay may use current live truth through the established Workbench authorities.
- After a Draft is created, all financial behaviour must use the frozen batch/Draft artifacts. Live finance truth must not replace or reinterpret those artifacts.
- `TS_DAY` remains date-bucketed as `YYYY-MM-DD`.
- Do not introduce a new economic-key derivation ladder.
- Do not introduce post-Draft live finance-component identity fallback.
- Do not bypass central freshness, staleness, fingerprint, digest, or ownership validation.
- Do not change provider, execution, settlement, remittance, cancellation, reversal, VAT, ERNI, rate, or allocation policy unless the user explicitly authorises that policy change.
- Presentation and frontend fixes must not recalculate financial amounts.

## 4. Core ownership model

### 4.1 Economic authority

The database owns financial amounts, eligibility, recoverability, selection authority, and effective preview section. The frontend displays that authority and sends bounded user intent; it must not invent amounts, eligibility, resolution family, or headroom.

### 4.2 Physical and economic identity

Economic identity and physical component identity are separate fences.

- Economic rows may contain more than one physical component.
- A `TS_DAY` economic key may contain DAY, NIGHT, SAT, SUN, BH, and arbitrary additional-rate components.
- Arbitrary additional-rate codes are independent identities. They must not be collapsed merely because they share an `ADDITIONAL` category.
- Two different additional codes may carry different rates.
- The same normalized additional identity with conflicting rates must fail closed through the typed multiple-rate contract.
- Physical baseline and reservation amounts come from sealed facts by exact physical or structural identity. Ambiguous multi-bucket economics must fail closed; they must not be proportionally allocated.

### 4.3 Effective section versus physical storage section

A row may retain an immutable physical storage section while a certified pre-Draft overlay determines its current effective presentation section.

The UI must use the canonical effective-section owner. Do not physically move or rewrite certified source rows merely to change whether the row appears in Ready to Pay, Cases / Resolutions, or Blocked for Pay.

## 5. One-effective-section rule

At a single authoritative Workbench revision, one economic/physical preview identity may appear in only one user-visible section:

- Ready to Pay;
- Cases / Resolutions;
- Blocked for Pay;
- or an intentionally hidden/internal section.

The same effective identity must never be rendered simultaneously in two sections. Compatibility aliases and page caches are alternate views of the same authority, not independent sources that may accumulate rows.

When an action changes a row's effective section, the open modal must adopt the new authority atomically:

- remove the identity from every stale alias and old section;
- insert it once into the new section;
- update counts, totals, selection state, badges, and actions from the same revision;
- preserve unaffected candidates and rows;
- keep the modal open unless the user closes it.

Closing and reopening the modal must never be required to make a completed server transition visible.

## 6. Ready to Pay

Ready to Pay contains only currently eligible, effective Ready rows.

### 6.1 Positive ordinary payments

- A positive timesheet payment may be selected for a Draft when all current eligibility and freshness checks pass.
- Unticking a positive row removes it from the selected positive headroom used by recovery allocation.
- Unticked positive rows may remain visible as Ready but must not count toward the Draft or selected recovery headroom.

### 6.2 Negative overpayment recoveries

A negative recovery may appear in Ready to Pay only when current selected positive pay for the same recovery partition provides recoverable headroom.

The established partition is candidate and pay channel. Headroom must not cross candidates or pay channels.

- Selected positive ordinary pay creates headroom.
- A negative recovery never creates headroom.
- Recovery is capped by both the outstanding/nominal recovery amount and remaining selected positive headroom.
- Full recovery is allowed when enough headroom exists.
- Partial recovery is allowed when only part of the outstanding amount can be deducted.
- Earlier eligible recoveries consume headroom in the established deterministic recovery order; later recoveries may be partial or blocked.
- A Ready recovery displays the amount actually recoverable in this pay run as a negative amount.
- A Ready recovery must be selected/draftable only to the extent allowed by the canonical server authority.

The frontend must not keep a recovery in Ready after its selected positive headroom becomes zero.

## 7. Recovery headroom and selection mutations

Any change to selected positive pay can change same-candidate recovery amounts and sections. Therefore every individual, grouped, page-wide, or global selection mutation must:

1. send the bounded selection intent to the current Workbench session;
2. allow the canonical server revalidator to recompute recovery headroom;
3. reload both Ready and Blocked authorities for the same resulting session revision;
4. atomically replace the affected identities across all frontend aliases;
5. rerender once from the reconciled state.

It is incorrect to:

- refresh only Ready;
- refresh only Blocked;
- render between two section reads as though each were a complete state;
- merge new rows without evicting identities that departed the old section;
- preserve a stale Ready alias because a fresh Ready page no longer contains the moved row;
- require a modal close/reopen to obtain the correct placement.

### 7.1 Zero headroom

When selected positive headroom is zero:

- recoverable this pay run is `0.00`;
- the recovery is not selectable;
- it is not Draft-eligible;
- its effective section is Blocked for Pay;
- the outstanding recovery remains financially intact for a future pay run.

The row must not appear in Ready to Pay merely because the underlying recovery exists.

### 7.2 Current verified open defect — 17 August 2026

Status: **OPEN — presentation/state-adoption defect; economics verified correct.**

Observed sequence:

1. The user unticked all relevant positive payments in an already-open Banking Pay modal.
2. TEST persisted the positive rows as unselected.
3. TEST recomputed selected positive headroom to exactly zero.
4. All four inspected James recovery rows became `0.00` recoverable, non-selectable, non-draftable, and effectively `blocked_for_pay`.
5. The still-open modal temporarily retained the old Ready placement.
6. Closing and reopening the modal rebuilt state from current server authority and showed the recoveries correctly under Blocked for Pay.

Conclusion: the financial/headroom rule is operating correctly. The remaining defect is that the open frontend state does not always atomically evict the departed recovery identities from every Ready alias after the selection mutation. This must be fixed in the selection-result/section-page adoption boundary without changing recovery economics, resolution authority, or Policy X.

Required regression: in one continuously open modal, select positive pay, observe eligible recovery in Ready, untick the positive pay, and prove the recovery leaves Ready and appears once in Blocked without closing/reopening. Re-selecting sufficient positive pay must promote the permitted full/partial recovery back to Ready once, again without reopening.

## 8. Blocked for Pay

Blocked for Pay contains rows that cannot currently proceed to the selected Draft but do not require an actionable user resolution.

For an overpayment recovery blocked only by insufficient selected positive funds:

- line type: `OVERPAYMENT RECOVERY`;
- supporting label: `No available funds to recover this yet.`;
- Amount shows the nominal/outstanding amount due for recovery, not a misleading `£0.00` recoverable value;
- explanatory text: `No recovery can be made because there are no available funds to deduct from this pay run.`;
- State: `Insufficient funds`;
- do not show a generic `This case is currently blocked and needs review...` message;
- do not show meaningless channel text such as `UMBRELLA • NONE` beneath the state.

Blocked-for-insufficient-funds is not a resolution case. When sufficient selected positive headroom later exists, the canonical revalidator may promote a full or partial recovery to Ready to Pay.

Negative ordinary presentation-only timesheet rows may also be blocked under their existing policy. They must not be confused with an actionable pay-channel/rate resolution, and they must not duplicate a Cases / Resolutions identity.

## 9. Cases / Resolutions

Cases / Resolutions contains only current actionable cases for which the user can perform the displayed resolution action.

- A row must not be routed here merely because it is blocked by insufficient funds.
- A row requiring pay-channel conversion/restructure belongs here until resolved or explicitly excluded through the canonical action.
- Once its required resolution is satisfied, the case must disappear from Cases / Resolutions in the same open modal and its effective payment/recovery row must appear in the appropriate section exactly once.
- If a saved resolution becomes stale, the server must reject it without writing a replacement based on stale evidence.

For a pay-channel resolution case, presentation must state the real source and target direction rather than `CHANNEL • NONE`. Approved compact direction labels are:

- `PAYE>UMBR`
- `UMBR>PAYE`

The Amount area must show the relevant channel-owned amount and explain that the current amount is determined under the source channel but requires resolution to the target channel. Do not present `£0.00` as though no financial amount exists when the case actually concerns a non-zero outstanding/restructured amount.

## 10. Rate resolution

- DAY, NIGHT, SAT, SUN, BH, and every arbitrary additional-rate identity save independently.
- Multiple physical components may sit beneath one `TS_DAY` economic key without blending their rates.
- Resolving one component must not silently resolve a different component unless the user explicitly confirms the server-provided matching-timesheet scope.
- The matching-timesheet option may apply the same compatible resolution to other eligible physical components, but unrelated candidates and ineligible components must not rebuild or change.
- The save boundary binds current row-backed evidence through source basis fingerprint, source family, bucket, economic key, units, and rates. Do not claim the save RPC literally compares fields it does not consume.
- Resolved Ready timesheet rows must expose `Cancel Resolved Rate` when the canonical clear action is valid.
- Cancel must restore the actionable case without deleting unrelated resolution evidence or altering finance economics.

Known boundary as of 17 August 2026: cancelling saved resolved-rate timesheet cases has been exercised separately. Extending cancellation to other resolved financial families is a distinct investigation/implementation and must not change the working timesheet cancellation authority.

## 11. Resolved financial-case cancellation

Every resolved case category should be cancellable only through its canonical saved-resolution ownership and clear action. The frontend must not infer that every resolved item belongs to the BUCKETED timesheet family.

For overpayment/restructure and other financial cases:

- publish and consume the actual saved resolution family and owner;
- expose a cancel action only when the canonical backend says the exact resolution is clearable;
- clear only that resolution identity;
- preserve the already-working resolved-rate/timesheet cancellation path;
- after cancellation, return the item to its correct actionable section in the same modal;
- never reinterpret the economic amount or create a new pay-channel decision in the frontend.

Status as of 17 August 2026: broader resolved-financial cancellation remains a separately scoped requirement unless newer authority proves it complete.

### 11.1 Exact cancellation-owner contract approved on 17 August 2026

Financial cancellation is a server-owned pre-Draft action. Presentation words such as `resolved`, the line type, a historical timesheet link, or the section containing the row are not proof of ownership.

The only supported non-timesheet cancellation owners are:

- `TAXABLE_CHANNEL_RESTRUCTURE` for a current exact finance-component owner set;
- `NON_BUCKET` for one current exact session-owned gross-total decision.

`BUCKETED` remains the existing physical timesheet/rate family. It must not be published or accepted as the owner of a finance-case cancellation, and this financial extension must not change `Cancel Resolved Rate`.

The database must classify each finance case into one explicit clearability state:

- `NOT_REQUIRED` — no saved owner and no resolution is required;
- `REQUIRES_RESOLUTION` — an authoritative blocker exists without a current saved owner;
- `RESOLVED_AND_CLEARABLE` — one supported, exact, current saved owner has been proved;
- `RESOLVED_BUT_FINANCIALLY_BOUND` — only when that exact clear branch proves a real financial boundary;
- `STALE_OR_AMBIGUOUS` — saved evidence is stale, incomplete, mixed, duplicated, conflicting, or otherwise not exact.

Only `RESOLVED_AND_CLEARABLE` may publish an executable financial clear action. All other states publish no mutation-shaped clear action.

For `TAXABLE_CHANNEL_RESTRUCTURE`, the canonical action is finance-case scoped and must not contain a timesheet identity. For `NON_BUCKET`, one exact linked timesheet may be included only when it belongs to the unique saved owner. If legacy `timesheet_id` and canonical `linked_timesheet_id` are both present, they must agree or the action fails closed.

The canonical action must contain exact server-owned candidate ID, finance-case ID, `finance:<finance-case-id>` case key, supported family, action name and enabled state. The frontend validates and dispatches this object; it must not default a family, synthesize `advance:<id>`, scrape a historical timesheet, or infer ownership from amount, date, badge, channel, or line type.

Cancellation availability is independent of recovery headroom. A current saved financial resolution may be cancelled while its recovery is displayed in either Ready to Pay or Blocked for Pay. Headroom governs recovery allocation and Draft eligibility, not whether the saved decision can be removed.

The clear RPC must re-prove the exact current owner under lock immediately before mutation. Stale, forged, missing, duplicated, mixed-family, target-mismatched, fingerprint-mismatched, or identity-conflicting requests must fail typed without a partial write.

Clearing a live financial resolution removes only its exact saved owner evidence and refreshes the affected candidate. It must preserve source and remaining balances, reservations, settled history, Snooze state, fixed-case policy, payment economics, and unrelated candidates. Existing frozen Draft items are never rewritten; the established stale-Draft signal is used where the supported taxable branch permits a live clear after Draft creation.

Approved labels are:

- `Cancel Resolved Pay Channel` for `TAXABLE_CHANNEL_RESTRUCTURE`;
- `Cancel Resolved Gross Total` for `NON_BUCKET`;
- `Cancel Resolved Rate` remains exclusively the existing `BUCKETED` timesheet workflow.

## 12. Timesheet and recovery breakdowns

Expanding a timesheet must show the available authoritative detail, including:

- date;
- client;
- role;
- band;
- start;
- finish;
- break;
- amount;
- source pay and target pay where the row carries both.

Do not render a second target-only copy of a segment already represented by its source/target line. Deduplication must use canonical identity, not visual similarity.

Expanding an overpayment recovery must show its constituent recovery amounts and the current recoverable amount without duplicating the parent identity.

Expansion/collapse is an in-place UI action. It must not trigger an unnecessary full Workbench refresh, full modal rebuild, or unrelated candidate recomputation.

## 13. Modal responsiveness and state adoption

The Banking Pay modal must remain responsive during refresh, resolve, cancel, selection, expansion, and Draft preparation.

- Do not repeatedly deep-clone the entire preview graph for a local expand/collapse.
- Do not retain multiple independent full copies of the same page in compatibility aliases.
- Compatibility aliases must share or be replaced from one bounded authoritative graph.
- Candidate-scoped actions must update only the affected candidate plus any explicitly server-declared linked scope.
- Do not rebuild unrelated candidates merely to resolve or cancel one candidate's case.
- Network completion is not UI completion: the open modal must visibly adopt the returned authoritative revision.
- A selection checkbox may update optimistically, but the Draft action must immediately show a disabled selection-update state until the accepted server result and its authoritative Ready/Blocked adoption settle. It must never remain labelled as though no selection exists, and it must never become Draft-enabled from optimistic client state.
- Tests must observe responsiveness and request count as well as final content.

## 14. Draft creation

- A Draft uses only rows that are selected and Draft-eligible under the current canonical Workbench revision.
- A recovery cannot enter a Draft beyond its current selected positive headroom.
- Rows in Cases / Resolutions or Blocked for Pay are not Draft inputs.
- Draft creation must fail closed on stale selection, stale fingerprint, stale session, missing authority, or unresolved required case.
- Draft-action visibility and enablement must come from the accepted server-owned Workbench selection authority. A pending selection mutation may only disable that action temporarily; it must not erase or overwrite the settled action state published by the authoritative rerender.
- Once created, the Draft and all downstream operations use frozen artifacts under Policy X.
- A successful pre-Draft screen does not prove Draft execution, future payment execution, fast cancellation, settlement, or remittance; each lifecycle stage requires its own evidence.

## 15. Fast future-payment cancellation

Fast cancellation is a post-Draft workflow and must remain separate from live Workbench truth.

- Cancellation must use frozen Draft/execution artifacts.
- It must not refresh live rates, current finance facts, or current recovery headroom to reinterpret the payment.
- Obsolete/superseded job liveness, idempotency, provider state, and cancellation ownership must be fenced by their existing contracts.
- A terminal `BLOCKED`, `FAILED_FINAL`, or `FAILED_RETRYABLE` result from an older cancellation attempt remains immutable audit history, but must not permanently suppress a fresh whole-Draft cancellation when the current exact Draft diagnostic independently re-proves every frozen-item, provider, settlement, instruction-scope, carry-forward, and current-batch fence.
- That retry creates a new bounded cancellation request; it must not reopen, rewrite, or erase the terminal historical request. Scheduled or executed non-Draft cancellations retain their historical-work fences.
- No Workbench presentation fix may alter this path unless explicitly authorised.

## 16. Mandatory regression matrix

Any change touching relevant code must run focused tests for the affected rows plus adjacent safeguards.

Minimum recovery/selection matrix:

1. Zero selected positive headroom -> recovery appears once in Blocked, recoverable `0.00`, not selectable/draftable.
2. Exact headroom -> full recovery appears once in Ready.
3. Partial headroom -> partial recovery appears once in Ready; unrecovered balance remains intact.
4. More recovery than headroom -> deterministic earlier allocation, partial boundary recovery, later recoveries blocked.
5. Headroom in another candidate -> no effect.
6. Headroom in another pay channel -> no effect.
7. Untick positive row in an open modal -> immediate Ready-to-Blocked transition without reopen.
8. Re-tick positive row in the same modal -> immediate Blocked-to-Ready full/partial transition without reopen.
9. No duplicated identity across Ready, Cases, and Blocked.
10. Selected totals and Draft inputs exactly match current server authority.

Minimum resolution matrix:

1. DAY/NIGHT and other physical buckets save independently.
2. Arbitrary additional codes with different rates remain independent.
3. Conflicting duplicate physical identity fails typed.
4. Matching-timesheet scope changes only eligible linked rows.
5. Resolution disappears from Cases and appears once in the correct section without reopen.
6. Cancel resolved rate restores the case without reopen.
7. Stale units, rates, fingerprint, or ownership fails without a write.
8. A current taxable finance-component owner publishes one `Cancel Resolved Pay Channel` action with no timesheet identity in Ready or Blocked.
9. A unique current non-bucket owner publishes one `Cancel Resolved Gross Total` action with only its exact optional linked-timesheet identity.
10. BUCKETED, missing, stale, closed, duplicate, mixed-family, target-mismatched, and fingerprint-mismatched finance owners publish no financial clear action.
11. A forged or stale financial clear request is rejected under the database lock without mutation.
12. A successful financial clear changes only the saved owner, preserves frozen Draft/economic artefacts, refreshes the same modal, and can be restored through the supported apply path.

Minimum presentation/performance matrix:

1. Breakdown fields are populated from canonical backend data.
2. No duplicate source/target segment lines.
3. Expand/collapse does not fetch/rebuild the whole modal.
4. Repeated expand/collapse, selection, resolve, and cancel do not make the modal non-responsive.
5. The test proves the patched frontend asset or installed database definition was actually exercised.
6. During a real selection request, the Draft action immediately displays a disabled in-progress state, remains fail-closed while the request is unsettled, then adopts the exact authoritative `Select rows` or `Create drafts` result without modal reopen.

Minimum Draft-cancellation retry matrix:

1. A current safe `DRAFT` with no prior correction outcome exposes `DRAFT_CANCEL`.
2. The same current safe `DRAFT` still exposes `DRAFT_CANCEL` when its latest historical attempt is terminal `BLOCKED`, `FAILED_FINAL`, or `FAILED_RETRYABLE`.
3. The historical request/work item remains unchanged and visible as audit evidence.
4. Provider submission, paid/settled evidence, incomplete instruction scope, ambiguous provider outcome, manual carry-forward, or carry-forward freshness failure still withholds cancellation.
5. Scheduled and executed non-Draft cancellation keeps the established historical-work fences.
6. Reader and immutable selection preparation classify the safe Draft retry identically before a new request is allowed.

## 17. Evidence standards

Completion claims must distinguish:

- static source evidence;
- compile/canonical-hash evidence;
- installed-definition evidence;
- rollback-fixture evidence;
- read-only live runtime evidence;
- real user-visible lifecycle evidence.

One category must not be presented as another. A source test does not prove the deployed browser. An installed hash does not prove a live lifecycle. A close/reopen result does not prove same-modal adoption.

For database work, record the current TEST project, object identity, owner/ACL/search path where relevant, source and installed hashes, and bounded before/after results. For frontend work, record the repository commit, deployed asset parity, Playwright/browser path, request scope, and whether the modal stayed open.

## 18. Verified implementation/evidence register

The following frontend commits form part of the current 17 August 2026 evidence trail. They are historical pointers, not permission to assume their deployed behaviour remains current:

- `e8be014` — clarified case presentation and deduplicated breakdowns.
- `e6f8f2b` — refreshed after recovery restructure.
- `950012e` — preserved accepted resolved-rate clears.
- `f1669a0` — adopted linked rate-resolution results.
- `ae17c57` — evicted a stale case alias.
- `c1f95ee` — replaced candidate case aliases.
- `e6f326d` — atomically adopted candidate sections for the covered action path.
- `f5468ed` — clarified zero-headroom recovery rows.
- `aee02f1` — settled the covered James modal-adoption path.
- `2ca622b` — evicted resolved candidate cases.

Current frontend authority at the time this Bible was created: `2ca622bb15f77647b49aba8ac5bf78a2a485ca67`.

Current backend authority observed at the time this Bible was created: `6117000635a2f287220e5d20b90ba9e74d5cd8b1`.

These identities are observations, not pinned baselines. Every later task must use the most recent authority available at execution time.

## 19. Current open-items register

### Closed by verified current authority

- Same-modal recovery routing after an accepted selection change is closed for the frontend selection-result path by the `20260821-banking-selection-result-refresh-r2` asset. Commit `6ef2285868bcab8c59272aba8b62ddc6d321bbc6` established the atomic concurrent Ready/Blocked pair, but later exact browser evidence proved that its accepted page graph was not installed on the render-consumed `draftWizard.preview` wrapper aliases. That omission could reintroduce a departed recovery from `preview.preview_pages.canonical_preview_lines` even though the direct Workbench rows and server readers were current. The narrow correction installs the same bounded accepted page graph on `workbench`, the accepted envelope, `preview`, and `preview.data`; it does not add a source, perform a second merge, or recalculate any amount. An executable stale-wrapper regression failed before the correction and passed after it. A patched-asset TEST browser lifecycle then selected James positive headroom, observed a promoted recovery, unticked the last positive, and proved zero recovery rows in every Ready page-cache root, one-or-more Blocked recovery presentations, no cross-section duplicate, the modal still open, and exact restoration of the original unselected James state. The two selection mutations settled in 1,766 ms and 1,558 ms. TEST database truth after restoration showed James with zero selected rows and zero selected recoveries in the current open READY session.

### Separately scoped / do not assume complete

- Canonical cancellation of resolved overpayment/restructure and other non-timesheet financial resolution families.
- End-to-end James Draft creation followed by future execution and fast cancellation, unless newer evidence closes it.
- Performance proof for repeated row expansion under the current deployed asset.
- Whole-database Supabase privilege hardening remains separately scoped. TEST currently uses a Worker/service-role data path plus a pre-request MFA gate; later approved hardening must remove direct browser-role object authority in staged TEST phases, preserve the exact Worker and MFA contracts, measure route latency, and never copy a TEST-only authentication exception to LIVE.

### Working contracts that must be preserved

- James physical rate authority and independent component resolution.
- Typed failure and fail-closed physical baseline/reservation handling.
- One-effective-section server readers.
- A terminal historical cancellation attempt cannot poison a currently safe whole-Draft retry; all current provider, settlement, frozen-scope, carry-forward, and completeness fences remain mandatory.
- Active post-Draft batches exclude an exact frozen timesheet/component identity even when an older valid `OVERPAYMENT_RECOVERY` artifact stores the timesheet only as `frozen_source_basis_json.linked_timesheet_id` or `frozen_component_snapshot_json.source_basis_json.linked_timesheet_id`; the Draft seed must independently reject the same overlap.
- A current pre-Draft `OVERPAYMENT_RECOVERY` preview may expose only the positive residual not owned by active Draft reservations. A fully reserved recovery is absent from the Workbench; a genuine positive partial residual may remain exactly once only when the canonical versioned residual contract matches the current active reservation aggregate. Missing, malformed, stale, candidate-mismatched, or arithmetically inconsistent contract evidence fails closed.
- Zero-headroom blocked presentation wording.
- Detailed timesheet breakdown and source/target deduplication.
- Existing resolved-rate cancellation for the already-supported timesheet family.
- Database security work must preserve the Worker/service-role path, fail closed rather than fall back to browser-role database access, avoid permissive RLS policies for Worker-only tables, and use exact object/signature manifests plus post-repeatable verification so later migrations cannot silently regrant browser authority.

## 20. Change record

### 17 August 2026 — initial Bible

- Consolidated the controlling Banking Pay rules established through the James rate-authority, post-resolution, recovery presentation, same-modal adoption, and Draft-integrity work.
- Recorded the user-confirmed recovery-headroom policy.
- Recorded read-only TEST proof that deselection correctly produced zero headroom and effective Blocked rows.
- Recorded the remaining same-modal Ready-alias eviction defect separately from economics.
- Made this Bible mandatory through `AGENTS.md`.

### 17 August 2026 — resolved financial cancellation authority

- Recorded the exact non-timesheet owner families: `TAXABLE_CHANNEL_RESTRUCTURE` and `NON_BUCKET`.
- Kept `BUCKETED` and `Cancel Resolved Rate` exclusively within the working timesheet/rate workflow.
- Added the explicit finance clearability state model and fail-closed canonical action contract.
- Confirmed that cancellation visibility is independent of Ready/Blocked headroom routing.
- Required under-lock current-owner revalidation and Policy X preservation of frozen Draft and downstream artefacts.
- Added the finance cancellation regression matrix and prohibited frontend ownership inference.

Future entries must include the date, approved rule change or clarification, affected owners, executable regression evidence, deployed/installed authority where applicable, and explicit Policy X assessment.

### 18 August 2026 — finance cancel/restore adoption clarification

- A successful financial clear or restore RPC is not same-modal completion. Completion requires the still-open modal to show the exact postcondition, remove every stale opposite-section alias, expose the correct canonical action, and render `data-progress-active="false"` without closing or reopening.
- Candidate-scoped successor rows and all first pages that own Ready, Cases / Resolutions, and Blocked placement must belong to one accepted session revision before a terminal render. A mixture of a current candidate graph and prior-revision section-page caches is not publishable UI state.
- The restore path may legitimately keep the same Workbench session version while advancing the progress/generation authority. Tests must prove a current exact owner and exact row/action postcondition; they must not invent a mandatory `session_version + 1` rule.
- The modal must publish one terminal render only after the candidate graph, section pages, progress authority, and refresh-state aliases agree. Clearing only polling flags, or obtaining correct rows only after modal reopen, is insufficient.
- Frontend commit `a204ffdaa3930a90797da22f8a6cb81f4a690a47` synchronized accepted candidate and section-page revisions but did not close the strict same-modal restore condition in live TEST: the restored owner and fresh-open modal were correct, while the original modal failed to reach the combined restored-and-terminal condition within 120 seconds. Treat this commit as diagnostic progress, not final closure.
- Policy X assessment: no payment economics, recovery headroom, frozen Draft artifacts, provider execution, settlement, or remittance authority changed.

### 18 August 2026 — active-batch frozen linked-timesheet exclusion

- TEST batch `4f87739e-6e6f-48db-acad-5702bb2e198a` proved an older valid frozen `OVERPAYMENT_RECOVERY` shape whose direct `pay_batch_items.timesheet_id` was null while the exact timesheet identity was retained at both `frozen_source_basis_json.linked_timesheet_id` and `frozen_component_snapshot_json.source_basis_json.linked_timesheet_id`.
- The existing batch-mutation overlay and active-batch preview readers recognised a direct item timesheet ID and the older top-level frozen `timesheet_id`, but not these sealed linked-timesheet paths. This allowed one already-reserved `TS_DAY` allocation component for £25.00 ex VAT to be reselected and shown in Ready to Pay after a live source refresh.
- The verified correction extends only the existing exact frozen-timesheet identity resolution in `pay_workbench_patch_preview_after_batch_mutation`, `pay_workbench_session_get_candidate_preview`, `pay_workbench_session_get_preview_page`, and the independent `pay_workbench_prepare_draft_scope_seed` fail-closed guard. It does not add a live finance identity fallback or a new economic-key derivation rule.
- Staged definitions compiled in rollback, canonical definition hashes matched the catalogue, and a James-specific rollback runtime proof returned zero target rows from both readers, one exact Draft-guard match, one exact overlay patch, and unchanged batch/item/reservation state. Focused source tests passed 93/93 before installation.
- Installed TEST verification showed the target row selected count `0`, NOT_SELECTABLE count `1`, both public-reader target counts `0`, no active Workbench jobs, and an open session at version `51`. The signed-in TEST browser then showed no James £25.00 Ready row and no James Cases / Resolutions row.
- Financial invariants remained: scheduled/not-submitted batch; eight active frozen items; £35.63 ex VAT / £42.76 inc VAT net; four recoveries totalling £-755.00 ex VAT / £-906.00 inc VAT; four COMMITTED reservations totalling £755.00; zero RELEASED reservations.
- This evidence proves the Workbench exclusion and Draft fail-closed boundary for the observed artifact. It does not by itself prove future-payment cancellation, settlement, provider submission, remittance, or every historical frozen payload shape.
- Policy X assessment: compliant. Post-Draft exclusion uses only frozen batch artifacts; the pre-Draft certified source builder, payment economics, reservations, provider state, settlement, and remittance owners were unchanged.

### 19 August 2026 — terminal historical Draft-cancellation retry recovery

- A failed legacy cancellation attempt remained terminal `BLOCKED` after its reviewed communications count changed, while the batch itself remained a current `DRAFT`, `NOT_SUBMITTED`, with no provider submission or money-movement evidence. The status reader incorrectly gave the historical work label precedence over the current exact cancellation diagnostic, permanently hiding `DRAFT_CANCEL`.
- The verified correction changes only `pay_batch_payment_status_page_v1` and the matching status-filter precedence in `pay_payment_correction_selection_prepare_chunk_v1`. For a `DRAFT` only, the current exact diagnostic now governs a fresh retry; scheduled and executed non-Draft cancellations retain all historical-work fences.
- The installed TEST reader now returns `ACTIVE`, `DRAFT_CANCEL`, `pre_provider_cancel_eligible=true`, no stale blocker, and no stale failure reason for the observed £72.76 Draft. The old correction request and work item remain terminal `BLOCKED` audit evidence.
- Before and after installation, the Draft remained `NOT_SUBMITTED` with seven active frozen items totalling £72.76 and three committed reservations totalling £730.00. No batch, item, reservation, communication, provider, settlement, or financial row was changed by installation or verification.
- Exact staged Git blobs compiled in a rollback-only TEST transaction. The complete Banking Pay source suite passed 717 tests with zero failures and 17 intentional skips before installation. Installed owner, security-definer configuration, search path, timeouts, ACLs, and canonical hashes matched the catalogue authority.
- This evidence proves safe retry visibility and reader/preparation parity. It does not by itself prove the subsequent user-authorised cancellation lifecycle, Workbench rebuild, or same-modal closure; those remain to be exercised end to end.
- Policy X assessment: compliant. The change does not recalculate or reinterpret any frozen amount and does not alter provider, execution, reservation, settlement, remittance, email, or Workbench economics.

### 20 August 2026 — active-reservation partial recovery residual

- The active-batch exclusion remains strict for fully reserved `OVERPAYMENT_RECOVERY` rows, but exact physical overlap alone must not suppress a genuine unreserved balance. The canonical pre-Draft publisher now freezes a versioned residual contract containing source outstanding ex VAT, current active reserved ex VAT, and residual outstanding ex VAT.
- Both Workbench readers validate that contract against one current set-wise active-reservation aggregate. They may publish only a strictly positive, current residual and retain the established strict frozen-sibling fence. Missing, malformed, stale, candidate-mismatched, or arithmetically inconsistent evidence is suppressed rather than inferred.
- TEST catalogue hashes were pinned as follows: residual validator `4317bb7fbf6fd222fc26133fa08c931b2a9d23f0cc60ff71522ff930f59d344a`; canonical publisher `9216d9e6c3c73514149dc20e93b75648c42ffd6850b0eaff2fbe4764e713c0b5`; candidate reader `7e669a4dd7d00e332207161460444ced8d71045c1549ef837e8e8b19d25aab2b`; page reader `99309bf519fa791b05249f74fc0c3de2079006f9eed64fd3dbf3e6ca25486b48`.
- Bounded TEST proof found 13 current Ready recovery contracts and 13 valid residual validations, with zero malformed or invalid rows. The two public readers returned identical 63-row identities before frontend filter/adoption, cursor paging remained stable, and the combined eight-call plan executed in 876.27 ms without shared or temporary reads/writes.
- The seven-item active James Draft reconciled to £948.76 positive inc VAT, £-876.00 recovery inc VAT, and £72.76 net bank amount. Its three active reservations totalled £730.00 ex VAT and were absent from Workbench presentation; the separate unreserved £25.00 control remained exactly once under resolution authority.
- A normal TEST browser refresh completed without a Banking Pay failure and showed 60 Ready lines. No fully reserved James recovery from the active Draft was shown. The unrelated authenticated capability probes continued to return 401 and did not fail a Banking Pay request.
- Backend commit `28265873244bb5345440078c38a2a7921ded5334` was published to `test`. Safe migration run `32384500076` passed the PostgreSQL 17.6 and 18.1 candidate-runtime gates, source/catalogue verification, and the TEST repeatable replay. The four installed catalogue hashes still matched the published manifests after that replay.
- The browser proof is an exclusion and refresh-health proof, not proof that every server-owned section is visible in every signed-in session: the final signed-in browser showed 60 Ready, 0 Cases, and 0 Blocked rows, while the bounded direct reader proof performed earlier returned 60 Ready, 1 Case, and 2 Blocked rows for its inspected session. A later investigation must identify the exact session/user/filter/adoption reason before claiming complete browser-to-reader parity; it must not weaken the residual or frozen-reservation fences to make the counts agree.
- Policy X assessment: compliant. The new contract is frozen by the canonical pre-Draft publisher and validated only against active reservation ownership. No post-Draft live finance-component fallback, new economic-key ladder, recovery/VAT/ERNI/headroom calculation, Draft artifact, provider, settlement, remittance, or cancellation authority changed.

### 21 August 2026 — atomic selection-result Ready/Blocked refresh

- Frontend commit `6ef2285868bcab8c59272aba8b62ddc6d321bbc6` changes only the accepted selection-result refresh path. Individual rows, grouped rows, the Ready header and explicit all-page selection actions pass one exact queued selection epoch into their existing mutation owner.
- The accepted row-selection response remains the membership/readiness authority. Only a response matching the active session and carrying a valid session version and progress revision may launch the paired section refresh. An older or superseded selection epoch cannot publish page results or perform a terminal success render.
- Ready and Blocked page reads now start concurrently in deferred mode. Deferred reads do not mutate page state, cursors, loading/error state, compatibility aliases, scroll position, or the DOM. Both returned pages must match the accepted session ID, session version, progress revision and requested/resolved section, must contain unique non-empty row identities, and must be disjoint across Ready and Blocked.
- One new narrow owner, `adoptSelectionMutationReadyBlockedPagesV1`, stages a cloned Draft Workbench wizard, supplies direct Ready and Blocked authority to the existing `applyPayWorkbenchPreviewToState` owner once, retains Cases / Resolutions and mutation-owned selection/readiness fields, commits only after complete validation/adoption, and marks the exact intent `ADOPTED`. A request, validation or adoption failure marks the exact intent `FAILED`, publishes neither partial section and releases the normal watcher recovery path.
- The same-revision watcher suppresses only duplicate Ready/Blocked page work for the exact current selection epoch while that pair is `PENDING` or `ADOPTED`. Failed, older and newer revisions continue through the established authoritative watcher path.
- The full Banking Pay unit set passed 240/240, including executable atomic Ready-to-Blocked and Blocked-to-Ready transitions, cross-section duplicate rejection, mismatched-tuple rejection, no-partial-commit failure and exact watcher suppression. The complete focused Playwright file passed all applicable current-state cases; four precondition-dependent cases were intentionally skipped because their old server-selected/Kier fixture was absent.
- Patched-asset and deployed-asset Playwright both used the normal TEST origin and normal TEST backend. The deployed run settled one real TEST selection in 1,562 ms versus the captured approximately 26.8-second baseline, issued exactly one selected-row request plus one concurrent Ready GET and one concurrent Blocked GET, retained the open Banking modal, left Cases / Resolutions unchanged, produced zero cross-section duplicate identities, and restored the original selection plus the exact original Ready/Blocked presentation hash.
- GitHub Pages run `32480773533` deployed the commit successfully. The served `main.js` matched the committed bytes exactly; the served `index.html` matched after normalising GitHub Pages line endings, and both `20260821` selection-refresh asset markers were present.
- No backend source, SQL, database object, reservation, Draft artifact, batch, provider, settlement, remittance, cancellation, recovery amount, VAT, ERNI or headroom calculation changed. Policy X assessment: compliant; this is presentation/adoption orchestration only and introduces no post-Draft live fallback or economic-key derivation.

### 21 August 2026 — render-consumed preview-wrapper page-cache closure

- Exact live diagnostics found that the accepted atomic Ready/Blocked pair was installed on the Workbench, accepted envelope, and `preview.data`, but not on the renderer-consumed `draftWizard.preview` wrapper. The renderer intentionally reads that wrapper for compatibility, so its stale canonical page could reintroduce a recovery that had already moved to Blocked under current server authority.
- The correction adds the `draftWizard.preview` wrapper to the existing page-alias installation owner. All six compatibility aliases on all four roots now reference the same bounded accepted page graph. No new fetch, page merge, renderer source, fallback, or economic owner was introduced.
- The focused frontend suite passed 241/241. The new executable regression seeds a stale Ready recovery only on the wrapper cache, proves the prior source fails, and proves the correction replaces every alias with the accepted disjoint Ready/Blocked graph.
- Patched-asset Playwright on the normal TEST origin and backend proved the current James last-positive-headroom lifecycle without modal reopen: promoted recovery in Ready, last positive unticked, zero recovery rows in every Ready cache root, recovery present only in Blocked, no cross-section duplicate, and the original selection restored. Mutation settlement was 1,766 ms and 1,558 ms.
- Bounded TEST database verification after restoration found the current open session READY at version `51`; James had zero selected rows and zero selected recoveries. No Draft, payment, reservation, provider, settlement, remittance, cancellation, or database definition was created or changed by this frontend correction.
- Policy X assessment: compliant. The patch adopts server-owned pre-Draft presentation authority only; it does not recalculate recovery headroom or alter frozen post-Draft artifacts, financial identity, VAT, ERNI, amounts, provider state, settlement, remittance, or cancellation behaviour.

### 22 August 2026 — fail-closed Draft action during selection settlement

- Exact deployed TEST diagnostics reproduced a transient mismatch: the checkbox and selected-count display changed optimistically while the Draft action retained the prior `Select rows` state until the accepted selection response and concurrent Ready/Blocked adoption completed. Database authority for the observed open session already reported two selected, Draft-eligible rows and `ready_for_draft=true`; no eligibility, amount, recovery-headroom, or Draft-authority defect was found.
- The narrow frontend correction extends only the existing selection-controls busy owner. A real selection request immediately presents `Updating selection…`, native-disabled plus ARIA-disabled/busy, and remains fail-closed. When the authoritative renderer replaces the action, that renderer wins; when no replacement occurs, only the exact prior element state is restored.
- Focused unit/cache checks passed 11/11, the complete Banking Pay unit suite passed 242/242, and patched-asset Playwright on the normal TEST origin/backend proved both immediate disabled busy state and authoritative settlement while restoring the exact original two-row TEST selection. No Draft was created.
- Policy X assessment: compliant. This changes transient action presentation only. It does not infer Draft eligibility, calculate any amount/headroom, add a frontend economic authority, or alter frozen Draft, provider, settlement, remittance, cancellation, database, or backend behaviour.

### 22 August 2026 — read-only Supabase security boundary audit

- A whole-TEST-database read-only Advisor/catalogue audit confirmed that the supported CloudTMS data path is Worker/service-role based and that a database-wide MFA pre-request hook is only a compensating control, not a substitute for object-level RLS and privileges.
- The approved future target is staged least privilege: Worker-only application tables stay fail-closed to browser roles with RLS enabled and no permissive policies; application views use invoker rights; internal RPCs and sequences are unavailable to browser roles; default privileges prevent silent regrant; and the exact Worker and MFA contracts are preserved and latency-tested.
- Security installation remains separately scoped and unapproved. It must be rehearsed and verified in TEST by bounded object/signature manifests and post-repeatable migration gates before any LIVE migration. TEST-only authentication exceptions must never be copied to LIVE.
- No database, Auth, API, RLS, privilege, function, view, extension, index, connection, Banking Pay, or financial object was changed by the audit. Policy X was not touched.

### 22 August 2026 — verified TEST browser-isolation security phase

- The approved non-LIVE phase was subsequently installed only on the `test-cloudtms` Supabase project. It excluded the completed Candidate/MyTMS boundary and every Candidate-named object, preserved the database MFA pre-request hook, enabled fail-closed RLS on 126 audited non-Candidate relations, removed direct `PUBLIC`/`anon`/`authenticated` authority from those relations and eight sequences, changed 20 audited non-Candidate views to invoker rights, and removed browser execution from 403 audited non-Candidate security-definer RPC signatures. Exact pre-state count/hash guards stopped the migrations if the inspected catalogue differed.
- The Worker remains the application data broker. Its required `service_role` table, sequence, view and RPC privileges were retained and verified. One legacy Worker helper was made fail-closed so it cannot substitute a service-key or anonymous browser credential for `SUPABASE_SERVICE_ROLE_KEY`.
- Default privileges owned by the application migration role now retain the Worker authority and deny automatic future browser grants. Supabase-managed owner defaults were not forcibly changed. The repository migrations accept only the exact audited pre-state or the exact verified already-installed state, so a management-first TEST install can be safely adopted by the GitHub ledger without replay drift. The migration workflow now runs both the general browser-isolation verifier and the unchanged Candidate/MyTMS verifier after repeatables and one-time migrations, preventing a later migration from silently weakening either boundary.
- Post-install TEST verification passed both SQL boundaries, the normal backend health/readiness probes, the 735-test backend suite, the new service-role fallback regression, and all 112 Candidate broker/boundary tests. Candidate registration/read/write/daily/notification/manager/paper and related feature flags remained false; Candidate accounts, active sessions/challenges/approvals and pending Candidate mail remained zero; client and contract paper enablement remained zero.
- Supabase Security Advisor findings fell from 756 to 292, with errors falling from 103 to 13 and warnings from 552 to 106. This is not a claim that the legacy TEST database is fully clean: the remaining Candidate-named objects stay outside this phase for the App-Ready owner, mutable function search paths and public-schema extensions require separate dependency-aware work, and the remaining fail-closed RLS-without-policy notices are expected. Those deferred areas must not be changed merely to clear Advisor counts.
- No application row, permissive RLS policy, function body, view body, economic key, amount, VAT, ERNI, recovery headroom, Draft artifact, provider, settlement, remittance or cancellation rule changed. Policy X remains intact. Before any later LIVE migration, re-establish the exact LIVE catalogue and dependencies, preserve the Candidate/MyTMS boundary and Worker/MFA contracts, rehearse the migration independently, and rerun both verification files; TEST-only authentication exceptions must never be copied to LIVE.

