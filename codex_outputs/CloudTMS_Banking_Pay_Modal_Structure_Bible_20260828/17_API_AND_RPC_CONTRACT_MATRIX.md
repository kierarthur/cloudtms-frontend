# API and RPC contract matrix

## Planned additive public RPCs

| RPC | Method class | Owns | Must reuse | Must not do |
| --- | --- | --- | --- | --- |
| `pay_workbench_session_get_candidate_summary_page_v1` | Read | Main candidate page, counts, headline, Draft gate, selected Timesheet scope | Effective section, line contract, current amount/deduction facts | New economics, browser-shaped financial formula, N+1 |
| `pay_workbench_session_set_candidate_ready_selection_v1` | Mutation | Atomic candidate SELECT/CLEAR intent | Current session locks, selection semantics, recovery revalidator, audit/revision | Browser ID fan-out, intermediate public revision, cross-candidate/channel change |
| `pay_workbench_session_set_filtered_ready_selection_v1` | Mutation response adapter | Existing all-page filtered Ready header intent and compact settlement result | Same original selected-rows owner and proved global intent branch | Per-candidate calls, visible-page selection, retaining old main rows |
| `pay_workbench_session_set_ready_rows_v1` | Mutation response adapter | Existing individual/exact-group1–100-row patch and bounded settlement | Unchanged original ROW_PATCH request/owner, overrides, recovery and audit | New selection algorithm, extra receipt/audit, silently acting on a partial group |
| `pay_workbench_session_get_candidate_ready_page_v1` | Read | One candidate's Ready-only page | Effective section and existing Ready row payload | Filter Cases/Blocked after limit, return another candidate |
| `pay_workbench_session_get_action_required_page_v1` | Read | Deduplicated Action task list and Updating summaries/count | Current case/readiness/job facts/actions | Duplicate task per payment, count Updating as Action |
| `pay_workbench_session_get_action_required_detail_v1` | Read | Complete affected scope and current permitted actions | Current finance/bank/readiness owners | Recreate resolution economics |
| `pay_workbench_session_get_blocked_page_v1` | Read | Passive Blocked list/count | Current effective Blocked facts | Include Action/Updating/indefinite snooze |
| `pay_workbench_session_get_blocked_detail_v1` | Read | Exact passive blocker detail | Current reason/amount/Timesheet facts | Ordinary selection control, guessed clear action |
| `pay_workbench_session_get_selected_ready_timesheets_v1` | Read | Resolve opaque selected-only scope token | Current selected effective Ready membership | Broad candidate search, unselected IDs, stale token widening |

## Planned Worker routes

| Method/path | RPC | Key validation |
| --- | --- | --- |
| `GET /api/banking/pay/workbench/v2/capability` | Contract/capability owner | Auth, exact contract version, read-only |
| `GET /api/banking/pay/workbench/v2/session/:id/candidates` | Candidate summary page | Session/version/progress/scope/sort/cursor/limit |
| `POST /api/banking/pay/workbench/v2/session/:id/candidate/:candidateId/selection` | Candidate selection | UUIDs, explicit action, expected revisions, idempotency, scope |
| `POST /api/banking/pay/workbench/v2/session/:id/selection` | Filtered Ready header selection | Explicit action/request/view digest and original four scope options; no candidate IDs or child input |
| `POST /api/banking/pay/workbench/v2/session/:id/candidate/:candidateId/ready-selection` | Exact Ready row patch |1–100 unique UUIDs, explicit selected boolean, request correlation, view digest/current options and optional open-child anchor |
| `GET /api/banking/pay/workbench/v2/session/:id/candidate/:candidateId/ready` | Candidate Ready page | Candidate/session/revision/scope/cursor/limit |
| `GET /api/banking/pay/workbench/v2/session/:id/action-required` | Action page | Session/revision/scope/cursor/limit plus BP-102 task-only search/sort; complete deduplicated task result before pagination |
| `GET /api/banking/pay/workbench/v2/session/:id/action-required/:taskKey` | Action detail | Opaque task key, session/revision/scope |
| `GET /api/banking/pay/workbench/v2/session/:id/blocked` | Blocked page | Session/revision/scope/cursor/limit plus BP-121 Blocked-only search/sort before pagination |
| `GET /api/banking/pay/workbench/v2/session/:id/blocked/:blockerKey` | Blocked detail | Opaque blocker key, session/revision/scope |
| `GET /api/banking/pay/workbench/v2/session/:id/candidate/:candidateId/selected-ready-timesheets` | Selected Timesheets | Exact opaque token, candidate/session/revision/scope |

