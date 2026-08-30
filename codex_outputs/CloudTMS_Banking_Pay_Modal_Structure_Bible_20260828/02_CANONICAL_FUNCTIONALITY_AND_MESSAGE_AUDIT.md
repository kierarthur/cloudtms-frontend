# CloudTMS Banking Pay simplification

## Zero-functionality-loss baseline audit and proposed wording audit

**Audit date:** 27 August 2026  
**Audit type:** Read-only product, source, route, database-contract and regression-test audit  
**Application changes made:** None  
**Database changes made:** None  
**Deployments made:** None

## 1. Plain-English conclusion

This is a **targeted rearrangement of the pre-Draft Banking Pay workbench**, not a redesign of how payments are calculated, made, authorised or settled.

The simple main screen is achievable, but it is safe only if the current payment authority stays exactly where it is. The database must continue deciding what is Ready, what is selectable, how much is displayed, what can be deducted, what is blocked, and what moves after an action. The browser must not try to recreate those decisions from labels or from whichever page happens to be open.

The proposed result is:

- One candidate per physical table row.
- A maximum of 100 candidate rows per page.
- No expandable rows, child rows, accordions or second lines in the main table.
- Four main pieces of information: include checkbox, Candidate, Deductions, and Ready to pay.
- The Timesheets shortcut sits neatly beside Candidate or Ready to pay; it does not get its own column.
- Double-clicking the non-interactive part of a row opens Candidate Banking. There is no View details button and no instruction above the table telling the user to double-click.
- Candidate Banking shows only that candidate's current Ready payments and the full detail and controls currently available for those Ready rows.
- Action Required holds work a person can resolve.
- Updating holds work CloudTMS is currently processing.
- Blocked for Pay holds payments that cannot currently be included and have no immediate human action that will make them Ready.
- Indefinite snoozes appear only in the existing Snoozes tab. They do not appear, count or leave a note anywhere in Banking Pay.

The largest safety risk is not the visible table. It is accidentally replacing mature server-owned behaviour with browser calculations. Five supporting server contracts are genuinely missing today: a candidate summary, candidate-wide all-page selection, a Ready-only candidate detail page, a deduplicated Action Required view, and a clean passive Blocked view. Those should be added around the current authority, not replace it.

## 2. Evidence used

This audit used the current saved repositories, not an old handover commit:

- Frontend branch main at eba846114beaaba89b203d19145aa2c4305e7f72.
- Backend branch test at 60a3fc9e17b710bd4b4b50de38a345512888bc50.
- Current TEST runtime database: Miget agency_test.
- The root instructions, both repository instruction files and the Banking Pay Bible were read in full.
- The current Banking Pay renderer, action handlers, filters, Workbench network functions, Worker routes and relevant regression tests were inspected.
- The permanent read-only Miget route was authenticated, reported read_only=true, exposed all nine expected audit tools, and successfully proved both TEST PostgreSQL services.
- Exact installed RPC signatures and selected installed definitions were inspected read-only.
- Focused non-mutating regression runs passed: 136 frontend Banking Pay tests and 126 backend Banking Pay/Loans-Snoozes tests, with zero failures.

The frontend and backend worktrees contain pre-existing user changes. They were treated as authoritative saved work and were not edited or discarded. The only file created by this audit is this report.

No payment, Draft, case, snooze, bank detail, Timesheet or TEST data was changed. No live payment flow was exercised. This is therefore a contract and source audit, not a claim that the future implementation has already passed browser acceptance testing.

## 3. Product decisions now locked

### 3.1 Main Banking Pay table

| Decision | Locked meaning |
| --- | --- |
| Row membership | Show a candidate when the candidate has at least one currently selectable effective Ready payment in the active Workbench/filter scope. |
| No selectable payments | Do not show that candidate in the main table. Do not show an ordinary unchecked or disabled candidate checkbox. Any Action Required or Blocked work remains visible through its own count and modal. |
| Default order | Candidate name in alphabetical order, with candidate ID as a stable tie-breaker. |
| Page size | Up to 100 candidates, not 100 payment components. |
| Physical layout | Exactly one fixed-height, non-wrapping physical line per candidate. No expandable row and no responsive card that creates extra lines. |
| Columns | Include checkbox; Candidate; Deductions; Ready to pay. |
| Timesheets | Compact exact-scope icon beside Candidate or Ready to pay. No Timesheets column. |
| Row opening | Double-click only on the non-interactive row area. Checkbox and Timesheets activity must never open Candidate Banking. |
| Selection state | Checked when all currently selectable Ready payments for the candidate are selected; mixed/indeterminate when some are selected; unchecked when none are selected. |
| Deductions | Yes only when at least one currently selected, selectable/draftable Ready payment is canonically classed by the server as a deduction; otherwise show a neutral dash. |
| Ready to pay value | The server-authoritative sum of that candidate's currently selected payment display amounts. It is not PAYE net pay and it must not subtract recovery or deductions a second time. |
| Headline | The same current payment display amount summed over all selected candidates and payments in the complete filtered Workbench, across every candidate page. |
| Sorting | Every sortable column header sorts the complete matching result before pagination. Sorting only the 100 loaded rows is forbidden. |
| Filtering | Preserve current PAYE, Umbrella, candidate and client filter meaning. Filtering must happen before paging and must remain tied to the authoritative Workbench scope. |

### 3.2 Candidate Banking

- Opens as a separate modal over the main Banking Pay modal.
- Shows one candidate only.
- Shows effective Ready payments only; Action Required, Updating, Blocked and indefinite-snooze items are excluded before pagination.
- Uses a maximum page size of 100 and filters in the database before applying the page limit.
- Retains the current line selection controls, Timesheet group selection, payment breakdowns, component details, exact Timesheets navigation, snooze controls that currently belong to a Ready row, exclusions, resolved-decision cancellation and Ready export behaviour.
- Keeps the same Workbench session, version and progress authority as the main screen.
- Updates in real time after a mutation. If a payment ceases to be Ready, it leaves Candidate Banking only after authoritative reclassification.
- On close, the main candidate row, headline, Deductions value and tri-state checkbox must already reflect the accepted result.

### 3.3 Action Required and Updating

Action Required means **a person can and must do something now**. It is not a new name for every Blocked payment.

It includes, when the server publishes the relevant current action:

- Financial case decisions: suggested rate, manual rate, manual amount, gross-total decision and taxable payment-method restructure.
- Missing or incomplete candidate or umbrella bank details.
- Account-name check required, failed, unavailable or near match where review/acceptance is permitted.
- Bank-account setup still required after details have been checked.
- Inactive umbrella company where reactivation is permitted.
- Failed source or readiness work where Retry or another corrective action is currently available.

One underlying problem is one task. For example, one umbrella bank-account issue affecting ten candidates must not become ten identical tasks. Opening the task must still expose all ten affected candidates, every affected payment/component, the exact Timesheets and every existing control.

Updating is separate. It contains queued, pending or running work that CloudTMS is processing. It does not inflate the Action Required count. A failed operation moves to Action Required only when there is an operator action; otherwise it moves to Blocked.

### 3.4 Blocked for Pay and Snoozes

Blocked for Pay is passive and unselectable. It includes:

- Insufficient funds to deduct.
- A passive remaining part of a partially recoverable deduction, where current authority creates a separate economic identity.
- Dated snooze/on-hold payments where current policy shows them in Banking Pay.
- Do Not Pay payments.
- Blocked Timesheet payments.
- A terminal source/readiness failure with no safe user action.
- An unknown external payment problem that cannot safely be classified elsewhere.

Blocked must show the server-published affected amount, exact reason, what would have to change before it can become Ready, and an exact Timesheets shortcut where one exists. It has no ordinary payment-selection checkbox.

Indefinite snoozes are excluded before counting, sorting and pagination. They appear only in the Snoozes tab. Banking Pay must not show a hidden-item count or an explanatory indefinite-snooze note.

## 4. Important current-state findings

### 4.1 The current Amount is not the future headline

The current renderer builds readyLineAmountTotal by adding the display amount of the Ready lines currently assembled for display. It does not restrict that calculation to selected payments and it is not a guaranteed full-session total across every page.

The future Ready to pay headline is therefore a **new server-authoritative full-session selected amount**. It must not reuse the current visible-page subtotal.

