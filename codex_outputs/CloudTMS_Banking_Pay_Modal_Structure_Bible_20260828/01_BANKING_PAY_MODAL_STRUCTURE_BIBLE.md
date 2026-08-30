# CloudTMS Banking Pay candidate redesign

## Controlling, corrected, implementation-ready plan — TEST only

**Prepared:** 28 August 2026  
**Status:** Planning and read-only audit complete. No implementation, database change, deployment, or TEST data mutation is authorised by this document.  
**Primary objective:** Make pre-Draft Banking Pay materially simpler and faster without losing, weakening, duplicating, or changing any current functionality or payment authority.

---

## 1. Decision and readiness statement

This redesign is a **targeted pre-Draft Banking Pay presentation and controller change**, not a full Banking rewrite.

The implementation must:

- replace the overwhelming main pre-Draft payment-level view with one compact candidate row;
- move, rather than remove, the existing detailed payment controls;
- keep current database-owned payment economics, eligibility, selection, recovery, Draft preparation and every post-Draft lifecycle unchanged;
- add only the bounded server projections and one candidate-scoped selection operation that the new presentation genuinely needs;
- retain the complete current interface behind a controlled TEST fallback until parity and performance have been proved.

There are **no unresolved product choices** in this plan. Empirical checks immediately before and during implementation are proof gates, not opportunities to reinterpret the design.

### 1.1 Post-review visual refinement

The first deployed TEST presentation exposed layout problems without changing the accepted economic or Workbench contract. The subsequently agreed presentation refinement is controlled by:

- `04_SETTLED_DECISION_REGISTER.md`, as amended;
- `24_VISUAL_PRESENTATION_POLICY_AND_CODE_TRACE.md`.

Those documents control the global Banking destination menu, outer Banking tabs, proper Ready/Action/Blocked underline tabs, separate child-modal containment, Payment Batches separation, ID History nesting, compact Timesheets icon, compact status panels, amount alignment, group-level payment-method wording and arbitrary multi-rate presentation.

They are targeted presentation amendments only. They do not reopen the database, selection, recovery, Create Draft, post-Draft or Policy X decisions in this plan. Until the new executable and real TEST evidence closes document 24, the accurate status is `IN_PROGRESS`; earlier visual screenshots are not acceptance evidence for the refined presentation.

---

## 2. Binding specification bundle

This plan is controlling together with the following already accepted audit:

- `codex_outputs/banking-pay-functionality-message-audit/report.md`
- Audited SHA-256: `AFD124655E4020FA061209F23914BB25D853F05BB6546DFB9DAA718F76206D6F`
- It contains the canonical **136-functionality ledger** (`BP-*`) and **89-message change ledger** (`MSG-*`).

Those original IDs must remain unchanged in implementation traceability. Do not replace them with a newly numbered list.

One bookkeeping correction is now binding:

- The original audit heading incorrectly said 29 actions; the canonical audit has now been corrected to **30**.
- Its table and the current source both contain the same **30** distinct action names.
- Therefore the deletion guard is **30 core visible actions**, plus 15 separately rendered compatibility/nested handlers: **45 unique action names in total**.
- This correction changes no functionality; it prevents one action being lost because of a wrong count.

If this plan and an earlier planning response differ, this plan and the canonical audit above win.

---

## 3. Evidence refreshed for this plan

### 3.1 Repository observations

Read-only fetch and comparison on 28 August 2026 found:

- Frontend `origin/main`: `b66b2a61d3d266ef4e9a3d410061274ca74a7a8e`
- Backend `origin/test`: `a965f4461257abc58625824f87b1b9e2aace0327`

These are observations, not implementation pins. Re-fetch both immediately before implementation.

The saved local clones contain unrelated user changes and differ from the remote heads. They must not be reset, overwritten, restored, or mixed into this work. When implementation is authorised, use clean dedicated worktrees from the then-current approved heads, or another equally safe isolation method that preserves every existing local change.

The newer repository work inspected since the earlier audit concerns Candidate/Timesheet and other unrelated features. It has not introduced this Banking Pay redesign and has not replaced the audited Workbench authorities.

### 3.2 Current Miget TEST observations

The permanent CloudTMS Miget Operations connector was proved in this same audit:

- authenticated;
- read-only;
- current `agency_test` healthy;
- current `mytms_test` healthy;
- no LIVE database was accessed.

Current agency TEST observations included PostgreSQL 17.11, 1,332 non-system functions, 201 recorded migrations and 406 repeatables. The newest releases were unrelated to this redesign.

The exact current installed signatures were re-read for the core Workbench owners, including:

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
- `pay_workbench_session_refresh_current_authority_v1`
- `pay_workbench_prepare_draft`
- `pay_workbench_enqueue_payee_readiness_ensure`
- `pay_workbench_contract_version_get_v1`
- `_pay_workbench_candidate_projection_contract`

The installed source confirms:

- the database owns effective section, selectability, draftability, current row display facts and recovery revalidation;
- the current candidate preview mixes Ready, Cases/Resolutions and Blocked before/within its page contract and therefore cannot safely power the new Ready-only Candidate Banking modal;
- current global all-page Ready select/clear exists;
- current atomic candidate-wide all-page Ready select/clear does not exist;
- the five bounded v2 capabilities in section 12 do not currently exist.

---

## 4. Hard boundaries

### 4.1 TEST only

In scope only when separately authorised:

- `TEST-Frontend`;
- `cloudtms-backend` branch `test`;
- Miget `agency_test`;
- the normal TEST Worker and frontend release paths;
- an isolated TEST patch path if separately selected.

Out of scope:

- all LIVE databases, Workers, endpoints, credentials and deployments;
- provider payment submission;
- settlement, remittance, cancellation execution or webhook replay;
- email/comms drains;
- any unrequested data mutation;
- any change to post-Draft financial ownership.

### 4.2 Policy X and payment authority

The following are immutable:

- Current live truth is used only before Draft through established Workbench authority.
- After Draft creation, frozen Draft/batch artefacts remain sole financial authority.
- `TS_DAY` remains date-bucketed as `YYYY-MM-DD`.
- No new economic-key derivation ladder.
- No live post-Draft finance fallback.
- No bypass of freshness, fingerprint, digest, ownership or staleness fences.
- No browser calculation of financial authority.
- No change to VAT, ERNI, PAYE/Umbrella treatment, recovery allocation, Draft economics, provider execution, settlement, remittance or cancellation.