## Common read envelope

First summary read only: after adopting the existing shared session/version/progress and current channel, the browser has not yet received the v2 scope hash. It omits that field and the cursor. The server computes the hash from that exact session and verifies the unchanged strict actor/revision/filter context before returning it. Every continuation, detail and mutation requires the returned hash. This avoids a new context request or browser duplication of the server hash rule; it does not create a new session or filter scope. DEV-0004 / EVIDENCE-0030.

Every list/detail read returns or validates:

- `ok`;
- session UUID;
- session version;
- progress revision;
- active scope/filter/channel hash;
- contract version;
- bounded rows/detail;
- next opaque cursor/has more/count where paged;
- safe typed error/message metadata;
- no sensitive payload or credential.

## Draft display gate — both unchanged readiness owners (STEP-060)

The compact `global.draft` object composes the existing read-only `pay_workbench_session_recompute_progress_counters(session,false,reason,false)` and `pay_workbench_scope_progress_v1(session)`, once each. Counter readiness alone is not permission to create a Draft. Preserve the continuous-scope owner's `display_ready`, `draft_safe` and exact `draft_block_reason_code`; append its non-null blocking reason to the existing counter blockers without discarding any blocker.

Required fields are `can_create_draft`, `blocker_codes`, `session_ready`, `read_only`, `work_queued`, `display_ready`, `draft_safe`, `draft_block_reason_code`, `session_selected_row_count`, `session_selected_eligible_ready_row_count`, and the existing `progress_state`/`next_recommended_action`. Both selection counts are copied from the original counter owner for the COMPLETE session. They are not candidate counts, visible-page counts, or replacements for the filtered `global.selected_ready_count`.

Both transport boundaries reject missing/wrongly typed safety fields, unsafe counts, an enabled gate with blockers or an unsafe scope, and contradictory safe/display/reason states. The gate remains bounded to2KB inside the existing total response bounds. This is internal safety metadata, not additional main-table columns or new user wording. Existing first-canonical-page initialization, frontend permissions/busy/same-week guards and the complete original Create Draft contract remain mandatory. Full legacy alias adoption is still an integration gate; these fields alone do not claim it is complete.

## Candidate summary row

Required fields:

- candidate UUID;
- canonical display name/reference;
- canonical normalised sort values;
- selectable Ready count;
- selected Ready count;
- `NONE`/`SOME`/`ALL`;
- selected current payment display decimal;
- selected canonical deduction boolean;
- selected exact Timesheet count;
- at most 25 inline IDs or opaque selected-scope token;
- child invalidation/revision token.

Every canonical candidate row additionally carries `facts_digest`: a server-generated SHA-256 of its complete existing canonical facts before the selected Timesheet IDs are compacted. Every main page carries `view_digest` over the complete scoped candidate facts, not merely its visible page. Navigation revision/token metadata is outside the facts digest. Missing or malformed digest evidence fails both response boundaries. These are change-detection metadata, not new financial authorities or permission to relabel an old row. Public mutation preimage checks and controller retention remain separately gated by DEV-0015.

Selected-Timesheet scope tokens are navigation metadata, never Draft inputs. After another candidate changes, an older token may resolve only when the request independently proves the exact current session/version/filter context and the server recomputes an identical complete selected-Ready Timesheet membership hash for that candidate. Missing, malformed, future, different-version/scope/candidate or changed-membership tokens reject. The response always contains current recomputed IDs. Ordinary paging cursor checks are unchanged. DEV-0005 / EVIDENCE-0034.

## Candidate Ready response: complete header authority

Every Ready page also returns `candidate`: the exact same canonical candidate-row projection used by the main summary, or `null` only when no selectable Ready payment remains in that candidate/filter scope. The field covers all child pages. It is not derived from the returned payment page. An unchecked candidate still has a non-null row with zero selected amount.

The open child consumes this field even if amount/deduction sorting moves the candidate off the visible main page. A supplied compatibility candidate alias or visible main row must agree before adoption. A null candidate requires an empty child page and zero total; surviving nonselectable context parents cannot keep a departed candidate visible. The original line payload and financial/Draft owners are unchanged.