### 4.2 Current candidate detail is not Ready-only

The installed pay_workbench_session_get_candidate_preview function:

- caps each page at 100;
- pages by effective section, row order and row ID;
- returns Ready, Cases/Resolutions and Blocked rows together.

Client-side removal of non-Ready rows after that page is loaded would be wrong. A candidate could have 100 Case rows before a Ready row and the modal would appear empty. The new Candidate Banking read must filter to effective Ready in the database before pagination.

### 4.3 Global all-page selection exists; candidate all-page selection does not

The installed pay_workbench_session_set_selected_rows function already supports server-owned select-all/clear-all for the complete Ready section. It requires the current session and progress versions, maintains selection intent, audits the change, advances the progress revision and revalidates recovery availability.

It does not provide one atomic all-page candidate selection. Building that by sending pages of IDs from the browser would expose half-applied selection and stale recovery availability. One new candidate-scoped mutation is required.

### 4.4 The five missing contracts are confirmed missing

No installed public RPC matched candidate summary, selected-deduction summary, Action Required, passive Blocked, candidate selection or Ready-only candidate detail naming. The functionality may reuse current private helpers, rows and actions, but these read/mutation shapes do not exist today.

## 5. Audit 1 — zero-functionality-loss traceability baseline

Status terms used below:

- **Retain:** same capability and authority, same or equivalent location.
- **Move:** same capability and authority, new modal/location.
- **New support:** required to present the simpler design safely; not a replacement for existing economics.
- **Remove shell only:** remove visual clutter while retaining the underlying capability elsewhere.

### 5.1 Entry, scope, session and loading

| ID | Current capability | Current authority/evidence | Required home | Zero-loss requirement |
| --- | --- | --- | --- | --- |
| BP-001 | Open or adopt one shared pre-Draft Workbench | Worker open route and installed pay_workbench_session_open_shared_v2 | Main modal controller | Retain the same pay date, week cutoff, filters and session signature. Never open one session per child modal. |
| BP-002 | PAYE and Umbrella scope | Existing filter modal and Workbench/Draft scope | Filters | Retain Both PAYE and Umbrella, PAYE only and Umbrella only exactly. |
| BP-003 | Candidate filter | Current candidate picker and session signature | Filters | Retain canonical candidate ID, not browser name matching. |
| BP-004 | Client filter | Current client picker and session signature | Filters | Retain canonical client ID and exact intersection with route/candidate filters. |
| BP-005 | Filter adoption fails closed | Current filter-save logic requires a replacement/current session to be adopted | Filters/main | If the new scope is not adopted, keep the prior list unchanged and explain the failure. |
| BP-006 | Hidden filtered selection safety | Current filter text and Draft validation | Filters/Draft gate | Preserve saved selections where current authority does, but never Draft a row outside the active filter scope. |
| BP-007 | Current session and progress version | Current Workbench state and every sensitive mutation | All four pre-Draft views | Carry the same current tuple on every read/mutation. Stale results must not repaint a newer view. |
| BP-008 | Light progress polling | Worker progress route and installed progress-light RPC | Main compact status | Retain bounded polling, coalesce refreshes and do not rebuild 100 rows for counter-only changes. |
| BP-009 | Candidate/source preparing state | Current progress model and candidate indicators | Main compact status; Updating detail | Keep visible without mixing it into Action Required. |
| BP-010 | Candidate/source failure state | Current failed candidate/job model and Draft gate | Main status; Action Required or Blocked by actionability | Never hide a failure merely because the Ready candidate table has no row for it. |
| BP-011 | Refresh Banking Pay | Current Refresh action and refresh-current-authority route | Fixed main header/overflow | Retain a full current refresh without clearing user decisions. |
| BP-012 | Clear all Decisions | Current action, confirmation and clear-all-decisions RPC | Fixed main header/overflow | Retain exact clearing of decisions, exclusions and selections followed by authoritative reload. |
| BP-013 | First usable page gate | Current readiness/first-page checks | Branded waiter | Do not expose an empty or stale large modal before the first candidate page and global summary are usable. |
| BP-014 | Retry and cancel loading | Current modal error handling | Waiter | A failed open must offer genuine Retry and Cancel; no fabricated percentage or countdown. |
| BP-015 | Close and reopen | Current modal/session adoption behaviour | Main and child modal shells | Closing presentation must not discard current server decisions. Reopen adopts current truth. |
| BP-016 | Memory/listener cleanup | Current memory and modal lifecycle tests | All modal shells | Abort late reads, clear timers/listeners and release old page graphs when modal closes. |

### 5.2 Main candidate summary

| ID | Current capability | Change type | Required home | Zero-loss requirement |
| --- | --- | --- | --- | --- |
| BP-020 | Ready row membership | New support around current effective-section authority | Main candidate summary | Candidate appears only because at least one selectable effective Ready payment exists. No browser classification. |
| BP-021 | One physical row per candidate | New presentation | Main table | Fixed height; no wrapping, expanded rows, child rows or card conversion. |
| BP-022 | Alphabetical default order | New presentation contract | Main table | Sort entire result before paging using normalised display name plus candidate ID. |
| BP-023 | Header sorting | New support | Main table | Server sorts every matching candidate across all pages. Header indicates direction. Stable tie-breaker required. |
| BP-024 | 100 candidates per page | New support | Main table | Page count and navigation describe candidates, not underlying payment rows. |
| BP-025 | Candidate identity/reference | Move/aggregate | Candidate column | Use server-published current display identity; fit on one line with ellipsis if required. |
| BP-026 | Candidate selection state | New aggregate over current row selection | Main checkbox | Checked/all, mixed/some, unchecked/none over all selectable Ready payments for the candidate, not just loaded detail rows. |
| BP-027 | Candidate select all | New atomic mutation | Main checkbox | Select every current selectable Ready payment for one candidate across all pages in one transaction/revision. |
| BP-028 | Candidate clear all | New atomic mutation | Main checkbox | Clear every selected Ready payment for one candidate across all pages in one transaction/revision. |
| BP-029 | Global Ready select/clear | Retain current server all-page selection | Main table header | Continue to select/clear the complete filtered Ready section across every candidate page. |
| BP-030 | Current payment display amount | New server aggregate of existing display authority | Ready to pay column | Sum only currently selected effective Ready display amounts. Preserve current signs. Do not calculate PAYE net. |
| BP-031 | Full-session headline | New support | Main header | Sum BP-030 over the complete filtered session, never the loaded 100 candidates. |
| BP-032 | Deductions indicator | New server boolean | Deductions column | Yes only for at least one selected canonical deduction. Never infer from a negative number, label or line-type list in JavaScript. |
| BP-033 | Deductions live update | New response projection | Main row | Tick/untick, promotion/demotion, resolution and exclusion must update Yes/dash at the accepted revision. |
| BP-034 | Exact Timesheets shortcut | Move current shortcut | Candidate or Ready to pay cell | Use exact currently relevant Ready Timesheet IDs. Never open a broad candidate search. Stop click and double-click propagation. |
| BP-035 | No Timesheet case | Retain valid non-Timesheet payments | Same inline location | Show no active shortcut or a neutral disabled icon; do not invent a Timesheet ID. |
| BP-036 | No selectable candidate case | Product correction | Main membership | Candidate is absent, not shown with a normal unchecked/disabled checkbox. Counts in other modals remain visible. |
| BP-037 | Main row open | New presentation | Main row | Double-click non-interactive area only. No View details button and no expansion. |
| BP-038 | Main state restoration | New modal coordination | Main modal | Closing Candidate Banking restores exact page, sort, filters, scroll, focus and the updated candidate row. |
| BP-039 | Main all-page export | Retain current Ready all-page CSV | Main fixed header/overflow | Preserve complete Ready export, current inclusion state and full breakdown without changing visible page cursor. |
| BP-040 | Action Required count/button | New summary over current action authority | Permanent main control | Count unique human tasks over the complete session. Button stays visible even when count is zero. |
| BP-041 | Updating count | New summary over current progress/jobs | Main status/Action Required | Count current non-terminal work separately. |
| BP-042 | Blocked count/button | New summary over current blocked authority | Permanent main control | Count unique passive economic blockers; exclude Action Required, Updating and indefinite snoozes. |
| BP-043 | Create Draft control | Retain | Fixed main area | Same existing Draft gate and route. The simpler list must not create a second Draft path. |