### 4.3 Current Workbench invariants

Preserve:

- one effective visible section per economic identity;
- server-owned eligibility and selection;
- candidate and pay-channel recovery partitions;
- deterministic recovery allocation order;
- zero, partial and full recovery semantics;
- explicit user unselection overrides;
- current automatic selection of newly eligible recoveries except where the current explicit override says otherwise;
- same-session and same-revision Ready/Blocked reconciliation after selection changes;
- Draft readiness and Draft input authority;
- all current resolution, cancellation, exclusion, snooze, bank/readiness and clear-decision authorities.

---

## 5. Final product contract

### 5.1 Main Banking Pay modal

The main Ready table has exactly four visible cells per candidate row:

| Column | Exact purpose |
| --- | --- |
| Include | A dedicated narrow candidate tri-state checkbox on the far left. The header contains the existing all-pages Ready select/clear control and is not sortable. |
| Candidate | Canonical candidate display name and reference on the same physical line. |
| Deductions | `Yes` when at least one currently selected, selectable/draftable effective Ready payment is a canonical server-recognised deduction; otherwise `—`. |
| Ready to pay | Candidate's current selected pre-Draft display amount, with the compact selected-only Timesheets shortcut immediately beside it. |

This corrects superseded proposals that put the checkbox inside Candidate or added a Timesheets column.

The main table must have:

- one physical, non-wrapping row per candidate;
- no expansion control;
- no expandable child row;
- no payment-level detail;
- no card conversion;
- no View/Details button;
- no Actions column;
- no Gross, Net, VAT, ERNI, PAYE, Umbrella, deduction amount or other financial column;
- exactly 100 candidates per full page;
- default Candidate A–Z order;
- fixed header/actions outside the scrolling body where practical.

Example only:

```text
[✓]  Jane Smith · C-10482                         Yes     £1,284.50  [Timesheets]
[−]  John Taylor · C-10891                        Yes       £640.25  [Timesheets]
[ ]  Priya Patel · C-11004                          —         £0.00  [disabled Timesheets]
```

`[−]` represents the browser's native indeterminate checkbox state, not a custom financial state.

### 5.2 Candidate membership and checkbox rules

A candidate appears only when at least one current payment is all of:

- inside the active pay date/week/filter/channel scope;
- in the server's effective Ready section;
- currently selectable;
- currently draftable under the existing line contract.

If the candidate has selectable Ready payments but none is selected:

- keep the candidate row;
- show an ordinary unchecked checkbox;
- show `£0.00`;
- show `—` under Deductions;
- disable the main Timesheets shortcut because its scope is selected-only.

If the candidate has no selectable Ready payment:

- do not show the candidate in the main table;
- do not show a persistent disabled candidate checkbox;
- continue to show any Action Required, Updating or Blocked facts in their correct separate views/counts.

Candidate checkbox state is calculated across every selectable Ready payment for that candidate, not the loaded child page:

- checked = all selected;
- indeterminate = some selected;
- unchecked = none selected.

A checkbox may be temporarily disabled while its mutation is being settled. That busy state is not the same as an ineligible candidate.

### 5.3 Headline amount — exact settled meaning

The headline is simply:

```text
SUM(all candidate Ready-to-pay amounts in the complete active candidate list)
```

Equivalently, it is the sum of every currently selected, selectable/draftable effective Ready payment's existing current display amount, once, across the complete active scope and every page.

It is **not**:

- the visible page subtotal;
- PAYE net pay;
- eventual bank-out;
- a gross-minus-new-deduction browser equation;
- a second subtraction of a recovery already represented by the selected display amount.

PAYE net is entered only after Draft creation and is irrelevant here.

Both the candidate amount and headline are returned as server-owned decimals from the same accepted session/revision. The browser may apply currency formatting only.

Required invariant:

```text
headline == exact server sum of candidate amounts over the complete current filtered result
```

The server must test this invariant; the browser must not establish it by summing the 100 visible rows.

### 5.4 Deductions — exact settled meaning

Show `Yes` only where at least one current payment contributing to the candidate's selected Ready scope has the canonical server deduction marker.

Show `—` otherwise. Do not show `No`, because the candidate may have an unselected or Blocked deduction elsewhere.

The value updates at the same accepted revision as selection, promotion, demotion, exclusion, resolution and amount changes.

Never infer a deduction from:

- a negative number;
- a label;
- a browser-maintained list of line types;
- a finance component that is evidence only;
- a Blocked or Action Required payment.

### 5.5 Main Timesheets shortcut — exact settled meaning

The main shortcut opens only exact distinct Timesheet IDs linked to the candidate's **currently selected effective Ready payments** in the active scope.

Rules:

- Unticked-only payments contribute no Timesheet ID.
- If one selected and one unselected payment share the same Timesheet ID, include that ID once because a selected payment links it.
- Never perform a broad candidate Timesheet search.
- Opening Timesheets retains the current behaviour of updating/showing the Timesheets summary without closing Banking Pay.
- The icon remains in the row next to Ready to pay; there is no Timesheets column.
- The shortcut stops `pointerdown`, `click` and `dblclick` propagation so it never opens Candidate Banking.

When the selected scope has no Timesheet:

- keep a neutral disabled icon in the same position to preserve row alignment;
- use exact tooltip: `No Ready Timesheet is linked to this candidate's selected payments.`

Payload rule:

- Return an exact selected Timesheet count.
- Inline at most 25 distinct UUIDs.
- Above 25, return an opaque server-owned selected-scope token bound to session, version, progress revision, channel/filter scope and candidate.
- Resolve that token on click in one bounded read.
- A token is not a candidate search and may never widen the selected scope.

### 5.6 Main row opening

Double-clicking a candidate row's non-interactive area opens Candidate Banking.

Do not add:

- a View breakdown button;
- an Actions column;
- a new keyboard-opening product requirement;
- row expansion.

Checkboxes, Timesheet icons, links and buttons must never trigger row opening.

### 5.7 Sorting and pagination

The Include header is the global selection control, not a sort key.

The other three headers sort the complete filtered candidate result on the server before pagination:

