# Performance baseline and acceptance protocol

## Principle

Performance claims must distinguish:

1. database function time;
2. Worker route time;
3. network/payload time;
4. browser parse/state/render time;
5. time until first useful main candidate page;
6. background Workbench preparation time.

A faster database RPC alone does not prove a faster modal. A smaller DOM does not prove source preparation is faster.

## Baseline capture before v2 code

Record p50 and p95 from repeated current TEST observations for:

- Workbench open/adopt;
- preparation until current Ready authority is usable;
- first useful existing Banking Pay view;
- existing Ready/Cases/Blocked first pages;
- existing candidate-targeted refresh/detail behaviour;
- individual selection;
- global all-page selection and clear;
- case/action opening;
- Blocked opening;
- current payload bytes;
- browser render duration/long tasks/DOM nodes;
- retained listeners, timers, nodes and memory after twenty open/close cycles.

Record:

- exact frontend/backend commits;
- exact deployed asset/version;
- session/filter/channel scope;
- row/candidate counts;
- cold or warm state;
- browser/device/network conditions;
- individual samples, not only aggregate;
- errors/retries separately.

Do not mutate financial or payment state merely to obtain a baseline.

## Request-count acceptance

| Interaction | Normal | Hard maximum |
| --- | ---: | ---: |
| Fresh main open | open/adopt + candidate summary | 2 plus bounded genuine preparation progress reads |
| Already adopted refresh | candidate summary | 1 plus required progress only |
| Candidate Banking open | one Ready-only page | 1 |
| Candidate checkbox under Candidate sort | one mutation | 1 |
| Candidate checkbox under amount/deduction sort or membership change | mutation + anchored page | 2 |
| Individual checkbox | one mutation | 1 plus one anchored summary only if order/membership requires |
| Action Required open | one list | +1 when detail explicitly opens |
| Blocked open | one list | +1 when detail explicitly opens |
| Sort/page | one summary read | 1 |
| Selected Timesheets | none if inline, otherwise one token resolution | 1 |

There is no candidate-search budget because no search is permitted.

## Payload acceptance

| Response | Preferred | Mandatory investigation/fail-until-explained |
| --- | ---: | ---: |
| Candidate summary page | ≤64 KB | >128 KB |
| Candidate selection | ≤16 KB | >32 KB |
| Candidate Ready page | ≤256 KB | >512 KB |
| Action Required page | ≤128 KB | >256 KB |
| Blocked page | ≤128 KB | >256 KB |

Responses must remain bounded even with long names, many affected payments and large exact Timesheet scopes. Use lazy detail and selected-Timesheet token resolution rather than unbounded summary payloads.

### Approved open-breakdown selection exception — DEV-0007

The user approved this exception on 28 August 2026 with `YES AND CONTINUE`:

- With no Candidate Banking breakdown open, the existing selection-response 16/32 KB limits are unchanged.
- With one Candidate Banking breakdown already open, the same response may additionally contain its one complete current Ready page, bounded by the existing 256/512 KB Ready-page limits and maximum 100 rows.
- The base response, including envelope overhead, remains within 16/32 KB. Combined preferred/investigation bounds are 272/544 KB. This is not permission for unbounded section movements or all child pages.
- No extra automatic Ready-page request is permitted. Selection, candidate summary, complete open child, headline and section movement must settle at the same accepted revision.
- Existing latency, memory, request-count and every financial/Draft requirement remain unchanged. Both uncompressed and actual transferred bytes must be recorded; synthetic local compression is not network performance evidence.

EVIDENCE-0039 is the investigation supporting the approved design, not a performance pass. Implementation and representative browser/Worker measurements remain required.

## Relative latency acceptance

