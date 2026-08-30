/* CloudTMS modal modernisation — does not replace showModal. */
(() => {
  'use strict';

  const explicitMoneyName = /^(?:paye_|umb_|charge_)(?:day|night|sat|sun|bh)$|^mileage_(?:pay|charge)_rate$|^extra_(?:pay|charge)_\d+$|^(?:pay|charge)_(?:day|night|sat|sun|bh)$/;
  const moneyCue = /(?:^|[_\s-])(amount|pay|charge|margin|rate|price|cost|balance|outstanding|advance|credit|debt|recovery|repayment|subtotal|net|gross|due)(?:$|[_\s-])/i;
  const nonMoneyCue = /(?:^|[_\s-])(?:date|time|day(?:s)?|hour(?:s)?|minute(?:s)?|count|quantity|units?|percent(?:age)?|sort|code|number|telephone|phone|postcode|reference|ref|id|uuid)(?:$|[_\s-])/i;
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  let workflowGeometryRaf = 0;

  const safeText = (value) => String(value == null ? '' : value).trim();

  const visibleCopyRules = [
    [/^Right click a Job Title in Edit mode to select a Primary Job Role\.$/i, 'Right-click a job title to make it primary.'],
    [/^Enter the candidate[’']s band \(e\.g\. 5, 6, 7\)\.$/i, null],
    [/^Links this candidate to the rota identity \(GCK\)\. You can correct or clear this if it was mapped incorrectly\.$/i, 'Rota identity key. Change only if incorrectly matched.'],
    [/^When enabled, the options? below override Global Settings for this candidate\.$/i, null],
    [/^When enabled, the options? below override Global Settings for this umbrella\.$/i, null],
    [/^Detailed remittances \(include schedule rows for segment timesheets\)$/i, 'Include schedule details in remittances'],
    [/^Candidate receives umbrella copy remittance \(umbrella-paid items\)$/i, 'Send the candidate a copy of umbrella remittances'],
    [/^Note: Umbrella remittances are always sent to the umbrella remittance email when configured\.$/i, 'Umbrella remittances are also sent to the umbrella’s remittance email.'],
    [/^View the full read-only Candidate Finance Report for Payment Advances, Overpayments, Underpayments, Manual Adjustments, and Snoozed \/ Deferred items, including mixed-case, unresolved taxable, and stale-state detail\.$/i, 'View payment advances, adjustments and unresolved finance items.'],
    [/^Clearing all times means this client will inherit the global shift pattern\.$/i, 'Clear all times to use the default shift pattern.'],
    [/^Rule: you can either set all shift times, or leave all blank\.$/i, 'Set every shift time, or leave all times blank.'],
    [/^Weekly timesheets are managed manually \(no external weekly import source\)\. Candidates will submit timesheets electronically or using a QR Timesheet\.$/i, 'Weekly timesheets are entered manually. Candidates can submit electronically or by QR timesheet.'],
    [/^References & flags$/i, 'Invoice and reference rules'],
    [/^Not available for this client\. These controls are shown only when the client is import-authoritative\.$/i, 'Import correction dates are not available for this client.'],
    [/^Add\s*\/\s*Upsert Client Default Window$/i, 'Add rate window'],
    [/^Tick this box if shifts are ad hoc\..*hours\/days are not fixed$/i, 'Use for shifts without fixed days or hours. Timesheets will not be pre-filled.'],
    [/^Pay method snapshot$/i, 'Pay method'],
    [/^Umbrella pay \(visible if Umbrella\)$/i, 'Umbrella pay'],
    [/^PAYE pay \(visible if PAYE\)$/i, 'PAYE pay'],
    [/^Up to 5 optional additional pay buckets, billed by units \(e\.g\. patient visits\)\.?$/i, 'Add up to five optional rates for work charged per unit, such as patient visits.'],
    [/^Margins are per-unit and follow the PAYE\/Umbrella logic used on the Rates tab\.?$/i, 'Pay and charge margins are calculated automatically from the selected rate type.'],
    [/^Day\/night boundary time settings remain client-level and are not shown here\.$/i, 'Change shift times in Client settings.'],
    [/^This override is independent of invoice routing\..*$/i, 'Use a different address for this contract’s timesheet queries.'],
    [/^Send this contract[’']s missing shifts, wrong hours and reference queries to a different address$/i, 'Use a different email for timesheet queries'],
    [/^Discard this staged import\?$/i, 'Discard this import?'],
    [/^Retry contract check$/i, 'Try again'],
    [/^No staged import is open\.$/i, 'No import is open.'],
    [/^(\d+) parsed rows\. Coverage becomes immutable when the review is created\.$/i, (match) => `${match[1]} rows found. The date range is fixed when the review is created.`],
    [/^Imported evidence$/i, 'Imported shift'],
    [/^Current CloudTMS evidence$/i, 'Current shift'],
    [/^The server will revalidate the saved review before committing\. The browser is not supplying financial values, validation rows or email recipients\.$/i, 'CloudTMS will check the review again before applying it.'],
    [/^Verified source .*parser .*preview generation .*$/i, null],
    [/^Server evidence: source .*parser .*preview .*$/i, null],
    [/^The staged import will remain in history, but this review cannot be resumed\. You can reimport the source file to start again\.$/i, 'This import will remain in history, but you will not be able to continue it. You can import the file again to start over.'],
    [/^The stored global values or their concurrency version are missing\. Nothing has been defaulted and saving is disabled\.$/i, 'Import settings are unavailable. Refresh and try again.'],
    [/^Tick = exclude from pay \(staged\)$/i, 'Tick to exclude from pay.'],
    [/^Changes to pay exclusion and invoice delay are staged until you click Save\.$/i, 'These changes will be saved with the timesheet.'],
    [/^Changes to [‘']Exclude from pay[’'] and [‘']Invoice week \/ Pause[’'] are staged only\. They are applied when you click Save on the Timesheet modal\.$/i, 'These changes will be saved with the timesheet.'],
    [/^Read-only import\/TSFIN segment truth\.$/i, 'Imported shift details.'],
    [/^Authorised at server$/i, 'Authorised'],
    [/^Daily timesheets do not rely on contracts; values are sourced from the best available timesheet context\.$/i, 'Rates come from the available timesheet details.'],
    [/^Evidence file actions do not unlock hours, rates, pay, charge, mileage, travel, accommodation, or other financial values\.$/i, 'Adding or removing evidence does not unlock financial fields.'],
    [/^No evidence uploaded yet\. Drag a file anywhere inside this tab to upload\.$/i, 'No evidence uploaded yet.'],
    [/^Start\/End and break times are shown read-only\.$/i, 'Times and breaks cannot be edited here.'],
    [/^Schedule is shown read-only\. Multiple shifts on the same day appear as multiple lines\.$/i, null],
    [/^Using current financial snapshot totals(?: while .*?)?\.$/i, null],
    [/^Use Apply Snooze in the modal footer to save\.$/i, null],
    [/^Case [0-9a-f-]{36}\s*•\s*Ref advance: [0-9a-f-]{36}$/i, null],
    [/^Timesheet:\s*[0-9a-f-]+(?:…|\.\.\.)?$/i, null],
    [/^Resolve HealthRoster grade to contract$/i, 'Match HealthRoster grade'],
    [/^Resolve contract$/i, 'Match contract'],
    [/^Pick the correct contract for this candidate and client\. We will create a candidate \+ client mapping for this incoming code, targeting the chosen contract \(most reliable\)\.$/i, 'Choose the contract that matches this HealthRoster grade.'],
    [/^This creates a candidate\+client rule: .*It applies whenever this candidate appears for this client with this code in future HR weekly imports\.$/i, 'This choice will be used for future weekly imports for this candidate and client.'],
    [/^Use this screen to fix unassigned candidates and unresolved clients by teaching the system how rota\/HR names map to database records\.$/i, 'Match imported candidate and client names to CloudTMS records.'],
    [/^Authoritative readiness for the current workbench session\/version is unavailable\. Refresh Banking Pay before creating a draft\.$/i, 'Payment readiness could not be confirmed. Refresh Banking Pay before creating a draft.'],
    [/^The current canonical preview page is still loading for (?:this|the current) (?:workbench )?session\/version\.$/i, 'The payment preview is still loading.'],
    [/^No bucket detail is available in the current preview payload for this case\.$/i, 'No payment breakdown is available for this case.'],
    [/^No external bank payment evidence is required for this authorised explicit-zero route\.$/i, 'No bank evidence is needed because this payment is £0.00.'],
    [/^Active payment operation$/i, 'Payment progress'],
    [/^Payment details are not loaded for the current batch version\.$/i, 'Payment details are still loading.'],
    [/^The previous bootstrap snapshot is no longer treated as authoritative\. CloudTMS is fetching the latest batch overview, payment status and remittance summary\.$/i, 'Refreshing the latest payment and remittance details.'],
    [/^Read-only view of remittance(?: email outbox rows\. Remittances are triggered automatically from the pay batch child modal| and payout-notice rows for this pay batch\. Double-click a row to open the exact rendered communication where available)\.$/i, null],
    [/^No overrides staged\.$/i, 'No overrides added.'],
    [/^Manual values are sent to the backend suggestion endpoint\..*The effective pay date is locked to the backend correction plan\.$/i, 'The fixed component total cannot be reduced. The payment date cannot be changed for this adjustment.'],
    [/^Manual values are sent to the backend suggestion endpoint\..*$/i, 'The fixed component total cannot be reduced.'],
    [/^CloudTMS is retaining the exact original reminder batch while it checks the durable result\. No new reminder batch can be started from this workspace\.$/i, 'CloudTMS is checking the earlier reminder batch. Wait for the result before starting another.'],
    [/^CloudTMS is checking this batch without changing its identity or selection\.$/i, 'CloudTMS is checking the existing batch.'],
    [/^(?:1 retained batch|Protected recovery state)$/i, null],
    [/^\+ Add timesheet$/i, 'Add existing timesheets'],
    [/^Refs and Ward$/i, 'References and ward'],
    [/^QR reissue \(optional\)$/i, 'Reissue QR code (optional)'],
    [/^Create Manual Daily Timesheet$/i, 'Create daily timesheet'],
    [/^(?:Rate Presets|Preset Rates)$/i, 'Rate presets'],
    [/^Create preset$/i, 'Create rate preset'],
    [/^Rate preset$/i, 'Edit rate preset'],
    [/^Retry Outbox item$/i, 'Retry outbox item'],
    [/^Reschedule Outbox item$/i, 'Reschedule outbox item'],
    [/^Outbox detail$/i, 'Outbox details'],
    [/^Skip Weeks$/i, 'Skip weeks'],
    [/^Bank Holidays list \(JSON dates\)$/i, 'Bank holiday dates'],
    [/^BH feed URL$/i, 'Bank holiday feed'],
    [/^VAT \/ Holiday pay \/ ERNI \/ Mileage defaults are controlled by date windows\. Windows cannot overlap\.$/i, 'Set finance defaults by date. Date ranges cannot overlap.'],
    [/^Tip: selecting a new Start date will automatically adjust the Current End date to avoid overlaps\.$/i, 'Choosing a new start date adjusts the current end date to prevent overlaps.'],
    [/^Admin: manage users \(create\/edit\/disable\/reset password\) and per-user email settings JSON\.$/i, 'Manage users, access and email settings.'],
    [/^Admin: edit global finance email settings \(used for finance workflows and attachment bundling\)\.$/i, 'Manage the email address and attachment limits used by finance workflows.'],
    [/^Click a row to select \(blue\)\. Double-click a row to edit\. Edit opens a panel above\.$/i, null],
    [/^Email Settings \(Finance\)$/i, 'Finance email settings'],
    [/^Showing eligible candidates for this flow\.$/i, null],
    [/^Showing eligible clients for this flow\.$/i, null],
    [/^\+ Child$/i, 'Add sub-family or role'],
    [/^Manual address \(you can edit after choosing a result, or ignore lookup entirely\)$/i, 'Enter address manually'],
    [/^Double-click a row to apply\. Single-click selects; click Apply to use the selected preset\.$/i, 'Select a preset, then choose Apply.'],
    [/^Hospital \/ Trust \(normalised\)$/i, 'Hospital / Trust'],
    [/^Save remains in the modal footer\. Template id is kept internally and is not shown here\.$/i, null],
    [/^Select a template and click Save to apply it, or close this modal to cancel\.$/i, 'Select a template, then choose Apply template.'],
    [/^Canonical current Timesheets represented in Workbench evidence$/i, 'Current timesheets in Banking Pay'],
    [/^Canonical authorised Timesheets$/i, 'Authorised timesheets'],
    [/^Canonical active-Advance Timesheets$/i, 'Timesheets with active advances'],
    [/^Canonical retained-finance Timesheets$/i, 'Timesheets with retained finance records'],
    [/^Exact qualifying target union$/i, 'Timesheets affected'],
    [/^Potential cross-route Case Resolution Timesheets$/i, 'Potential payment-route cases'],
    [/^TSFIN repricing rows$/i, 'Finance rows repriced'],
    [/^Authoritative Banking Pay session evidence$/i, 'Open Banking Pay sessions']
    ,[/^Source Timesheets, Contract Weeks, rates and TSFIN rows will not be changed\..*Only prospective derived Banking Pay Workbench output will be refreshed against the candidate's new target payment method\.$/i, 'Existing timesheets, rates and financial records will not change. CloudTMS will use the new pay method for future Banking Pay calculations.']
    ,[/^No authoritative open Banking Pay session currently represents this candidate\. The exact canonical target set is still shown above\.$/i, 'No open Banking Pay session currently includes this candidate.']
    ,[/^Canonical targets$/i, 'Affected timesheets']
    ,[/^Choose which payment routes, candidates and clients appear in Banking Pay\. Create Draft uses the same filtered workbench rows\.$/i, 'Choose which payment routes, candidates and clients to include.']
    ,[/^Show PAYE- and Umbrella-relevant rows and create the applicable filtered draft\(s\), subject to PAYE guardrails\.$/i, 'Include PAYE and Umbrella payments.']
    ,[/^Show only PAYE-relevant Workbench rows and include only those filtered Ready to Pay rows in Create Draft\.$/i, 'Include PAYE payments only.']
    ,[/^Show only Umbrella-relevant Workbench rows and include only those filtered Ready to Pay rows in Create Draft\.$/i, 'Include Umbrella payments only.']
    ,[/^Payment route, candidate and client filters intersect across Ready to Pay, Blocked for Pay and Case Resolutions\. Hidden selections are preserved, but hidden rows are never drafted\.$/i, null]
    ,[/^Create or update a Payment Advance\. Use Apply Payment Advance in the modal footer to save\.$/i, 'Enter the advance and repayment details.']
    ,[/^Create or update a Manual Credit Adjustment\. Use Apply in the modal footer to save\.$/i, 'Enter the credit adjustment details.']
    ,[/^Create or update a Manual Debt Adjustment\. Use Apply in the modal footer to save\.$/i, 'Enter the debt and repayment details.']
    ,[/^Pick a candidate to determine the payout route\.$/i, 'Select a candidate to continue.']
    ,[/^This is a non-repayable correction payout and will be shown as a Manual Credit Adjustment\.$/i, 'This adjustment is not repaid by the candidate.']
    ,[/^After Apply, this item will remain visible and move into Blocked for Pay\.$/i, 'After saving, this item will move to Blocked for Pay.']
    ,[/^After Apply, this item will drop out of the live pay workbench and remain in Loans \/ Snoozes only\.$/i, 'After saving, this item will remain available in Loans / Snoozes.']
    ,[/^You can also close this dialog to cancel\.$/i, null]
    ,[/^This action is auditable and requires a reason\.$/i, null]
    ,[/^FINANCE_CASE_EVENT$/i, 'Finance case']
    ,[/^Choose a date first\.$/i, null]
    ,[/^Supported content includes formatted text, colours, links, tables, and uploaded images\..*$/i, null]
    ,[/^This signature is stored on your user record and is injected into email editors by default\..*$/i, null]
  ];

  const titleCopyRules = [
    [/^Resolve grade to role \(daily\)$/i, 'Match grade to role'],
    [/^Select matching timesheet \(HR Rota Daily\)$/i, 'Select matching timesheet'],
    [/^Suggested Rates Review$/i, 'Review suggested rates'],
    [/^Refs and Ward$/i, 'References and ward'],
    [/^QR reissue \(optional\)$/i, 'Reissue QR code (optional)'],
    [/^Manual Week(?:\s*[—-].*)?$/i, 'Edit weekly hours'],
    [/^Create Manual Daily Timesheet$/i, 'Create daily timesheet'],
    [/^(?:Rate Presets|Preset Rates)$/i, 'Rate presets'],
    [/^Create preset$/i, 'Create rate preset'],
    [/^Rate preset$/i, 'Edit rate preset'],
    [/^Retry Outbox item$/i, 'Retry outbox item'],
    [/^Reschedule Outbox item$/i, 'Reschedule outbox item'],
    [/^Outbox detail$/i, 'Outbox details'],
    [/^Skip Weeks$/i, 'Skip weeks'],
    [/^QR timesheet after-save action$/i, 'QR timesheet options'],
    [/^Resolve HealthRoster grade$/i, 'Match HealthRoster grade']
  ];

  const replacementFor = (rules, value) => {
    for (const [pattern, replacement] of rules) {
      const match = value.match(pattern);
      if (!match) continue;
      return typeof replacement === 'function' ? replacement(match, value) : replacement;
    }
    return undefined;
  };

  const elementFor = (root, selector) => {
    try { return root.querySelector(selector); } catch { return null; }
  };

  const directChildFor = (root, node) => {
    if (!root || !node || !root.contains(node)) return null;
    let current = node;
    while (current && current.parentElement !== root) current = current.parentElement;
    return current && current.parentElement === root ? current : null;
  };

  const directChildForSelector = (root, selector) => directChildFor(root, elementFor(root, selector));

  const header = (title, copy, eyebrow = 'CloudTMS record') => {
    const wrap = document.createElement('div');
    wrap.className = 'ctms-section-head';
    const block = document.createElement('div');
    const eye = document.createElement('span');
    eye.className = 'ctms-section-eyebrow';
    eye.textContent = eyebrow;
    const heading = document.createElement('h3');
    heading.className = 'ctms-section-title';
    heading.textContent = title;
    block.append(eye, heading);
    if (copy) {
      const p = document.createElement('p');
      p.className = 'ctms-section-copy';
      p.textContent = copy;
      block.appendChild(p);
    }
    wrap.appendChild(block);
    return wrap;
  };

  const intro = (body, key, title, copy) => {
    if (!body || body.querySelector(`:scope > .ctms-tab-intro[data-ctms-intro="${key}"]`)) return;
    const wrap = document.createElement('div');
    wrap.className = 'ctms-tab-intro';
    wrap.dataset.ctmsIntro = key;
    const block = document.createElement('div');
    const h = document.createElement('h2');
    h.textContent = title;
    block.appendChild(h);
    if (copy) {
      const p = document.createElement('p');
      p.textContent = copy;
      block.appendChild(p);
    }
    wrap.appendChild(block);
    body.prepend(wrap);
  };

  const section = (form, options) => {
    const opts = options || {};
    const selectors = Array.isArray(opts.selectors) ? opts.selectors : [];
    const explicitNodes = Array.isArray(opts.nodes) ? opts.nodes : [];
    const nodes = [];
    const seen = new Set();

    for (const selector of selectors) {
      const child = directChildForSelector(form, selector);
      if (child && !seen.has(child)) {
        nodes.push(child);
        seen.add(child);
      }
    }
    for (const node of explicitNodes) {
      const child = directChildFor(form, node) || node;
      if (child && child.parentElement === form && !seen.has(child)) {
        nodes.push(child);
        seen.add(child);
      }
    }
    if (!nodes.length) return null;

    const wrap = document.createElement('section');
    wrap.className = `ctms-section${opts.wide ? ' ctms-section-wide' : ''}`;
    wrap.dataset.ctmsSection = safeText(opts.key || opts.title).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    wrap.appendChild(header(opts.title || 'Details', opts.copy || '', opts.eyebrow || 'CloudTMS record'));
    const grid = document.createElement('div');
    grid.className = `ctms-section-grid${opts.columns === 3 ? ' ctms-grid-3' : ''}`;
    nodes.forEach((node) => grid.appendChild(node));
    wrap.appendChild(grid);
    form.appendChild(wrap);
    return { wrap, grid, nodes };
  };

  const spanForSelector = (form, selector, className = 'ctms-span-2') => {
    const target = elementFor(form, selector);
    if (!target) return;
    const grid = target.closest('.ctms-section-grid');
    if (grid) {
      let node = target;
      while (node && node.parentElement !== grid) node = node.parentElement;
      if (node && node.parentElement === grid) node.classList.add(className);
      return;
    }
    const node = directChildFor(form, target);
    if (node) node.classList.add(className);
  };

  const unclaimedVisibleChildren = (form) => Array.from(form.children).filter((child) => {
    if (child.classList.contains('ctms-section') || child.classList.contains('record-system-references')) return false;
    if (child.id === 'searchHeaderRow') return false;
    if (child.matches('input[type="hidden"]')) return false;
    return true;
  });

  const finishRemaining = (form, title = 'Additional details', copy = '') => {
    const nodes = unclaimedVisibleChildren(form);
    if (!nodes.length) return;
    section(form, { key: 'additional', title, copy, nodes, wide: true });
  };

  const isMoneyInput = (input) => {
    if (!(input instanceof HTMLInputElement)) return false;
    if (['checkbox', 'radio', 'hidden', 'date', 'time', 'datetime-local'].includes(safeText(input.type).toLowerCase())) return false;
    const identity = [input.name, input.id, input.dataset.field, input.dataset.expField, input.dataset.key]
      .map(safeText)
      .filter(Boolean)
      .join(' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    if (explicitMoneyName.test(safeText(input.name))) return true;
    if (identity && moneyCue.test(identity) && !nonMoneyCue.test(identity)) return true;

    const row = input.closest('.row,.split,td,label,.field,.form-group');
    const label = row?.querySelector('label,.mini,th') || input.labels?.[0] || null;
    const labelText = safeText(label?.textContent).replace(/\s+/g, ' ');
    return !!labelText && moneyCue.test(labelText) && !nonMoneyCue.test(labelText);
  };

  const formatMoneyInput = (input, dispatch) => {
    if (!isMoneyInput(input)) return false;
    const raw = safeText(input.value).replace(/,/g, '');
    if (!raw) return false;
    const value = Number(raw);
    if (!Number.isFinite(value)) return false;
    const fixed = value.toFixed(2);
    if (input.value === fixed) return false;
    input.value = fixed;
    if (dispatch) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  };

  const decorateMoney = (root) => {
    root.querySelectorAll('input').forEach((input) => {
      if (!isMoneyInput(input)) return;
      formatMoneyInput(input, false);
      if (input.dataset.ctmsMoney === '1') return;
      input.dataset.ctmsMoney = '1';
      const parent = input.parentElement;
      if (!parent) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'ctms-money-field';
      const prefix = document.createElement('span');
      prefix.className = 'ctms-money-prefix';
      prefix.setAttribute('aria-hidden', 'true');
      prefix.textContent = '£';
      parent.insertBefore(wrapper, input);
      wrapper.append(prefix, input);
    });
  };

  const formatVisibleMoney = (root) => {
    if (!root) return;
    const formatNumber = (raw) => {
      const numeric = Number(String(raw).replace(/,/g, ''));
      return Number.isFinite(numeric) ? numeric.toFixed(2) : raw;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      const parent = node.parentElement;
      if (!parent || parent.closest('input,textarea,select,option,script,style,code,pre,[contenteditable="true"]')) return;
      const original = node.nodeValue || '';
      let value = original.replace(/£\s*(-?\d[\d,]*(?:\.\d+)?)/g, (_match, amount) => `£${formatNumber(amount)}`);
      value = value.replace(/\b(Amount|Pay|Charge|Margin|Balance|Subtotal|VAT|Outstanding)\s*:?[ \t]+(-?\d[\d,]*(?:\.\d+)?)(?![\d/:])/gi,
        (_match, label, amount) => `${label} ${formatNumber(amount)}`);
      if (value !== original) node.nodeValue = value;
    });

    root.querySelectorAll('table').forEach((table) => {
      const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map((cell) => safeText(cell.textContent));
      if (!headers.length) return;
      headers.forEach((heading, index) => {
        if (!moneyCue.test(heading) || nonMoneyCue.test(heading)) return;
        table.querySelectorAll('tbody tr').forEach((row) => {
          const cell = row.children[index];
          if (!cell || cell.querySelector('input,select,textarea,button,a')) return;
          const value = safeText(cell.textContent);
          if (!/^-?\d[\d,]*(?:\.\d+)?$/.test(value)) return;
          const formatted = formatNumber(value);
          if (formatted !== value) cell.textContent = formatted;
        });
      });
    });
  };

  const clampModalAfterLayout = (modal, backdrop, frame, family) => {
    if (!modal || !backdrop || !family) return;
    try { cancelAnimationFrame(workflowGeometryRaf); } catch {}
    workflowGeometryRaf = requestAnimationFrame(() => {
      workflowGeometryRaf = 0;
      if (getComputedStyle(backdrop).display === 'none') return;
      const rect = modal.getBoundingClientRect();
      const margin = 12;
      let left = rect.left;
      let top = rect.top;
      if (rect.right > window.innerWidth - margin) left -= rect.right - (window.innerWidth - margin);
      if (rect.bottom > window.innerHeight - margin) top -= rect.bottom - (window.innerHeight - margin);
      left = Math.max(margin, left);
      top = Math.max(margin, top);
      if (Math.abs(left - rect.left) < 1 && Math.abs(top - rect.top) < 1) return;

      // The standard modal geometry runs before a tab's new content has settled.
      // Keep its calculated size and anchor, then nudge only an overflowing
      // targeted frame back into view once the final layout is known.
      modal.style.position = 'fixed';
      modal.style.left = `${Math.round(left)}px`;
      modal.style.top = `${Math.round(top)}px`;
      modal.style.right = 'auto';
      modal.style.bottom = 'auto';
      modal.style.transform = 'none';
      modal.dataset.ctmsViewportClamped = '1';
    });
  };

  const enhanceCandidateMain = (body, form) => {
    intro(body, 'candidate-main', 'Candidate profile', '');
    form.classList.add('ctms-proposal-form');
    section(form, {
      key: 'identity', title: 'Identity', eyebrow: 'Candidate', columns: 3,
      copy: '',
      selectors: ['[name="title"]','[name="first_name"]','[name="last_name"]','[name="display_name"]','[name="date_of_birth"]','[name="gender"]']
    });
    section(form, {
      key: 'contact', title: 'Contact & communication', eyebrow: 'Candidate',
      copy: '',
      selectors: ['[name="email"]','[name="phone"]','[name="opt_in_email"]']
    });
    section(form, {
      key: 'address', title: 'Address & notes', eyebrow: 'Candidate', wide: true,
      copy: '',
      selectors: ['[name="address_line1"]','[name="notes"]']
    });
    spanForSelector(form, '[name="opt_in_email"]');
    spanForSelector(form, '[name="band"]');
    spanForSelector(form, '[name="address_line1"]');
    spanForSelector(form, '[name="notes"]');
    finishRemaining(form);
  };

  const enhanceCandidatePay = (body, form) => {
    intro(body, 'candidate-pay', 'Payment details', '');
    form.classList.add('ctms-proposal-form');
    section(form, {
      key: 'bank', title: 'Payment destination', eyebrow: 'Candidate payment', wide: true,
      copy: 'PAYE bank details can be edited. Umbrella bank details come from the selected umbrella.',
      selectors: ['[name="pay_method"]','[name="account_holder"]','[name="bank_name"]','[name="sort_code"]','[name="account_number"]','#umbRow']
    });
    section(form, {
      key: 'remittance', title: 'Remittance preferences', eyebrow: 'Candidate payment',
      copy: '',
      selectors: ['[name="remittance_overrides_enabled"]']
    });
    const finance = section(form, {
      key: 'finance', title: 'Candidate finance', eyebrow: 'Candidate payment',
      copy: '',
      selectors: ['#candidateAdvancesSummary']
    });
    if (finance) finance.wrap.classList.add('candidate-finance-section');
    spanForSelector(form, '#candidateAdvancesSummary');
    spanForSelector(form, '#umbRow');
    unclaimedVisibleChildren(form).forEach((node) => {
      if (/PAYE bank fields are editable/i.test(safeText(node.textContent))) node.remove();
    });
    finishRemaining(form, 'Additional payment details');
  };

  const enhanceClientMain = (body, form) => {
    intro(body, 'client-main', 'Client profile', '');
    form.classList.add('ctms-proposal-form');
    section(form, {
      key: 'organisation', title: 'Organisation', eyebrow: 'Client', wide: true,
      copy: '',
      selectors: ['[name="name"]','#cli_ref_display','[name="invoice_address"]','[name="client_address"]']
    });
    section(form, {
      key: 'contact', title: 'Primary site contact', eyebrow: 'Client', wide: true,
      copy: '',
      selectors: ['[name="contact_forename"]']
    });
    section(form, {
      key: 'billing', title: 'Billing & accounts payable', eyebrow: 'Client',
      copy: '',
      selectors: ['[name="primary_invoice_email"]','[name="ap_phone"]','[name="vat_chargeable"]','[name="payment_terms_days"]']
    });
    section(form, {
      key: 'notes', title: 'Internal notes', eyebrow: 'Client',
      copy: '',
      selectors: ['[name="notes"]']
    });
    spanForSelector(form, '[name="contact_forename"]');
    spanForSelector(form, '[name="notes"]');
    finishRemaining(form);
  };

  const enhanceCandidateWork = (body, form) => {
    intro(body, 'candidate-work', 'Work & compliance', '');
    form.classList.add('ctms-proposal-form');
    section(form, { key:'professional', title:'Professional details', eyebrow:'Candidate', wide:true,
      selectors:['[name="band"]','[name="prof_reg_number"]','[name="ni_number"]'] });
    spanForSelector(form, '[name="band"]');
    form.querySelector('[name="band"]')?.setAttribute('aria-label', 'Band');
    const references = section(form, { key:'references', title:'References & matching', eyebrow:'Candidate', wide:true,
      selectors:['#tms_ref_display','[name="key_norm"]','#cand-alias-empty'] });
    if (references) {
      const details=document.createElement('details'); details.className='record-system-references';
      const summary=document.createElement('summary'); summary.textContent='System references & matching';
      references.wrap.before(details); details.append(summary, references.wrap);
    }
    finishRemaining(form);
  };

  const enhanceUmbrella = (body, form) => {
    intro(body, 'umbrella-main', 'Umbrella company', '');
    form.classList.add('ctms-proposal-form');
    section(form, {
      key: 'company', title: 'Company details', eyebrow: 'Umbrella',
      copy: '',
      selectors: ['[name="name"]','[name="remittance_email"]','[name="company_number"]','[name="vat_chargeable"]','[name="enabled"]']
    });
    section(form, {
      key: 'bank', title: 'Bank account', eyebrow: 'Umbrella',
      copy: '',
      selectors: ['[name="bank_name"]','[name="sort_code"]','[name="account_number"]']
    });
    section(form, {
      key: 'remittance', title: 'Remittance preferences', eyebrow: 'Umbrella',
      copy: '',
      selectors: ['[name="remittance_overrides_enabled"]']
    });
    section(form, {
      key: 'address', title: 'Registered address', eyebrow: 'Umbrella',
      copy: '',
      selectors: ['[name="address_line1"]']
    });
    spanForSelector(form, '[name="remittance_overrides_enabled"]');
    spanForSelector(form, '[name="address_line1"]');
    finishRemaining(form);
  };

  const enhanceAdvancedSearch = (body, form) => {
    intro(body, 'advanced-search', 'Find candidates', 'Use one or more filters. Empty fields are ignored.');
    form.classList.add('ctms-proposal-form');
    const headerRow = form.querySelector('#searchHeaderRow');
    if (headerRow) form.prepend(headerRow);
    section(form, {
      key: 'identity-contact', title: 'Identity & contact', eyebrow: 'Candidate search', wide: true,
      copy: '',
      selectors: ['[name="first_name"]','[name="last_name"]','[name="email"]','[name="phone"]','[name="dob"]','[name="gender"]','[name="town_city"]','[name="postcode"]','[name="notes"]']
    });
    section(form, {
      key: 'work', title: 'Work & compliance', eyebrow: 'Candidate search',
      copy: '',
      selectors: ['[name="pay_method"]','[name="roles_any"]','[name="job_title_include_node_ids"]','[name="prof_reg_number"]','[name="prof_reg_type"]','[name="active"]']
    });
    section(form, {
      key: 'dates-payment', title: 'Dates & payment references', eyebrow: 'Candidate search',
      copy: '',
      selectors: ['[name="created_from"]','[name="updated_from"]','[name="sort_code"]','[name="account_number"]','[name="umbrella_name"]','[name="tms_ref"]']
    });
    spanForSelector(form, '[name="job_title_include_node_ids"]');
    finishRemaining(form, 'Additional filters');
  };

  const enhanceContractMain = (body, form) => {
    intro(body, 'contract-main', 'Contract overview', '');
    form.classList.add('ctms-proposal-form');
    section(form, {
      key: 'placement', title: 'Placement', eyebrow: 'Contract', wide: true,
      copy: '',
      selectors: ['#candidate_name_display','#client_name_display','[name="display_site"]','[name="role"]']
    });
    section(form, {
      key: 'rules', title: 'Dates & contract rules', eyebrow: 'Contract', wide: true,
      copy: '',
      selectors: ['#contractRouteLabel','[name="start_date"]','[name="pay_method_snapshot"]']
    });
    const sched = form.querySelector('.sched-grid');
    const scheduleLabel = Array.from(form.children).find((node) => safeText(node.textContent).startsWith('Proposed schedule'));
    section(form, {
      key: 'schedule', title: 'Proposed weekly schedule', eyebrow: 'Contract', wide: true,
      copy: '',
      nodes: [scheduleLabel, sched].filter(Boolean)
    });
    finishRemaining(form, 'Additional contract details');
  };

  const enhanceContractRates = (body, root) => {
    intro(body, 'contract-rates', 'Rates & margins', '');
    if (root.dataset.ctmsEnhanced === '1') return;
    root.dataset.ctmsEnhanced = '1';
    const hero = document.createElement('div');
    hero.className = 'ctms-rate-hero';
    const title = document.createElement('div');
    title.className = 'ctms-section-title';
    title.textContent = 'Current contract rate card';
    const copy = document.createElement('div');
    copy.className = 'ctms-section-copy';
    copy.textContent = 'Rates are shown in pounds per hour. Margins update automatically.';
    hero.append(title, copy);
    const first = root.firstElementChild;
    if (first) first.after(hero); else root.prepend(hero);
  };

  const enhanceClientSettings = (body, settings) => {
    intro(body, 'client-settings', 'Client settings', '');
    if (settings.dataset.ctmsEnhanced === '1' || settings.classList.contains('record-client-settings')) return;
    settings.dataset.ctmsEnhanced = '1';
    const grid = settings.firstElementChild;
    if (!grid) return;
    grid.classList.add('ctms-settings-grid');
    const panels = Array.from(grid.children);
    panels.forEach((panel, index) => {
      panel.classList.add('ctms-settings-panel');
      const head = header(
        index === 0 ? 'Shift pattern & submission' : 'Timesheets & invoicing',
        '',
        'Client settings'
      );
      panel.prepend(head);
    });
    settings.closest('#tab-settings')?.classList.add('ctms-settings-host');
  };

  const enhanceContractSettings = (body, form) => {
    body.classList.add('ctms-contract-settings-body');
    intro(body, 'contract-settings', 'Contract settings', '');
    form.querySelectorAll('.mini, .alert, span, p').forEach((node) => {
      const value = safeText(node.textContent);
      if (/^\(Staged only until you Save the contract\)$/i.test(value)) node.remove();
      else if (/^Override is OFF\./i.test(value)) node.textContent = 'Using client defaults.';
      else if (/^Override is ON\./i.test(value)) node.textContent = 'Contract-specific settings are enabled.';
      else if (/^View-only\. You cannot change contract settings here\.$/i.test(value)) node.textContent = 'View only.';
      else if (/^Client settings snapshot is not available\./i.test(value)) node.textContent = 'Client settings are unavailable. Reopen the contract or select a client.';
      else if (/^Day\/night boundary time settings remain client-level/i.test(value)) node.textContent = 'Shift boundaries are managed in Client settings.';
      else if (/^This override is independent of invoice routing\./i.test(value)) node.textContent = 'Use a different email for this contract’s timesheet queries.';
      else if (/^Send this contract’s missing shifts, wrong hours and reference queries to a different address$/i.test(value)) node.textContent = 'Use a different email for timesheet queries';
    });
    form.querySelectorAll('.controls').forEach((controls) => controls.classList.add('ctms-choice-stack'));
  };

  const enhanceGenericRecordTab = (body, entity, tab) => {
    const form = body.querySelector(':scope > .form');
    if (!form || form.dataset.ctmsEnhanced === '1') return;
    form.dataset.ctmsEnhanced = '1';
    form.classList.add('ctms-proposal-form');
    const rows = unclaimedVisibleChildren(form);
    if (!rows.length) return;
    const entityName = entity === 'candidates' ? 'Candidate' : entity === 'clients' ? 'Client' : entity === 'contracts' ? 'Contract' : 'Record';
    intro(body, `generic-${entity}-${tab}`, `${entityName} ${safeText(tab).replace(/_/g, ' ')}`, '');
    section(form, { key: 'details', title: `${entityName} details`, eyebrow: entityName, nodes: rows, wide: true });
  };

  const utilityFamilyClasses = [
    'ctms-modal-settings',
    'ctms-modal-user-management',
    'ctms-modal-candidate-picker',
    'ctms-modal-client-picker',
    'ctms-modal-job-titles',
    'ctms-modal-address',
    'ctms-modal-rate-presets',
    'ctms-modal-outbox-details',
    'ctms-modal-audit-event'
  ];

  const workflowFamilyClasses = [
    'ctms-modal-timesheet',
    'ctms-modal-invoice',
    'ctms-modal-bulk-process',
    'ctms-modal-bulk-authorise'
  ];

  const utilityBodyFamilyClasses = utilityFamilyClasses.map((className) =>
    `${className.replace(/^ctms-modal-/, 'ctms-')}-body`
  );
  const workflowBodyFamilyClasses = workflowFamilyClasses.map((className) =>
    `${className.replace(/^ctms-modal-/, 'ctms-')}-body`
  );

  const utilityFamilyFor = (body, entity, kind) => {
    if (kind === 'import-summary-user-management') return 'user-management';
    if (kind === 'candidate-picker' || body.querySelector('[data-picker-kind="candidate"]')) return 'candidate-picker';
    if (kind === 'client-picker' || body.querySelector('[data-picker-kind="client"]')) return 'client-picker';
    if (kind === 'job-titles' || body.querySelector('#jobTitlesSettingsRoot')) return 'job-titles';
    if (kind === 'address-lookup' || body.querySelector('#addrLookupRoot')) return 'address';
    if (
      kind === 'rate-presets-picker' ||
      kind === 'rates-presets' ||
      kind === 'rate-preset' ||
      body.querySelector('#ratePresetPicker, #ratePresetManager, #rp_form')
    ) return 'rate-presets';
    if (kind === 'import-summary-outbox-detail' || body.querySelector('#outboxDetailRoot')) return 'outbox-details';
    if (kind === 'import-summary-audit-item') return 'audit-event';
    if (entity === 'settings') return 'settings';
    return '';
  };

  const workflowFamilyFor = (body, entity, kind) => {
    if (kind === 'bulk-process-workbench' || body.querySelector('#bulkProcessWorkbenchRoot')) return 'bulk-process';
    if (kind === 'bulk-authorise-workbench' || body.querySelector('#bulkAuthoriseWorkbenchRoot')) return 'bulk-authorise';
    if (kind === 'invoice-modal' || (entity === 'invoices' && body.querySelector('#invModalRoot'))) return 'invoice';
    if (kind === 'timesheets' || (entity === 'timesheets' && body.querySelector('.tabc'))) return 'timesheet';
    return '';
  };

  const labelTableCells = (table, labels) => {
    if (!table || !Array.isArray(labels)) return;
    const normaliseHeader = (value) => {
      const text = safeText(value).replace(/\s+/g, ' ').trim();
      const compact = text.replace(/\s+/g, '').toLowerCase();
      if (compact === 'ref#' || compact === 'reference') return 'Reference';
      if (compact === 'line#' || compact === 'line') return 'Line';
      if (compact === 'break(mins)' || compact === 'breakmins' || compact === 'breakminutes') return 'Break minutes';
      if (compact === 'paidhrs' || compact === 'paidhours') return 'Paid hours';
      if (compact === 'no.ofunits' || compact === 'units') return 'Units';
      return text;
    };
    const headerLabels = Array.from(table.querySelectorAll(':scope > thead > tr:last-child > th')).map((cell) => normaliseHeader(cell.textContent));
    table.querySelectorAll(':scope > tbody > tr').forEach((row) => {
      const rowCells = Array.from(row.children);
      const effectiveLabels = headerLabels.length === rowCells.length
        ? headerLabels.map((label, index) => label || (index === rowCells.length - 1 ? 'Actions' : ''))
        : labels;
      rowCells.forEach((cell, index) => {
        if (!(cell instanceof HTMLElement)) return;
        const label = effectiveLabels[index] || '';
        if (cell.dataset.ctmsLabel !== label) cell.dataset.ctmsLabel = label;
      });
    });
  };

  const slugFor = (value) => safeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);

  const universalFamilyFor = (kind, title, body) => {
    const signal = `${safeText(kind)} ${safeText(title)}`.toLowerCase();
    if (/invoice-batch|batch (?:generate|issue).*invoice/.test(signal)) return 'invoice-batch';
    if (/mailshot/.test(signal)) return 'mailshot';
    if (/warning|confirm|verification|authorisation|decision|overlap|notice|after-save action|unsaved|prompt/.test(signal)) return 'confirmation';
    if (/search|selection|filters|outbox runs/.test(signal)) return 'selection';
    if (/banking|finance|payment advance|manual (?:credit|debt)|paye entry|pay batch|snooze|repayment/.test(signal)) return 'finance';
    if (/pdf|document|evidence|signature/.test(signal)) return 'document';
    if (/import|healthroster|nhsp|weekly band|column aliases|resolve timesheet/.test(signal)) return 'import-tool';
    if (/picker|pick template|select fields|select job|select matching|assign client|add hospital/.test(signal)) return 'picker';
    if (/audit/.test(signal)) return 'selection';
    if (body?.querySelector('table, .grid')) return 'data';
    return 'form';
  };

  const removePrefixedClasses = (node, prefix, keep = '') => {
    if (!node) return;
    Array.from(node.classList).forEach((className) => {
      if (className.startsWith(prefix) && className !== keep) node.classList.remove(className);
    });
  };

  const enhanceUniversalModal = (modal, body, kind, title, family) => {
    const kindSlug = slugFor(kind || title || 'modal') || 'modal';
    const kindClass = `ctms-kind-${kindSlug}`;
    const familyClass = `ctms-family-${family}`;
    removePrefixedClasses(modal, 'ctms-kind-', kindClass);
    removePrefixedClasses(modal, 'ctms-family-', familyClass);
    removePrefixedClasses(body, 'ctms-family-', familyClass);
    modal.classList.add(kindClass, familyClass);
    body.classList.add('ctms-universal-modal-body', familyClass);
    modal.dataset.ctmsModalKind = kindSlug;
    modal.dataset.ctmsModalFamily = family;

    body.querySelectorAll('table').forEach((table) => {
      if (!(table instanceof HTMLTableElement)) return;
      const headerCells = Array.from(table.querySelectorAll(':scope > thead > tr:last-child > th'));
      const labels = headerCells.map((cell) => safeText(cell.textContent)
        .replace(/Drag to resize\..*$/i, '')
        .replace(/[▲▼]\s*$/g, '')
        .trim());
      const bodyRows = Array.from(table.querySelectorAll(':scope > tbody > tr'));
      const keyValueTable = labels.length === 0 && bodyRows.length > 0 && bodyRows.every((row) => (
        row.children.length === 2 && row.firstElementChild?.tagName === 'TH'
      ));
      if (labels.length) labelTableCells(table, labels);
      table.classList.add('ctms-universal-table');
      table.classList.toggle('ctms-universal-key-value-table', keyValueTable);
      const cardTable = labels.length > 0 && (labels.length <= 9 || kindSlug === 'import-summary-outbox-runs');
      table.classList.toggle('ctms-universal-card-table', cardTable);
      table.classList.toggle('ctms-universal-wide-table', labels.length > 9 && !cardTable);
      const host = table.closest('.table-responsive,.scrollable,.scrollbox,.grid-wrap,.table-wrap') || table.parentElement;
      if (host && host !== body) host.classList.add('ctms-universal-table-host');
    });

    if (kind === 'document-template-picker') {
      body.querySelectorAll('#documentTemplatePickerTBody .mini').forEach((node) => {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(safeText(node.textContent))) node.remove();
      });
    }

    if (kindSlug === 'search-load') {
      const presetTable = body.querySelector('#presetTable');
      if (presetTable instanceof HTMLTableElement) {
        const hasRowActions = Array.from(presetTable.querySelectorAll('tbody tr')).some((row) => {
          const lastCell = row.lastElementChild;
          return !!lastCell?.querySelector('button:not([hidden])');
        });
        presetTable.classList.toggle('ctms-no-row-actions', !hasRowActions);
      }
    }

    if (kindSlug === 'candidate-pay-method-change') {
      body.querySelectorAll('#candPayMethodChange .group').forEach((group) => {
        const value = safeText(group.textContent).replace(/\s+/g, ' ');
        if (/^Exact .* (?:Timesheet )?IDs? \(\d+\)/i.test(value)) group.remove();
      });
    }

    const primaryActionLabels = {
      'search-load': 'Load',
      'hr-weekly-client-picker': 'Select client',
      'job-title-picker': 'Select job title',
      'document-template-picker': 'Apply template',
      'template-field-picker': 'Apply fields'
    };
    const primaryActionLabel = primaryActionLabels[kindSlug];
    const primaryActionButton = primaryActionLabel ? modal.querySelector('#btnSave') : null;
    if (
      primaryActionButton instanceof HTMLButtonElement &&
      safeText(primaryActionButton.textContent) !== primaryActionLabel
    ) primaryActionButton.textContent = primaryActionLabel;

    body.querySelectorAll('button').forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const text = safeText(button.textContent).replace(/\s+/g, ' ');
      const destructive = /^(?:delete|remove|discard|write off|cancel payment|unprocess|unsnooze)/i.test(text);
      const primary = /^(?:save|next|apply|continue|confirm|send|enqueue|generate selected|issue selected invoices|authorise|process|create|add|upload|attach|resolve|export)/i.test(text);
      button.classList.toggle('ctms-action-danger', destructive);
      button.classList.toggle('ctms-action-primary', !destructive && primary);
    });
  };

  const rowForLabel = (root, label) => Array.from(root.querySelectorAll(':scope > .row')).find((row) => {
    const rowLabel = safeText(row.querySelector(':scope > label')?.textContent).replace(/\s+/g, ' ');
    return rowLabel.toLowerCase() === String(label || '').toLowerCase();
  }) || null;

  const enhanceUtilityModal = (body, family, tab, activeTabLabel) => {
    if (!family) return;
    body.classList.add('ctms-utility-modal-body', `ctms-${family}-body`);

    if (family === 'settings') {
      const key = tab || activeTabLabel || 'main';
      const settingsIntro = {
        main: ['Operational defaults', 'Working hours, holidays and default finance settings.'],
        banking_payments: ['Banking and payment defaults', 'Configure the standard payment day and banking controls.'],
        remittances: ['Remittance delivery', 'Set the default remittance options and recipients.'],
        my_email_signature: ['My email signature', 'Manage the signature added to your email messages.']
      }[key] || ['Settings', 'Manage CloudTMS defaults.'];
      intro(body, `settings-${key}`, settingsIntro[0], settingsIntro[1]);
      const form = body.querySelector('#settingsForm');
      if (form) form.classList.add('ctms-utility-form', 'ctms-settings-form');
      const financeWindows = body.querySelector('#settingsFinanceWindows');
      if (financeWindows) financeWindows.classList.add('ctms-settings-finance-windows');
      return;
    }

    if (family === 'user-management') {
      const isFinance = activeTabLabel.includes('finance') || body.querySelector('#userMgmtRoot')?.dataset.tab === 'finance';
      intro(
        body,
        isFinance ? 'user-finance' : 'user-management',
        isFinance ? 'Finance email settings' : 'Manage users',
        isFinance ? 'Set the finance mailbox and attachment limits.' : 'Create users, manage access and update account details.'
      );
      const root = body.querySelector('#userMgmtRoot');
      if (root) root.classList.add('ctms-user-management-root');
      body.querySelector('#userMgmtBody')?.classList.add('ctms-user-management-content');
      return;
    }

    if (family === 'candidate-picker' || family === 'client-picker') {
      const candidate = family === 'candidate-picker';
      intro(
        body,
        family,
        candidate ? 'Choose a candidate' : 'Choose a client',
        `Search, select a row, then choose Apply.`
      );
      const root = body.querySelector(candidate ? '[data-picker-kind="candidate"]' : '[data-picker-kind="client"]');
      if (root) root.classList.add('ctms-picker-shell');
      root?.querySelector('.picker-table-wrap')?.classList.add('ctms-picker-results');
      return;
    }

    if (family === 'job-titles') {
      intro(body, 'job-titles', 'Job title structure', 'Organise families, sub-families and roles.');
      const root = body.querySelector('#jobTitlesSettingsRoot');
      if (!root) return;
      root.classList.add('ctms-job-titles-root');
      const panels = Array.from(root.children);
      panels[0]?.classList.add('ctms-job-tree-panel');
      panels[1]?.classList.add('ctms-job-editor-panel');
      return;
    }

    if (family === 'address') {
      intro(body, 'address', 'Find or enter an address', 'Look up a postcode or enter the address manually.');
      const form = body.querySelector('#addrLookupRoot');
      if (!form || form.dataset.ctmsEnhanced === '1') return;
      form.dataset.ctmsEnhanced = '1';
      form.classList.add('ctms-proposal-form', 'ctms-address-form');
      section(form, {
        key: 'address-search',
        title: 'Postcode lookup',
        copy: 'Search by postcode and optional house name or number.',
        eyebrow: 'Address finder',
        selectors: ['input[name="lookup_postcode"]', 'input[name="lookup_house"]', '#btnAddrLookup', '#addrLookupResults'],
        wide: true
      });
      section(form, {
        key: 'manual-address',
        title: 'Address details',
        copy: 'Review or complete the address before saving.',
        eyebrow: 'Manual entry',
        selectors: ['input[name="addr_line1"]', 'input[name="addr_line2"]', 'input[name="addr_line3"]', 'input[name="addr_city"]', 'input[name="addr_postcode"]'],
        wide: true
      });
      spanForSelector(form, '#addrLookupResults');
      finishRemaining(form, 'Address details', '');
      return;
    }

    if (family === 'rate-presets') {
      const picker = body.querySelector('#ratePresetPicker');
      const manager = body.querySelector('#ratePresetManager');
      const editor = body.querySelector('#rp_form');
      const heading = picker ? 'Choose a rate preset' : (manager ? 'Manage rate presets' : 'Rate preset details');
      const copy = picker
        ? 'Filter the available presets, select one, then choose Apply.'
        : '';
      intro(body, `rate-presets-${picker ? 'picker' : (manager ? 'manager' : 'editor')}`, heading, copy);
      const root = picker || manager || editor;
      if (!root) return;
      root.classList.add(
        'ctms-rate-preset-shell',
        picker ? 'ctms-rate-preset-picker' : (manager ? 'ctms-rate-preset-manager' : 'ctms-rate-preset-editor')
      );
      const labels = ['', 'Preset', 'Scope', 'Charge', 'PAYE', 'Umbrella', 'Mileage'];
      root.querySelectorAll('#rp_table tbody tr').forEach((row) => {
        Array.from(row.children).forEach((cell, index) => {
          const label = labels[index] || '';
          if (cell.dataset.ctmsLabel !== label) cell.dataset.ctmsLabel = label;
        });
      });
      const managerLabels = ['Name', 'Scope', 'Client', 'Role', 'Band', 'Last edited', 'Actions'];
      root.querySelectorAll('#ratesPresetsTable tbody tr').forEach((row) => {
        Array.from(row.children).forEach((cell, index) => {
          const label = managerLabels[index] || '';
          if (cell.dataset.ctmsLabel !== label) cell.dataset.ctmsLabel = label;
        });
      });
      return;
    }

    if (family === 'outbox-details') {
      intro(body, 'outbox-details', 'Delivery details', 'Review message status, recipient, timing and content.');
      const root = body.querySelector('#outboxDetailRoot');
      if (!root) return;
      root.classList.add('ctms-outbox-detail-root');
      const cards = Array.from(root.children).filter((node) => node.classList?.contains('card'));
      cards.forEach((card, index) => card.classList.add('ctms-outbox-card', index === 0 ? 'ctms-outbox-hero' : 'ctms-outbox-section'));
      const duplicateTitle = cards[0]?.querySelector('div[style*="font-weight:700"]');
      if (safeText(duplicateTitle?.textContent).toLowerCase() === 'outbox detail') duplicateTitle.remove();
      return;
    }

    if (family === 'audit-event') {
      intro(body, 'audit-event', 'Audit event', 'Review who changed the record and compare the saved values.');
      const form = body.querySelector(':scope > .form');
      if (!form || form.dataset.ctmsEnhanced === '1') return;
      form.dataset.ctmsEnhanced = '1';
      form.classList.add('ctms-proposal-form', 'ctms-audit-form');
      section(form, {
        key: 'audit-summary',
        title: 'Event summary',
        eyebrow: 'Audit trail',
        nodes: ['Event time', 'Action', 'Actor', 'Role at time', 'Object type', 'Object ID'].map((label) => rowForLabel(form, label)).filter(Boolean),
        wide: true
      });
      section(form, {
        key: 'audit-technical',
        title: 'Technical details',
        copy: 'Identifiers recorded with this event.',
        eyebrow: 'Reference',
        nodes: ['Correlation ID', 'IP', 'User agent'].map((label) => rowForLabel(form, label)).filter(Boolean),
        wide: true
      });
      section(form, {
        key: 'audit-change',
        title: 'Change details',
        copy: 'Compare the values before and after the event.',
        eyebrow: 'Record history',
        nodes: ['Reason', 'Before', 'After'].map((label) => rowForLabel(form, label)).filter(Boolean),
        wide: true
      });
      finishRemaining(form, 'Additional details', '');
    }
  };

  const enhanceWorkflowModal = (body, family, tab, activeTabLabel) => {
    if (!family) return;
    body.classList.add('ctms-workflow-modal-body', `ctms-${family}-body`);

    if (family === 'timesheet') {
      const key = tab || activeTabLabel || 'overview';
      const content = {
        overview: ['Timesheet overview', 'Review the week, route and available actions.'],
        lines: ['Hours and shifts', 'Enter each shift and break clearly for the selected week.'],
        expenses: ['Expenses', 'Review mileage and other claimable expenses.'],
        evidence: ['Evidence', 'Review the files and approvals attached to this timesheet.'],
        issues: ['Issues', 'Review validation or processing issues for this timesheet.'],
        finance: ['Finance', 'Review calculated pay, charge and margin details.'],
        audit: ['Audit history', 'Review changes recorded for this timesheet.']
      }[key] || ['Timesheet', 'Review the timesheet details.'];
      intro(body, `timesheet-${key}`, content[0], content[1]);
      const tabRoot = body.querySelector(':scope > .tabc');
      if (tabRoot) tabRoot.classList.add('ctms-timesheet-tab', `ctms-timesheet-${key}`);
      body.querySelectorAll('.tabc > .card, .tabc > [class*="card"]').forEach((card) => card.classList.add('ctms-workflow-card'));
      const schedule = body.querySelector('#tsWeeklySchedule');
      if (schedule) {
        schedule.classList.add('ctms-timesheet-schedule');
        labelTableCells(schedule, ['Day', 'Date', 'Line', 'Reference', 'Start', 'End', 'Break start', 'Break end', 'Break minutes', 'Paid hours', 'Actions']);
        schedule.querySelectorAll('.sched-paid-hours').forEach((value) => {
          value.classList.toggle('ctms-paid-hours-value', !!safeText(value.textContent));
        });
      }
      const extras = body.querySelector('#tsWeeklyExtras');
      if (extras) {
        extras.classList.add('ctms-timesheet-extras');
        labelTableCells(extras, ['Day', 'Date', 'Rate', 'Units', 'Unit name']);
      }
      if (key === 'finance' && tabRoot) {
        tabRoot.querySelectorAll('table.grid').forEach((table) => {
          const columnCount = table.querySelectorAll('thead th').length;
          table.classList.add('ctms-timesheet-finance-table');
          if (columnCount > 4) table.classList.add('ctms-timesheet-finance-table-wide');
          labelTableCells(table, []);
        });
      }
      if (key === 'evidence' && tabRoot) {
        const evidenceTable = tabRoot.querySelector('.ts-evidence-table');
        if (evidenceTable) {
          evidenceTable.classList.add('ctms-timesheet-evidence-table');
          labelTableCells(evidenceTable, ['Filename', 'Type', 'Source', 'Pages', 'Upload date', 'Time', 'Uploaded by', 'Actions']);
        }
      }
      return;
    }

    if (family === 'invoice') {
      const innerKey = safeText(window.modalCtx?.activeTab || body.querySelector('[data-action="inv-set-tab"].btn-primary')?.dataset.tab || 'invoice').toLowerCase();
      const content = {
        invoice: ['Invoice details', 'Review status, totals, documents and invoice lines.'],
        evidence: ['Invoice evidence', 'Review supporting files attached to this invoice.'],
        history: ['Invoice history', 'Review recorded invoice activity and document changes.']
      }[innerKey] || ['Invoice', 'Review the invoice details.'];
      const introKey = `invoice-${innerKey}`;
      body.querySelectorAll(':scope > .ctms-tab-intro[data-ctms-intro^="invoice-"]').forEach((node) => {
        if (node.dataset.ctmsIntro !== introKey) node.remove();
      });
      intro(body, introKey, content[0], content[1]);
      const root = body.querySelector('#invModalRoot');
      if (!root) return;
      root.classList.add('ctms-invoice-root', `ctms-invoice-${innerKey}`);
      const subtab = root.querySelector('[data-action="inv-set-tab"]')?.parentElement;
      if (subtab) subtab.classList.add('ctms-invoice-subtabs');
      root.querySelectorAll('table.grid').forEach((table) => table.classList.add('ctms-invoice-table'));
      const historyTable = root.querySelector('.table-responsive table');
      if (historyTable) {
        historyTable.classList.add('ctms-invoice-history-table');
        labelTableCells(historyTable, ['Date and time', 'Action', 'User', 'Details']);
      }
      const evidenceTable = root.querySelector('.invoice-evidence-tab table');
      if (evidenceTable) {
        evidenceTable.classList.add('ctms-invoice-evidence-table');
        labelTableCells(evidenceTable, ['Filename', 'Type', 'Source', 'Pages', 'Upload date', 'Time', 'Uploaded by', 'Actions']);
      }
      return;
    }

    if (family === 'bulk-process' || family === 'bulk-authorise') {
      const process = family === 'bulk-process';
      const root = body.querySelector(process ? '#bulkProcessWorkbenchRoot' : '#bulkAuthoriseWorkbenchRoot');
      if (!root) return;
      root.classList.add('ctms-bulk-workbench', process ? 'ctms-bulk-process-workbench' : 'ctms-bulk-authorise-workbench');
      root.querySelectorAll('.card').forEach((card) => card.classList.add('ctms-bulk-card'));
      root.querySelectorAll('#tsWeeklySchedule').forEach((schedule) => {
        schedule.classList.add('ctms-timesheet-schedule', 'ctms-bulk-schedule');
        labelTableCells(schedule, ['Day', 'Date', 'Line', 'Reference', 'Start', 'End', 'Break start', 'Break end', 'Break minutes', 'Paid hours', 'Actions']);
        schedule.querySelectorAll('.sched-paid-hours').forEach((value) => {
          value.classList.toggle('ctms-paid-hours-value', !!safeText(value.textContent));
        });
      });
      root.querySelectorAll('#tsWeeklyExtras').forEach((extras) => {
        extras.classList.add('ctms-timesheet-extras', 'ctms-bulk-extras');
        labelTableCells(extras, ['Day', 'Date', 'Rate', 'Units', 'Unit name']);
      });
    }
  };

  const hideUserFacingInternalIds = (copyRoot) => {
    if (!copyRoot) return;
    const isSharedModalStructure = (node) => node instanceof HTMLElement && (
      node.id === 'modal' ||
      node.id === 'modalBody' ||
      node.matches('.modal,.modal-b,.ctms-universal-modal-body,.ctms-utility-modal-body,.ctms-workflow-modal-body')
    );
    const hide = (node) => {
      if (!(node instanceof HTMLElement) || isSharedModalStructure(node)) return;
      node.hidden = true;
      node.setAttribute('aria-hidden', 'true');
      node.dataset.ctmsInternalIdHidden = '1';
    };
    const hideTableColumn = (cell) => {
      const row = cell?.parentElement;
      const table = cell?.closest('table');
      if (!row || !table) return;
      const columnIndex = Array.from(row.children).indexOf(cell);
      if (columnIndex < 0) return;
      table.querySelectorAll('tr').forEach((tableRow) => hide(tableRow.children[columnIndex]));
    };

    const internalIdLabel = /^(?:(?:operation|timesheet|candidate|client|contract|batch|session|job|case|advance|transfer|provider|row|scope|payment)[\s_-]*)?(?:id|uuid)(?:\s*:.*)?$/i;
    copyRoot.querySelectorAll('label,th,td,dt,dd,span,strong,.mini,.hint,p,li').forEach((node) => {
      if (!(node instanceof HTMLElement) || node.dataset.ctmsInternalIdHidden === '1') return;
      const text = safeText(node.textContent).replace(/\s+/g, ' ');
      const hasInternalLabel = internalIdLabel.test(text) || /(?:^|\s)[a-z][a-z0-9_]*_id(?:\s*:|$)/i.test(text);
      const hasTimesheetIdLabel = /timesheet[\s_]*ids?/i.test(text);
      const hasCompoundInternalIds = /\b(?:case|ref(?:erence)? advance|operation|timesheet)[\s_-]*(?:id|uuid)?\s*:?[ \t]*[0-9a-f-]{20,}/i.test(text);
      if (!hasInternalLabel && !hasTimesheetIdLabel && !hasCompoundInternalIds) return;

      // Do not remove an editable control: IDs may still be required internally by
      // an administrative workflow. This rule only suppresses read-only metadata.
      if (node.querySelector('input:not([type="hidden"]),select,textarea,button,a')) return;

      if (node.matches('th,td')) {
        hideTableColumn(node);
        return;
      }

      const row = node.matches('label,dt,dd') ? node.closest('.row,.field,.form-group') : null;
      if (row) {
        hide(row);
        return;
      }

      if (/^exact .*timesheet[\s_]*ids?/i.test(text)) {
        hide(node.closest('.group') || node.closest('.card') || node);
        return;
      }

      const pairedValue = node.matches('span') && node.parentElement?.querySelector(':scope > strong');
      if (pairedValue && /^timesheet[\s_]*id$/i.test(text)) {
        hide(node.parentElement);
        return;
      }

      if (hasInternalLabel || hasTimesheetIdLabel || hasCompoundInternalIds) {
        hide(node.closest('.row,.mini,.hint,p,li') || node);
      }
    });

    copyRoot.querySelectorAll('.mono,[class*="metadata"],[class*="detail"]').forEach((node) => {
      if (!(node instanceof HTMLElement) || node.dataset.ctmsInternalIdHidden === '1') return;
      const text = safeText(node.textContent).replace(/\s+/g, ' ');
      if (!uuidPattern.test(text)) return;
      if (/\b(?:operation|timesheet|candidate|client|contract|batch|session|case|advance|transfer|provider)[\s_-]*(?:id|uuid)?\b/i.test(text)) {
        hide(node.closest('.row,.mini,.hint,p,li') || node);
      }
    });
  };

  const cleanVisibleCopy = (body, modal) => {
    const copyRoot = modal || body;
    hideUserFacingInternalIds(copyRoot);
    const selectors = '.mini,.hint,.alert,p,span,button,h1,h2,h3,h4,h5,h6,label,li,th,td,[role="alert"]';
    copyRoot.querySelectorAll(selectors).forEach((node) => {
      if (!node.isConnected) return;
      const value = safeText(node.textContent).replace(/\s+/g, ' ');
      if (!value) return;
      const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const containsControl = !!node.querySelector('input,select,textarea,button,a');
      if (isoDate && !containsControl && !node.closest('code,pre')) {
        const displayDate = `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
        if (node.textContent !== displayDate) node.textContent = displayDate;
        return;
      }
      const replacement = replacementFor(visibleCopyRules, value);
      if (replacement === undefined) return;
      if (replacement === null) {
        if (!containsControl) node.remove();
        return;
      }
      if ((!containsControl || node.matches('button')) && node.textContent !== replacement) {
        node.textContent = replacement;
      }
    });

    const embeddedCopy = [
      ['Discard this staged import?', 'Discard this import?'],
      ['The approved database and Worker contract could not be verified. Upload and review controls are disabled.', 'Import review is unavailable. Try again or contact support.'],
      ['Financial values remain server-owned and are recalculated only by the approved database functions.', ''],
      ['Only the selected, server-approved CloudTMS actions shown above will be committed.', 'Only the selected actions shown above will be applied.'],
      ['The previous pack remains immutable history but is no longer valid.', 'The previous pack remains in the audit history but cannot be used.'],
      ['Changes are staged. Click “Save” in the main dialog to persist.', 'Click Save to keep these changes.'],
      ['Changes are staged. Click "Save" in the main dialog to persist.', 'Click Save to keep these changes.'],
      ['Up to 5 optional additional pay buckets, billed by units (e.g. patient visits).', 'Add up to five optional rates for work charged per unit, such as patient visits.'],
      ['Margins are per-unit and follow the PAYE/Umbrella logic used on the Rates tab.', 'Pay and charge margins are calculated automatically from the selected rate type.'],
      ['Supported content includes formatted text, colours, links, tables, and uploaded images. Images are inserted at a normalised size and can be resized by dragging from the bottom-right corner without changing aspect ratio.', ''],
      ['This signature is stored on your user record and is injected into email editors by default. It becomes normal editable content, so you can still delete or change it in a specific email.', '']
      ,['Source Timesheets, Contract Weeks, rates and TSFIN rows will not be changed. Their hours, authorisation, active Advance state and financial history remain exactly as stored. The canonical scope is every current Timesheet for this candidate that is authorised, has an active Advance, or retains frozen financial authority that Banking Pay must continue to recognise. Current Workbench representation is evidence only; it does not define or narrow that scope. Only prospective derived Banking Pay Workbench output will be refreshed against the candidate\'s new target payment method.', 'Existing timesheets, rates and financial records will not change. CloudTMS will use the new pay method for future Banking Pay calculations.']
    ];
    const walker = document.createTreeWalker(copyRoot, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      const original = node.nodeValue || '';
      let value = original;
      embeddedCopy.forEach(([current, replacement]) => { value = value.split(current).join(replacement); });
      const compact = safeText(value).replace(/\s+/g, ' ');
      if (/^(?:Operation|Timesheet|Candidate|Client|Contract|Batch|Session|Case|Advance|Transfer|Provider)[\s_-]*(?:ID|UUID)\s*:?[ \t]*[0-9a-f-]{20,}$/i.test(compact) ||
          /^Case\s+[0-9a-f-]{20,}\s*[•|]\s*Ref(?:erence)? advance\s*:?[ \t]*[0-9a-f-]{20,}$/i.test(compact)) {
        value = '';
      }
      value = value.replace(/\bCandidate:\s*[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, 'Candidate: Selected candidate');
      value = value.replace(/\bClient:\s*[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, 'Client: Selected client');
      const precedingText = safeText(node.parentElement?.previousSibling?.nodeValue || '');
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(safeText(value))) {
        if (/^Candidate:\s*$/i.test(precedingText)) value = 'Selected candidate';
        if (/^Client:\s*$/i.test(precedingText)) value = 'Selected client';
      }
      if (value !== original) node.nodeValue = value;
    });

    copyRoot.querySelectorAll('.banking-pay-active-operation-summary .mono').forEach((node) => node.remove());
    copyRoot.querySelectorAll('.banking-pay-active-operation-summary .pill').forEach((node) => {
      if (/^Runner:/i.test(safeText(node.textContent))) node.remove();
    });

    const title = modal?.querySelector('#modalTitle') || document.getElementById('modalTitle');
    if (title) {
      const value = safeText(title.textContent).replace(/\s+/g, ' ');
      const replacement = replacementFor(titleCopyRules, value);
      if (replacement !== undefined && replacement !== null && title.textContent !== replacement) {
        title.textContent = replacement;
      }
    }

    copyRoot.querySelectorAll('.mini:empty,.hint:empty,p:empty,span:empty').forEach((node) => {
      if (!node.querySelector('input,select,textarea,button,a')) node.remove();
    });
    hideUserFacingInternalIds(copyRoot);
  };

  const bankingScrollHosts = '#bankingPayReadyScrollHost,#bankingPayCasesScrollHost,#bankingPayBlockedScrollHost,.banking-pay-batch-table-scroll';
  const canScrollInDirection = (element, deltaY) => {
    if (!(element instanceof HTMLElement) || Math.abs(deltaY) < 0.5) return false;
    const max = Math.max(0, element.scrollHeight - element.clientHeight);
    return deltaY > 0 ? element.scrollTop < max - 1 : element.scrollTop > 1;
  };

  const handOffBankingWheel = (event) => {
    if (!(event.target instanceof Element) || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const modal = event.target.closest('#modal.banking-modal.ctms-modern-modal');
    if (!modal) return;
    const inner = event.target.closest(bankingScrollHosts);
    const outer = modal.querySelector(':scope > .modal-b > #modalBody') || modal.querySelector('#modalBody');
    if (!(inner instanceof HTMLElement) || !(outer instanceof HTMLElement) || inner === outer) return;
    if (canScrollInDirection(inner, event.deltaY) || !canScrollInDirection(outer, event.deltaY)) return;
    event.preventDefault();
    outer.scrollTop += event.deltaY;
  };

  let bankingTouch = null;
  const beginBankingTouch = (event) => {
    if (!(event.target instanceof Element) || event.touches.length !== 1) return;
    const modal = event.target.closest('#modal.banking-modal.ctms-modern-modal');
    const inner = event.target.closest(bankingScrollHosts);
    const outer = modal?.querySelector(':scope > .modal-b > #modalBody') || modal?.querySelector('#modalBody');
    const touch = event.touches[0];
    bankingTouch = modal && inner instanceof HTMLElement && outer instanceof HTMLElement
      ? { inner, outer, x: touch.clientX, y: touch.clientY }
      : null;
  };

  const handOffBankingTouch = (event) => {
    if (!bankingTouch || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaY = bankingTouch.y - touch.clientY;
    const deltaX = bankingTouch.x - touch.clientX;
    bankingTouch.x = touch.clientX;
    bankingTouch.y = touch.clientY;
    if (Math.abs(deltaY) <= Math.abs(deltaX) || canScrollInDirection(bankingTouch.inner, deltaY) || !canScrollInDirection(bankingTouch.outer, deltaY)) return;
    if (event.cancelable) event.preventDefault();
    bankingTouch.outer.scrollTop += deltaY;
  };

  const endBankingTouch = () => { bankingTouch = null; };

  const apply = () => {
    const modal = document.getElementById('modal');
    const backdrop = document.getElementById('modalBack');
    const body = document.getElementById('modalBody');
    if (!modal || !backdrop || !body) return;
    const visible = getComputedStyle(backdrop).display !== 'none';
    if (!visible) return;

    const frame = typeof window.__getModalFrame === 'function' ? window.__getModalFrame() : null;
    const entity = safeText(frame?.entity || window.modalCtx?.entity).toLowerCase();
    const tab = safeText(frame?.currentTabKey || '').toLowerCase();
    const activeTabLabel = safeText(modal.querySelector('#modalTabs button.active')?.textContent).toLowerCase();
    const kind = safeText(frame?.kind || '').toLowerCase();
    const utilityFamily = utilityFamilyFor(body, entity, kind);
    const workflowFamily = workflowFamilyFor(body, entity, kind);

    // The modal body is a shared shell. A previous modal must never leave it
    // hidden or carrying a specialised family class into the next modal.
    if (body.dataset.ctmsInternalIdHidden === '1') {
      body.hidden = false;
      body.removeAttribute('aria-hidden');
      delete body.dataset.ctmsInternalIdHidden;
    }
    const activeUtilityBodyClass = utilityFamily ? `ctms-${utilityFamily}-body` : '';
    const activeWorkflowBodyClass = workflowFamily ? `ctms-${workflowFamily}-body` : '';
    utilityBodyFamilyClasses.forEach((className) => {
      body.classList.toggle(className, className === activeUtilityBodyClass);
    });
    workflowBodyFamilyClasses.forEach((className) => {
      body.classList.toggle(className, className === activeWorkflowBodyClass);
    });
    body.classList.toggle('ctms-utility-modal-body', !!utilityFamily);
    body.classList.toggle('ctms-workflow-modal-body', !!workflowFamily);
    cleanVisibleCopy(body, modal);
    const title = safeText(modal.querySelector('#modalTitle')?.textContent || 'Modal');
    const universalFamily = universalFamilyFor(kind, title, body);
    const targeted = true;
    if (!targeted) {
      if (modal.classList.contains('ctms-modern-modal')) modal.classList.remove('ctms-modern-modal');
      if (modal.classList.contains('ctms-utility-modal')) modal.classList.remove('ctms-utility-modal');
      utilityFamilyClasses.forEach((className) => {
        if (modal.classList.contains(className)) modal.classList.remove(className);
      });
      workflowFamilyClasses.forEach((className) => {
        if (modal.classList.contains(className)) modal.classList.remove(className);
      });
      if (backdrop.classList.contains('ctms-modern-backdrop')) backdrop.classList.remove('ctms-modern-backdrop');
      return;
    }

    if (!modal.classList.contains('ctms-modern-modal')) modal.classList.add('ctms-modern-modal');
    if (!backdrop.classList.contains('ctms-modern-backdrop')) backdrop.classList.add('ctms-modern-backdrop');
    enhanceUniversalModal(modal, body, kind, title, universalFamily);
    const hasSpecialisedLayout = !!utilityFamily || !!workflowFamily ||
      ['candidates', 'clients', 'contracts', 'umbrellas', 'settings'].includes(entity) ||
      kind === 'advanced-search' || kind === 'contracts' || !!body.querySelector('.irv1-shell');
    modal.classList.toggle('ctms-generic-modal', !hasSpecialisedLayout);
    utilityFamilyClasses.forEach((className) => {
      if (className !== `ctms-modal-${utilityFamily}` && modal.classList.contains(className)) modal.classList.remove(className);
    });
    workflowFamilyClasses.forEach((className) => {
      if (className !== `ctms-modal-${workflowFamily}` && modal.classList.contains(className)) modal.classList.remove(className);
    });
    if (utilityFamily) {
      if (!modal.classList.contains('ctms-utility-modal')) modal.classList.add('ctms-utility-modal');
      const utilityClass = `ctms-modal-${utilityFamily}`;
      if (!modal.classList.contains(utilityClass)) modal.classList.add(utilityClass);
      enhanceUtilityModal(body, utilityFamily, tab, activeTabLabel);
    } else if (modal.classList.contains('ctms-utility-modal')) {
      modal.classList.remove('ctms-utility-modal');
    }
    if (workflowFamily) {
      const workflowClass = `ctms-modal-${workflowFamily}`;
      if (!modal.classList.contains(workflowClass)) modal.classList.add(workflowClass);
      enhanceWorkflowModal(body, workflowFamily, tab, activeTabLabel);
    }

    const form = body.querySelector('#tab-main, #tab-pay, #searchForm, #contractForm');
    // Async Umbrella mounting can leave the frame on its previous tab after the
    // next form is visible. Layout follows that form, never the stale frame.
    const candidateTab = form?.dataset.recordCandidateTab || (form?.id === 'tab-pay' ? 'pay' : tab);
    if (entity === 'candidates' && candidateTab === 'main' && form && form.dataset.ctmsEnhanced !== '1') {
      form.dataset.ctmsEnhanced = '1';
      enhanceCandidateMain(body, form);
    } else if (entity === 'candidates' && candidateTab === 'pay' && form && form.dataset.ctmsEnhanced !== '1') {
      form.dataset.ctmsEnhanced = '1';
      enhanceCandidatePay(body, form);
    } else if (entity === 'candidates' && candidateTab === 'work' && form && form.dataset.ctmsEnhanced !== '1') {
      form.dataset.ctmsEnhanced = '1';
      enhanceCandidateWork(body, form);
    } else if (entity === 'clients' && tab === 'main' && form && form.dataset.ctmsEnhanced !== '1') {
      form.dataset.ctmsEnhanced = '1';
      enhanceClientMain(body, form);
    } else if (entity === 'umbrellas' && tab === 'main' && form && form.dataset.ctmsEnhanced !== '1') {
      form.dataset.ctmsEnhanced = '1';
      enhanceUmbrella(body, form);
    } else if (kind === 'advanced-search' && form && form.dataset.ctmsEnhanced !== '1') {
      form.dataset.ctmsEnhanced = '1';
      enhanceAdvancedSearch(body, form);
    } else if (entity === 'contracts' && tab === 'main' && form?.id === 'contractForm' && form.dataset.ctmsEnhanced !== '1') {
      const contractForm = form;
      contractForm.dataset.ctmsEnhanced = '1';
      enhanceContractMain(body, contractForm);
    } else if (
      ['candidates','clients','contracts'].includes(entity) &&
      !(entity === 'clients' && tab === 'settings') &&
      !(entity === 'contracts' && ['rates', 'settings'].includes(tab)) &&
      !body.querySelector('#contractRatesTab, #clientSettingsForm, #contractSettingsForm')
    ) {
      enhanceGenericRecordTab(body, entity, activeTabLabel || tab || 'details');
    }

    const rates = body.querySelector('#contractRatesTab');
    if (rates) enhanceContractRates(body, rates);
    const clientSettings = body.querySelector('#clientSettingsForm');
    if (clientSettings) enhanceClientSettings(body, clientSettings);
    const contractSettings = body.querySelector('#contractSettingsForm');
    if (contractSettings) enhanceContractSettings(body, contractSettings);

    cleanVisibleCopy(body, modal);
    decorateMoney(body);
    formatVisibleMoney(body);
    clampModalAfterLayout(modal, backdrop, frame, workflowFamily || utilityFamily || universalFamily);
  };

  document.addEventListener('blur', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.closest('#modal.ctms-modern-modal')) return;
    formatMoneyInput(target, true);
  }, true);
  document.addEventListener('wheel', handOffBankingWheel, { capture: true, passive: false });
  document.addEventListener('touchstart', beginBankingTouch, { capture: true, passive: true });
  document.addEventListener('touchmove', handOffBankingTouch, { capture: true, passive: false });
  document.addEventListener('touchend', endBankingTouch, true);
  document.addEventListener('touchcancel', endBankingTouch, true);

  const observer = new MutationObserver(() => queueMicrotask(apply));
  const start = () => {
    const modal = document.getElementById('modal');
    const backdrop = document.getElementById('modalBack');
    if (modal) observer.observe(modal, { childList: true, subtree: true });
    if (backdrop) observer.observe(backdrop, { attributes: true, attributeFilter: ['style', 'class'] });
    apply();
  };

  window.__applyCloudTmsModalModernisation = apply;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