| Key | Ascending | Descending | Stable tie-break |
| --- | --- | --- | --- |
| Candidate | Normalised name A–Z | Name Z–A | reference, then candidate UUID |
| Deductions | `—` first, then `Yes` | `Yes` first, then `—` | Candidate A–Z, reference, UUID |
| Ready to pay | Numeric low–high | Numeric high–low | Candidate A–Z, reference, UUID |

Requirements:

- never sort only the 100 browser rows;
- keyset cursor, not offset paging;
- opaque cursor bound to session, version, progress revision, active scope hash, sort key and direction;
- sort/filter change resets to page one and invalidates the previous cursor;
- deterministic null placement;
- no duplicates or skipped candidates;
- mutations that change the current sort value trigger at most one bounded page reconciliation before Draft is re-enabled.

### 5.8 Filters and search

Retain the exact current authoritative filters and Draft semantics:

- pay date;
- week-ending cutoff;
- canonical Candidate picker/filter;
- canonical Client picker/filter;
- Both PAYE and Umbrella (`ALL`);
- PAYE only;
- Umbrella only;
- any current filter found at the exact implementation head must be added to the traceability ledger before coding continues.

Candidate and client filters continue to intersect. Hidden selection behaviour and channel-scoped Draft safety remain unchanged.

Do **not** add a new main-table display-only candidate search, search count, search hash or search-specific cursor state.

The existing Candidate picker may retain its own current find/pick behaviour because it is the authoritative existing filter, not a new table search.

---

## 6. Candidate Banking modal

Candidate Banking is a separate modal over the still-mounted main Banking Pay modal.

It is bound to one:

- Workbench session;
- accepted session version;
- accepted progress revision;
- candidate UUID;
- active pay-channel/filter scope.

The database filters to effective Ready before pagination.

It contains:

- one candidate only;
- selected and unselected current Ready payments;
- individual payment checkbox;
- candidate all/clear checkbox;
- Timesheet group checkbox with all/some/none state;
- every current detailed field removed from the main table;
- every current Ready breakdown and expandable component detail;
- exact Timesheet navigation;
- current Ready snooze controls where currently allowed;
- current exclusion/include control where currently allowed;
- resolved/correction evidence;
- exact existing clear/cancel action for an already resolved Ready decision where current authority publishes it;
- current Ready CSV/export behaviour, including a candidate all-pages Ready export;
- server cursor with maximum page size 100.

It excludes before pagination:

- Action Required;
- Updating;
- Blocked for Pay;
- indefinite snoozes;
- other candidates.

It may retain the existing payment-level expansion because this is the detail modal. The prohibition on expansion applies absolutely to the main candidate table.

Closing Candidate Banking restores the exact main page, sort, filters, scroll and focus. The main row, amount, Deductions, checkbox and headline must already reflect the last accepted revision.

If the candidate loses its final selectable Ready payment while open:

- remove the payment only after authoritative reclassification;
- show a truthful empty Candidate Banking state;
- remove/reconcile the main candidate row;
- never insert Action Required or Blocked rows into Candidate Banking to fill the gap.

---

## 7. Action Required and Updating

### 7.1 Meaning

`Action Required` means a person can and must do something now.

It includes current server-published actions such as:

- suggested/manual rate decision;
- manual amount/gross-total decision;
- bucketed and non-bucketed resolution;
- taxable payment-method restructure;
- missing/incomplete candidate or umbrella bank details;
- account-name check required, close match, unavailable or failed where review is allowed;
- bank account/payment setup required;
- inactive umbrella company where reactivation is available;
- retryable source/readiness failure.

It is not a renamed copy of all Blocked rows.

### 7.2 One problem, one task

Deduplicate tasks before pagination.

Examples:

- One umbrella bank-account problem affecting ten candidates is one Action Required task.
- Opening it lists all ten candidates, every affected payment/component and every exact Timesheet.
- One finance case is not multiplied into one task per presentation row.

Stable task families/keys:

| Family | Stable identity |
| --- | --- |
| Finance resolution | finance case UUID + current resolution lineage/version |
| Component decision | candidate/payment/component identity + source-basis fingerprint |
| Bank-detail acceptance | canonical payee owner + exact bank-details fingerprint |
| Account-name check | payee owner + checked-details fingerprint + result version |
| Payee mapping | payee owner + provider + environment |
| Umbrella activation | canonical umbrella account UUID |
| Retryable source/readiness failure | source/job owner + failure generation |

The task list is compact. The task detail holds the longer wording and all evidence, affected candidates, payments, components, Timesheets, amounts, pay routes, Draft impact, preconditions and existing actions.

### 7.3 Updating

`Updating` contains non-terminal CloudTMS work such as queued, pending, running, in-progress, source-build pending, line-work pending and delta-refresh pending.

Rules:

- Updating does not increase Action Required.
- Updating does not increase Blocked.
- Show a compact `Updating {n}` status only when nonzero.
- It may open/focus a separate Updating subsection inside the Action Required modal.
- A failed job moves to Action Required only when the server publishes an operator action; otherwise it moves to Blocked.
- Do not tell users to keep refreshing; adopt the result automatically.

### 7.4 Main buttons

Keep permanent, easy-to-find controls in the main header:

- `Action Required ({task count})`
- `Blocked for Pay ({blocked payment count})`

Action Required count is unique human tasks. Blocked count is unique passive blocked economic payment identities. Updating is reported separately.

Both main buttons remain visible at zero so users know where these views are.

---

## 8. Blocked for Pay and Snoozes

### 8.1 Blocked meaning

Blocked is passive and not ordinarily selectable. The user cannot resolve it now through an available Banking Pay action.

It includes, according to current server authority:

- `Insufficient funds to deduct`;
- passive residual of a partial deduction where it has its own economic identity;
- dated snooze/on hold where current policy keeps it in Banking Pay;
- Do Not Pay;
- Blocked Timesheet authority;
- terminal source/readiness failure with no safe current user action;
- unknown external payment problem that cannot safely be classified elsewhere.

Each Blocked detail provides:

- candidate;
- exact economic identity;
- pay route;
- server-published affected amount where meaningful;
- concise reason;
- what must change, where known;
- exact Timesheet shortcut where one exists;
- only current safe controls, if any;
- safe non-secret support reference for unknown/system failure.

It has no ordinary payment selection checkbox.