### 5.3 Candidate Banking — Ready detail retained

| ID | Current capability | Current visible detail/action | Required home | Zero-loss requirement |
| --- | --- | --- | --- | --- |
| BP-050 | Ready-only candidate read | Current candidate read is mixed | Candidate Banking | New database-filtered Ready-only page before limit; 100 maximum; keyset cursor. |
| BP-051 | Individual payment checkbox | Current Ready row checkbox | Candidate Banking row | Same selected-row mutation, exact revisions and fail-closed repaint. |
| BP-052 | Timesheet group checkbox | Current grouped checkbox | Candidate Banking group | Preserve all/none/mixed child state and exact eligible row IDs. |
| BP-053 | Candidate all/clear | Not atomic today | Candidate Banking header | Use the same new candidate-scoped mutation as main checkbox. |
| BP-054 | Line type | Current Line type column | Candidate Banking | Retain every friendly line type and correction/recovery identity. |
| BP-055 | Candidate/client/date/channel/state | Current Ready columns | Candidate Banking | Retain the detailed fields removed from the simple main table. |
| BP-056 | Current row amount | Current display helper | Candidate Banking | Preserve amount_display/section display precedence and existing recovery special cases. |
| BP-057 | Timesheet parent grouping | Current grouped rendering | Candidate Banking | Preserve one visible parent while retaining every economic row ID. |
| BP-058 | Timesheet component expansion | Current plus/minus breakdown | Candidate Banking only | Expansion stays local; it must never create an expandable main candidate row. |
| BP-059 | Segment detail | Date, client, role, band, start, finish, break, pay amount, state, action | Candidate Banking breakdown | Retain every field and exact segment identity. |
| BP-060 | Expense component detail | Exact expense code/label and amounts | Candidate Banking breakdown | Retain individual expense identities and current clamping information. |
| BP-061 | Snooze one payment | Snooze action | Candidate Banking where Ready action currently exists | Retain exact snooze identity and current conflict checks. |
| BP-062 | Manage dated snooze | Manage/Unsnooze action | Candidate Banking or Blocked according to effective state | Retain current clear/no-op/stale handling. |
| BP-063 | Snooze one segment | Current segment action | Candidate Banking breakdown | Retain whole-Timesheet versus segment conflict guard. |
| BP-064 | Snooze one expense | Current exact expense action | Candidate Banking breakdown | Retain stale-source guard and exact source reference. |
| BP-065 | Snooze/unsnooze all Timesheet expenses | Current bulk expense actions | Candidate Banking breakdown | Retain current set construction and confirmation modal. |
| BP-066 | Exclude/include Timesheet for this run | Current timesheet-exclusion action | Candidate Banking when row is Ready; Action Required/Blocked only where current effective state allows it | Keep exact candidate, Timesheet, expected session and progress versions. |
| BP-067 | Overpayment grouping | Current dedicated parent grouping | Candidate Banking | Preserve all underlying selectable IDs; presentation must never broaden Draft selection. |
| BP-068 | Overpayment breakdown | Original, outstanding and recoverable this run | Candidate Banking | Preserve every component and current row-level cap. |
| BP-069 | Manual-debt display | Scheduled due versus recoverable this run | Candidate Banking/Blocked as classified | Never substitute scheduled debt for an amount actually recoverable now. |
| BP-070 | Partial/zero deduction reclassification | Current selection recovery revalidation | Candidate Banking and Blocked | One authoritative identity per section; totals and row membership update together. |
| BP-071 | Resolved badge/correction badge | Current Ready indicators | Candidate Banking | Preserve correction versus resolved distinction. |
| BP-072 | Cancel Resolved Rate | Current exact BUCKETED cancellation | Candidate Banking | Preserve exact Timesheet owner, linked Timesheet rules, immutable Draft exclusion and confirmation. |
| BP-073 | Cancel Resolved Pay Channel | Current finance clear action | Candidate Banking for resolved Ready payment | Preserve finance-case owner and no-Timesheet taxable owner boundary. |
| BP-074 | Cancel Resolved Gross Total | Current finance clear action | Candidate Banking for resolved Ready payment | Preserve optional exact linked Timesheet and stale-identity failure. |
| BP-075 | Exact Timesheets navigation | Current row shortcut | Every applicable Candidate Banking row/group | Open only explicitly related Timesheets; multiple exact IDs stay exact. |
| BP-076 | Current-page and all-page detail export | Current all-page Ready CSV behaviour | Candidate Banking export menu | Ready-only, all pages, exact inclusion state, no Action/Blocked rows, visible page unchanged. |
| BP-077 | Candidate mutation settlement | Current targeted candidate refresh | Candidate Banking controller | Wait for a newer authoritative version, fetch all required pages, merge once and avoid broad full-session reopen. |

### 5.4 Action Required and Updating — current controls moved, not removed

| ID | Current capability | Current action/authority | Required home | Zero-loss requirement |
| --- | --- | --- | --- | --- |
| BP-080 | Bucketed financial resolution | Suggested Rate/open bucketed review | Action Required task detail | Retain component basis, suggested rate, manual rate and exact server calculation. |
| BP-081 | Non-bucket resolution | Suggested Gross Total/non-bucket flow | Action Required task detail | Retain current gross-total authority and manual amount option. |
| BP-082 | Taxable payment-method restructure | Suggested Restructure/taxable flow | Action Required task detail | Retain source method, target method, remaining amount, weekly due, effective date and server tax authority. |
| BP-083 | Accept suggested component value | componentUseSuggested | Action Required task detail | Server validates the current suggestion fingerprint/basis. |
| BP-084 | Enter manual rate | componentManualRate | Action Required task detail | Retain source units/rate/charge basis and stale checks. |
| BP-085 | Enter manual amount | componentManualAmount | Action Required task detail | Retain current finance-case/component identity and server validation. |
| BP-086 | Clear component decision | componentClearResolution | Action Required or Candidate Banking according to current effective state | Inspect cleared/state_changed/no_op and returned revisions; HTTP success alone is not completion. |
| BP-087 | Include/exclude case for run | Current Include case/Exclude case | Action Required task detail | Preserve Timesheet exclusion semantics and later reclassification. |
| BP-088 | Case component table | Bucket, units, rates, pay, charge, margin and action | Action Required task detail | Retain every current column and component, even though the task list itself stays compact. |
| BP-089 | Case metadata | Candidate, date/week, client, amount, mixed/unresolved/stale indicators | Action Required detail | Retain complete affected context. |
| BP-090 | Missing bank details | Current BLOCKED_BANK_DETAILS rows | Action Required when person can correct | One task per canonical bank-account owner/fingerprint; expose all affected candidates/payments. |
| BP-091 | Accept bank mismatch with reason | Accept bank details and audited override route | Action Required task detail | Reason remains mandatory; bind to exact owner and bank-details hash; no silent acceptance. |
| BP-092 | Run account-name check | Current payee-readiness ensure action | Action Required task detail | Retain candidate/umbrella owner, checked-details hash, permissions and safe result envelope. |
| BP-093 | Near match/unavailable/fail review | Current bank result and acceptance path | Action Required task detail | Keep distinct result meanings; do not reduce them to one vague failure. |
| BP-094 | Set up bank account | Current payee-map ensure route | Action Required task detail | Retain payment provider/environment scope and safe no-payment-on-failure behaviour. |
| BP-095 | Inactive umbrella company | Current BLOCKED_UMBRELLA_INACTIVE authority | Action Required only when activation/review action exists | One umbrella-owned task can list multiple candidates. |
| BP-096 | Failed source/readiness retry | Current job/failure authority | Action Required when Retry is published | Keep retry generation/currentness; transition to Updating after acceptance. |
| BP-097 | Queued/running work | Current pending candidate/job states | Updating subsection | No red human-action task while CloudTMS is still working. |
| BP-098 | Failed work without action | Current terminal failure state | Blocked, not Action Required | Must remain prominent, counted and unselectable. |
| BP-099 | Task deduplication | Not available today | Action Required read model | Dedupe by real owner: finance case/version, payee/fingerprint, provider/environment, umbrella, or job generation. |
| BP-100 | Task list/detail split | Current detail is dispersed across rows | Action Required | List stays compact; opening task reveals every affected candidate, payment, component, Timesheet and control. |
| BP-101 | Exact Timesheets navigation | Current row shortcut | Task list/detail where applicable | Exact task-scoped IDs only; no broad candidate navigation. |
| BP-102 | Task search/sort/paging | New support | Action Required | Filter and sort complete task result before 100-row paging. |
| BP-103 | Draft blocker link | Current Draft blockers are messages | Fixed Draft area to Action Required | Link/focus the exact current task or a precise filtered list. |
| BP-104 | Resolved receipt while refreshing | Current mutation settlement behaviour | Action Required detail | Keep a short resolved/updating state until authoritative reclassification; never remove on HTTP 200 alone. |