| Operation | Pass requirement |
| --- | --- |
| Existing Workbench source preparation | No more than 5% p95 regression. |
| First 100 usable candidates | p50 ≤70% and p95 ≤80% of current first-useful-modal baseline. |
| Candidate summary DB/Worker | No slower than current combined Ready/Cases/Blocked first-page work; target ≤50% of combined p95. |
| Candidate Banking open | No worse than current candidate detail/targeted expansion p95; target ≥20% faster. |
| Candidate checkbox | No worse than current global all-page selection p95, excluding one permitted dynamic-sort read. |
| Individual checkbox | No more than 5% p95 regression. |
| Action Required first page | No worse than current Cases first page; target ≥20% faster. |
| Blocked first page | No worse than current Blocked first page; target ≥20% faster. |
| Main render | 100 simple rows; no routine whole-modal rebuild or long-task regression. |
| Twenty cycles | No duplicate listeners/pollers; retained resources ≤ baseline +5%. |

## Database proof

For every new query/RPC:

- record `EXPLAIN (ANALYZE, BUFFERS)` on representative TEST scale through the approved safe verification route;
- record rows examined/returned, execution/planning time, buffers and temp use;
- prove sort happens before pagination;
- prove candidate/task/blocker grouping is set-wise;
- prove no N+1/per-candidate loop;
- prove cursor predicates use stable/indexable values;
- prove worst permitted page is bounded;
- record lock/statement timeout behaviour;
- add an index only after measurement proves need and impact.

## Browser proof

Measure:

- request waterfall;
- transferred/uncompressed bytes;
- JSON parse/state adoption;
- render and layout duration;
- DOM node count;
- long tasks;
- scroll responsiveness with 100 rows;
- candidate child open/close without main rebuild;
- mutation-to-authoritative-paint time;
- memory/listener/timer retention.

Test 100%, 125%, 150% and 200% zoom/text scaling and supported modal widths.

## Failure rule

Any hard budget breach, statistically meaningful regression, unbounded query, N+1 call, repeated full-modal render or unexplained memory growth blocks activation. It cannot be waived by saying the redesign feels faster.

The evidence register must contain the raw measurement artefact, summary calculation and exact source/deployment identity.

## Working local evidence — 28 August 2026

The disposable 110-row database benchmark initially exposed approximately 3.2 seconds of candidate projection work. Two expression-materialisation fences reduced that same projection to approximately 197–211 ms without changing its normalised payload or display result. Both JIT-on and JIT-off runs show the improvement; no persistent database setting was changed.

This is not a full performance acceptance. The synthetic fixture is small and the complete Action/Updating/Blocked summary, Worker route, browser render, real representative distribution and repeated lifecycle measurements remain outstanding. See EVIDENCE-0004 and its bounded follow-up EVIDENCE-0005.

STEP-035 subsequently reproduced a warm-plan regression in the complete105-candidate summary. The scoped SQL-wrapper setting alone did not fix it: the wider suite still exceeded the existing3-second PREVIEW_PROGRESS per-operation budget. Instrumented rollback comparisons isolated repeated execution of the existing effective-section helper. A PL/pgSQL RETURN QUERY wrapper over the byte-equivalent certified statement, with parameter-specific planning restricted to that new private reader, reduced those calls from2,928,064 to75,444 for the same six-sample run. Complete summary responses remained identical. A current-source early return avoids unnecessary payment expansion only when the existing stable source owner proves no noncurrent source.

The six local summaries then measured875.16/954.21/888.35/779.90/804.81/781.66ms. All43 combined regressions passed without increasing a timeout. Raw sampled timings and scope limitations are in `measurements/summary-reader-planning-20260828.json`; EVIDENCE-0052/DEV-0010 apply only to this local component. These measurements do not meet or waive any browser, deployment, representative-distribution or concurrency gate above.

### Subsequent repeated-read finding — STEP-047/048

The earlier improvement was not a complete fix: later full-fixture repetition again exceeded the same3-second per-operation limit. A single-row payload evaluation barrier reduced repeated JSON construction, with3504 exact old/new payload cases plus a null composite passing; repetition still exposed an independent eligibility problem. The failing profile showed1,247,802 effective-section calls. Materializing the final certified eligible-ID set before its physical-row join prevents that repeated work without changing any predicate.