### 8.2 Indefinite snoozes

Indefinite snoozes appear **only** in the existing Snoozes tab.

Exclude them before:

- candidate grouping;
- Ready amount/headline;
- Deductions;
- Action Required task creation/count;
- Updating count;
- Blocked count;
- sorting;
- pagination;
- Banking Pay empty/status messages.

Banking Pay must show neither a hidden-item count nor an indefinite-snooze explanation.

The Snoozes tab and all of its existing management functionality remain unchanged.

---

## 9. Full functionality placement and zero-loss rule

The canonical 136-item ledger remains the row-by-row proof source. Its section totals are:

| Canonical range | Count | Future owner |
| --- | ---: | --- |
| BP-001–BP-016 | 16 | Main session, filters, loading and lifecycle controller |
| BP-020–BP-043 | 24 | Main candidate table/header |
| BP-050–BP-077 | 28 | Candidate Banking |
| BP-080–BP-104 | 25 | Action Required and Updating |
| BP-110–BP-124 | 15 | Blocked for Pay and Snoozes boundary |
| BP-130–BP-142 | 13 | Draft safety/equivalence |
| BP-150–BP-164 | 15 | Unchanged post-Draft lifecycle |
| **Total** | **136** | Every row requires executable evidence |

No BP item may be marked complete merely because the old button still exists. Completion requires:

1. exact future owner;
2. exact route/RPC owner;
3. exact UI entry point;
4. success test;
5. stale/no-op/failure test;
6. fallback/rollback proof;
7. no duplicate handler or double dispatch.

### 9.1 Corrected 30-action deletion guard

All of these current visible names require a v2 owner and parity test:

1. `banking:pay:acceptBankDetails`
2. `banking:pay:clearCaseResolution`
3. `banking:pay:clearFilters`
4. `banking:pay:componentClearResolution`
5. `banking:pay:componentManualAmount`
6. `banking:pay:componentManualRate`
7. `banking:pay:componentUseSuggested`
8. `banking:pay:createDraft`
9. `banking:pay:ensurePayeeMap`
10. `banking:pay:exportReadyToPayCsv`
11. `banking:pay:manageSnooze`
12. `banking:pay:openBucketedResolution`
13. `banking:pay:openChild`
14. `banking:pay:openFiltersModal`
15. `banking:pay:openNonBucketResolution`
16. `banking:pay:openSnooze`
17. `banking:pay:openTaxableFinanceCaseRestructure`
18. `banking:pay:previewPage`
19. `banking:pay:refreshDraftCreateStatus`
20. `banking:pay:runBankNameCheck`
21. `banking:pay:snoozeAllExpenses`
22. `banking:pay:toggleAllReadyPreviewRows`
23. `banking:pay:toggleExcludeTimesheet`
24. `banking:pay:togglePreviewRow`
25. `banking:pay:toggleTimesheetBreakdown`
26. `banking:pay:toggleTimesheetPreviewGroup`
27. `banking:pay:toggleWorkbenchSection`
28. `banking:pay:unsnoozeAllExpenses`
29. `banking:pay:viewDraftCreateStatus`
30. `banking:pay:viewRowTimesheets`

Also preserve nested/compatibility entry points, including:

- account-name override set and clear;
- payee-readiness ensure;
- explicit select/clear helpers;
- filter candidate/client pick and clear;
- full Refresh and Clear all Decisions;
- current post-mutation candidate settlement;
- current Draft operation recovery/status flows.

`toggleWorkbenchSection` is the only shell action deliberately replaced: its embedded section panels disappear, but their complete contents/actions move to the permanent Action Required and Blocked modal buttons.

---

## 10. Wording and message contract

The accepted 89-item `MSG-*` ledger is binding and contains only copy that changes or is added. Wording not listed there remains unchanged.

Key locked wording includes:

- `Action Required`
- `Ready to pay`
- `Deductions`
- `Yes`
- `—`
- `Insufficient funds to deduct`
- `There is not enough pay available in this run to make this deduction.`
- `Deduction scheduled for this pay run`
- `Can be deducted now: £{amount}`
- `Payment was originally PAYE. Candidate is now paid through an umbrella company.`
- `Payment was originally through an umbrella company. Candidate is now PAYE.`
- `No Ready Timesheet is linked to this candidate's selected payments.`

Presentation rules:

- Keep internal codes for logic/audit/support, but never expose them as user text.
- Messages must be specific, plain English and actionable.
- Payment-method wording must state original and current method explicitly.
- Do not guess source/target method when facts are missing or mixed; keep the payment fail-closed in Action Required with a visible unclassified explanation.
- Do not use `headroom`, `payee`, `canonical preview`, raw enum names or internal field names in user messages where the accepted ledger replaces them.
- Do not hard-code the same mapping independently in several modals. Use stable server reason/action facts and one tested presentation mapping.

### 10.1 Room for wording without clutter

The main candidate table contains no long status sentences.

Action Required and Blocked list rows show a concise approved title. Full explanations, affected-payment lists and next steps appear in a detail pane/modal opened from that row.

Requirements:

- sensible minimum column widths;
- bounded horizontal scroll where a complete table cannot fit;
- ellipsis only when the full value is available in tooltip/detail;
- no silent text clipping;
- no hidden errors;
- no main-row wrapping;
- detailed modal text may wrap normally in its dedicated detail area.

---

## 11. Server-owned amount contract

The current frontend display chain is:

```text
renderCompactReadyAmountHtml
→ getPreviewLineDisplayAmount
→ manual-debt/recovery special handling
→ getLineSectionAmount
→ current amount/section fallback precedence
```

The installed preview-page RPC also publishes current normalised amount facts and the canonical deduction marker.

Implementation must factor or reuse one private server projection for `current_payment_display_amount`; it must not create a new financial equation.

For every top-level effective Ready identity:

```text
server current_payment_display_amount
== current compact Ready display amount for the same canonical input
```

The accepted `AMT-001`–`AMT-019` fixture matrix in the solid plan must be implemented, including:

- ordinary PAYE;
- VAT-aware Umbrella;
- parent versus promoted children;
- `TS_DAY` versus synthetic `TS_TOTAL`;
- expenses/additional payments;
- manual debt;
- full/partial/zero overpayment recovery;
- loans and payment advances;
- standalone finance adjustments;
- resolution-derived Ready;
- carry-forward/correction carrier;
- duplicate presentation parents;
- frozen post-Draft overlap;
- zero-current-value identities.

