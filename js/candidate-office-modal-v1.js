(() => {
  'use strict';
  const escape = value => String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const paragraphs = value => String(value || '').split(/\n\s*\n/).map(item => `<p>${escape(item).replaceAll('\n', '<br>')}</p>`).join('');
  let serial = 0;

  function openDialog(options = {}) {
    const trigger = options.trigger instanceof HTMLElement ? options.trigger : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const id = `candidateOfficeDialog_${++serial}`;
    const rootId = `${id}_root`;
    const kind = `candidate-office-${String(options.kind || 'action').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
    const title = String(options.title || 'Candidate action').trim() || 'Candidate action';
    if (typeof showModal !== 'function') {
      throw Object.assign(new Error('The existing CloudTMS modal framework is unavailable.'), { code: 'CANDIDATE_OFFICE_MODAL_FRAMEWORK_UNAVAILABLE' });
    }

    return new Promise(resolve => {
      let settled = false;
      let busy = false;
      let pendingResult = null;
      const modalBody = () => document.getElementById('modalBody');
      const root = () => document.getElementById(rootId);
      const onKeyDown = event => {
        if (event.key !== 'Tab' || settled) return;
        const current = root();
        const modal = document.getElementById('modal');
        if (!current || !modal || !modal.contains(document.activeElement)) return;
        const focusable = Array.from(modal.querySelectorAll('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])'))
          .filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.getClientRects().length > 0);
        if (!focusable.length) {
          event.preventDefault();
          modal.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      const setBusy = (value, message = '') => {
        busy = value === true;
        const current = root();
        if (!current) return;
        current.setAttribute('aria-busy', String(busy));
        current.querySelectorAll('button, input, select, textarea').forEach(el => { el.disabled = busy || el.dataset.initiallyDisabled === '1'; });
        const status = current.querySelector('.candidate-office-dialog__status');
        if (status) status.textContent = message;
      };
      const setError = message => {
        const error = root()?.querySelector('.candidate-office-dialog__error');
        if (!error) return;
        error.hidden = !message;
        error.textContent = message || '';
        if (message) error.setAttribute('tabindex', '-1');
        if (message) error.focus?.();
      };
      const requestClose = () => {
        const close = document.getElementById('btnCloseModal');
        if (close) close.click();
        else if (typeof closeModal === 'function') closeModal();
      };
      const cleanup = () => {
        modalBody()?.removeEventListener('click', onBodyClick);
        modalBody()?.removeEventListener('input', onBodyInput);
        modalBody()?.removeEventListener('change', onBodyInput);
        window.removeEventListener('keydown', onKeyDown, true);
        if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
      };
      const finish = result => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const onDismiss = () => finish(pendingResult || { confirmed: false, value: 'cancel', via: 'close' });
      const onBodyInput = event => {
        const current = root();
        if (!current || !current.contains(event.target)) return;
        setError('');
      };
      const onBodyClick = async event => {
        if (settled || busy || !root()?.contains(event.target)) return;
        const button = event.target.closest('[data-candidate-dialog-action]');
        if (!button) return;
        const value = button.dataset.candidateDialogAction;
        if (value === 'cancel' || value === 'back' || value === 'close') {
          pendingResult = { confirmed: false, value, via: value };
          requestClose();
          return;
        }
        setError('');
        let collected = {};
        try {
          collected = typeof options.collect === 'function' ? options.collect(root()) : {};
          if (typeof options.validate === 'function') options.validate(collected, root());
        } catch (validationError) {
          setError(validationError?.message || 'Review the required fields.');
          return;
        }
        if (typeof options.onAction === 'function') {
          setBusy(true, options.busyMessage || 'Working…');
          try {
            const outcome = await options.onAction(value, collected, { setError, setBusy, root: root() });
            if (outcome?.keepOpen) { setBusy(false, outcome.status || ''); return; }
            collected = { ...collected, outcome };
          } catch (actionError) {
            setBusy(false, '');
            setError(actionError?.message || 'CloudTMS could not complete this action.');
            return;
          }
        }
        pendingResult = { confirmed: true, value, via: 'action', inputs: collected };
        requestClose();
      };
      const renderTab = key => {
        if (key !== 'main') return '';
        const icon = options.tone === 'danger' ? '!' : options.tone === 'success' ? '✓' : 'i';
        const buttons = (options.buttons || []).map((button, index) => `<button type="button" class="btn ${escape(button.className || (index === 0 ? 'btn-outline' : 'btn-primary'))}" data-candidate-dialog-action="${escape(button.value)}"${button.disabled ? ' disabled data-initially-disabled="1"' : ''}>${escape(button.label)}</button>`).join('');
        return `
          <div class="tabc" id="${escape(rootId)}" data-candidate-office-dialog="${escape(options.kind || 'action')}">
            <div class="card candidate-office-modal-panel candidate-office-tone--${escape(options.tone || 'warning')}">
              <div class="candidate-office-modal-heading">
                <div class="candidate-office-dialog__icon" aria-hidden="true">${icon}</div>
                <div>${options.eyebrow ? `<div class="candidate-office-dialog__eyebrow">${escape(options.eyebrow)}</div>` : ''}<div class="candidate-office-modal-heading__title">${escape(title)}</div></div>
              </div>
              <div class="candidate-office-dialog__body">${options.bodyHtml || paragraphs(options.body || '')}${options.formHtml || ''}<div class="candidate-office-dialog__error" role="alert" hidden></div><div class="candidate-office-dialog__status" aria-live="polite"></div></div>
              <div class="candidate-office-dialog__footer">${buttons}</div>
            </div>
          </div>`;
      };
      showModal(title, [{ key: 'main', label: 'Confirm' }], renderTab, null, false, null, {
        kind,
        frameEntity: 'candidate-office-dialog',
        noParentGate: true,
        showSave: false,
        showApply: false,
        onDismiss
      });
      modalBody()?.addEventListener('click', onBodyClick);
      modalBody()?.addEventListener('input', onBodyInput);
      modalBody()?.addEventListener('change', onBodyInput);
      window.addEventListener('keydown', onKeyDown, true);
      options.onReady?.(root());
      requestAnimationFrame(() => {
        const current = root();
        const target = options.defaultFocusSelector ? current?.querySelector(options.defaultFocusSelector) : current?.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
        target?.focus?.();
      });
    });
  }

  const reasonForm = ({ generic = false } = {}) => {
    if (generic) return `<div class="candidate-office-field"><label for="candidateOfficeReason">Reason</label><textarea id="candidateOfficeReason" maxlength="1000" rows="4" required></textarea><div class="candidate-office-field__help">Required · maximum 1,000 characters</div></div>`;
    const reasons = window.CloudTMSCandidateRouteWarnings.getCandidateInterventionReasons();
    return `<fieldset class="candidate-office-field"><legend>Reason for intervention</legend>${reasons.map(reason => `<label class="candidate-office-radio"><input type="radio" name="candidateOfficeReasonCode" value="${escape(reason.code)}"> <span>${escape(reason.label)}</span></label>`).join('')}<label class="candidate-office-note" hidden>Explanatory note<textarea id="candidateOfficeReasonNote" maxlength="1000" rows="3"></textarea><span>Required for other exceptional intervention · maximum 1,000 characters</span></label></fieldset>`;
  };
  const collectIntervention = root => ({
    reasonCode: root.querySelector('input[name="candidateOfficeReasonCode"]:checked')?.value || '',
    reasonNote: root.querySelector('#candidateOfficeReasonNote')?.value.trim() || ''
  });
  const validateIntervention = values => {
    if (!values.reasonCode) throw new Error('Select a reason before continuing.');
    if (values.reasonCode === 'OTHER_EXCEPTIONAL_OFFICE_INTERVENTION' && !values.reasonNote) throw new Error('Add an explanatory note for the exceptional intervention.');
  };
  document.addEventListener('change', event => {
    if (event.target?.name !== 'candidateOfficeReasonCode') return;
    const dialog = event.target.closest('[data-candidate-office-dialog]');
    const note = dialog?.querySelector('.candidate-office-note');
    if (note) note.hidden = event.target.value !== 'OTHER_EXCEPTIONAL_OFFICE_INTERVENTION';
  });

  function openCandidateRouteWarningModal({ preview, warningCode, trigger }) {
    const code = warningCode || preview.warning_code || preview.warning || (Array.isArray(preview.warning_codes) ? preview.warning_codes[0] : null);
    const def = window.CloudTMSCandidateRouteWarnings.getCandidateRouteWarningDefinition(code);
    return openDialog({
      kind: 'route-warning', size: 'warning', tone: def.blocking ? 'danger' : 'warning', title: def.title, body: def.body,
      formHtml: def.reason_required ? reasonForm() : '', trigger,
      buttons: def.buttons.map((label, index) => ({ label, value: index === 0 ? 'back' : 'confirm', className: index === 0 ? 'btn-outline' : (def.blocking ? 'btn-outline' : 'btn-warn') })),
      collect: def.reason_required ? collectIntervention : () => ({}),
      validate: def.reason_required ? validateIntervention : null,
      defaultFocusSelector: '[data-candidate-dialog-action="back"]'
    });
  }
  function openCandidateDecisionModal({ decision, trigger }) {
    const def = window.CloudTMSCandidateRouteWarnings.getCandidateRouteDecisionDefinition('W07');
    return openDialog({ kind: 'route-decision', size: 'warning', tone: 'warning', title: def.title, body: def.body, trigger,
      buttons: [
        { label: 'Go Back', value: 'back', className: 'btn-outline' },
        { label: 'Use Reject Candidate Submission', value: 'reject', className: 'btn-warn', disabled: decision?.reject_available === false },
        { label: 'Continue to Manual conversion', value: 'manual', className: 'btn-primary' }
      ], defaultFocusSelector: '[data-candidate-dialog-action="back"]' });
  }
  const managerContext = projection => {
    const m = projection?.manager_approval || {};
    const fmt = window.CloudTMSCandidateOfficePresenter?.formatDateTime || (value => value || '—');
    return `<dl class="candidate-office-dialog-facts"><div><dt>Last provider-accepted send</dt><dd>${escape(fmt(m.provider_accepted_at_utc))}</dd></div><div><dt>Next reminder eligibility</dt><dd>${escape(fmt(m.next_reminder_at_utc))}</dd></div><div><dt>Expires</dt><dd>${escape(fmt(m.expires_at_utc))}</dd></div><div><dt>Resends remaining</dt><dd>${escape(m.resends_remaining ?? '—')}</dd></div></dl>`;
  };
  function openCandidateManagerActionModal({ action, projection, trigger }) {
    const code = action.code;
    const managerRequestCodes = new Set(['SEND_MANAGER_REMINDER', 'RENEW_MANAGER_REQUEST']);
    if (code === 'CANCEL_MANAGER_REQUEST') {
      throw Object.assign(new Error('This backend action is not exposed in the Office frontend.'), { code: 'CANDIDATE_OFFICE_ACTION_NOT_EXPOSED' });
    }
    if (['BEGIN_PHONE_REVIEW', 'RECORD_PHONE_REVIEW_PROGRESS', 'PREPARE_PHONE_SIGNATURE', 'APPROVE_BY_PHONE', 'REFUSE_BY_PHONE'].includes(code)) {
      throw Object.assign(new Error('Manager decisions are completed by the manager journey and are not Office actions.'), { code: 'CANDIDATE_OFFICE_MANAGER_DECISION_FORBIDDEN' });
    }
    const config = {
      SEND_MANAGER_REMINDER: ['Send Manager Reminder?', 'CloudTMS will send another reminder for this current live manager approval request.', 'Go Back', 'Send Manager Reminder'],
      RENEW_MANAGER_REQUEST: ['Request Manager Approval Again?', 'The previous approval request has expired. CloudTMS will create a new approval request, link and expiry. The previous request will remain in the audit history and will no longer be usable.', 'Go Back', 'Request Manager Approval Again'],
      RETRY_FINALISATION: ['Retry Candidate finalisation?', 'CloudTMS will retry the outstanding final document and finalisation work. The candidate or manager will not be asked to sign again.', 'Go Back', 'Retry finalisation'],
      RETRY_PAPER_PREPARATION: ['Retry QR Pack preparation?', 'CloudTMS will retry the failed QR Pack preparation for the exact current delivery generation.', 'Go Back', 'Retry QR Pack preparation'],
      ISSUE_REPLACEMENT_PAPER_PACK: ['Create a Replacement QR Pack?', 'The current QR Pack and code will be invalidated. Any printed or previously emailed copy can no longer be returned. A replacement QR Pack with a new code will be generated and the worker will be notified.\n\nThe previous pack remains immutable history but is no longer valid.', 'Go Back', 'Create Replacement QR Pack and Notify Worker']
    }[code] || [`${action.label}?`, 'Review this Candidate action before continuing.', 'Go Back', action.label];
    const formHtml = '';
    return openDialog({ kind: 'office-action', size: 'form', tone: 'warning', title: config[0], bodyHtml: `${paragraphs(config[1])}${managerRequestCodes.has(code) ? managerContext(projection) : ''}`, formHtml, trigger,
      buttons: [{ label: config[2], value: 'back', className: 'btn-outline' }, { label: config[3], value: 'confirm', className: 'btn-primary' }],
      collect: root => ({ reason: root.querySelector('#candidateOfficeReason')?.value.trim() || '' }),
      validate: () => {}, defaultFocusSelector: '[data-candidate-dialog-action="back"]' });
  }
  function openCandidateTypedActionModal({ action, projection, trigger }) {
    const inputs = Array.isArray(action?.invocation?.required_user_inputs) ? action.invocation.required_user_inputs : [];
    const fields = inputs.map(input => {
      const name = String(input.name || '').trim();
      const label = name.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
      const attrs = `data-candidate-input="${escape(name)}"${input.required === true ? ' required' : ''}${input.max_length ? ` maxlength="${escape(input.max_length)}"` : ''}`;
      if (input.type === 'enum') return `<label>${escape(label)}<select ${attrs}>${(input.values || []).map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('')}</select></label>`;
      if (input.type === 'object') return `<label>${escape(label)}<textarea ${attrs} rows="4" placeholder="JSON object"></textarea></label>`;
      if (input.type === 'integer') return `<label>${escape(label)}<input ${attrs} type="number" min="${escape(input.minimum ?? 0)}"></label>`;
      return `<label>${escape(label)}<input ${attrs} type="text" autocomplete="off"></label>`;
    }).join('');
    return openDialog({ kind: 'typed-action', size: 'form', tone: 'warning', title: `${action.label}?`, body: 'Review the required information before continuing.', formHtml: `<div class="candidate-office-field-grid">${fields}</div>`, trigger,
      buttons: [{ label: 'Go Back', value: 'back', className: 'btn-outline' }, { label: action.label, value: 'confirm', className: action?.code?.includes('REFUSE') ? 'btn-warn' : 'btn-primary' }],
      collect: root => {
        const result = {};
        root.querySelectorAll('[data-candidate-input]').forEach(el => {
          const input = inputs.find(item => item.name === el.dataset.candidateInput) || {};
          let value = el.value;
          if (input.type === 'integer' && value !== '') value = Number(value);
          if (input.type === 'object' && value.trim()) { try { value = JSON.parse(value); } catch { throw new Error(`${input.name.replaceAll('_', ' ')} must be valid JSON.`); } }
          result[el.dataset.candidateInput] = value;
        });
        return result;
      },
      validate: values => {
        for (const input of inputs) {
          const value = values[input.name];
          if (input.required === true && (value == null || String(value).trim() === '')) throw new Error(`${input.name.replaceAll('_', ' ')} is required.`);
        }
      }, defaultFocusSelector: '[data-candidate-dialog-action="back"]' });
  }
  function openCandidateRejectionModal({ preview, context = {}, trigger }) {
    const neutral = [context.candidateName, context.clientName, context.weekEnding].filter(Boolean).map(item => `<span>${escape(item)}</span>`).join('');
    return openDialog({ kind: 'rejection', size: 'form', tone: 'danger', title: 'Reject Candidate Submission', bodyHtml: `${neutral ? `<div class="candidate-office-neutral-context">${neutral}</div>` : ''}${paragraphs('This will reject the evidence submitted and require the candidate to resubmit.\nAre you sure you wish to continue?')}`, formHtml: reasonForm({ generic: true }), trigger,
      buttons: [{ label: 'Go Back', value: 'back', className: 'btn-outline' }, { label: 'Reject Candidate Submission', value: 'confirm', className: 'btn-warn' }],
      collect: root => ({ reason: root.querySelector('#candidateOfficeReason')?.value.trim() || '' }),
      validate: values => { if (!values.reason) throw new Error('A reason is required.'); }, defaultFocusSelector: '[data-candidate-dialog-action="back"]' });
  }
  function openCandidateReminderBatchModal({ preview, trigger }) {
    const counts = [['Selected', preview.selected_count ?? preview.items?.length ?? 0], ['Eligible', preview.eligible_count ?? 0], ['Ineligible', preview.ineligible_count ?? 0], ['Changed since selection', preview.changed_count ?? 0]];
    return openDialog({ kind: 'reminder-batch', size: 'warning', tone: 'warning', title: 'Send Manager Reminders', bodyHtml: `${paragraphs('CloudTMS will send reminders only for selected timesheets that still have an eligible live manager approval request. Ineligible or changed timesheets will be left unchanged.')}<dl class="candidate-office-dialog-counts">${counts.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`, trigger,
      buttons: [{ label: 'Go Back', value: 'back', className: 'btn-outline' }, { label: 'Send Manager Reminders', value: 'confirm', className: 'btn-primary', disabled: Number(preview.eligible_count || 0) < 1 }], defaultFocusSelector: '[data-candidate-dialog-action="back"]' });
  }
  function openCandidateBatchResultModal({ result, trigger }) {
    const rows = Array.isArray(result.items) ? result.items : [];
    return openDialog({ kind: 'reminder-results', size: 'warning', tone: result.status === 'COMPLETED' ? 'success' : 'warning', title: 'Sending Manager Reminders', bodyHtml: `<div class="candidate-office-result-summary"><strong>${escape(result.status || 'COMPLETED')}</strong><span>${escape(result.success_count ?? 0)} completed</span><span>${escape(result.skipped_count ?? 0)} skipped</span><span>${escape(result.failure_count ?? 0)} failed</span></div><div class="candidate-office-result-list">${rows.map(row => `<div><span>${escape(row.correlation_key || 'Selected row')}</span><strong>${escape(row.outcome || row.error_code || 'Completed')}</strong></div>`).join('')}</div>`, trigger, buttons: [{ label: 'Close', value: 'close', className: 'btn-primary' }] });
  }
  function openCandidateConflictModal({ error, trigger }) {
    return openDialog({ kind: 'conflict', size: 'form', tone: 'danger', title: 'This timesheet has changed', body: error?.message || 'Refresh the current state, review it and confirm again.', trigger,
      buttons: [{ label: 'Close', value: 'close', className: 'btn-outline' }, { label: 'Refresh current state', value: 'refresh', className: 'btn-primary' }], defaultFocusSelector: '[data-candidate-dialog-action="close"]' });
  }
  Object.assign(window, { CloudTMSCandidateOfficeModals: Object.freeze({ openDialog, openCandidateRouteWarningModal, openCandidateDecisionModal, openCandidateManagerActionModal, openCandidateTypedActionModal, openCandidateRejectionModal, openCandidateReminderBatchModal, openCandidateBatchResultModal, openCandidateConflictModal }) });
})();