After both corrections, ten complete105-candidate summary/navigation/selection fixtures passed consecutively without a timeout. Their60 individual sorted-page reads measured442.540–617.649ms, p50=503.456ms and nearest-rank p95=578.354ms. A separate profile grew by10,424 section checks per summary, instead of the failed quadratic pattern. The original Draft/readiness checks and all-page selected headline assertions remained in each fixture. No timeout or persistent database configuration was changed.

`measurements/eligible-set-repeated-reads-20260828.json` retains all statement samples, source identities and profile counts. These results are confined to disposable local PostgreSQL17.6 with synthetic rollback data. They do not establish real Worker/browser latency, representative scale, concurrency, or the finished modal's performance acceptance.

### 29 August local application checkpoint — STEP-063/064

The contained Chromium shell now renders100 synthetic candidates as100 non-wrapping four-cell rows in one bounded page. The complete Playwright test containing load, publish and assertions completed in327 ms; the isolated in-page publish is guarded below500 ms. Candidate open/close and selected-only Timesheet navigation complete in the first Chromium test, whose complete test time was938 ms. These are local synthetic component timings, not network or deployed modal timings.

The current disposable PostgreSQL17 fixture produced the following direct samples without a timeout increase or retry:

- eligible rows:5.67–13.29 ms;
- selection rows:73.41–89.80 ms;
- normalized payload pass:25.68–26.06 ms;
- complete Ready members:185.32–207.64 ms;
- candidate facts:156.38–163.20 ms;
- complete summary including task counts and Draft display gate:544.94–680.40 ms;
- complete six-sort/navigation fixture individual reads:533.959–1,448.908 ms.

The previously observed timeout during a parallel Node run was synthetic fixture lock contention: concurrent rollback files inserted the same local actor/candidate keys. Serial execution removes that false contention. It is not counted as an application performance improvement. Hosted Miget RPC, Worker route, real browser open, real100-candidate distribution, repeated interaction, memory and request-count gates remain OPEN.

### 29 August current-source regression checkpoint

The final 252-file backend audit was deliberately repeated with `--test-concurrency=1` because the rollback-contained database fixtures share fixed synthetic identities. It produced 2,261 passing assertions and 28 intentional skips. The same source also passes the normal 977-test backend suite, 798 frontend Banking tests and three Chromium scenarios. No timeout or database setting was increased.

This was strong correctness and local boundedness evidence, but it was not yet the professional-scale verdict. The final deployed measurements follow.

## Final deployed TEST acceptance — 29 August 2026

These measurements use the real signed-in normal TEST frontend, the deployed normal TEST Worker and the current Miget agency TEST database. They are separated from the earlier local component measurements.

| User-visible or network stage | Observed time |
| --- | ---: |
| Modal shell | 1.30–1.45 s |
| Candidate table useful render | 2.17–2.32 s |
| Capability | 129–153 ms |
| Session open | 304–422 ms |
| Progress | 213–221 ms |
| Candidate summary | 387–453 ms |
| Candidate Ready detail | 335–473 ms |
| Action Required | 551–628 ms |
| Blocked for Pay | 418–433 ms |
| Candidate sort | 568–750 ms |
| Deductions sort | 515–555 ms |
| Ready-to-pay amount sort | 539–598 ms |

Acceptance result: **PASS**. The first useful candidate table is materially faster than the recorded legacy baseline of approximately 3.58–6.27 seconds. Reads are bounded, server-sorted before pagination and do not make one request per candidate. The 100-row and 105-payment local scale fixtures pass without N+1 requests or a raised timeout. Current hosted TEST contains only one Ready candidate, so the scale conclusion combines deployed route timing with executable 100-row fixtures rather than pretending the hosted dataset itself contains 100 candidates.

One earlier repeated-read timeout was traced to the old eligibility expression being evaluated repeatedly inside the final join. The certified predicate was not changed: its completed ID set is now materialised once. Repeated fixtures subsequently complete in approximately 0.44–0.62 seconds. No application timeout, database timeout or persistent planner setting was increased.

No Banking request failed during the final timing capture. Four initial authentication/capability `401` probes belonged to the normal page bootstrap and were not failed Banking Pay reads.