Every fixture proves exact signed decimal, selected contribution, unselected zero contribution, no parent/child duplication, no second deduction subtraction, candidate amount, full headline and Draft identity parity.

---

## 12. Five required additive v2 capabilities

The current 28 August catalogue contains no conflicting functions with the names below. These are the planned exact public RPC names; Phase 0 must confirm they remain unused before creation:

| Logical capability | Planned exact public RPC(s) |
| --- | --- |
| Candidate summary/headline | `pay_workbench_session_get_candidate_summary_page_v1` |
| Candidate-wide selection | `pay_workbench_session_set_candidate_ready_selection_v1` |
| Candidate Ready detail | `pay_workbench_session_get_candidate_ready_page_v1` |
| Action Required/Updating | `pay_workbench_session_get_action_required_page_v1`; `pay_workbench_session_get_action_required_detail_v1` |
| Passive Blocked | `pay_workbench_session_get_blocked_page_v1`; `pay_workbench_session_get_blocked_detail_v1` |
| Selected Timesheet token resolution | `pay_workbench_session_get_selected_ready_timesheets_v1` |

Private helper names may follow the same dated/versioned repository convention, but no public contract may be silently renamed after frontend/Worker contract fixtures are frozen.

### 12.1 Candidate summary/headline page

Input:

- session UUID;
- accepted session version and progress revision;
- active channel/filter/scope hash;
- `CANDIDATE`, `DEDUCTIONS` or `READY_TO_PAY` sort;
- direction;
- opaque cursor;
- limit, default/max 100.

Output:

- exact authority tuple and scope hash;
- global candidate/selected payment counts;
- global tri-state;
- full-scope selected headline;
- Action Required task count;
- Updating count;
- Blocked payment count;
- current Draft gate/status;
- up to 100 candidate summaries;
- next cursor/has more/complete filtered candidate count;
- typed message/error metadata.

Each candidate summary returns:

- candidate UUID;
- canonical name/reference and sort values;
- complete selectable and selected Ready counts;
- `NONE`, `SOME` or `ALL`;
- selected current payment display amount;
- selected-deduction boolean;
- exact selected Timesheet count and inline IDs or deferred token;
- child invalidation token/revision.

No candidate search input exists.

### 12.2 Atomic candidate-wide select/clear

Request:

- request/idempotency UUID;
- session UUID;
- candidate UUID;
- explicit `SELECT_ALL_READY` or `CLEAR_ALL_READY`;
- expected session version;
- expected progress revision;
- active scope hash.

It is one transaction and one externally visible accepted revision.

Under lock it must:

1. prove current open/non-replaced session and actor;
2. prove expected versions/scope;
3. materialise the complete candidate selectable effective Ready set set-wise;
4. apply explicit candidate intent across all pages;
5. preserve every ineligible, Action Required, Updating, Blocked, snoozed-out and post-Draft identity;
6. use the current selection/recovery authority, not duplicated financial logic;
7. revalidate recovery exactly once;
8. settle promotion/demotion and explicit override behaviour;
9. finish with all final selectable Ready selected for SELECT, or none selected for CLEAR;
10. advance one accepted revision and write one audit receipt;
11. return a genuine no-op without a partial write;
12. return final candidate/global summaries, Draft gate, section movement and page-reconciliation facts.

Never implement this as browser fan-out, child-page loops or repeated current row mutations.

Exact intent rules:

- `SELECT_ALL_READY` clears/overrides prior individual unselection intent for this candidate, selects the complete current Ready set and leaves every final selectable Ready identity selected, including one promoted by that same recovery revalidation.
- `CLEAR_ALL_READY` establishes explicit candidate clear intent, clears the complete current Ready set and leaves every final selectable Ready identity unselected.
- Neither action changes another candidate or another pay-channel recovery partition.
- The existing main-header global select/clear continues to operate over the complete active filtered Ready section across all candidate pages; it is not rebuilt as one request per candidate.

### 12.3 Ready-only candidate page

Input:

- session/revision/scope;
- candidate UUID;
- cursor;
- limit max 100.

Filter by effective Ready before limit. Return current canonical Ready rows and all existing detailed/action metadata needed by Candidate Banking. Do not include Action Required, Updating, Blocked or indefinite snoozes.

### 12.4 Action Required/Updating list and detail

The list deduplicates stable tasks before pagination and returns compact task summaries plus separate Updating summaries/count.

The detail route returns every affected candidate/payment/component/Timesheet and current permitted action. It reuses existing resolution/readiness mutation owners.

### 12.5 Passive Blocked list and detail

The list groups by current passive economic blocker identity before pagination and excludes Action Required, Updating and indefinite snoozes.

The detail returns exact reason, affected amount, clear condition, Timesheet scope and current safe optional controls.

### 12.6 Exact selected Timesheet resolution

This is a bounded branch of the candidate-summary capability, not a sixth business capability. It accepts only the opaque selected-scope token and returns the exact current selected Ready Timesheet UUIDs after revision/scope validation.

---

## 13. Worker contract

Use one contained Banking Pay v2 controller/module in the backend with minimal router integration.

Planned exact TEST API surface:

| Method and path | Purpose |
| --- | --- |
| `GET /api/banking/pay/workbench/v2/capability` | Read-only contract/capability discovery. |
| `GET /api/banking/pay/workbench/v2/session/:id/candidates` | Main candidate page, counts, headline and Draft gate. |
| `POST /api/banking/pay/workbench/v2/session/:id/candidate/:candidateId/selection` | Atomic candidate `SELECT_ALL_READY`/`CLEAR_ALL_READY`. |
| `GET /api/banking/pay/workbench/v2/session/:id/candidate/:candidateId/ready` | Ready-only Candidate Banking page. |
| `GET /api/banking/pay/workbench/v2/session/:id/action-required` | Deduplicated Action Required plus Updating summaries/count. |
| `GET /api/banking/pay/workbench/v2/session/:id/action-required/:taskKey` | Exact task detail and affected scope. |
| `GET /api/banking/pay/workbench/v2/session/:id/blocked` | Passive Blocked page. |
| `GET /api/banking/pay/workbench/v2/session/:id/blocked/:blockerKey` | Exact Blocked detail. |
| `GET /api/banking/pay/workbench/v2/session/:id/candidate/:candidateId/selected-ready-timesheets` | Resolve an opaque selected-only Timesheet scope token. |