### 5.5 Blocked for Pay and Snoozes

| ID | Current capability | Current authority | Required home | Zero-loss requirement |
| --- | --- | --- | --- | --- |
| BP-110 | Passive blocked payment | Effective blocked_for_pay classification | Blocked modal | No selection checkbox; one economic identity once. |
| BP-111 | Insufficient funds to deduct | NO_PAY_HEADROOM recovery authority | Blocked modal | Show the affected/outstanding amount and plain reason; move only after recovery revalidation. |
| BP-112 | Partial passive recovery remainder | Current recovery presentation authority | Blocked modal when separately authoritative | No duplicate of the selected Ready recovery. |
| BP-113 | Dated snooze/on hold | Current dated snooze state | Blocked modal | Show until date and current optional Manage/Unsnooze control where permitted. |
| BP-114 | Do Not Pay | Current DO_NOT_PAY state | Blocked modal | Retain exact payment/Timesheet identity and deliberate status. |
| BP-115 | Blocked Timesheet | Current BLOCKED_TIMESHEET state | Blocked modal | Retain exact reason, segment detail where currently available and Timesheets shortcut. |
| BP-116 | Non-actionable terminal failure | Current progress/job authority | Blocked modal | Label as a system payment issue; never silently discard it. |
| BP-117 | Unknown/unclassified blocker | Current fail-closed fallback must be improved | Blocked modal | Visible, counted, unselectable and explicit that CloudTMS could not identify the reason. Raw codes stay in diagnostics. |
| BP-118 | Nominal affected amount | Current row/case amount authority | Blocked row/detail | Server value only; never a selected-to-pay total. |
| BP-119 | Clear condition | Not consistently published today | Blocked detail | Server supplies what must change before the item can become Ready. No vague needs review message. |
| BP-120 | Optional existing action | Snooze management/Timesheets where currently allowed | Blocked detail | Moving screens must not remove an existing safe action. Human resolution actions belong in Action Required. |
| BP-121 | Blocked search/sort/paging | Current section paging; new canonical list | Blocked modal | Apply classification/exclusion/filter/sort before 100-row paging. |
| BP-122 | Indefinite snooze management | Existing Loans / Snoozes tab | Snoozes tab only | Retain every current manage/unsnooze/export/filter action in Snoozes. |
| BP-123 | Indefinite exclusion | Current hidden classification plus new strict view filter | Every Banking Pay view/count | Exclude before count/page. No candidate row, Action task, Updating item, Blocked row, amount or hidden note. |
| BP-124 | Snooze expiry/clear | Current authoritative refresh | Snoozes/Blocked then normal reclassification | An expired/cleared item can re-enter Ready only after server classification. |

### 5.6 Draft creation and financial safety

| ID | Current capability | Current authority | Required result |
| --- | --- | --- | --- |
| BP-130 | Create Draft uses selected Ready identities | Existing Draft preparation | Keep unchanged. Candidate selection must resolve to the same exact selected preview-row identity set. |
| BP-131 | Selection recheck before Draft | Current session/progress and selected-row review | Keep fail-closed. A changed selection requires review; no Draft starts. |
| BP-132 | Recovery availability revalidation | Current selection RPC and Draft preparation | Keep server-owned and current. Browser totals never decide recoverability. |
| BP-133 | PAYE existing-Draft guard | Current PAYE guardrails | Keep exactly; Umbrella-ready work can continue only where current authority permits. |
| BP-134 | Same-week PAYE override | Password, 2FA and explicit confirmation | Keep exactly; wording can improve but security steps cannot be reduced. |
| BP-135 | Preparing/failure gate | Current progress and blocker codes | Create Draft remains disabled until current authority says it is safe. |
| BP-136 | Active Draft-create operation | Current status banner/poll/view/open batch controls | Keep visible and recoverable after modal repaint/reopen. |
| BP-137 | Idempotent Draft request | Existing operation/Draft authority | Candidate UI must not introduce a second submission path or double click. |
| BP-138 | Current payment display is not PAYE net | Existing pre-Draft policy | Headline/row never claim to be bank-out or net. PAYE is entered after Draft. |
| BP-139 | Pre-Draft live/post-Draft frozen boundary | Banking Pay Bible and existing Draft items | All new views are live pre-Draft only. Never rewrite frozen Draft facts after later changes. |
| BP-140 | One identity, one effective section | Current effective-section helper and atomic page adoption | No payment may appear simultaneously in Candidate Banking, Action Required and Blocked for the same current identity. |
| BP-141 | Cross-section movement | Current candidate/selection settlement | Remove from old view and add to new view at one accepted revision; update candidate row/headline/Deductions/Draft gate together. |
| BP-142 | No browser calculation of economics | Current database authority | Candidate summary fields are server-published. JavaScript formats but does not recalculate. |

### 5.7 Downstream Banking Pay functions outside this layout change

The simplification ends at Draft creation. The following existing functions are not being redesigned and must pass regression tests unchanged:

| ID | Downstream capability that remains unchanged |
| --- | --- |
| BP-150 | Open the created Draft batch and load its current status. |
| BP-151 | Frozen candidate/payment/component hierarchy and exact Timesheets drilldown. |
| BP-152 | PAYE payment entry after Draft, including manual net entry. |
| BP-153 | Sage CSV import, validation, worksheet export and print. |
| BP-154 | Detailed CSV and PDF export. |
| BP-155 | Authorisation, reauthorisation and golden-key/approval rules. |
| BP-156 | Payment scheduling and future date/time handling. |
| BP-157 | Provider execution and no-bank-payment audit paths. |
| BP-158 | Pre-provider retry and blocked-funds retry. |
| BP-159 | Bank CSV generation. |
| BP-160 | Remittance generation, preview and sending. |
| BP-161 | Cancel unsubmitted Draft, cancel scheduled batch and recalculate. |
| BP-162 | Payment issue review, returned/rejected handling, reversal and correction. |
| BP-163 | Settlement, provider facts, frozen audit history and cancellation history. |
| BP-164 | Current payment alerts, progress children and parent/child modal lifecycle. |

## 6. Exact visible pre-Draft action manifest

The current main renderer exposes 30 Banking Pay action names. This list is a practical deletion guard: implementation review must account for each name before the old layout is removed. The earlier 29-action heading was a counting error; the table itself contains 30 distinct names.

