(() => {
  'use strict';
  const escape = value => String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const statusClass = tone => `candidate-office-badge candidate-office-badge--${['success', 'danger', 'warning', 'info'].includes(tone) ? tone : 'neutral'}`;
  function renderCandidateSummaryCell(view) {
    if (!view || !view.status) return '';
    if (view.status.unavailable) return '';
    return `<span class="${statusClass(view.status.tone)} candidate-office-summary-status" data-candidate-status-code="${escape(view.status.code)}">${escape(view.status.label)}</span>`;
  }
  const renderCandidateCompactBadges = renderCandidateSummaryCell;
  const renderFields = fields => `<dl class="candidate-office-facts">${(fields || []).map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
  const approvedActions = (actions, surface) => (Array.isArray(actions) ? actions : [])
    .filter(action => action?.enabled === true || action?.placeholder === true)
    .filter(action => window.CloudTMSCandidateOfficeUiPolicy?.isButtonApproved(surface, action?.code) === true);
  function renderActions(actions, surface) {
    const list = approvedActions(actions, surface);
    if (!list.length) return '';
    return `<div class="candidate-office-actions">${list.map(action => `<span class="candidate-office-action-wrap"><button type="button" class="btn ${action.enabled ? (action.prominent ? 'btn-primary' : 'btn-outline') : 'btn-outline'}" data-candidate-office-action="${escape(action.code)}" data-candidate-office-surface="${escape(surface)}" data-candidate-office-server-enabled="${action.enabled ? '1' : '0'}"${action.enabled ? '' : ' disabled aria-disabled="true"'}${action.placeholder ? ' data-candidate-office-placeholder="1"' : ''} title="${escape(action.enabled ? action.label : action.disabled_text)}">${escape(action.label)}</button>${action.placeholder ? `<small>${escape(action.disabled_text)}</small>` : ''}</span>`).join('')}</div>`;
  }
  function renderCandidateActionHub(view, { surface = 'SIMPLE_TIMESHEET' } = {}) {
    const buttons = renderActions(view.actions, surface);
    return buttons ? `<section class="candidate-office-section candidate-office-action-hub"><h4>Candidate actions</h4>${buttons}</section>` : '';
  }
  function renderCandidateStageFragment(view) {
    if (!view?.status) return '';
    return `<span class="candidate-office-overview-badges"><span class="${statusClass(view.status.tone)}" data-candidate-status-code="${escape(view.status.code)}">${escape(view.status.label)}</span></span>`;
  }
  function renderCandidateOverviewFragment(view) {
    if (!view) return '';
    const sections = [];
    if (view.manager) {
      sections.push(`<div class="candidate-office-overview-group"><strong>Manager approval</strong>${renderFields(view.manager.fields)}</div>`);
    }
    if (view.paper) {
      sections.push(`<div class="candidate-office-overview-group"><strong>QR Pack</strong>${renderFields(view.paper.fields)}</div>`);
    }
    if (view.rejections?.length) {
      sections.push(`<div class="candidate-office-overview-group"><strong>Submission history</strong>${view.rejections.map(item => `<div class="candidate-office-history-row"><span>${escape(item.label)}</span>${item.replacement_state ? `<span>Replacement: ${escape(item.replacement_state)}</span>` : item.historical ? '<span>Historical — already replaced or no longer actionable</span>' : ''}</div>`).join('')}</div>`);
    }
    return sections.length ? `<div class="candidate-office-overview-details">${sections.join('')}</div>` : '';
  }
  function renderCandidateActionsFragment(view, { surface = 'SIMPLE_TIMESHEET' } = {}) {
    if (!view) return '';
    return renderActions(view.actions, surface);
  }
  function renderCandidateIssuesFragment(view) {
    if (!view) return '';
    const issues = [];
    if (['REJECTED_BY_AGENCY', 'REFUSED_BY_CLIENT', 'REJECTED', 'REFUSED'].includes(String(view.status?.code || '').toUpperCase())) {
      issues.push(`<li><span class="${statusClass(view.status.tone)}">${escape(view.status.label)}</span></li>`);
    }
    for (const diagnostic of view.diagnostics || []) {
      issues.push(`<li><span class="${statusClass(diagnostic.tone)}" title="Presentation only; no calculation effect">${escape(diagnostic.label)}</span></li>`);
    }
    return issues.length ? `<ul class="candidate-office-issues">${issues.join('')}</ul>` : '';
  }
  function renderCandidateEvidenceFragment(view) {
    if (!view?.paper) return '';
    const viewAction = (view.evidence_actions || []).find(action => action.code === 'VIEW_PAPER_PACK' && action.enabled === true);
    if (!viewAction || String(view.workflow?.state || '').toUpperCase() !== 'AWAITING_PAPER_RETURN') return '';
    const pages = view.paper.page_count ? `${escape(view.paper.page_count)} pages` : 'PDF';
    return `<div class="candidate-office-evidence-row" role="group" aria-label="Unsigned QR Pack">
      <div><strong>Unsigned QR Pack</strong><span>QR Pack · ${pages} · Candidate</span><small>Audit copy only — signed official documents have not yet been returned and this cannot make the timesheet eligible for Authorisation.</small></div>
      <div class="candidate-office-evidence-row__actions">
        <button type="button" class="btn mini subtle" data-candidate-office-evidence-action="VIEW_PAPER_PACK" data-candidate-office-server-enabled="1" data-candidate-office-evidence-mode="view">View</button>
        <button type="button" class="btn mini subtle" data-candidate-office-evidence-action="VIEW_PAPER_PACK" data-candidate-office-server-enabled="1" data-candidate-office-evidence-mode="download">Download</button>
      </div>
    </div>`;
  }
  function renderCandidateFragment(view, { surface = 'SIMPLE_TIMESHEET', variant = 'detail' } = {}) {
    if (variant === 'stage') return renderCandidateStageFragment(view);
    if (variant === 'overview') return renderCandidateOverviewFragment(view);
    if (variant === 'actions') return renderCandidateActionsFragment(view, { surface });
    if (variant === 'issues') return renderCandidateIssuesFragment(view);
    if (variant === 'evidence') return renderCandidateEvidenceFragment(view);
    if (variant === 'compact') return renderCandidateCompactBadges(view);
    return renderCandidateOfficeCard(view, { surface });
  }
  function renderCandidateOfficeCard(view, { surface = 'SIMPLE_TIMESHEET' } = {}) {
    if (!view) return `<section class="candidate-office-card candidate-office-card--loading" aria-busy="true"><div class="candidate-office-skeleton"></div><span>Loading Candidate status…</span></section>`;
    if (view.status?.unavailable) return `<section class="candidate-office-card candidate-office-card--unavailable"><div><strong>Status unavailable</strong><p>CloudTMS could not safely read the Candidate state.</p></div></section>`;
    const managerActions = renderActions(view.manager?.actions, surface);
    const manager = view.manager ? `<section class="candidate-office-section candidate-office-manager"><div class="candidate-office-section__heading"><h4>${escape(view.manager.title)}</h4></div>${renderFields(view.manager.fields)}${managerActions}</section>` : '';
    const paperActions = renderActions(view.paper?.actions, surface);
    const paper = view.paper ? `<section class="candidate-office-section candidate-office-paper"><div class="candidate-office-section__heading"><h4>QR Pack</h4></div>${view.paper.explanation ? `<div class="candidate-office-inline-note">${escape(view.paper.explanation)}</div>` : ''}${renderFields(view.paper.fields)}${paperActions}</section>` : '';
    const rejections = view.rejections.length ? `<section class="candidate-office-section candidate-office-rejections"><h4>Submission history</h4>${view.rejections.map(item => `<div class="candidate-office-history-row"><div><strong>${escape(item.label)}</strong>${item.replacement_state ? `<span>Replacement: ${escape(item.replacement_state)}</span>` : item.historical ? '<span>Historical — already replaced or no longer actionable</span>' : ''}</div>${item.action ? renderActions([item.action], surface) : ''}</div>`).join('')}</section>` : '';
    const diagnostics = view.diagnostics.length ? `<div class="candidate-office-diagnostics">${view.diagnostics.map(item => `<span class="${statusClass(item.tone)}" title="Presentation only; no calculation effect">${escape(item.label)}</span>`).join('')}</div>` : '';
    const managerCodes = new Set((view.manager?.actions || []).map(action => action.code));
    const paperCodes = new Set((view.paper?.actions || []).map(action => action.code));
    const historyCodes = new Set(view.rejections.map(item => item.action?.code).filter(Boolean));
    const remaining = view.actions.filter(action => !managerCodes.has(action.code) && !paperCodes.has(action.code) && !historyCodes.has(action.code));
    const remainingButtons = renderActions(remaining, surface);
    return `<section class="candidate-office-card" data-candidate-office-card="${escape(surface)}"><header class="candidate-office-card__header"><div><span class="candidate-office-card__eyebrow">Candidate submission</span><h3>Candidate status</h3></div><span class="${statusClass(view.status.tone)}" data-candidate-status-code="${escape(view.status.code)}">${escape(view.status.label)}</span></header>${diagnostics}${manager}${paper}${rejections}${remainingButtons ? `<section class="candidate-office-section candidate-office-action-hub"><h4>Candidate actions</h4>${remainingButtons}</section>` : ''}<footer class="candidate-office-card__footer">State observed ${escape(view.observed_at)}</footer></section>`;
  }
  function renderCandidateUnavailable(error, { variant = 'detail' } = {}) {
    const message = escape(error?.message || 'Refresh the current state.');
    if (variant !== 'detail') return '';
    return `<section class="candidate-office-card candidate-office-card--unavailable"><div><strong>Candidate status unavailable</strong><p>${message}</p></div></section>`;
  }
  function renderCandidateOfficeSlot({ surface, row, variant = surface === 'TIMESHEET_SUMMARY' ? 'compact' : 'detail' }) {
    const identity = window.CloudTMSCandidateOfficeApi.buildIdentity(row);
    const loading = variant === 'detail'
      ? renderCandidateOfficeCard(null, { surface })
      : (variant === 'compact' ? '<span class="candidate-office-badge candidate-office-badge--neutral">Loading Candidate status…</span>' : '');
    return `<div class="candidate-office-slot" data-candidate-office-slot="1" data-candidate-office-variant="${escape(variant)}" data-candidate-office-surface="${escape(surface)}" data-row-key="${escape(identity.row_key)}" data-timesheet-id="${escape(identity.timesheet_id || '')}" data-contract-week-id="${escape(identity.contract_week_id || '')}" data-row-signature="${escape(identity.expected_row_signature || '')}" aria-live="polite">${loading}</div>`;
  }
  function bindCandidateOfficeActions(root, context) {
    const listener = event => {
      const button = event.target.closest('[data-candidate-office-action]');
      if (!button || !root.contains(button) || button.disabled) return;
      context.onAction?.(button.dataset.candidateOfficeAction, button);
    };
    root.addEventListener('click', listener);
    return () => root.removeEventListener('click', listener);
  }
  Object.assign(window, { CloudTMSCandidateOfficeSurface: Object.freeze({ renderCandidateSummaryCell, renderCandidateCompactBadges, renderCandidateOfficeCard, renderCandidateActionHub, renderCandidateStageFragment, renderCandidateOverviewFragment, renderCandidateActionsFragment, renderCandidateIssuesFragment, renderCandidateEvidenceFragment, renderCandidateFragment, renderCandidateUnavailable, renderCandidateOfficeSlot, bindCandidateOfficeActions }) });
})();
