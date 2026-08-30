# Banking Pay continuous candidate-scope maintenance

## Completion-audit implementation handover

Status: the completion corrections are implemented, installed in TEST, published, and frontend-deployed on 1 August 2026. Read this addendum with report.md in the same directory. This addendum is authoritative where it supersedes the earlier report.

## Final authorities

Backend repository: kierarthur/cloudtms-backend, branch test.

Published backend commit:

- e3df88f435bb9bf71e6ad49125021bbb66e1c923 — Complete Banking Pay continuous scope safeguards
- Parent: 2776ba97b4d9aebd8d0c1954ed7a2862271bd4c8
- Publication: non-forced fast-forward

The backend commit contains exactly five files:

- supabase/migrations/01082026_0145_banking_pay_continuous_scope_completion.sql
- supabase/repeatable/21072026_1235_46_pay_workbench_prepare_draft_scope_seed.sql
- supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql
- supabase/repeatable/31072026_2350_banking_pay_continuous_scope_runtime.sql
- tests/banking-pay-continuous-scope-completion.test.cjs

Local backend commit 562381ea8f8adba9611a2f6600b437ba618b9815 contains the same five Banking Pay blobs. Do not push or reapply it. Remote e3df88f is the published authority.

Frontend repository: kierarthur/TEST-Frontend, branch main.

Published frontend code commit:

- 7969919e06a0e2980abf86f8b872491c2b0ccbf8 — Explain Banking Pay scope reconciliation blockers

GitHub Actions run 30680096324 passed build, deploy, and build-status. The live TEST main.js returned HTTP 200 and matched the published Git blob exactly:

- Bytes: 16,962,848
- SHA-256: d01c996c2553b9e7c1c7442157c6775d6157a14542978a64c0fb65ef860af14b

TEST Supabase contains the final schema and final effective function bodies. Worker JavaScript did not change in this completion patch, so no Worker redeployment was required for e3df88f. Production was not accessed or deployed.

## Scope and architecture preserved

The implementation does not replace banking_pay_workbench_jobs, add a queue, add a Worker route or cron, increase source-build parallelism, add a per-candidate RPC, or change preview economics. The established source build, delta refresh, line work, preview materialisation, shared session, frozen operation, batch, payment, provider, settlement and remittance authorities remain in place.

Policy X remains intact:

- pre-draft may use live truth;
- the atomic FROZEN operation-scope seal is the live/frozen boundary;
- post-draft uses frozen operation and batch artifacts;
- no live financial fallback was added;
- TS_DAY remains YYYY-MM-DD;
- central freshness and staleness gates remain authoritative.

## Completion defects closed

1. Historical FAILED jobs no longer poison readiness after later successful recovery. Generated work is interpreted from the latest row per stable dedupe_key inside the closed prefix scope_change_generation less than or equal to the caller target.
2. DEAD jobs are terminal unresolved. Blockers are session- or frozen-operation-relevant rather than global raw status counts. Unknown broad-root relevance remains fail-closed.
3. Shadow mode is genuinely non-mutating. It evaluates bounded pages, records diagnostics, advances only the shadow watermark, and does not insert scope, enqueue refresh, or advance applied generation.
4. Empty admission shortlist matches no candidates. Explicit candidate filters are intersected with the shortlist, and output outside the shortlist fails closed.
5. DRAFT_CREATE chunk seeding independently requires a complete FROZEN operation scope.
6. DRAFT_CREATE completion and batch integrity independently prove frozen-scope and generation provenance. Later relevant live changes create stale or pending evidence without aborting the frozen operation.
7. Expired snoozes have a source fingerprint and durable check evidence. Unchanged rows are checked once per exact identity/date, do not dirty Banking Pay, and cannot starve later rows.
8. Coordinator target promotion is monotonic. A later successful recovery becomes authoritative only after that generation enters the evaluated target. The blocker helper never silently changes a caller target.

## Additive schema

banking_pay_workbench_sessions now has scope_change_generation_shadow_checked bigint not null default 0.

pay_item_snoozes now has:

- natural_expiry_source_fingerprint
- natural_expiry_checked_fingerprint
- natural_expiry_checked_at_utc
- natural_expiry_state_changed
- natural_expiry_result_code

The bounded unchecked-expiry index is installed. Fingerprint backfill ran only after the derived-metadata no-dirty guard. Backfill did not populate checked fingerprint because calculating source identity is not equivalent to running expiry transition authority.