| Current action | Future home | Treatment |
| --- | --- | --- |
| banking:pay:acceptBankDetails | Action Required detail | Move; retain mandatory audited reason and exact bank-details fingerprint. |
| banking:pay:clearCaseResolution | Candidate Banking for a resolved Ready item; otherwise Action Required | Move; retain exact BUCKETED cancellation owner and refresh. |
| banking:pay:clearFilters | Main toolbar | Retain. |
| banking:pay:componentClearResolution | Candidate Banking or Action Required by effective state | Move; retain state_changed/no_op handling. |
| banking:pay:componentManualAmount | Action Required detail | Move. |
| banking:pay:componentManualRate | Action Required detail | Move. |
| banking:pay:componentUseSuggested | Action Required detail | Move. |
| banking:pay:createDraft | Main fixed action | Retain unchanged. |
| banking:pay:ensurePayeeMap | Action Required detail | Move. |
| banking:pay:exportReadyToPayCsv | Main export/overflow and Candidate Banking export | Retain current all-page semantics; add candidate Ready-only scope without weakening global export. |
| banking:pay:manageSnooze | Candidate Banking or Blocked; indefinite stays in Snoozes | Move according to effective state. |
| banking:pay:openBucketedResolution | Action Required detail | Move. |
| banking:pay:openChild | Main Draft status/result | Retain. |
| banking:pay:openFiltersModal | Main toolbar | Retain. |
| banking:pay:openNonBucketResolution | Action Required detail | Move. |
| banking:pay:openSnooze | Candidate Banking/Blocked where currently allowed | Move. |
| banking:pay:openTaxableFinanceCaseRestructure | Action Required detail | Move. |
| banking:pay:previewPage | Candidate Banking, Action Required and Blocked internal paging | Retain the concept; new endpoints own their own stable cursors. |
| banking:pay:refreshDraftCreateStatus | Main Draft status | Retain. |
| banking:pay:runBankNameCheck | Action Required detail | Move; proposed visible wording changes to Check account name. |
| banking:pay:snoozeAllExpenses | Candidate Banking breakdown | Move. |
| banking:pay:toggleAllReadyPreviewRows | Main header | Retain existing all-page Ready selection authority. |
| banking:pay:toggleExcludeTimesheet | Candidate Banking or Action Required by effective state | Move. |
| banking:pay:togglePreviewRow | Candidate Banking payment row | Move. |
| banking:pay:toggleTimesheetBreakdown | Candidate Banking only | Move; expressly prohibited in main table. |
| banking:pay:toggleTimesheetPreviewGroup | Candidate Banking group | Move. |
| banking:pay:toggleWorkbenchSection | Retained through the proper underline-tab strip for Ready to Pay, Action Required and Blocked for Pay | Presentation changes only. The section-switching action, contents and all child actions remain available. |
| banking:pay:unsnoozeAllExpenses | Candidate Banking breakdown | Move. |
| banking:pay:viewDraftCreateStatus | Main Draft status | Retain. |
| banking:pay:viewRowTimesheets | Candidate Banking, Action Required and Blocked | Move/reuse exact-ID navigation. |

Additional handler entry points used by nested/compatibility flows must also remain callable, including bank-name override set/clear, payee-readiness ensure, explicit select/clear helpers, filter pick/clear operations and the current post-mutation candidate settlement path. They must not be silently dropped merely because their button is rendered by a child modal rather than the main renderer.

## 7. Current screen to future screen placement map

| Current visible area | Future location | What disappears from the main screen | What must remain available |
| --- | --- | --- | --- |
| Create payment batch header | Compact main header | Long status blocks may move behind concise status/detail | Filters, selected state, refresh, clear decisions, Draft gate and Draft operation status. |
| Ready to Pay table | Candidate Banking plus main candidate aggregate | Payment-level columns, expansion and multiple rows per candidate | Every Ready row, checkbox, grouping, breakdown, action, Timesheet shortcut, paging and export. |
| Cases / Resolutions | Action Required | Entire embedded section/card stack | Every case, component, source/target basis, amount, status and action. |
| Bank/readiness blockers inside Blocked | Action Required or Updating according to current actionability | Embedded bank setup rows | Accept, check, set up, activate/retry controls and all affected payments. |
| Passive Blocked rows | Blocked for Pay modal | Entire embedded table | Exact reason, amount, clear condition, Timesheets and current optional safe controls. |
| Hidden indefinite-snooze note/count | Nowhere in Banking Pay | Both note and count | Existing Snoozes tab remains the sole location and keeps its functionality. |
| Section expand/collapse buttons | Replaced by Action Required and Blocked buttons | Expandable main sections | Separate fast modal views. |
| Ready line CSV | Main/candidate export menu | Dedicated control can move to compact toolbar | Global all-page and candidate Ready-only exports. |

## 8. State-transition audit

Every transition below must be one authoritative change. The user must never see an item disappear from one screen before the accepted result says where it now belongs.

| Trigger | Possible authoritative result | Required visible updates |
| --- | --- | --- |
| Tick one Ready payment | Remains Ready; selected amount changes; recovery availability may change | Payment checkbox, candidate tri-state, candidate Ready to pay, Deductions, global headline, Draft gate; Ready and Blocked pages adopt one revision. |
| Untick one Ready payment | Remains Ready or causes a recovery/residual to become Blocked | Same fields; moved economic item leaves Candidate Banking and appears in Blocked exactly once. |
| Tick candidate | All candidate Ready rows selected atomically, with recovery revalidation | Candidate checked/mixed state, amount, Deductions, headline and Draft gate from one result. |
| Untick candidate | All candidate Ready rows cleared atomically | Candidate unchecked; amount becomes the sum of any server-retained selected rows only (normally zero); Deductions recalculated; headline updated. |
| Select/clear all | All matching Ready payments across all pages | Every cached candidate state is invalidated or patched at the same revision; no page-one-only result. |
| Resolve financial case | Updating, then Ready or Blocked | Task shows accepted/updating receipt; after reclassification task leaves Action Required and affected candidates/headline/counts update. |
| Clear resolved decision | Ready may change amount or return to Action Required/Blocked | Candidate detail and every aggregate adopt exact current result; frozen Draft items do not change. |
| Accept bank details | Updating, then Ready, Action Required or Blocked | Audited result retained; do not repeat acceptance after a refresh-only failure. |
| Run account-name check | Updating, then pass/review/fail | Preserve PASS, FAIL, NEAR_MATCH and UNAVAILABLE distinctions and next permitted action. |
| Set up bank account | Updating, then Ready or failure | Failure creates Action Required only if retry/action exists; otherwise visible Blocked. No payment/Draft is created by setup. |
| Exclude Timesheet | Ready, Action Required or Blocked changes | Candidate amount/selection/headline and exact section membership update together. |
| Snooze until date | Leaves Ready and becomes dated Blocked | Candidate may become mixed/unchecked or leave main if no Ready payment remains; Blocked count updates. |
| Create indefinite snooze | Leaves Banking Pay entirely | Appears only in Snoozes; no Blocked count/note. |
| Unsnooze/expiry | Ready, Action Required or Blocked after current evaluation | Never assume Ready merely because the snooze ended. |
| Draft commits | Selected identities become frozen Draft items | Remove/reserve them from live pre-Draft views using current authority; downstream batch opens unchanged. |

## 9. Gaps that must be closed before implementation can be called safe

### Essential product/authority gaps

1. **Candidate summary RPC/read model.** It must return one row per candidate, global selected payment display total, candidate tri-state counts, selected deduction boolean, exact Ready Timesheet scope, full-session counts and stable sort cursor.
2. **Candidate-wide all-page selection mutation.** It must lock one session, validate current versions, select or clear a candidate set-wise, revalidate recovery availability, audit once and return one accepted revision and updated summary.
3. **Ready-only candidate detail.** It must apply effective Ready classification and candidate scope before pagination.
4. **Action Required list/detail.** It must deduplicate by the actual authority owner and expose all affected records/actions in detail.
5. **Passive Blocked list/detail.** It must exclude Action Required, Updating, evidence-only duplicates and every indefinite snooze before count/paging.
6. **Canonical selected-deduction flag.** Current source does not prove a universal candidate boolean. Classification belongs in the database/server contract, including future deduction families.
7. **Full-session selected payment display total.** Current visible Amount is not sufficient. The new value must use the same display semantics as current Ready rows and preserve signed deductions/recoveries once.
8. **Server-side sort/filter.** Candidate, task and blocker ordering must occur before pagination with a stable identity tie-breaker.
9. **Exact plain-language reason and clear condition.** The server should publish a reason code for logic, a user label, a specific explanation, permitted actions and the condition for becoming Ready. Unknown reasons must fail visible, not fall back to a raw code.
10. **Capability/version switch and fallback.** A new frontend must not show the v2 shell unless the Worker proves all required contracts. The existing layout remains the safe fallback during rollout.

### Evidence gaps to close during implementation

- Freeze executable parity fixtures for the current payment display amount across ordinary pay, Timesheets, expenses, corrections, manual debt, overpayment recovery and other deductions.
- Inventory every current deduction family used by preview and Draft authority; prove the new boolean follows canonical server classification rather than a hand-written frontend list.
- Measure how many exact Ready Timesheet IDs candidates have in TEST data before choosing the inline-ID threshold; use a scoped token only for proven outliers.
- Re-extract the current action manifest at the implementation head. This report is a baseline, not permission to ignore later source movement.
- Capture cold and warm browser, Worker and database timing for the existing and new views before claiming a speed improvement.