Opaque task/blocker keys and cursors must be URL-safe and server validated. They are identifiers, not user-entered search values.

Responsibilities:

- current auth and Workbench permission checks;
- strict UUID/enums/cursor/limit/version validation;
- one RPC per logical read/mutation;
- exact response-envelope validation;
- typed error mapping;
- safe non-secret support references;
- read-only capability/version response;
- no amount/recovery arithmetic.

Do not:

- add N+1 per-candidate reads;
- call one RPC for each payment;
- map dependency failures to false business validation;
- broaden database grants;
- log payment/bank payloads;
- access LIVE.

Capability shape:

```json
{
  "banking_pay_workbench_v2": {
    "available": false,
    "contract_version": 1
  }
}
```

Routes may exist while `available` remains false.

---

## 14. Frontend architecture and settlement controller

Use one lazily loaded Banking Pay v2 module with a narrow integration seam in the current main asset.

It owns:

- one adopted Workbench authority tuple;
- active filters/channel scope;
- candidate summary page/sort/cursor history;
- Candidate Banking pages;
- Action Required/Updating pages/details;
- Blocked pages/details;
- one ordered mutation queue;
- request generations/abort controllers;
- modal stack, focus and scroll restoration;
- one atomic render boundary.

Legacy and v2 must never be mounted together for the same session.

### 14.1 Mutation states

Every selection/exclusion/resolution/readiness/snooze mutation follows:

```text
QUEUED
→ DISPATCHED
→ SERVER_ACCEPTED
→ RECONCILING
→ VALIDATED
→ ADOPTED
```

Terminal alternatives:

```text
REJECTED_TYPED
TRANSPORT_UNCERTAIN
SUPERSEDED
FAILED_VISIBLE
CLOSED
```

Rules:

- no optimistic financial amount, Deductions, count or Draft gate;
- disable affected controls and Draft while unsettled;
- explicit desired state, never stale toggle inference;
- serialize incompatible session/candidate mutations;
- late older results cannot publish;
- transport uncertainty triggers authoritative read-back, never blind mutation retry;
- every intent reaches one deterministic terminal state;
- no partial DOM adoption.

### 14.2 Atomic Ready/Blocked settlement

Where a selection may move recovery:

- revalidate through the canonical server owner;
- obtain same-revision Ready and Blocked authority concurrently or through one same-revision reconciliation envelope;
- validate non-empty unique identities and cross-section disjointness;
- stage candidate summary, headline, child page/token, counts, Draft gate and every render-consumed alias together;
- commit once and render once.

Refreshing only Ready or only Blocked is prohibited.

Action Required/Updating/Blocked pages that are not open may be invalidated rather than eagerly downloaded, but their counts and economic-identity ownership must update at the accepted revision. An open affected modal must reconcile before adoption completes.

### 14.3 Dynamic sort settlement

If Candidate sort is active and membership does not change, patch the accepted row in place.

If Deductions/Ready-to-pay sort value or candidate membership changes:

- keep last authoritative page visible in busy state;
- perform at most one anchored current-page read;
- atomically replace the sorted page;
- restore focus if the row remains, otherwise announce that it moved/left under the current sort;
- only then re-enable Draft.

---

## 15. Database security and performance rules

Every new/changed RPC must prove:

- exact signature/defaults/result type;
- owner/language/volatility;
- `SECURITY DEFINER` status where required;
- fixed safe `search_path`;
- bounded statement and lock timeout;
- exact ACLs;
- explicit revoke from PUBLIC, `anon` and `authenticated` where service-only;
- only the narrowly required service/release owner grant;
- PostgREST schema-cache availability;
- repository source hash equals installed canonical definition;
- no RLS/browser-role broadening.

Dynamic sorting uses a fixed whitelist/CASE or other constant-only construction. Never concatenate caller sort text into SQL.

Queries must be:

- set-wise;
- bounded;
- keyset-paginated;
- supported by measured query plans;
- free of N+1 and per-candidate loops;
- measured against current TEST distribution.

Do not add an index by assumption. Add one only when a recorded `EXPLAIN (ANALYZE, BUFFERS)` proves a narrow index is necessary and safe.

---

## 16. Performance contract

The redesign guarantees a smaller initial payload/DOM; it does not claim to make underlying Workbench source preparation faster unless measurement proves that too.

### 16.1 Request budgets

| Interaction | Normal | Maximum |
| --- | ---: | ---: |
| Fresh main open | open/adopt + candidate summary | 2, plus bounded progress reads only while genuinely preparing |
| Already adopted main refresh | candidate summary | 1, plus progress only if required |
| Candidate Banking open | one Ready-only page | 1 |
| Candidate checkbox under Candidate sort | one mutation | 1 |
| Candidate checkbox under amount/deduction sort or membership change | mutation + anchored page reconciliation | 2 |
| Individual Ready checkbox | one mutation | 1, plus one anchored summary read only when sort/membership requires |
| Action Required open | one task-list request | +1 only when detail opened |
| Blocked open | one list request | +1 only when detail opened |
| Sort/page change | one summary request | 1 |
| Main Timesheets shortcut | zero if IDs inline; otherwise one exact token resolution | 1 |

No search request budget exists because no new search exists.

### 16.2 Payload budgets

| Response | Preferred | Mandatory review |
| --- | ---: | ---: |
| Candidate page | ≤64 KB | >128 KB |
| Candidate selection result | ≤16 KB | >32 KB |
| Candidate Ready page | ≤256 KB | >512 KB |
| Action Required page | ≤128 KB | >256 KB |
| Blocked page | ≤128 KB | >256 KB |

Approved DEV-0007 (user: `YES AND CONTINUE`, 28 August 2026): when Candidate Banking is already open, a selection response may include its one complete updated Ready page. The base selection response retains the 16/32 KB limits; the optional Ready page retains its 256/512 KB limits. The combined preferred/investigation bounds are 272/544 KB, including response-envelope overhead in the base. Do not include a child when none is open, return all child pages, issue an extra automatic Ready request, or substitute a revision stamp for updated rows. Both parts must represent the same accepted revision. No latency, memory, selection, financial, Draft or zero-loss requirement is relaxed. Measure uncompressed and transferred bytes separately.