This stays within one Ready RPC. Local database, Worker, presenter and browser-component proof is recorded as EVIDENCE-0027; full integrated/deployed and representative latency proof remains open.

### Ready read-position renewal — DEV-0008

The Ready reader additionally returns `page_number`, `has_previous`, `previous_cursor` and `page_anchor`. A `READY_PAGE_ANCHOR` binds session/version/candidate/scope/page size and a nonfuture progress revision; it carries read position only. Every request still independently proves exact current authority. Ordinary Ready cursors keep their strict original revision checks. A current anchored page backfills after movement/removal and falls back to the last available page or truthful empty state. An open-child mutation request uses this anchor to obtain one complete current page in its same response, never an extra automatic GET or reused old financial rows. EVIDENCE-0041 is local component proof; actual application wiring/performance remain required.

## Candidate page position and previous-page authority

Every summary page also returns `page_number`, `has_previous`, `previous_cursor` and `page_anchor`. The empty result has page number zero, no previous page and a null anchor. A nonempty main result uses a server-aligned 100-candidate page. Previous from page two uses a null cursor (start of result); later pages receive an exact server-generated predecessor cursor. The browser does not invent offsets or retain an unbounded page-history stack.

Ordinary page cursors still require the exact accepted progress revision. The separately typed `CANDIDATE_PAGE_ANCHOR` is read-position metadata only: it may renew a read across progress revisions within the same session UUID/version, filter scope, sort/direction and page size. A future revision or any changed binding fails closed. The public read must still receive and prove the exact current authority tuple independently. No amount, selection, eligibility or Draft authority is taken from an anchor.

The current server sort values of the anchor candidate determine its current aligned page. If it has left Ready, the server fills from its former boundary; if that boundary is beyond the remaining result, it returns the last current page. It never displays a false empty page while eligible candidates remain. Previous/Next round trips remain deterministic after renewal. EVIDENCE-0028 covers local runtime and boundary tests; complete controller and representative latency proof remain required.

STEP-043 additionally requires `next_page_anchor` and `previous_page_anchor`: an opaque token only when that direction is available, otherwise JSON null. These are server-issued `CANDIDATE_PAGE_ANCHOR` values with strictly whitelisted NEXT/PREVIOUS direction. The server first finds the current aligned anchor page, then advances; before-first/after-last, future and changed bindings reject. The controller passes these tokens unchanged on explicit navigation with the independently accepted current revision. Normal cursors remain revision-strict. EVIDENCE-0059 proves current public navigation after actual candidate CLEAR and all six sort directions; it does not authorise retaining other candidates without a separate current-facts proof.

### Passive Blocked list contract — STEP-042

Each compact Blocked row carries exact opaque identity, current candidate UUID/name/reference, approved/current plain-English reason and a published display decimal or JSON null where no payment exists. Source metadata, when supplied, must distinguish PREVIEW_ROW with its exact physical preview UUID from STORED_PAYEE/SOURCE_PROGRESS with no physical payment ID. The implemented server supplies these fields and preserves complete original detail through the exact detail route. Numeric amounts sort before null in either direction. PAYE/UMBRELLA and source/Action/Updating/indefinite exclusions apply before pagination. The mixed count label is still awaiting DEV-0012 wording approval; no copy change is implied by this technical contract.

## Task payment counts and complete detail pages — DEV-0009

Action rows and both detail envelopes carry `affected_candidate_count`, `affected_payment_count` and `affected_payment_count_complete`. The candidate count is exact and positive. A complete payment count is an integer including zero. An incomplete/unconfirmed payment count is JSON null with the completeness flag false; it is never coerced to zero or one. Its compact table cell is a dash with tooltip/accessibility text `Payment count not yet confirmed.` No main-table column or financial meaning changes.

A detail response identifies the exact requested `task_key` or `blocker_key`. It supplies `page_number`, `has_previous`, `previous_cursor`, `has_more`, `next_cursor` and the complete current `total_count` of detail members, distinct from affected-payment count. Each page is bounded to100 members and256KB. First-page, full-page and final-page cardinality must agree exactly; a current task must include at least its source member. More than100 members remain reachable through explicit navigation. No extra automatic request is added.