## Function-by-function implementation

### New: pay_workbench_scope_blocker_state_v1

- Reads generated candidate, finance-case, and contract/client fan-out rows only through p_target_generation.
- Ranks all relevant statuses by dedupe_key, generation, creation time, and ID, then classifies the latest effective row.
- QUEUED and RUNNING are active; FAILED and DEAD are terminal unresolved; SUCCEEDED is resolved.
- Null-generation pre-cutover rows do not participate.
- Candidate, client, and operation candidate-scope relevance are applied. Unprovable broad roots remain relevant.
- Counts are complete and diagnostic samples are capped at 25.
- Browser roles have no execute grant; service_role is granted.

### pay_preview_build_context

- Distinguishes absent admission mode from an authorised empty shortlist.
- Empty shortlist matches no candidates.
- Broad callers and explicit hard-scope callers retain their prior semantics.
- Date, client, channel, timesheet, finance-case, PAYE/Umbrella, and economic logic are unchanged.

### pay_workbench_scope_admission_candidates_v1

- Empty input returns zero immediately.
- UUIDs are deduplicated and capped.
- Explicit candidate filters are intersected before hard-scope evaluation.
- Target cannot exceed current global generation.
- Any output outside the requested shortlist raises a fail-closed error.
- The helper does not insert scope, enqueue refresh, or mutate preview rows.

### pay_workbench_scope_reconcile_ensure_v1

- Authoritative lag uses applied generation.
- Shadow lag uses scope_change_generation_shadow_checked.
- Coordinator payload captures SHADOW or AUTHORITATIVE mode.
- One global dedupe key and advisory try-lock remain.
- Ensure does not update an active coordinator or lock global generation.

### pay_workbench_scope_reconcile_drain_one_v1

- On claim, target promotes monotonically to current global generation while preserving a safe generation/entity cursor.
- The shared blocker helper is used before advancing a session.
- Authoritative mode retains bounded admission, idempotent scope insert, and existing bulk candidate-refresh enqueue.
- Shadow mode runs equivalent decisions with zero authoritative mutation and advances only the shadow watermark after a complete pass.
- The same coordinator row is requeued when more work or a newer generation exists.

### pay_workbench_scope_progress_v1

- Effective blocker authority replaces raw historical failure counts.
- display_ready remains separate from draft_safe.
- Precise codes cover initial scope, shadow mode, reconciliation lag, upstream work/failure, and candidate work/failure.
- Existing materialised rows remain visible while draft creation is unsafe.

### pay_workbench_prepare_draft_scope_seed

- Operation then session lock order remains.
- Provisional operation scope is still built and inserted in the same uncommitted RPC transaction.
- Effective blockers are checked before construction and before the late generation fence.
- Shadow mode and unresolved relevant work reject the freeze.
- No heavy scan, aggregation, eligibility, scope insert, batch creation, or chunk creation occurs after the global lock.
- Complete scope and FROZEN seal remain one atomic Policy X boundary.

### banking_pay_operation_seed_chunks

- DRAFT_CREATE candidate-scope chunks require a FROZEN operation, source-scope completion, frozen generation, counts, hash, session version, and snapshot run.
- Row count, selected-row count, provenance, terminal state, and aggregate hash are independently checked before persistent chunk creation.
- Other operation types and chunk limits are unchanged.

### pay_batch_shell_ensure_from_operation

- Operation-relevant effective blockers replace raw broad-root status checks.
- Late global lock and frozen generation provenance remain.
- Valid, stale, pending-relevance, and pending-relevance-failed outcomes are recorded.
- No post-draft live economic fallback is introduced.

### banking_pay_operation_finish

- DRAFT_CREATE cannot complete unless scope is FROZEN and complete, a matching batch exists, required chunks are complete, and candidate-scope rows are successful terminal state.
- Operation and batch provenance must agree.
- Post-freeze relevance is refreshed with the shared helper.
- A later live change does not abort an internally valid frozen operation; central batch freshness blocks consequential actions.

### pay_batch_assert_integrity

- New DRAFT_CREATE batches prove operation/batch frozen generation equality.
- Source session, version, snapshot, candidate-scope links, and batch identity must agree.
- Legacy batches retain legacy validation and are not failed solely for null generation provenance.
- Totals, VAT, PAYE/Umbrella, rates, reservations, and economic keys are unchanged.