### 16.3 Measured acceptance

Record current p50/p95 before v2 changes and then require:

- Workbench source preparation: no more than 5% p95 regression.
- First 100 usable candidates: p50 no more than 70% and p95 no more than 80% of the current first-useful-modal baseline.
- Candidate Banking: no worse than current candidate detail/expansion p95, target at least 20% faster.
- Individual checkbox: no more than 5% p95 regression.
- Action Required first page: no worse than current Cases first page, target at least 20% faster.
- Blocked first page: no worse than current Blocked first page, target at least 20% faster.
- Main render: 100 simple rows without routine full-modal reconstruction.
- Twenty open/close cycles: no duplicate listeners/pollers and retained resources no worse than baseline plus 5%.

---

## 17. Layout and interaction acceptance

### 17.1 Main table

Test at 100%, 125%, 150% and 200% zoom/text scaling:

- exactly four cells;
- exactly one physical row per candidate;
- no `aria-expanded`;
- no `<details>`/`<summary>`;
- no nested payment DOM;
- no responsive card conversion;
- no second line;
- candidate/reference ellipsis with full tooltip;
- currency uses tabular numerals;
- all four columns remain available;
- bounded horizontal scrolling at genuinely narrow widths;
- no hidden error or row.

### 17.2 Event propagation

Prove separately:

- double-click plain row area opens Candidate Banking once;
- checkbox click/double-click changes selection only;
- Timesheets pointer/click/double-click opens exact Timesheets only;
- any child link/button does not open Candidate Banking;
- no newly added View button or keyboard-opening handler exists.

### 17.3 Detailed modals

- List tables stay compact.
- Longer reasons/actions live in detail areas.
- Candidate Banking can expand payment details locally.
- Full text remains accessible without forcing long main-table rows.
- Pagination happens after the correct database classification/deduplication.

---

## 18. Test and proof matrix

### 18.1 Candidate aggregation

Prove:

- one/many Ready payments;
- selected/unselected/mixed;
- selected/nonselected deductions;
- zero selected amount;
- duplicate candidate display names with different UUIDs;
- one candidate with PAYE and Umbrella rows under ALL;
- candidate removed/gained during reclassification;
- no duplicate candidate between pages;
- candidate 101 on page 2.

### 18.2 Sorting/filtering

For all three sort keys and both directions:

- ordinary values;
- ties;
- null/zero/negative/positive amount;
- boolean order;
- page continuation;
- sort/filter reset;
- stale/malformed/cross-scope cursor;
- no duplicate/skipped candidate;
- Candidate/Client intersection;
- ALL/PAYE/Umbrella Draft equivalence;
- no main search control/state/request.

### 18.3 Timesheets

Prove:

- selected-only exact IDs;
- unselected-only ignored;
- shared selected/unselected ID deduplicated and retained;
- no selected Timesheet gives disabled icon/exact tooltip;
- selected non-Timesheet payment gives disabled icon;
- 25 inline boundary;
- 26+ deferred token;
- stale token rejected without widening;
- main/candidate/action/blocked Timesheets keep the parent modal open and update the summary using exact IDs.

### 18.4 Selection/recovery

Prove:

- candidate all/none/mixed;
- more than 100 candidate payments;
- individual after candidate and candidate after individual;
- Timesheet group;
- global all-page;
- explicit recovery override;
- newly eligible recovery selection;
- zero/exact/partial available funds;
- deterministic earlier recovery allocation;
- candidate/channel isolation;
- Ready→Blocked and Blocked→Ready in one open modal;
- stale, no-op, rapid superseding and transport-uncertain cases;
- no double dispatch/partial write;
- exact fixture restoration.

### 18.5 Action Required/Updating/Blocked

Prove every canonical family and current action:

- finance decisions/resolutions;
- PAYE↔Umbrella directional wording;
- candidate/umbrella bank details;
- account-name PASS/close match/FAIL/unavailable;
- setup/mapping/inactive umbrella;
- queued/running versus retryable/final failure;
- shared problem deduplication with complete affected-payment detail;
- insufficient funds/partial residual/dated snooze/Do Not Pay/Blocked Timesheet/unknown problem;
- indefinite snooze absent from every Banking Pay count/page/message.

### 18.6 Draft and Policy X equivalence

For every amount/recovery fixture compare legacy and v2:

- selected preview row UUIDs;
- economic keys;
- candidate/Timesheet/finance case/component IDs;
- recovery reservations;
- Draft blockers;
- frozen Draft manifest/hash.

Acceptance is zero missing, zero extra, same reservation and same Draft manifest.

No provider, settlement, remittance, cancellation or post-Draft mutation is required to prove this pre-Draft redesign.

### 18.7 Canonical ledger checks

Automate:

- all 136 `BP-*` IDs accounted for exactly once;
- all 89 `MSG-*` changes tested or explicitly not exercised in a fixture with reason;
- all 30 visible actions mapped/tested;
- all additional compatibility handlers mapped/tested;
- deletion guard fails if an old handler is removed before replacement evidence exists;
- source guards reject extra main columns, main expansion, candidate search, browser financial arithmetic, `TS_DAY` drift and post-Draft live fallback.

---

## 19. Implementation phases

No phase below is authorised by this planning document.

### Phase 0 — no-change start gate

Before adding or editing implementation code:

1. Re-fetch exact current frontend `main` and backend `test` heads.
2. Re-read every applicable `AGENTS.md` and the complete Banking Pay Bible.
3. Create clean isolated worktrees without touching current dirty clones.
4. Repeat the permanent Miget connector preflight and target only `agency_test`.
5. Re-fetch exact installed definitions/signatures/defaults/owners/ACLs/hashes for every reused Workbench function.
6. Confirm no newly installed v2 equivalent exists.
7. Re-extract current amount display chain, filter controls, all 30 visible actions and compatibility handlers.
8. Compare with this plan and the canonical audit.
9. Record a signed/no-change evidence report.

Stop if an unexplained Banking Pay source or installed-authority change affects the contract. Resolve the evidence; do not reopen settled product decisions by guesswork.