## 10. Performance and responsiveness audit requirements

The layout can be materially faster because the main screen will stop rendering every payment component, case card and blocked row. That benefit will be lost if the implementation eagerly loads the detail modals or makes one request per candidate.

Mandatory performance rules:

- Main open performs the existing Workbench open/adopt plus one candidate-summary page read. It does not fetch Candidate Banking, Action Required detail or Blocked detail.
- One candidate summary request returns up to 100 candidates. No candidate-by-candidate requests and no browser joins.
- Action Required and Blocked detail are lazy and load only when opened.
- Candidate Banking first page is one Ready-only request. Later pages load only on explicit paging.
- A candidate checkbox is one mutation in the normal path, with at most one bounded reconciliation request after an exceptional incomplete response.
- Main checkbox mutations are serialised. A second click cannot race against an older session version.
- A successful candidate mutation patches one candidate row, the headline, counts and Draft gate. It must not replace the entire large modal DOM.
- Header sorting issues one server-side sorted page request and resets the cursor. It must not download every candidate to sort in JavaScript.
- Cache keys include session ID, session version, progress revision, view, filters, sort and cursor. Pages from different revisions are never mixed.
- Closing a child aborts pending reads and removes child listeners/timers. Closing Banking Pay releases all paged economic data.
- Heavy diagnostics and response-body cloning stay opt-in, as current tests require.
- No fabricated loading percentage. Render an immediate lightweight branded waiter, then the first usable table.

Minimum measurements to record in TEST:

| Journey | Measure |
| --- | --- |
| Cold Banking Pay open | Static asset requests, API request count, response bytes, Worker duration, database duration, time to first usable 100-candidate table. |
| Warm Banking Pay open | API requests, cached asset behaviour, time to usable table. |
| Candidate Banking open | One-request proof, response bytes, time to interactive detail. |
| Candidate tick/untick | Mutation duration, optional reconciliation count, time until row/headline/Draft gate agree. |
| Action Required open | One list request; no eager detail. |
| Blocked open | One list request; indefinite exclusion proved before count. |
| Sort/page/filter | Request count, correct full-result order, stable cursor and no duplicates/missing candidates. |
| Modal lifecycle | DOM row count, detached listener/timer check and memory release after repeated open/close. |

## 11. Regression and acceptance proof

### Existing protections that must continue passing

The current repository already has tests protecting:

- all-page Ready selection and server-owned selection modes;
- session/progress revision fences and fail-closed Draft review;
- concurrent Ready/Blocked settlement and no cross-section duplicates;
- compact Ready amounts and payable-remainder presentation;
- recovery grouping, zero-funds presentation and row-level recovery caps;
- exact Timesheet shortcut identities;
- Timesheet grouping, breakdowns, scroll restoration and segment details;
- bank readiness actions and safe provider-error envelopes;
- targeted candidate settlement after bank/snooze/finance actions;
- filter session adoption;
- current modal performance diagnostics, render throttling and memory cleanup;
- resolved rate/finance cancellation owner boundaries;
- post-resolution Draft integrity;
- downstream cancellation, execution, PAYE and batch-child lifecycles.

These tests do not become obsolete because the UI moves. Their assertions must be adapted to the new home and kept as equivalence protection.

For this audit, the focused current-baseline run completed with 262 passing tests and no failures. That result proves the inspected baseline is internally protected; it does not claim that the future redesign has been implemented or tested.

### New acceptance tests required

1. Exactly 100 one-line candidate rows fit on a full page; candidate 101 is on page 2.
2. No main candidate row can expand, wrap, create a child row or change into a multi-line card at supported widths.
3. Default order is alphabetical across all pages; every sortable header sorts the full result, not the loaded page.
4. PAYE/Umbrella, candidate and client filters retain current semantics across all pages and all three modal views.
5. Candidate checkbox all/partial/none is correct for payments beyond the first detail page.
6. A candidate with no selectable Ready payment is absent; no disabled or ordinary unchecked placeholder is shown.
7. Row double-click opens the correct candidate; single click does not. Checkbox click/double-click and Timesheets click/double-click never open Candidate Banking.
8. Candidate Banking contains Ready rows only even when the candidate has more than 100 Action/Blocked rows before a Ready row in old mixed ordering.
9. Every current Ready row action and every current breakdown field is still available and functional in Candidate Banking.
10. Current payment display amount parity holds for every payment/deduction family and is never treated as PAYE net.
11. Global Ready to pay equals selected display amounts across every candidate page and changes after tick, untick, resolution, promotion, demotion and exclusion.
12. Deductions is Yes only for a selected canonical deduction; unselected, Action Required, Updating, Blocked and indefinite items produce a dash.
13. One shared umbrella problem produces one Action Required task whose detail shows every affected candidate/payment/component/Timesheet and current action.
14. Updating never increments Action Required; failed-with-action and failed-without-action take different destinations.
15. Every passive blocked reason is visible and specific. An unknown reason is visible/counts and cannot become Ready.
16. Indefinite snoozes appear only in Snoozes and affect no Banking Pay row, count, amount or message.
17. Dated snoozes remain visible in Blocked where current policy requires and retain current manage/unsnooze action.
18. Ready to Blocked, Blocked to Ready, Action Required to Updating to Ready/Blocked and resolution-clear reverse movements are atomic and duplicate-free.
19. Legacy selection identity set and new candidate selection identity set produce the same Draft manifest, reservations and blockers.
20. New frontend with old Worker, old frontend with new Worker, missing capability and module-load failure all fall back safely without opening two Workbench sessions.

## 12. Audit verdict

**The product direction is safe and appropriately targeted, but the implementation is not a frontend-only table change.**

Zero functionality can be lost if and only if:

- the five missing contracts are additive;
- current economics, selection, recovery and Draft authority are reused;
- all 29 visible action names plus nested action entry points are accounted for;
- the placement and transition tables above are treated as acceptance criteria;
- current and new regression tests prove identity/amount/Draft parity;
- the simpler main table never loads or renders the detail views eagerly.

The principal speed improvement should come from doing less work on initial open: one compact candidate projection and no embedded detail. The principal safety protection is continuing to let the database decide every financial fact.

## 13. Audit 2 — proposed wording changes only

This section is intentionally **not** a catalogue of all current wording. It contains only wording that this audit recommends changing or adding. Anything not listed here is not part of the proposed message change set.

Internal reason codes can remain unchanged for logic, audit history and support diagnostics. The proposed changes concern what the user sees.

### 13.1 Main table, sections and empty states