Each detail member has an opaque unique `identity`, exact candidate UUID, `source_kind`, nullable `preview_row_id`, explicit `context_only` and unchanged original `payload`. A `PREVIEW_ROW` member requires an exact matching payload payment ID. `STORED_PAYEE` and `SOURCE_PROGRESS` members have no payment ID. Source-only problems stay visible without impersonating payments. Related Ready/Blocked context retains the original section/selection authority. Session/revision/scope and item identity are checked at both boundaries; malformed continuation cannot replace an accepted detail page.

If a payload supplies a candidate ID, it must agree with the wrapper. Cross-section adoption compares the exact physical preview-row reference, not the issue's task/member presentation key. An explicit context-only detail row is a reference rather than another effective owner; contradictory wrapper/payload references still fail.

STEP-031/EVIDENCE-0047 proves the frontend/Worker boundary only. Server list/detail assembly, original action rendering, real browser and representative performance remain mandatory.

## Candidate selection response

Approved DEV-0007: the user replied `YES AND CONTINUE` on 28 August 2026. Keep the base candidate-selection reply within its existing 16/32 KB bounds, including envelope overhead. Only when Candidate Banking is already open may the reply also carry its one complete current Ready page within the existing 256/512 KB and 100-row bounds (combined preferred/investigation limits 272/544 KB). Both parts require one accepted revision. No extra automatic Ready request, all-page child payload, stale-row relabelling, financial/Draft change or latency/memory waiver is permitted. STEP-023 and EVIDENCE-0039 record the measurement; executable boundary and integration tests remain required.

Required fields:

- request/idempotency identity;
- state changed/no-op;
- new authority tuple;
- final candidate summary or absent marker;
- global counts/headline/state;
- Action/Updating/Blocked counts;
- current Draft gate;
- moved economic identities/from/to/final selected state;
- section invalidation facts;
- sort/membership reconciliation facts.

## Typed errors

### Exact individual/group row response (STEP-057)

The row adapter passes the original section, select_preview_row_ids or deselect_preview_row_ids and expected revisions to the original selected-rows owner exactly once. It validates current candidate/filter/selectability scope without reconstructing an economic key. Its response uses the same bounded candidate/Ready formatter plus selection_scope EXACT_READY_ROWS. Original cleanup and recovery may affect other visible facts; complete retention proof decides whether a summary reread is required.

The original row owner advances audit/revision even when the requested row state already holds. Preserve that behavior. request_id is correlation only, not a fabricated idempotency receipt. A repeated old-context request rejects; an uncertain result requires authoritative read-back, never blind retry. Confirmed ROW_NOT_SELECTABLE is409. All response-limit failures occur inside the mutation transaction and roll back. Complete group selection across child page boundaries is not proved by the1–100 exact-ID adapter and remains a separate gate.

### Filtered header selection response (STEP-055)

POST `/api/banking/pay/workbench/v2/session/:id/selection` delegates once to `public.pay_workbench_session_set_filtered_ready_selection_v1`. It requires the existing four options, explicit action, request identity and expected_view_digest. It rejects candidate IDs, payment ID lists, child pages, search and sort inputs. The original complete filtered selection/recovery owner remains authoritative.

The response is bounded to32KB and includes FILTERED_READY scope, before/current view digests, current revision, global headline/count/Draft facts, section counts and mandatory detail-cache invalidation. It contains no candidate or Ready child payload and requires_summary_refresh is always true. The header budget is one mutation plus exactly one anchored current summary read before one atomic adoption. This documents the existing full-scope header's settlement, not a new main-table control or a change to Draft membership.

### Candidate view-proof binding (STEP-052)

Candidate POST requires a separate64-lowercase-hex expected_view_digest; it maps to p_expected_view_digest and is not a fifth options field. Optional open_ready contains only the current child's opaque page anchor and limit1–100. The public service-only adapter delegates once to the original selected-rows owner through the bounded private response helper.

The reply includes current view_digest and exactly six retention fields: before_view_digest plus boolean other_candidates_unchanged, membership_unchanged, candidate_sort_unchanged, amount_sort_unchanged and deduction_sort_unchanged. Both transport boundaries reject missing/extra/malformed proof or a before digest different from the submitted view. A valid proof does not by itself perform browser row retention.

BANKING_PAY_V2_STALE_VIEW is a confirmed409 rejection. In-transaction selection/Ready size failures are confirmed413 rejections and roll back. An invalid or lost response after submission remains UNCERTAIN, requiring current-authority read-back rather than blind retry. None of this changes the original Draft options/guard.