### Phase 1 — characterization and failing contracts first

Add tests/fixtures before runtime behaviour:

- all 136 BP traceability rows;
- 89 message changes;
- 30-action deletion guard plus compatibility handlers;
- AMT-001–AMT-019 parity oracle;
- selected-only Timesheet rules;
- exact filters/channel/Draft behaviour;
- current global/individual selection and recovery behaviour;
- source guards.

Prove new v2 tests fail against pre-v2 source only for the expected missing capability.

### Phase 2 — additive database projections/mutation

Implement the five capabilities in section 12 using current certified Workbench owners.

Requirements:

- no new economics;
- set-wise/keyset/bounded;
- exact amounts/deductions/selected Timesheets;
- atomic candidate intent;
- same-revision summary/Ready/Blocked settlement;
- exact grants/timeouts/search path;
- rollback-only compilation and real first-use fixture calls;
- source/installed hash verification;
- query plans and no N+1 proof.

Release to agency TEST only through the protected repository-controlled database release when separately authorised.

### Phase 3 — backend v2 routes/capability

Add contained controller, validators, typed errors and capability response. Keep capability false. Maintain one RPC per route and minimal shared router change.

### Phase 4 — complete frontend v2 while disabled

Add lazy module/style and contained store. Build the complete four-column main table, filters, sorting, pagination, totals, counts, Draft adapter and fallback. Do not expose v2 yet.

### Phase 5 — Candidate Banking and shared settlement

Move every Ready detail/control. Connect individual, group, candidate and global selection to one settlement controller. Prove real-time promotion/demotion and parent-state restoration.

### Phase 6 — Action Required, Updating and Blocked

Move every current case/readiness/bank/control. Implement task deduplication, Updating separation, passive Blocked detail and absolute indefinite-snooze exclusion.

### Phase 7 — wording, layout, parity and performance

Run all message, zoom/layout, exact-action, amount, Draft-equivalence, query, Worker, browser and memory tests. Fix any regression while capability remains false.

### Phase 8 — controlled TEST activation

Only after separate release authority and every gate green:

1. Verify installed TEST database definitions/hashes/ACLs.
2. Deploy/verify TEST backend through its authorised branch/build route.
3. Deploy the complete TEST frontend.
4. Verify deployed asset/source parity.
5. Enable v2 for a controlled TEST cohort/session boundary.
6. Exercise one continuously open modal through selection/recovery/action movements.
7. Record p50/p95, request count, payload and browser memory.
8. Restore any authorised TEST fixture state exactly.
9. Keep legacy fallback available.

### Phase 9 — later cleanup only

Legacy removal is a separate, later, explicitly authorised programme after sustained TEST parity, fallback evidence and every deletion guard has replacement proof. It is not part of initial implementation.

---

## 20. Fallback and rollback

Fallback to the unchanged legacy interface is allowed only:

- before the first v2 mutation in that modal; and
- after an exact read-only capability/dependency failure proves no mutation was submitted.

Fallback is prohibited:

- after a mutation has been dispatched;
- while outcome is uncertain;
- as a substitute for authoritative read-back;
- when it would leave both legacy and v2 handlers mounted.

Immediate TEST rollback:

1. Set v2 capability/feature false for new modal sessions.
2. Leave any already uncertain mutation in the v2 settlement/read-back path until terminal.
3. Restore the unchanged legacy interface for subsequent opens.
4. Leave additive database definitions dormant; do not perform emergency destructive rollback.
5. Preserve diagnostic/audit evidence.
6. Add regression coverage before re-enable.

Rollback proof requires no duplicate handler, no lost/repeated mutation, current server-owned Draft gate, no stale v2 alias and continued one-effective-section compliance.

---

## 21. Activation checklist

The simplified interface remains unavailable until every item is true:

- [ ] Latest heads and installed Miget definitions re-proved.
- [ ] Current dirty user work preserved in isolation.
- [ ] All 136 BP rows have exact owner and passing evidence.
- [ ] All 89 message changes pass.
- [ ] All 30 visible actions and compatibility handlers pass.
- [ ] Main table is exactly Include, Candidate, Deductions, Ready to pay.
- [ ] One non-wrapping row per candidate; no main expansion.
- [ ] No candidate search.
- [ ] Selected-only Timesheets exact scope passes.
- [ ] Candidate Amount and headline server scalar invariants pass.
- [ ] Deductions selected-only server boolean passes.
- [ ] Full-result sort-before-page passes all keys/directions.
- [ ] Existing filters/Draft semantics pass.
- [ ] Candidate-wide selection is one atomic revision.
- [ ] Candidate Banking is Ready-only before paging.
- [ ] Action Required is human-action-only and deduplicated.
- [ ] Updating is separate.
- [ ] Blocked is passive.
- [ ] Indefinite snoozes are absent from Banking Pay everywhere.
- [ ] Ready/Blocked adoption is same-revision and atomic.
- [ ] No stale alias can republish a moved identity.
- [ ] Draft remains fail-closed while unsettled.
- [ ] Amount fixture matrix and Draft manifest equivalence pass.
- [ ] Every Create Draft handoff gate in `23_CREATE_DRAFT_COMPATIBILITY_CONTRACT.md` passes; no candidate-page data substitutes for the complete payment contract.
- [ ] Performance/request/payload/memory targets pass.
- [ ] Exact TEST deployment parity passes.
- [ ] Legacy fallback and rollback pass.
- [ ] No LIVE or prohibited financial lifecycle action was accessed.

---

## 22. Final conclusion

The plan is product-complete and technically bounded.

The implementation is a deliberately contained v2 view/controller over the current Workbench, plus five additive server capabilities. It does not change payment calculations, Draft ownership or later Banking Pay lifecycle.

The biggest safety rules are:

1. never replace server financial authority with browser calculation;
2. never select a candidate by looping through visible pages;
3. never filter Candidate Banking after pagination;
4. never refresh Ready without its corresponding Blocked authority after selection changes;
5. never let Action Required, Updating, Blocked or indefinite snoozes leak into the wrong view;
6. never activate the simplified main table until every moved function is present and proved;
7. never treat the wrong historical action count as permission to omit the thirtieth action.

No further product question is required before the Phase 0 no-change start gate. Any new source fact discovered there must be reconciled against this specification, not silently assumed.