| ID | Current exact wording | Proposed exact wording | Why and behaviour preserved |
| --- | --- | --- | --- |
| MSG-001 | Cases / Resolutions | Action Required | This view will include every current human-action payment issue, not only finance resolutions. No case action is removed. |
| MSG-002 | No Case Resolutions match the current Banking Pay filters. | No payments requiring action match the current Banking Pay filters. | Matches the wider Action Required meaning and keeps current filter behaviour. |
| MSG-003 | No cases need resolution. | No payments currently need action. | Plain zero state for the wider task list. |
| MSG-004 | Payment route, candidate and client filters intersect across Ready to Pay, Blocked for Pay and Case Resolutions. Hidden selections are preserved, but hidden rows are never drafted. | Payment route, candidate and client filters apply to Ready to pay, Action Required and Blocked for Pay. Selections outside the current filters remain saved, but those payments cannot be included in this Draft. | Removes intersect and updates the renamed view without weakening the Draft safety rule. |
| MSG-005 | Choose Ready to Pay rows, then create a draft. | Choose the candidates to include, then create a Draft. | The main user action is now candidate selection. Payment-level selection remains in Candidate Banking. |
| MSG-006 | Amount | Ready to pay | The column shows the current selected payment display amount. It does not claim to be PAYE net or final bank-out. |
| MSG-007 | Amount {amount} | Ready to pay £{amount} | Makes the headline meaning explicit. The value must come from the full-session selected amount, not the current visible-page Amount. |
| MSG-008 | {number} selected | {number} candidates included | The main count is candidate-based. The underlying payment selection is unchanged. |
| MSG-009 | {selected}/{available} on this page | {selected} of {available} candidates on this page included | Removes ambiguity about whether the numbers are candidates or payment lines. |
| MSG-010 | Tick all Ready to Pay lines | Include all eligible payments for every candidate | Used as the global checkbox label/tooltip. It still invokes the current server-owned all-page Ready selection. |
| MSG-011 | Untick all Ready to Pay lines | Remove all eligible payments for every candidate | Used as the global clear label/tooltip. Remove means remove from this pay run, not delete payment records. |
| MSG-012 | No payable rows found. | No candidates currently have payments ready to include. | Candidate-based, plain empty state. |
| MSG-013 | No line-level items are currently ready to pay. | No candidates currently have payments ready to include. | Removes line-level technical language. |
| MSG-014 | No Ready to Pay rows match the current Banking Pay filters. | No candidates with payments ready to include match the current Banking Pay filters. | Correct full-result filtered empty state. |
| MSG-015 | No rows are blocked for pay. | No payments are currently blocked. | Uses the object the user understands: payments, not rows. |
| MSG-016 | No Blocked for Pay rows match the current Banking Pay filters. | No blocked payments match the current Banking Pay filters. | Keeps the same filters and removes table-language jargon. |
| MSG-017 | New candidate-level field; no current candidate Deductions label | Deductions | Exact new column name. Its value is Yes or a neutral dash only. |
| MSG-018 | New candidate-level value; no current equivalent | Yes | Show only when at least one currently selected Ready payment is canonically a deduction. |
| MSG-019 | New candidate-level value; no current equivalent | — | Show when no currently selected Ready payment is canonically a deduction. Do not show No, because the candidate may have an unselected or blocked deduction elsewhere. |
| MSG-020 | No current no-Timesheet tooltip | No Ready Timesheet is linked to this candidate's selected payments. | Used only if the design keeps a neutral disabled Timesheets icon. Never open a broad candidate Timesheets search. |

### 13.2 Insufficient funds and deductions

| ID | Current exact wording | Proposed exact wording | Why and behaviour preserved |
| --- | --- | --- | --- |
| MSG-030 | Insufficient funds | Insufficient funds to deduct | The current label is incomplete. The new label tells the user what cannot happen. The underlying NO_PAY_HEADROOM reason remains unchanged. |
| MSG-031 | No credit balance to deduct | Insufficient funds to deduct | Credit balance is accounting language and does not explain the practical effect. |
| MSG-032 | No available funds to recover this yet. | There is not enough pay available in this run to make this deduction. | Removes yet and states exactly why the deduction is not happening in this pay run. |
| MSG-033 | No unreserved payable earnings are available for this recovery. | There is not enough pay available in this run to make this deduction. | Removes unreserved payable earnings, which is accurate internally but not user-friendly. The scheduled amount and amount deductible now remain separately displayed. |
| MSG-034 | Scheduled recovery due | Deduction scheduled for this pay run | Keeps the scheduled figure distinct from what can actually be deducted now. |
| MSG-035 | Recoverable this pay run: {amount} | Can be deducted now: £{amount} | Plain wording; the server still owns the amount. |
| MSG-036 | No recovery can be made because there are no available funds to deduct from this pay run. | This deduction cannot be made because there is not enough pay available in this run. | Shorter and specific. No change to the outstanding amount or blocked state. |
| MSG-037 | {recoverable} will be recovered from the total outstanding amount of {outstanding}. | £{recoverable} will be deducted in this pay run. £{outstanding} is still outstanding before this deduction. | Separates the amount taken now from the outstanding balance and avoids a long accounting sentence. Values remain server supplied. |
| MSG-038 | No recovery can be made this pay run from the total outstanding amount of {outstanding}. | Nothing can be deducted in this pay run. £{outstanding} remains outstanding. | Direct, specific zero-deduction explanation. |

### 13.3 Payment-method changes and financial decisions

| ID | Current exact wording | Proposed exact wording | Why and behaviour preserved |
| --- | --- | --- | --- |
| MSG-040 | PAYE > UMBR | Payment was originally PAYE. Candidate is now paid through an umbrella company. | Removes an abbreviation and arrow that require interpretation. This text must be derived from the current source and target methods. |
| MSG-041 | This amount is currently determined as PAYE and needs resolution to convert it to Umbrella. | Payment was originally PAYE. Candidate is now paid through an umbrella company. Choose how this payment should be handled. | States what changed and what the user must do. The existing taxable restructure action and calculation remain unchanged. |
| MSG-042 | UMBR > PAYE | Payment was originally through an umbrella company. Candidate is now PAYE. | Clear reverse direction with no abbreviation. |
| MSG-043 | This amount is currently determined as Umbrella and needs resolution to convert it to PAYE. | Payment was originally through an umbrella company. Candidate is now PAYE. Choose how this payment should be handled. | Clear reverse source-to-target explanation. |
| MSG-044 | Resolution required, when used for a payment-method change | Payment method changed | A specific task title is more useful than a generic red badge. The full source-to-target sentence follows it. |
| MSG-045 | Resolution required, when a rate must be chosen | Rate decision required | The existing Suggested Rate, Accept suggestion and Manual rate controls remain. |
| MSG-046 | Resolution required, when an amount must be chosen | Amount decision required | The existing Suggested Gross Total and Manual amount controls remain. |
| MSG-047 | Suggested Restructure | Review suggested payment change | Restructure is finance jargon. The action still opens the current taxable restructure flow. |
| MSG-048 | Existing arrangement | Original payment arrangement | Makes the source side explicit. No figures are removed. |
| MSG-049 | Suggested arrangement | Suggested new payment arrangement | Makes the target side explicit. No figures are removed. |
| MSG-050 | Current / source rate | Original rate | Shorter and clearer in the detailed component table. |
| MSG-051 | Suggested / target rate | Suggested rate | Removes duplicate technical terms. |
| MSG-052 | Current / source pay | Original payment amount | Clearer description of the source amount. |
| MSG-053 | Current / source charge | Original client charge | Identifies what the charge refers to. |

### 13.4 Bank-account and umbrella tasks

| ID | Current exact wording | Proposed exact wording | Why and behaviour preserved |
| --- | --- | --- | --- |
| MSG-060 | Payee setup in progress | Bank account setup in progress | Payee is unnecessary jargon. This remains Updating, not Action Required. |
| MSG-061 | Payee readiness setup is queued or running. Refresh shortly. | CloudTMS is setting up this bank account for payment. This payment will update automatically when the setup finishes. | Explains what CloudTMS is doing and avoids telling the user to repeatedly refresh. |
| MSG-062 | Payee setup failed | Bank account setup failed | Plain task/status name. |
| MSG-063 | Payee readiness could not run. Retry setup or contact support. | CloudTMS could not finish setting up this bank account. Try again, or contact support if it keeps failing. | Specific failure and next action. Retry must only appear when the server permits it. |
| MSG-064 | Umbrella inactive | Umbrella company inactive | Makes clear that the company account, not the candidate, is inactive. |
| MSG-065 | Umbrella inactive. Re-enable or review the umbrella before payment setup. | This umbrella company is inactive. Reactivate it before trying to pay the affected candidates. | States the required action and recognises that one umbrella can affect several candidates. |
| MSG-066 | Bank details missing. | Candidate bank details are missing. | Specifies the owner when the owner is the candidate. |
| MSG-067 | Umbrella bank details missing. | The umbrella company's bank details are missing. | Specifies the owner when the owner is an umbrella company. |
| MSG-068 | Bank/name check required. | Account name check required. | Uses the familiar account name term. |
| MSG-069 | Run bank/name check | Check account name | Short, plain action label. The existing route and permissions remain. |
| MSG-070 | Bank details/name check failed. | The account name does not match the bank details. | Use only for a definite FAIL result. Near match and unavailable must use their own messages below. |
| MSG-071 | Bank/name check returned a near match. Review before accepting. | The account name is a close match. Check the name and bank details before accepting them. | Keeps near match distinct from failure. |
| MSG-072 | Bank/name check could not be completed. Review before accepting. | The bank could not check the account name. Check the bank details before deciding whether to accept them. | Keeps UNAVAILABLE distinct and states the decision. |
| MSG-073 | Bank/name check failed. Review before accepting. | The account name does not match the bank details. Check both before accepting them. | Specific FAIL explanation and next step. |
| MSG-074 | Bank/name check passed and the bank account has been set up. Banking Pay will refresh this candidate now. | The account name matches and this bank account is ready for payment. Banking Pay is updating the candidate now. | Plain success message; current refresh remains. |
| MSG-075 | Bank/name check completed and needs review. Banking Pay will refresh this candidate now. | The account name check is complete. Review the result before this payment can be included. Banking Pay is updating the candidate now. | Explains why it is still Action Required. The detailed result must say fail, close match or unavailable. |
| MSG-076 | Bank/name check has been submitted. Banking Pay will refresh this candidate now. | The account name check has started. This payment will update automatically when the result is ready. | Correctly places the item in Updating. |
| MSG-077 | Bank account setup required. | Bank account needs setting up. | Plain state label. |
| MSG-078 | Bank/name check has passed or been accepted, but the provider payee map is missing. | The bank details have been checked, but this account has not yet been set up for payments. | Removes provider payee map while preserving the exact next action. |
| MSG-079 | Please confirm a reason for accepting this bank-name mismatch. This is auditable and will prevent this mismatch from blocking drafts for these bank details. | Enter why you are accepting this account-name mismatch. The reason will be saved in the audit history. These exact bank details will no longer block Draft creation. | Preserves mandatory reason, exact bank-details scope and audit trail. |