### pay_item_snoozes_sync_identity_fields

- Computes stable SHA-256 from canonical snooze business identity and snooze-until date.
- Natural-expiry bookkeeping fields do not enter source identity.

### pay_workbench_mark_candidate_dirty

- Returns before candidate resolution, counter bump, dirty enqueue, and generation staging when changes are confined to the five natural_expiry derived fields.
- Real date, kind, source reference, clear/cancel state, and candidate/timesheet/segment identity changes still dirty normally.

### pay_workbench_enqueue_expired_snooze_refreshes_v1

- Selects only due rows whose checked fingerprint differs from source fingerprint.
- Processes at most 100 using existing transition authority and SKIP LOCKED.
- Successful unchanged evaluation updates check metadata without dirtying.
- Thrown transition remains unchecked and retries.
- Result diagnostics report examined, changed, unchanged, marker, failure, and has-more counts.

## Reviewed with no completion amendment

No completion change was required to:

- generation current/token/counter-stage/job-stage/finaliser helpers;
- dirty-event coalescing;
- contract/client and finance fan-out generation propagation;
- the installed SYNC_SKIPPED guard;
- snooze transition business authority;
- aggregate Worker drain and modal-open handler;
- initial full seed, source build, delta refresh, line work, or materialisation;
- payment, provider, settlement, or remittance functions.

Protected unrelated functions not amended:

- _import_review_action_catalog_core_v1
- _import_review_apply_envelope_core_v1
- nhsp_weekly_phase3_apply_adjustment_truth
- hr_weekly_apply_transactional
- nhsp_weekly_apply_transactional

## Verification completed

Backend completion test: tests/banking-pay-continuous-scope-completion.test.cjs, 6 of 6 passed.

Frontend verification:

- node --check js/main.js passed.
- banking-pay-continuous-scope-readiness and banking-pay-overpayment-presentation: 14 of 14 passed.
- live TEST main.js exactly matched the published blob.

TEST database evidence after installation:

- Global generation remained 9 during no-op checks.
- Current OPEN session target/applied was 9/9 and READY.
- Scope and line pending/failure counters were zero.
- Active coordinator, active generated work, and pending staging were zero.
- Empty admission returned zero.
- Shared blocker authority returned all clear.
- Clean-session display_ready and draft_safe were true.
- Shadow drain produced zero scope insert, refresh job, or applied-generation movement.
- Target-bounded FAILED/recovery/DEAD semantics were proved in a rolled-back controlled transaction.
- Snooze backfill and unchanged-expiry checking produced zero global generation, candidate sequence, dirty job, and source build.
- Generation and blocker paths retained indexed sub-millisecond plans in captured TEST evidence.
- Internal helper grants remained service-role-only.

No real payment, draft, provider submission, settlement, remittance, webhook, email/comms drain, or manual Worker drain was executed.

## Independent review and remaining evidence

A fresh chat should fetch backend test at or after e3df88f and frontend main at or after 7969919. It should compare installed TEST function definitions to the final canonical repeatables, re-run focused tests, and write a function-by-function plan only for reproduced residual defects.

Useful remaining evidence, not redesign work:

- global generation contention at 8, 16, and 32 writers plus bulk scale;
- coordinator crash/reclaim at page boundaries;
- 10,000-candidate no-change and 1,000 changed-candidate page proofs;
- 1,000 unchanged expired snoozes finishing in ten pages with zero dirty generation;
- browser rows-visible plus draft-safe-false plus automatic-re-enable evidence;
- two-user shared-session consistency;
- terminal upstream failure followed by later same-work recovery;
- continued scheduler quiet-window monitoring.

Do not replace the queue, raise source-build parallelism, add per-candidate RPCs, add a second scope queue, broaden source triggers into session scans, change economics, or weaken Policy X/freshness gates. Any proposed correction must name the exact function and reproduce the defect.

## Safety summary

- Secrets printed: no.
- Raw auth/cookies/storage state committed: no.
- TEST database schema/functions mutated: yes, explicitly requested, TEST only.
- Destructive financial actions: no.
- Normal TEST Worker deployed for this completion: no; Worker code was unchanged.
- Frontend deployed: yes.
- Production accessed or deployed: no.
- Policy X drift: none found.
- Unrelated user/other-chat files committed: no.
