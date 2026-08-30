# Synthetic candidate-table browser evidence — 28 August 2026

Target: loopback `127.0.0.1:18742`; exact allowlisted static test files; no application proxy, auth state, database route or payment operation. The test page labels itself as synthetic component verification, not the finished modal.

Reproducible verifier: frontend `tests/fixtures/verify-banking-table-browser.mjs`, run with the existing authorised in-app browser tab and its Playwright interface.

| Check | Observed result |
| --- | --- |
| Header schema | Include, Candidate, Deductions, Ready to pay |
| Candidate rows / cells | 100 rows; exactly four cells per row |
| Row height | All 43px at the observed normal viewport |
| Mixed selection | Native half-tick visible; aria-checked=mixed |
| Headline versus page | £220.00 from server-style full-scope fixture; not the visible-page total |
| Timesheets double-click | One exact selected-ID intent; no candidate/parent opening |
| Pending checkbox | Confirmed half-tick/£10.00 and £220.00 headline retained; controls disabled |
| Accepted update | £25.00 candidate / £235.00 headline; existing first row DOM retained |
| Invalid amount response | Rejected before DOM change |
| Candidate double-click | Exact candidate ID only; no parent propagation |
| Sort / page | Server-navigation intent; no browser reorder/filter |
| Include header | One full-scope intent, not one request per visible row |
| Narrow width | 423px scroll viewport, 760px table; horizontal overflow, no wrapped rows |
| Largest decimal | £9,999,999,999,999,999.99 intact; payment cell/client width both 286px |
| Twenty cycles | One mounted table, 100 rows, no duplicate click dispatch |

This evidence does not prove real selection mutations, deployed payload parity, complete modal layout, phone/browser zoom, assistive-technology behaviour, full memory limits or end-to-end latency. Those gates remain open.