### 13.5 Generic or technical fallbacks that should not reach users

| ID | Current exact wording | Proposed exact wording | Why and behaviour preserved |
| --- | --- | --- | --- |
| MSG-090 | Review required. | Payment issue not identified | A generic review instruction does not say what to review. This title is used only for a genuinely unknown reason and the explanation below must accompany it. |
| MSG-091 | A raw blocker code with underscores replaced by spaces | CloudTMS could not identify why this payment is blocked. It will not be included. Refresh Banking Pay; if it remains blocked, contact support. | Keep the raw code in diagnostics, not as user wording. The item remains visible, counted and fail-closed. |
| MSG-092 | This case is currently blocked and needs review before it can move to Ready to Pay. | Show the exact server-published reason and what must change. If neither is available: CloudTMS could not identify why this payment is blocked. It will not be included. Refresh Banking Pay; if it remains blocked, contact support. | Removes a vague catch-all. No blocked item is hidden. |
| MSG-093 | This timesheet segment is currently blocked for pay. | Show the exact Timesheet reason. If it is unavailable: This Timesheet payment cannot be included because CloudTMS could not confirm its current status. Open the Timesheet or refresh Banking Pay. | Requires a specific reason while retaining exact Timesheets navigation and fail-closed state. |
| MSG-094 | entity_kind must be CANDIDATE or UMBRELLA | This payment is missing its bank-account owner. Refresh Banking Pay and try again. | Replaces an internal field name if a damaged action reaches the user. |
| MSG-095 | entity_id is required | This payment is missing its bank-account owner. Refresh Banking Pay and try again. | Same damaged-context family; no internal field name. |
| MSG-096 | bank_details_hash is required | The bank details changed or could not be confirmed. Refresh Banking Pay and try again. | Explains the safe next step without exposing the fingerprint field. |
| MSG-097 | Reason prompt modal is not available (openUiPromptModal missing). | The bank-details review window could not be opened. Refresh Banking Pay and try again. | Removes a JavaScript function name. |
| MSG-098 | Case key is required. | This payment case could not be identified. Refresh Banking Pay and try again. | Replaces an internal identity term. |
| MSG-099 | Candidate id is required. | This candidate could not be identified. Refresh Banking Pay and try again. | Replaces an internal field term. |
| MSG-100 | Timesheet id is required. | This Timesheet could not be identified. Refresh Banking Pay and try again. | Replaces an internal field term. |
| MSG-101 | Candidate and timesheet context are required for the expense set action. | CloudTMS could not identify the candidate and Timesheet for this expense action. Refresh Banking Pay and try again. | Explains the failed action in plain English. |

### 13.6 Loading, refresh and Draft safety

| ID | Current exact wording | Proposed exact wording | Why and behaviour preserved |
| --- | --- | --- | --- |
| MSG-110 | Create Draft disabled: selected rows need refresh | Create Draft is unavailable while selected payments are updating. | Plain reason; Draft stays disabled for the same authority condition. |
| MSG-111 | The current canonical preview page is still loading for this workbench session/version. | Banking Pay is loading the latest payment list. | Removes canonical, workbench and session/version. |
| MSG-112 | Loading the first Ready to Pay preview page. | Banking Pay is loading the latest payment list. | One consistent loading message. |
| MSG-113 | The displayed preview does not match the current workbench session/version. Refresh Banking Pay. | This payment list is out of date. Refresh Banking Pay before creating a Draft. | Preserves the fail-closed version fence. |
| MSG-114 | This payment preview is obsolete or has been replaced. Open the latest preview session. | A newer Banking Pay list is available. Open the latest list before creating a Draft. | Removes obsolete/session jargon and keeps the same block. |
| MSG-115 | Select at least one current eligible Ready to Pay row. | Include at least one candidate with a payment ready to pay. | Matches the candidate-based main interaction. Candidate Banking still allows payment-level selection. |
| MSG-116 | Select rows | Select candidates | Candidate-based disabled button text. |
| MSG-117 | Some beneficiary checks failed ({failed}/{attempted}). Those payees remain blocked until refreshed or corrected. | Some bank-account checks failed ({failed}/{attempted}). The affected payments cannot be included until the bank details are corrected or checked again. | Removes beneficiary/payee and makes the impact explicit. |
| MSG-118 | Beneficiary checks were performed during preview; use Refresh to re-check if bank details change. | Bank details were checked when this list was prepared. Use Refresh if those details have changed. | Plain description without preview jargon. |
| MSG-119 | PAYE draft creation is blocked because an existing PAYE draft already exists. Cancel or delete the existing PAYE draft first. | A PAYE Draft already exists. Cancel or delete it before creating another PAYE Draft. | Removes repetition; same hard guard. |
| MSG-120 | A non-draft PAYE batch already exists for this payroll week. Creating another PAYE batch for the same week is override-only. Replacement or cancellation is usually the correct path. | A PAYE payment batch already exists for this payroll week. Creating another requires extra security checks. Usually the existing batch should be replaced or cancelled instead. | Removes override-only jargon while keeping the warning and preferred safe path. |
| MSG-121 | Override sequence required: password reauthentication, 2FA verification, then explicit continue confirmation. | To continue, confirm your password, complete 2FA and confirm that you want to create another PAYE batch. | Same security steps in direct language. |

### 13.7 Indefinite snooze wording removed from Banking Pay

| ID | Current exact wording | Proposed exact wording | Why and behaviour preserved |
| --- | --- | --- | --- |
| MSG-130 | {number} hidden item(s) | No Banking Pay message or count | Indefinite snoozes are excluded from Banking Pay before counting. Their existing Snoozes-tab functionality remains. |
| MSG-131 | Indefinite snoozes are hidden from the live pay workbench and are managed in Loans / Snoozes. | No Banking Pay message | The user should see indefinite snoozes only in the Snoozes tab, not a reminder of hidden Banking Pay items. |

## 14. Wording implementation rule

The future implementation should not hard-code these sentences independently in several modals. The server should publish stable reason/action codes and the current source/target facts; one presentation layer should map those facts to the approved wording. That keeps Candidate Banking, Action Required, Blocked for Pay, tooltips, CSV labels and Draft blockers consistent without moving any payment authority into the browser.

For payment-method changes, the sentence must be constructed from verified current source and target values. If either value is missing or mixed, do not guess. Show the exact affected methods or a visible unclassified task and keep the payment out of Ready until the server provides a safe current classification.

## 15. Final handoff checklist

Before a later implementation can be accepted, the reviewer should be able to mark every BP item in sections 5–8 as one of:

- proven unchanged;
- proven moved and working;
- new support implemented and verified;
- intentionally removed shell with its underlying function proved elsewhere.

No BP item may simply be marked not applicable because the main table is simpler.

The reviewer should separately mark each MSG item as:

- exact proposed wording implemented;
- a deliberately revised alternative approved by the product owner; or
- not shown because the underlying state cannot occur in that view.

That two-ledger approach provides the later cross-reference requested here: functionality can move without disappearing, and wording can become clearer without changing the financial rule beneath it.