At minimum distinguish:

- unauthorised/auth expired;
- session missing/replaced/not open;
- stale session version;
- stale progress revision;
- scope mismatch;
- candidate/task/blocker no longer current;
- malformed/stale/cross-scope cursor;
- nonselectable/no eligible change;
- invalid amount/selection/deduction authority;
- duplicate/cross-section identity;
- dependency/database/Worker transport failure;
- uncertain mutation outcome requiring read-back.

Never translate dependency failure into a false payment validation message.

## Existing unchanged mutation owners

Continue to reuse current authorities for:

- individual/global selected rows;
- case apply/clear;
- decision operations;
- Timesheet exclusion;
- bank-details acceptance/name override;
- account-name/readiness/payee mapping;
- snooze/unsnooze;
- clear all Decisions;
- refresh current authority;
- Create Draft and later lifecycle.

The v2 controller may adapt request construction and settlement. It must not recreate those owners.

## Working clarification — Action Required list queries

BP-102 includes task search/sort/paging inside Action Required. Its search value and approved task sort must bind the Action cursor and apply before the 100-task page limit. They must not alter selected membership, the Ready headline or Draft scope. They must never appear on the main candidates route. The first route-validator draft omitted these Action-only inputs; implementation and parity tests remain required, not waived. No product decision was reopened.

BP-121 likewise retains search/sort/paging inside Blocked for Pay. Its independent query state and cursor binding must follow the complete Blocked result, not just the loaded page. Neither list search changes the main filters or payment selection. The initial Worker draft also omitted these Blocked-only inputs; this is an implementation gap, not an approved removal.

### Implemented list-transport characterization (not SQL/list activation)

The Action read has a whitelisted `view` of `ACTION_REQUIRED` (default) or `UPDATING`, passed as `p_view`. Updating uses fixed TITLE/ASC and no search. Both views have100-row paging. The ordinary Action response retains separate `updating` summaries (first100), `updating_count`, `updating_has_more` and `updating_next_cursor`. An explicit Updating continuation uses that same endpoint/view and returns its current page as `rows`; it is not permitted to reinterpret the first100 inline summaries as the complete result. All cursor bindings include the view. Total response limit remains256KB; no new main-table feature or selection/Draft scope is introduced. STEP-040 must prove controller integration before activation.

- Action list sort keys: `TITLE`, `CANDIDATES`, `PAYMENTS`. Blocked list keys: `CANDIDATE`, `REASON`, `AMOUNT`. Both use explicit `ASC`/`DESC` and stable server ties before paging.
- `search` is a trimmed list-only string, at most 200 UTF-16 code units, rejecting control characters. It is passed separately as `p_search`, never inserted into `p_options_json`, selected membership or Draft filters. SQL must bind the exact list search/sort to its own cursor and use literal parameterized matching.
- Responses echo `search`, `sort_key`, `sort_direction` and `scope_count`; the searched result count cannot exceed the unsearched scope count. Ready/candidate routes reject these additional list-only search inputs.
- Both list boundaries require `page_number`, `has_previous`, `previous_cursor`, exact row cardinality under the requested limit, and matching `has_more`. Empty results use page0. An explicit first-page request cannot return page2. Previous from page2 is a null first-page cursor; later pages require an exact server cursor. An unsearched result count equals its full scope count. A truncated response is an error, never a smaller valid page.
- The original list transport characterization passed 82 Worker tests; the combined Worker boundary suite now passes 100 after child/anchor safeguards. The issue-list presenter passes 29 unit checks. Actual server list/deduplication queries, browser and action execution are still open.

## Create Draft compatibility — controlling supplement

Read `23_CREATE_DRAFT_COMPATIBILITY_CONTRACT.md` before implementing any Draft adapter. The existing endpoint and frontend/Worker/database owners stay unchanged. Candidate summary amounts and candidate/Timesheet IDs are not Draft input. A bounded v2 review uses the existing incomplete-ID/revision contract and the original full selected-payment reread.

Do not replace the old all-channel selected count with the filtered display count. Preserve session signature, original first-page proof, complete reviewed IDs versus scoped Draft IDs, row/economic-key contracts, recovery certificates, security/preflight checks and frozen downstream ownership. Component/runtime parity now passes; actual full-browser submission parity remains a release gate.
