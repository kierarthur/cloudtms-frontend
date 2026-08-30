(function initialiseMyTmsOffice(global) {
  'use strict';

  const state = {
    settings: null,
    managerSettings: null,
    managerSettingsError: null,
    homeAnnouncement: null,
    homeAnnouncementError: null,
    dailyInformation: null,
    dailyInformationError: null,
    managerSubmissionType: 'TIMESHEET',
    managerMailKind: 'INITIAL',
    activeSettingsTab: 'general',
    openToken: null,
    previewByKind: Object.create(null)
  };

  const text = (value) => String(value == null ? '' : value).trim();
  const upper = (value) => text(value).toUpperCase();
  const escapeHtml = (value) => String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
  const uuid = () => global.crypto?.randomUUID?.()
    || `00000000-0000-4000-8000-${Date.now().toString().padStart(12, '0').slice(-12)}`;

  const apiUrl = (path) => {
    if (typeof API === 'function') return API(path);
    if (typeof global.API === 'function') return global.API(path);
    throw new Error('MYTMS_OFFICE_API_UNAVAILABLE');
  };

  const authenticatedFetch = (...args) => {
    if (typeof authFetch === 'function') return authFetch(...args);
    if (typeof global.authFetch === 'function') return global.authFetch(...args);
    throw new Error('MYTMS_OFFICE_API_UNAVAILABLE');
  };

  async function api(path, init = {}) {
    const response = await authenticatedFetch(apiUrl(path), init);
    if (!response || typeof response.ok !== 'boolean') {
      throw new Error('MYTMS_OFFICE_RESPONSE_INVALID');
    }
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(text(body?.error_code || body?.error) || 'MYTMS_OFFICE_REQUEST_FAILED');
      error.status = response.status;
      throw error;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('MYTMS_OFFICE_RESPONSE_INVALID');
    }
    return body;
  }

  const settingsGet = () => api('/api/mytms/settings');
  const settingsPreview = (html) => api('/api/mytms/settings/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html: String(html || '') })
  });
  const managerSettingsGet = () => api('/api/mytms/manager-email-settings');
  const managerSettingsPreview = (kind, template) => api('/api/mytms/manager-email-settings/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, template })
  });
  const homeAnnouncementGet = () => api('/api/mytms/home-announcement');
  const homeAnnouncementPreview = (announcementText) => api('/api/mytms/home-announcement/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ announcement_text: String(announcementText ?? '') })
  });
  const dailyInformationGet = () => api('/api/mytms/daily-information');
  const candidateStatus = (candidateId) => api(
    `/api/mytms/candidates/${encodeURIComponent(text(candidateId))}/status`
  );

  function settingsPayload(source) {
    const keys = [
      'invitation_subject', 'invitation_html_sanitized', 'invitation_text',
      'access_reminder_subject', 'access_reminder_html_sanitized', 'access_reminder_text',
      'invitation_expiry_seconds', 'resend_minimum_seconds', 'maximum_resends'
    ];
    const output = {};
    for (const key of keys) output[key] = source[key] ?? null;
    return output;
  }

  async function settingsSave() {
    if (!state.settings) return { ok: false };
    const result = await api('/api/mytms/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: Number(state.settings.version),
        idempotency_key: uuid(),
        correlation_id: uuid(),
        settings: settingsPayload(state.settings)
      })
    });
    state.settings = { ...result };
    try { global.showModalHint?.(`MyTMS App Settings version ${result.version} saved.`, 'ok'); } catch {}
    return { ok: true };
  }

  async function managerTemplatesSave() {
    if (!state.managerSettings) return { ok: false };
    const result = await api('/api/mytms/manager-email-settings/templates', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: Number(state.managerSettings.agency_template_version),
        idempotency_key: uuid(), templates: state.managerSettings.agency_templates
      })
    });
    state.managerSettings.agency_templates = result.templates;
    state.managerSettings.agency_template_version = Number(result.version);
    state.managerSettings.agency_template_semantic_sha256_hex = result.semantic_sha256_hex;
    state.managerSettings.agency_template_updated_at_utc = result.updated_at_utc;
    global.showModalHint?.(`Manager email templates version ${result.version} saved.`, 'ok');
    return { ok: true };
  }

  async function homeAnnouncementSave() {
    if (!state.homeAnnouncement) return { ok: false };
    const result = await api('/api/mytms/home-announcement', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: Number(state.homeAnnouncement.version),
        idempotency_key: uuid(),
        announcement_text: String(state.homeAnnouncement.announcement_text ?? '')
      })
    });
    state.homeAnnouncement = { ...result };
    global.showModalHint?.(`Home announcement version ${result.version} saved.`, 'ok');
    return { ok: true };
  }

  function directoryValidation() {
    if (!state.dailyInformation) return 'The places and contacts directory is unavailable.';
    const hospitalNames = new Set();
    for (const entry of state.dailyInformation.hospital_addresses || []) {
      if (!text(entry.hospital_name) || !text(entry.address)) {
        return 'Every hospital needs a hospital name and address.';
      }
      const key = text(entry.hospital_name).toLowerCase();
      if (hospitalNames.has(key)) return 'Each hospital name can appear only once.';
      hospitalNames.add(key);
    }
    const accommodationNames = new Set();
    for (const entry of state.dailyInformation.accommodation_contacts || []) {
      if (!text(entry.hospital_name) || !text(entry.office_name)) {
        return 'Every accommodation contact needs a hospital and office name.';
      }
      const key = `${text(entry.hospital_name).toLowerCase()}\n${text(entry.office_name).toLowerCase()}`;
      if (accommodationNames.has(key)) {
        return 'Each accommodation office can appear only once for a hospital.';
      }
      accommodationNames.add(key);
    }
    return '';
  }

  async function dailyInformationSave() {
    const validation = directoryValidation();
    if (validation) {
      global.showModalHint?.(validation, 'err');
      return { ok: false };
    }
    const result = await api('/api/mytms/daily-information', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: Number(state.dailyInformation.version),
        idempotency_key: uuid(),
        hospital_addresses: state.dailyInformation.hospital_addresses,
        accommodation_contacts: state.dailyInformation.accommodation_contacts
      })
    });
    state.dailyInformation = { ...result };
    global.showModalHint?.(`Places and contacts version ${result.version} saved.`, 'ok');
    return { ok: true };
  }

  function settingsField(label, name, value, type = 'text', extra = '') {
    return `
      <div class="row">
        <label for="mytms-${escapeHtml(name)}">${escapeHtml(label)}</label>
        <div class="controls">
          <input class="input" id="mytms-${escapeHtml(name)}" data-mytms-setting="${escapeHtml(name)}"
                 type="${escapeHtml(type)}" value="${escapeHtml(value ?? '')}" ${extra} />
        </div>
      </div>`;
  }

  function readOnlySetting(label, value, note = 'Platform-owned') {
    const id = `mytms-readonly-${text(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return `<div class="row"><label for="${escapeHtml(id)}">${escapeHtml(label)}</label><div class="controls">
      <input class="input" id="${escapeHtml(id)}" value="${escapeHtml(value ?? '')}" data-mytms-platform-readonly="1" readonly disabled />
      <div class="mini">${escapeHtml(note)}</div></div></div>`;
  }

  function activationPanel() {
    const fields = [
      ['invitation_email_enabled', 'Invitation email'],
      ['access_reminder_enabled', 'Access reminder'],
      ['provisioning_enabled', 'Google provisioning'],
      ['membership_admin_enabled', 'Membership administration'],
      ['google_target_switch_enabled', 'Google target switching'],
      ['push_delivery_enabled', 'Push delivery']
    ];
    return `
      <div class="card">
        <h3 style="margin-top:0;">Activation state</h3>
        <p class="mini">These controls report the authoritative state. Activation remains externally gated and cannot be enabled from this local Office implementation.</p>
        ${fields.map(([name, label]) => `
          <label style="display:flex;gap:8px;align-items:center;margin:8px 0;">
            <input type="checkbox" data-mytms-setting="${name}" data-mytms-activation-readonly="1"
                   ${state.settings?.[name] === true ? 'checked' : ''} disabled />
            <span>${escapeHtml(label)}</span>
            <span class="mini">${state.settings?.[name] === true ? 'Enabled by controlled authority' : 'Disabled'}</span>
          </label>`).join('')}
      </div>`;
  }

  function editorPanel(kind) {
    const invitation = kind === 'invitation';
    const title = invitation ? 'Invitation email' : 'Access reminder';
    const subjectKey = invitation ? 'invitation_subject' : 'access_reminder_subject';
    const htmlKey = invitation ? 'invitation_html_sanitized' : 'access_reminder_html_sanitized';
    const textKey = invitation ? 'invitation_text' : 'access_reminder_text';
    return `
      <div class="card">
        <h3 style="margin-top:0;">${title}</h3>
        ${settingsField('Subject', subjectKey, state.settings?.[subjectKey] || '')}
        <div class="row">
          <label>HTML template</label>
          <div class="controls" style="min-width:0;">
            <div data-mytms-toolbar="${kind}" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
              <button type="button" class="btn mini" data-command="bold">Bold</button>
              <button type="button" class="btn mini" data-command="italic">Italic</button>
              <button type="button" class="btn mini" data-command="insertUnorderedList">List</button>
              <button type="button" class="btn mini" data-token="{{candidate_name}}">Candidate name</button>
              <button type="button" class="btn mini" data-token="{{agency_name}}">Agency name</button>
              <button type="button" class="btn mini" data-token="{{mytms_invitation_url}}">Secure link</button>
            </div>
            <div class="input" contenteditable="true" role="textbox" aria-multiline="true"
                 data-mytms-html-editor="${kind}" data-setting-key="${htmlKey}"
                 style="min-height:180px;overflow:auto;background:#fff;color:#111;"></div>
            <div class="mini" style="margin-top:5px;">Saved HTML is sanitized by the server. Preview uses the exact sanitized output.</div>
          </div>
        </div>
        <div class="row">
          <label for="mytms-${textKey}">Plain-text fallback</label>
          <div class="controls">
            <textarea class="input" id="mytms-${textKey}" data-mytms-setting="${textKey}" rows="6">${escapeHtml(state.settings?.[textKey] || '')}</textarea>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin:10px 0;">
          <button type="button" class="btn" data-mytms-preview="${kind}">Preview sanitized email</button>
          <span class="mini">Policy ${escapeHtml(state.settings?.sanitizer_policy_version || 'not installed')}</span>
        </div>
        <iframe data-mytms-preview-frame="${kind}" title="${title} sanitized preview" sandbox=""
                style="display:none;width:100%;height:260px;border:1px solid var(--line);background:#fff;"></iframe>
      </div>`;
  }

  function renderSettingsTab(tabKey) {
    state.activeSettingsTab = tabKey;
    if (!state.settings) return '<div class="card">MyTMS settings are unavailable.</div>';
    if (tabKey === 'activation') return activationPanel();
    if (tabKey === 'invitation') return editorPanel('invitation');
    if (tabKey === 'reminder') return editorPanel('reminder');
    if (tabKey === 'manager-email') return managerEmailPanel();
    if (tabKey === 'home') return homeAnnouncementPanel();
    if (tabKey === 'daily-information') return dailyInformationPanel();
    return `
      <div class="card">
        <h3 style="margin-top:0;">Agency invitation policy</h3>
        <p class="mini">Agency-editable within platform safety limits. Manager approval links always use their separate seven-day policy.</p>
        ${settingsField('Invitation expiry (seconds)', 'invitation_expiry_seconds', state.settings.invitation_expiry_seconds || '', 'number', 'min="86400" max="604800" step="1"')}
        ${settingsField('Minimum resend interval (seconds)', 'resend_minimum_seconds', state.settings.resend_minimum_seconds || '', 'number', 'min="900" max="86400" step="1"')}
        ${settingsField('Maximum resends (0–5; total sends 1–6)', 'maximum_resends', state.settings.maximum_resends || '', 'number', 'min="0" max="5" step="1"')}
      </div>
      <div class="card">
        <h3 style="margin-top:0;">Platform configuration</h3>
        <p class="mini">Shown for clarity. Agency customers cannot change app hosting, app stores, TEST safety recipients or activation authority.</p>
        ${readOnlySetting('TEST recipient allowlist', (state.settings.test_recipient_allowlist || []).join(', '))}
        ${readOnlySetting('TEST web origin', state.settings.planned_test_web_origin)}
        ${readOnlySetting('Future web origin', state.settings.planned_future_web_origin)}
        ${readOnlySetting('Web host state', state.settings.web_host_state)}
        ${readOnlySetting('Support URL', state.settings.support_url)}
        ${readOnlySetting('Android store URL', state.settings.android_store_url)}
        ${readOnlySetting('iOS store URL', state.settings.ios_store_url)}
        ${readOnlySetting('Logo asset key', state.settings.logo_asset_key)}
      </div>`;
  }

  function currentManagerTemplate() {
    return state.managerSettings?.agency_templates?.[state.managerSubmissionType]?.[state.managerMailKind] || null;
  }

  function managerEmailPanel() {
    if (!state.managerSettings) {
      return `<div class="card"><h3 style="margin-top:0;">Manager approval by email</h3>
        <p>${escapeHtml(state.managerSettingsError || 'Manager email settings are unavailable.')}</p>
        <p class="mini">Other MyTMS settings remain available; no defaults have been substituted.</p></div>`;
    }
    const template = currentManagerTemplate();
    const origin = state.managerSettings.manager_origin || {};
    const linkMail = template?.include_link === true;
    return `<div class="card" data-mytms-manager-panel>
      <h3 style="margin-top:0;">Manager approval by email</h3>
      <p class="mini">Email wording is owned by this agency. The secure review address is platform-owned and read-only here.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
        <div><label for="mytms-manager-submission">Submission type</label><select class="input" id="mytms-manager-submission" data-manager-selector="submission">
          ${[['TIMESHEET','Timesheet'],['EXPENSE_CLAIM','Expense claim']].map(([v,l]) => `<option value="${v}" ${state.managerSubmissionType === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
        <div><label for="mytms-manager-kind">Message</label><select class="input" id="mytms-manager-kind" data-manager-selector="kind">
          ${['INITIAL','REMINDER','RENEWAL','WITHDRAWAL','CANCELLATION'].map(v => `<option value="${v}" ${state.managerMailKind === v ? 'selected' : ''}>${v[0]}${v.slice(1).toLowerCase()}</option>`).join('')}
        </select></div>
      </div>
      <div class="row"><label for="mytms-manager-subject">Subject</label><div class="controls"><input class="input" id="mytms-manager-subject" data-manager-field="subject" maxlength="240" value="${escapeHtml(template?.subject || '')}" /></div></div>
      <div class="row"><label>HTML template</label><div class="controls" style="min-width:0;">
        <div data-manager-toolbar style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
          <button type="button" class="btn mini" data-command="bold">Bold</button><button type="button" class="btn mini" data-command="italic">Italic</button><button type="button" class="btn mini" data-command="insertUnorderedList">List</button>
        </div>
        <div class="input" contenteditable="true" role="textbox" aria-multiline="true" data-manager-html style="min-height:180px;overflow:auto;background:#fff;color:#111;">${template?.body_html || ''}</div>
        <div class="mini">Links, images, scripts and unknown variables are blocked. The secure button and seven-day expiry wording are added by the server.</div>
      </div></div>
      <div class="row"><label for="mytms-manager-text">Plain-text fallback</label><div class="controls"><textarea class="input" id="mytms-manager-text" data-manager-field="body_text" rows="6" maxlength="20000">${escapeHtml(template?.body_text || '')}</textarea></div></div>
      <div class="row"><label for="mytms-manager-button">Button text</label><div class="controls"><input class="input" id="mytms-manager-button" data-manager-field="button_text" maxlength="80" value="${escapeHtml(template?.button_text || '')}" ${linkMail ? '' : 'disabled'} /><div class="mini">${linkMail ? 'The server attaches the secure link after sanitizing the template.' : 'Terminal messages contain no link or button.'}</div></div></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0;">
        <button type="button" class="btn" data-manager-preview>Preview sanitized email</button>
        <button type="button" class="btn" data-manager-reset>Reset all manager templates</button>
        <span class="mini">Agency version ${escapeHtml(state.managerSettings.agency_template_version)} · policy ${escapeHtml(state.managerSettings.agency_template_sanitizer_policy_version)}</span>
      </div>
      <iframe data-manager-preview-frame title="Manager email sanitized preview" sandbox="" style="display:none;width:100%;height:260px;border:1px solid var(--line);background:#fff;"></iframe>
      <hr style="border:0;border-top:1px solid var(--line);margin:18px 0;" />
      ${readOnlySetting('Secure manager review address', origin.public_origin || 'Not configured', `Platform-owned · ${origin.state || 'UNCONFIGURED'} · settings version ${origin.settings_version || '—'}`)}
    </div>`;
  }

  function homeAnnouncementPanel() {
    if (!state.homeAnnouncement) {
      return `<div class="card"><h3 style="margin-top:0;">Candidate Home announcement</h3>
        <p>${escapeHtml(state.homeAnnouncementError || 'The Home announcement could not be loaded.')}</p>
        <p class="mini">Other MyTMS settings remain available; no placeholder message has been substituted.</p></div>`;
    }
    const value = String(state.homeAnnouncement.announcement_text ?? '');
    return `<div class="card" data-mytms-home-panel>
      <h3 style="margin-top:0;">Candidate Home announcement</h3>
      <p class="mini">Show a short agency message on the Candidate Home screen. Leave it blank when no announcement is needed.</p>
      <div class="row"><label for="mytms-home-announcement">Announcement</label><div class="controls">
        <textarea class="input" id="mytms-home-announcement" data-mytms-home-announcement rows="5" maxlength="600" placeholder="For example: Christmas timesheets must be uploaded by 21 December.">${escapeHtml(value)}</textarea>
        <div class="mini"><span data-mytms-home-count>${value.length}</span>/600 characters · plain text only</div>
      </div></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0;">
        <button type="button" class="btn" data-mytms-home-preview>Preview on Candidate Home</button>
        <button type="button" class="btn" data-mytms-home-reset>Clear announcement</button>
        <span class="mini">Agency version ${escapeHtml(state.homeAnnouncement.version)}</span>
      </div>
      <div class="card" data-mytms-home-preview-output style="display:none;">
        <div class="mini" style="margin-bottom:6px;">Candidate Home preview</div>
        <div data-mytms-home-preview-text style="white-space:pre-wrap;"></div>
      </div>
    </div>`;
  }

  function directoryInput(kind, index, key, label, value, options = {}) {
    const id = `mytms-directory-${kind}-${index}-${key}`;
    const input = options.multiline
      ? `<textarea class="input" id="${escapeHtml(id)}" rows="${options.rows || 3}" maxlength="${options.maxlength}" data-mytms-directory-kind="${escapeHtml(kind)}" data-mytms-directory-index="${index}" data-mytms-directory-field="${escapeHtml(key)}" placeholder="${escapeHtml(options.placeholder || '')}">${escapeHtml(value || '')}</textarea>`
      : `<input class="input" id="${escapeHtml(id)}" maxlength="${options.maxlength}" data-mytms-directory-kind="${escapeHtml(kind)}" data-mytms-directory-index="${index}" data-mytms-directory-field="${escapeHtml(key)}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(options.placeholder || '')}" />`;
    return `<div class="mytms-directory-field${options.wide ? ' mytms-directory-field--wide' : ''}">
      <label for="${escapeHtml(id)}">${escapeHtml(label)}${options.required ? ' *' : ''}</label>${input}</div>`;
  }

  function directoryCard(kind, entry, index, total) {
    const hospital = kind === 'hospital_addresses';
    return `<article class="mytms-directory-card" data-mytms-directory-card="${escapeHtml(kind)}-${index}">
      <div class="mytms-directory-card__head">
        <div><span class="mytms-directory-card__eyebrow">${hospital ? 'Hospital' : 'Accommodation office'} ${index + 1}</span>
          <strong>${escapeHtml(text(entry.hospital_name) || (hospital ? 'New hospital' : 'New accommodation contact'))}</strong></div>
        <div class="mytms-directory-card__actions" aria-label="Reorder or remove this entry">
          <button type="button" class="btn mini" data-mytms-directory-action="up" data-kind="${kind}" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" class="btn mini" data-mytms-directory-action="down" data-kind="${kind}" data-index="${index}" ${index === total - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button type="button" class="btn mini mytms-directory-remove" data-mytms-directory-action="remove" data-kind="${kind}" data-index="${index}">Remove</button>
        </div>
      </div>
      <div class="mytms-directory-grid">
        ${directoryInput(kind, index, 'hospital_name', 'Hospital name', entry.hospital_name, { required: true, maxlength: 160 })}
        ${hospital ? '' : directoryInput(kind, index, 'office_name', 'Accommodation office', entry.office_name, { required: true, maxlength: 160 })}
        ${directoryInput(kind, index, 'address', 'Address', entry.address, { required: hospital, maxlength: 600, multiline: true, wide: true, placeholder: 'Include the postcode' })}
        ${directoryInput(kind, index, 'telephone', 'Telephone', entry.telephone, { maxlength: 40, placeholder: 'For example 020 7123 4567' })}
        ${hospital
          ? directoryInput(kind, index, 'map_query', 'Map search', entry.map_query, { maxlength: 600, multiline: true, wide: true, placeholder: 'Optional: a precise building or entrance for Maps' })
          : `${directoryInput(kind, index, 'email', 'Email', entry.email, { maxlength: 254 })}${directoryInput(kind, index, 'working_hours', 'Working hours', entry.working_hours, { maxlength: 240, multiline: true, wide: true, placeholder: 'For example Monday to Friday, 09:00–17:00' })}`}
      </div>
    </article>`;
  }

  function dailyInformationPanel() {
    if (!state.dailyInformation) return `<div class="card"><h3>Hospital addresses and accommodation contacts</h3>
      <p>${escapeHtml(state.dailyInformationError || 'Places and contacts could not be loaded.')}</p>
      <p class="mini">No placeholder information has been substituted.</p></div>`;
    const hospitals = state.dailyInformation.hospital_addresses || [];
    const accommodation = state.dailyInformation.accommodation_contacts || [];
    return `<div class="mytms-directory" data-mytms-directory-panel>
      <div class="card mytms-directory-intro"><div><span class="mytms-directory-card__eyebrow">Candidate DAILY</span>
        <h3>Hospital addresses and accommodation contacts</h3>
        <p>Maintain the practical information Candidates see in MyTMS. Telephone numbers open the phone app and addresses open the Candidate’s maps app.</p></div>
        <span class="mytms-directory-version">Version ${escapeHtml(state.dailyInformation.version)}</span></div>
      <section class="card mytms-directory-section"><div class="mytms-directory-section__head"><div><h3>Hospital addresses</h3><p>${hospitals.length ? `${hospitals.length} hospital${hospitals.length === 1 ? '' : 's'}` : 'No hospitals added yet'}</p></div>
        <button type="button" class="btn btn-primary" data-mytms-directory-add="hospital_addresses">Add hospital</button></div>
        <div class="mytms-directory-list">${hospitals.length ? hospitals.map((entry, index) => directoryCard('hospital_addresses', entry, index, hospitals.length)).join('') : '<div class="mytms-directory-empty">Add the first hospital to give Candidates clear directions and contact details.</div>'}</div></section>
      <section class="card mytms-directory-section"><div class="mytms-directory-section__head"><div><h3>Accommodation contacts</h3><p>${accommodation.length ? `${accommodation.length} office${accommodation.length === 1 ? '' : 's'}` : 'No accommodation offices added yet'}</p></div>
        <button type="button" class="btn btn-primary" data-mytms-directory-add="accommodation_contacts">Add accommodation office</button></div>
        <div class="mytms-directory-list">${accommodation.length ? accommodation.map((entry, index) => directoryCard('accommodation_contacts', entry, index, accommodation.length)).join('') : '<div class="mytms-directory-empty">Add an accommodation office when Candidates need local housing support.</div>'}</div></section>
      <p class="mytms-directory-note">Changes affect only these two Candidate information screens. They do not alter Rota, Timesheets, emergencies or manager approval.</p>
    </div>`;
  }

  function setSetting(name, value) {
    if (!state.settings || !name) return;
    if (['invitation_expiry_seconds', 'resend_minimum_seconds', 'maximum_resends'].includes(name)) {
      const number = Number(value);
      state.settings[name] = Number.isSafeInteger(number) ? number : value;
    } else {
      state.settings[name] = value;
    }
    try { global.dispatchEvent(new Event('modal-dirty')); } catch {}
  }

  function insertEditorText(editor, value) {
    editor.focus();
    try {
      if (global.document.queryCommandSupported?.('insertText')) {
        global.document.execCommand('insertText', false, value);
      } else {
        const selection = global.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (range) {
          range.deleteContents();
          range.insertNode(global.document.createTextNode(value));
          range.collapse(false);
        } else editor.append(global.document.createTextNode(value));
      }
    } catch { editor.append(global.document.createTextNode(value)); }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function preview(kind) {
    const editor = global.document.querySelector(`[data-mytms-html-editor="${kind}"]`);
    const frame = global.document.querySelector(`[data-mytms-preview-frame="${kind}"]`);
    if (!editor || !frame) return;
    const result = await settingsPreview(editor.innerHTML);
    state.previewByKind[kind] = result;
    frame.srcdoc = String(result.sanitized_html || '');
    frame.style.display = '';
    try { global.showModalHint?.('Sanitized preview refreshed.', 'ok'); } catch {}
  }

  function replaceManagerPanel() {
    const panel = global.document.querySelector('[data-mytms-manager-panel]');
    if (!panel) return;
    panel.outerHTML = managerEmailPanel();
    Promise.resolve().then(wireSettings);
  }

  function setManagerTemplateField(field, value) {
    const template = currentManagerTemplate();
    if (!template || !['subject', 'body_text', 'body_html', 'button_text'].includes(field)) return;
    template[field] = field === 'button_text' && template.include_link !== true ? null : value;
    try { global.dispatchEvent(new Event('modal-dirty')); } catch {}
  }

  async function previewManagerTemplate() {
    const template = currentManagerTemplate();
    const frame = global.document.querySelector('[data-manager-preview-frame]');
    if (!template || !frame) return;
    const result = await managerSettingsPreview(state.managerMailKind, template);
    frame.srcdoc = String(result.preview_html || '');
    frame.style.display = '';
    global.showModalHint?.('Sanitized manager email preview refreshed.', 'ok');
  }

  async function resetManagerTemplates() {
    if (!state.managerSettings) return;
    const confirmation = await global.openUiConfirmModal?.({
      title: 'Reset manager email templates?',
      message: 'All ten agency manager-email messages will be restored to the approved safe defaults. This does not send an email.',
      confirm_label: 'Reset templates', cancel_label: 'Keep current templates',
      kind: 'mytms-manager-template-reset'
    });
    if (confirmation !== true && confirmation?.confirmed !== true && confirmation?.ok !== true) return;
    const result = await api('/api/mytms/manager-email-settings/templates/reset', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: Number(state.managerSettings.agency_template_version),
        idempotency_key: uuid()
      })
    });
    state.managerSettings.agency_templates = result.templates;
    state.managerSettings.agency_template_version = Number(result.version);
    state.managerSettings.agency_template_semantic_sha256_hex = result.semantic_sha256_hex;
    replaceManagerPanel();
    global.showModalHint?.('Manager email templates reset to the approved defaults.', 'ok');
  }

  function replaceHomeAnnouncementPanel() {
    const panel = global.document.querySelector('[data-mytms-home-panel]');
    if (!panel) return;
    panel.outerHTML = homeAnnouncementPanel();
    Promise.resolve().then(wireSettings);
  }

  async function resetHomeAnnouncement() {
    if (!state.homeAnnouncement) return;
    const confirmation = await global.openUiConfirmModal?.({
      title: 'Clear the Candidate Home announcement?',
      message: 'The announcement will no longer appear on Candidate Home. This does not affect Rota, Timesheets or notifications.',
      confirm_label: 'Clear announcement', cancel_label: 'Keep announcement',
      kind: 'mytms-home-announcement-reset'
    });
    if (confirmation !== true && confirmation?.confirmed !== true && confirmation?.ok !== true) return;
    const result = await api('/api/mytms/home-announcement/reset', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: Number(state.homeAnnouncement.version), idempotency_key: uuid()
      })
    });
    state.homeAnnouncement = { ...result };
    replaceHomeAnnouncementPanel();
    global.showModalHint?.('Candidate Home announcement cleared.', 'ok');
  }

  function wireSettings() {
    const token = state.openToken;
    if (!token) return;
    global.document.querySelectorAll('[data-mytms-platform-readonly="1"]').forEach((element) => {
      element.readOnly = true;
      element.disabled = true;
    });
    global.document.querySelectorAll('[data-mytms-setting]').forEach((element) => {
      if (element.dataset.mytmsActivationReadonly === '1') {
        element.disabled = true;
        return;
      }
      if (element.__myTmsWired) return;
      element.__myTmsWired = true;
      const eventName = element.type === 'checkbox' ? 'change' : 'input';
      element.addEventListener(eventName, () => {
        setSetting(element.dataset.mytmsSetting, element.type === 'checkbox' ? element.checked : element.value);
      });
    });
    const allowlist = global.document.querySelector('[data-mytms-allowlist]');
    if (allowlist && !allowlist.__myTmsWired) {
      allowlist.__myTmsWired = true;
      allowlist.addEventListener('input', () => {
        state.settings.test_recipient_allowlist = String(allowlist.value || '')
          .split(/\r?\n|,/).map((value) => text(value).toLowerCase()).filter(Boolean);
        try { global.dispatchEvent(new Event('modal-dirty')); } catch {}
      });
    }
    global.document.querySelectorAll('[data-mytms-html-editor]').forEach((editor) => {
      if (editor.__myTmsWired) return;
      editor.__myTmsWired = true;
      editor.innerHTML = String(state.settings?.[editor.dataset.settingKey] || '');
      editor.addEventListener('input', () => setSetting(editor.dataset.settingKey, editor.innerHTML));
    });
    global.document.querySelectorAll('[data-mytms-toolbar]').forEach((toolbar) => {
      if (toolbar.__myTmsWired) return;
      toolbar.__myTmsWired = true;
      toolbar.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const editor = global.document.querySelector(
          `[data-mytms-html-editor="${toolbar.dataset.mytmsToolbar}"]`
        );
        if (!editor) return;
        if (button.dataset.token) insertEditorText(editor, button.dataset.token);
        else if (button.dataset.command) {
          editor.focus();
          try { global.document.execCommand(button.dataset.command, false, null); } catch {}
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
    global.document.querySelectorAll('[data-mytms-preview]').forEach((button) => {
      if (button.__myTmsWired) return;
      button.__myTmsWired = true;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await preview(button.dataset.mytmsPreview); }
        catch (error) { global.showModalHint?.(`Preview failed: ${text(error.message)}`, 'err'); }
        finally { button.disabled = false; }
      });
    });
    global.document.querySelectorAll('[data-manager-selector]').forEach((selector) => {
      if (selector.__myTmsWired) return;
      selector.__myTmsWired = true;
      selector.addEventListener('change', () => {
        if (selector.dataset.managerSelector === 'submission') state.managerSubmissionType = upper(selector.value);
        if (selector.dataset.managerSelector === 'kind') state.managerMailKind = upper(selector.value);
        replaceManagerPanel();
      });
    });
    global.document.querySelectorAll('[data-manager-field]').forEach((element) => {
      if (element.__myTmsWired) return;
      element.__myTmsWired = true;
      element.addEventListener('input', () => setManagerTemplateField(element.dataset.managerField, element.value));
    });
    const managerHtml = global.document.querySelector('[data-manager-html]');
    if (managerHtml && !managerHtml.__myTmsWired) {
      managerHtml.__myTmsWired = true;
      managerHtml.addEventListener('input', () => setManagerTemplateField('body_html', managerHtml.innerHTML));
    }
    const managerToolbar = global.document.querySelector('[data-manager-toolbar]');
    if (managerToolbar && !managerToolbar.__myTmsWired) {
      managerToolbar.__myTmsWired = true;
      managerToolbar.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button?.dataset.command || !managerHtml) return;
        managerHtml.focus();
        try { global.document.execCommand(button.dataset.command, false, null); } catch {}
        managerHtml.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const managerPreview = global.document.querySelector('[data-manager-preview]');
    if (managerPreview && !managerPreview.__myTmsWired) {
      managerPreview.__myTmsWired = true;
      managerPreview.addEventListener('click', async () => {
        managerPreview.disabled = true;
        try { await previewManagerTemplate(); }
        catch (error) { global.showModalHint?.(`Preview failed: ${text(error.message)}`, 'err'); }
        finally { managerPreview.disabled = false; }
      });
    }
    const managerReset = global.document.querySelector('[data-manager-reset]');
    if (managerReset && !managerReset.__myTmsWired) {
      managerReset.__myTmsWired = true;
      managerReset.addEventListener('click', async () => {
        managerReset.disabled = true;
        try { await resetManagerTemplates(); }
        catch (error) { global.showModalHint?.(`Reset failed: ${text(error.message)}`, 'err'); }
        finally { managerReset.disabled = false; }
      });
    }
    const homeInput = global.document.querySelector('[data-mytms-home-announcement]');
    if (homeInput && !homeInput.__myTmsWired) {
      homeInput.__myTmsWired = true;
      homeInput.addEventListener('input', () => {
        if (!state.homeAnnouncement) return;
        state.homeAnnouncement.announcement_text = String(homeInput.value ?? '');
        const count = global.document.querySelector('[data-mytms-home-count]');
        if (count) count.textContent = String(state.homeAnnouncement.announcement_text.length);
        try { global.dispatchEvent(new Event('modal-dirty')); } catch {}
      });
    }
    const homePreview = global.document.querySelector('[data-mytms-home-preview]');
    if (homePreview && !homePreview.__myTmsWired) {
      homePreview.__myTmsWired = true;
      homePreview.addEventListener('click', async () => {
        homePreview.disabled = true;
        try {
          const result = await homeAnnouncementPreview(state.homeAnnouncement?.announcement_text);
          const output = global.document.querySelector('[data-mytms-home-preview-output]');
          const previewText = global.document.querySelector('[data-mytms-home-preview-text]');
          if (previewText) previewText.textContent = result.announcement_text
            || 'No announcement will be shown.';
          if (output) output.style.display = '';
        } catch { global.showModalHint?.('The announcement could not be previewed. Check the wording and try again.', 'err'); }
        finally { homePreview.disabled = false; }
      });
    }
    const homeReset = global.document.querySelector('[data-mytms-home-reset]');
    if (homeReset && !homeReset.__myTmsWired) {
      homeReset.__myTmsWired = true;
      homeReset.addEventListener('click', async () => {
        homeReset.disabled = true;
        try { await resetHomeAnnouncement(); }
        catch { global.showModalHint?.('The announcement could not be cleared. Reload the settings and try again.', 'err'); }
        finally { homeReset.disabled = false; }
      });
    }
    global.document.querySelectorAll('[data-mytms-directory-field]').forEach((element) => {
      if (element.__myTmsWired) return;
      element.__myTmsWired = true;
      element.addEventListener('input', () => {
        const list = state.dailyInformation?.[element.dataset.mytmsDirectoryKind];
        const entry = list?.[Number(element.dataset.mytmsDirectoryIndex)];
        if (!entry) return;
        entry[element.dataset.mytmsDirectoryField] = String(element.value || '');
        try { global.dispatchEvent(new Event('modal-dirty')); } catch {}
      });
    });
    global.document.querySelectorAll('[data-mytms-directory-add]').forEach((button) => {
      if (button.__myTmsWired) return;
      button.__myTmsWired = true;
      button.addEventListener('click', () => {
        const kind = button.dataset.mytmsDirectoryAdd;
        const list = state.dailyInformation?.[kind];
        if (!Array.isArray(list)) return;
        list.push(kind === 'hospital_addresses'
          ? { hospital_name: '', address: '', telephone: '', map_query: '' }
          : { hospital_name: '', office_name: '', address: '', telephone: '', email: '', working_hours: '' });
        replaceDirectoryPanel();
        try { global.dispatchEvent(new Event('modal-dirty')); } catch {}
      });
    });
    global.document.querySelectorAll('[data-mytms-directory-action]').forEach((button) => {
      if (button.__myTmsWired) return;
      button.__myTmsWired = true;
      button.addEventListener('click', () => {
        const list = state.dailyInformation?.[button.dataset.kind];
        const index = Number(button.dataset.index);
        if (!Array.isArray(list) || !list[index]) return;
        if (button.dataset.mytmsDirectoryAction === 'remove') list.splice(index, 1);
        if (button.dataset.mytmsDirectoryAction === 'up' && index > 0) {
          [list[index - 1], list[index]] = [list[index], list[index - 1]];
        }
        if (button.dataset.mytmsDirectoryAction === 'down' && index < list.length - 1) {
          [list[index + 1], list[index]] = [list[index], list[index + 1]];
        }
        replaceDirectoryPanel();
        try { global.dispatchEvent(new Event('modal-dirty')); } catch {}
      });
    });
  }

  function replaceDirectoryPanel() {
    const panel = global.document.querySelector('[data-mytms-directory-panel]');
    if (!panel) return;
    panel.outerHTML = dailyInformationPanel();
    Promise.resolve().then(wireSettings);
  }

  async function openSettings() {
    if (typeof global.confirmDiscardChangesIfDirty === 'function'
        && !global.confirmDiscardChangesIfDirty()) return;
    try {
      const [settingsResult, managerResult, homeResult, dailyInformationResult] = await Promise.allSettled([
        settingsGet(), managerSettingsGet(), homeAnnouncementGet(), dailyInformationGet()
      ]);
      if (settingsResult.status !== 'fulfilled') throw settingsResult.reason;
      state.settings = settingsResult.value;
      state.managerSettings = managerResult.status === 'fulfilled' ? managerResult.value : null;
      state.managerSettingsError = managerResult.status === 'rejected'
        ? `Manager email settings could not be loaded (${text(managerResult.reason?.message)}).` : null;
      state.homeAnnouncement = homeResult.status === 'fulfilled' ? homeResult.value : null;
      state.homeAnnouncementError = homeResult.status === 'rejected'
        ? 'The Candidate Home announcement could not be loaded.' : null;
      state.dailyInformation = dailyInformationResult.status === 'fulfilled'
        ? dailyInformationResult.value : null;
      state.dailyInformationError = dailyInformationResult.status === 'rejected'
        ? 'Hospital addresses and accommodation contacts could not be loaded.' : null;
    } catch (error) {
      await global.openUiConfirmModal?.({
        title: 'MyTMS App Settings unavailable',
        message: `The disabled App Readiness configuration could not be loaded (${text(error.message)}).`,
        confirm_label: 'OK', hide_cancel: true, kind: 'mytms-settings-unavailable'
      });
      return;
    }
    state.openToken = `mytms-settings:${Date.now()}:${uuid()}`;
    global.showModal(
      'MyTMS App Settings',
      [
        { key: 'general', label: 'General' },
        { key: 'invitation', label: 'Invitation email' },
        { key: 'reminder', label: 'Access reminder' },
        { key: 'manager-email', label: 'Manager approval by email' },
        { key: 'home', label: 'Candidate Home' },
        { key: 'daily-information', label: 'Places & contacts' },
        { key: 'activation', label: 'Activation state' }
      ],
      (tabKey) => {
        const output = renderSettingsTab(tabKey);
        Promise.resolve().then(wireSettings);
        return output;
      },
      async () => {
        try {
          if (state.activeSettingsTab === 'manager-email') return await managerTemplatesSave();
          if (state.activeSettingsTab === 'home') return await homeAnnouncementSave();
          if (state.activeSettingsTab === 'daily-information') return await dailyInformationSave();
          return await settingsSave();
        }
        catch (error) {
          global.showModalHint?.(`MyTMS settings were not saved: ${text(error.message)}`, 'err');
          return { ok: false };
        }
      },
      false,
      () => { try { wireSettings(); } catch {} },
      {
        kind: 'mytms-app-settings', noParentGate: true, forceEdit: true,
        showSave: true, showApply: false, stayOpenOnSave: true,
        primaryLabel: 'Save', dirtyClosePolicy: 'confirm-discard-close',
        onDismiss: () => {
          state.openToken = null; state.previewByKind = Object.create(null);
          state.managerSettings = null; state.managerSettingsError = null;
          state.homeAnnouncement = null; state.homeAnnouncementError = null;
          state.dailyInformation = null; state.dailyInformationError = null;
        }
      }
    );
    setTimeout(wireSettings, 0);
  }

  function actionIntent(actionCode) {
    return ({
      INVITE_TO_MYTMS: 'INVITE',
      RESEND_INVITATION: 'RESEND',
      SEND_ACCESS_REMINDER: 'ACCESS_REMINDER'
    })[upper(actionCode)] || null;
  }

  function actionPresentation(actionCode) {
    return ({
      INVITE_TO_MYTMS: 'Send invitation',
      RESEND_INVITATION: 'Resend invitation',
      SEND_ACCESS_REMINDER: 'Send access reminder',
      ENABLE_MEMBERSHIP: 'Enable MyTMS access',
      CANCEL_INVITATION: 'Cancel invitation',
      CANCEL_PENDING_MEMBERSHIP: 'Cancel pending membership',
      REVOKE_MEMBERSHIP: 'Revoke MyTMS access'
    })[upper(actionCode)] || 'MyTMS action';
  }

  function candidateStatusPresentation(status = {}) {
    const state = upper(status.state);
    const delivery = upper(status.delivery_state);
    const reason = upper(status.reason_code || status.action?.disabled_reason_code);

    if (state === 'ACTIVE') return {
      label: 'MyTMS active', tone: 'success',
      copy: 'The Candidate’s MyTMS access is active.'
    };
    if (state === 'DISABLED') return {
      label: 'Access disabled', tone: 'warning',
      copy: 'The Candidate’s MyTMS access is currently disabled.'
    };
    if (state === 'REVOKED') return {
      label: 'Access revoked', tone: 'danger',
      copy: 'The Candidate’s MyTMS access has been revoked.'
    };
    if (state === 'NOT_INVITED') return {
      label: 'Not invited', tone: 'neutral',
      copy: 'This Candidate has not yet been invited to MyTMS.'
    };
    if (state === 'PENDING' && delivery === 'RESERVED') return {
      label: 'Preparing invitation', tone: 'info',
      copy: 'The Candidate’s invitation is being prepared.'
    };
    if (state === 'PENDING' && delivery === 'OUTBOX_ACCEPTED') return {
      label: 'Invitation queued', tone: 'info',
      copy: 'The invitation is queued for sending. Email-provider acceptance has not yet been confirmed.'
    };
    if (state === 'PENDING' && delivery === 'PROVIDER_ACCEPTED') return {
      label: 'Invitation sent', tone: 'success',
      copy: 'The email provider has accepted the invitation. Registration has not yet been completed.'
    };
    if (state === 'PENDING' && delivery === 'DELIVERY_UNCERTAIN') return {
      label: 'Delivery needs checking', tone: 'warning',
      copy: 'CloudTMS cannot currently confirm whether the email provider accepted the invitation.'
    };
    if (state === 'PENDING') return {
      label: 'Registration pending', tone: 'info',
      copy: 'The Candidate has not completed MyTMS registration yet.'
    };
    if (state === 'INELIGIBLE' && reason === 'CANDIDATE_INACTIVE') return {
      label: 'Candidate inactive', tone: 'warning',
      copy: 'Activate the Candidate record before sending a MyTMS invitation.'
    };
    if (state === 'INELIGIBLE' && reason === 'CANDIDATE_EMAIL_INVALID') return {
      label: 'Valid email required', tone: 'warning',
      copy: 'Add a valid email address before sending a MyTMS invitation.'
    };
    if (state === 'INELIGIBLE' && reason === 'CANDIDATE_NOT_FOUND') return {
      label: 'Status unavailable', tone: 'danger',
      copy: 'The Candidate record could not be matched to MyTMS.'
    };
    if (state === 'INELIGIBLE') return {
      label: 'Not eligible', tone: 'warning',
      copy: 'This Candidate is not currently eligible for MyTMS.'
    };
    return {
      label: 'Status unavailable', tone: 'neutral',
      copy: 'MyTMS status could not be confirmed.'
    };
  }

  function disabledReasonPresentation(status = {}, action = status.action || {}) {
    const reason = upper(action.disabled_reason_code || status.reason_code);
    return ({
      MYTMS_INVITATION_DELIVERY_DISABLED: 'Email invitations are currently unavailable.',
      MYTMS_MEMBERSHIP_ADMIN_DISABLED: 'Membership changes are currently unavailable.',
      NO_ACTION_AVAILABLE: 'No MyTMS action is currently available.',
      CANDIDATE_INACTIVE: 'Activate the Candidate record before sending an invitation.',
      CANDIDATE_EMAIL_INVALID: 'Add a valid email address before sending an invitation.',
      CANDIDATE_NOT_ELIGIBLE: 'This Candidate is not currently eligible for MyTMS.',
      CANDIDATE_NOT_FOUND: 'The Candidate record could not be matched to MyTMS.'
    })[reason] || '';
  }

  function invitationResultPresentation(result = {}, status = {}) {
    const code = upper(result.status);
    const reason = upper(result.reason_code);
    const actionCode = upper(status.action?.code);
    const candidateName = text(status.candidate_display_name) || 'The Candidate';
    const isAccessReminder = actionCode === 'SEND_ACCESS_REMINDER';
    const item = isAccessReminder ? 'MyTMS access reminder' : 'email invitation';
    if (code === 'OUTBOX_ACCEPTED') return {
      title: isAccessReminder ? 'Access reminder queued' : 'Invitation queued', tone: 'info',
      message: `${candidateName}’s ${item} has been queued for sending.`
    };
    if (code === 'PROVIDER_ACCEPTED') return {
      title: 'MyTMS action accepted', tone: 'success',
      message: `${candidateName} has been sent ${isAccessReminder ? 'a MyTMS access reminder' : 'an email invitation'}.`
    };
    if (code === 'DELIVERY_UNCERTAIN') return {
      title: 'Delivery needs checking', tone: 'warning',
      message: `CloudTMS cannot currently confirm whether ${candidateName}’s invitation was accepted by the email provider. Check the MyTMS status before trying again.`
    };
    if (code === 'ALREADY_CURRENT') return {
      title: isAccessReminder ? 'Access reminder already pending' : 'Invitation already pending', tone: 'info',
      message: `${candidateName} already has a current ${item}. No additional email was created.`
    };
    if (code === 'THROTTLED' && reason === 'RESEND_LIMIT') return {
      title: 'Resend limit reached', tone: 'warning',
      message: `The maximum number of invitation emails has been reached for ${candidateName}.`
    };
    if (code === 'THROTTLED') {
      const seconds = Math.max(0, Number(result.retry_after_seconds) || 0);
      const minutes = seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : 0;
      return {
        title: 'Please wait before resending', tone: 'warning',
        message: minutes > 0
          ? `The invitation cannot be resent yet. Try again in approximately ${minutes} minute${minutes === 1 ? '' : 's'}.`
          : 'The invitation cannot be resent yet. Check the MyTMS status before trying again.'
      };
    }
    if (code === 'DISABLED') return {
      title: 'Invitations unavailable', tone: 'warning',
      message: 'MyTMS email invitations are currently unavailable.'
    };
    if (code === 'NOT_ELIGIBLE' && reason === 'RECIPIENT_NOT_ALLOWLISTED') return {
      title: 'Recipient not permitted in TEST', tone: 'warning',
      message: 'This email address is not on the TEST recipient allowlist. No email was created.'
    };
    if (code === 'NOT_ELIGIBLE') return {
      title: 'Invitation unavailable', tone: 'warning',
      message: `${candidateName} is not currently eligible for a MyTMS invitation.`
    };
    if (code === 'CONFLICT') return {
      title: 'MyTMS account needs review', tone: 'danger',
      message: 'The Candidate details do not match the existing MyTMS account. No email was sent.'
    };
    return {
      title: 'MyTMS action could not be confirmed', tone: 'warning',
      message: 'CloudTMS could not confirm the outcome. Check the MyTMS status before trying again.'
    };
  }

  async function confirmAndSend(status, selectedActionOrContext = status?.action || {}, contextLabel = '') {
    const selectedAction = typeof selectedActionOrContext === 'string'
      ? status?.action || {} : selectedActionOrContext;
    if (typeof selectedActionOrContext === 'string') contextLabel = selectedActionOrContext;
    const actionCode = upper(selectedAction?.code);
    const intent = actionIntent(actionCode);
    const membershipAction = ['CANCEL_INVITATION','CANCEL_PENDING_MEMBERSHIP','REVOKE_MEMBERSHIP']
      .includes(actionCode);
    if ((!intent && !membershipAction) || selectedAction?.enabled !== true) {
      return { sent: false, reason: 'DISABLED' };
    }
    if (membershipAction && (!text(status.membership_id)
        || !Number.isSafeInteger(Number(status.membership_generation)))) {
      throw new Error('MYTMS_MEMBERSHIP_STATUS_INVALID');
    }
    const actionLabel = actionPresentation(selectedAction?.code);
    const current = candidateStatusPresentation(status);
    const consequence = ({
      CANCEL_INVITATION: 'The current invitation link will stop working. An email already queued or delivered cannot be recalled, but its link will be unusable.',
      CANCEL_PENDING_MEMBERSHIP: 'The pending agency membership will be cancelled and the Candidate will not be able to join from an earlier link.',
      REVOKE_MEMBERSHIP: 'The Candidate will immediately lose access to this agency. Their global MyTMS account and access to any other agency will remain unchanged.'
    })[actionCode] || 'Only this Candidate will be contacted. Repeating the action will not create a duplicate current invitation.';
    const confirmation = await global.openUiConfirmModal({
      title: actionLabel,
      message_html: `
        <div class="mytms-confirm-copy">
          ${contextLabel ? `<p>${escapeHtml(contextLabel)}</p>` : ''}
          <dl class="mytms-confirm-facts">
            <div><dt>Candidate</dt><dd>${escapeHtml(text(status.candidate_display_name) || '—')}</dd></div>
            <div><dt>Email</dt><dd>${escapeHtml(text(status.candidate_email) || '—')}</dd></div>
            <div><dt>Current status</dt><dd>${escapeHtml(current.label)}</dd></div>
          </dl>
          <p class="mytms-confirm-note">${escapeHtml(consequence)}</p>
        </div>`,
      confirm_label: actionLabel,
      cancel_label: 'Not now',
      kind: 'mytms-candidate-invitation-confirm'
    });
    if (!confirmation?.confirmed) return { sent: false, reason: 'DECLINED' };
    const result = membershipAction
      ? await api(`/api/mytms/memberships/${encodeURIComponent(status.membership_id)}/state`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidate_id: status.candidate_id,
          transition: 'REVOKE',
          expected_generation: Number(status.membership_generation),
          reason: actionCode,
          idempotency_key: uuid()
        })
      })
      : await api(`/api/mytms/candidates/${encodeURIComponent(status.candidate_id)}/invitations`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent,
          expected_settings_version: Number(status.settings_version),
          idempotency_key: uuid()
        })
      });
    const candidateName = text(status.candidate_display_name) || 'The Candidate';
    const presented = membershipAction ? {
      title: actionCode === 'REVOKE_MEMBERSHIP' ? 'MyTMS access revoked' : 'MyTMS invitation cancelled',
      tone: 'success',
      message: actionCode === 'REVOKE_MEMBERSHIP'
        ? `${candidateName} can no longer access this agency in MyTMS.`
        : `${candidateName}’s pending invitation and agency membership have been cancelled.`
    } : invitationResultPresentation(result, { ...status, action: selectedAction });
    await global.openUiConfirmModal({
      title: presented.title,
      message_html: `
        <div class="mytms-result mytms-result--${escapeHtml(presented.tone)}" role="status">
          <span class="mytms-result__icon" aria-hidden="true">${presented.tone === 'success' ? '✓' : presented.tone === 'danger' ? '!' : 'i'}</span>
          <p>${escapeHtml(presented.message)}</p>
        </div>`,
      confirm_label: 'Close', hide_cancel: true,
      kind: 'mytms-invitation-result'
    });
    return { sent: !membershipAction, changed: membershipAction, result };
  }

  function renderCandidateStatus(host, status) {
    const actions = Array.isArray(status.actions) && status.actions.length
      ? status.actions : status.action?.code && upper(status.action.code) !== 'NONE'
        ? [status.action] : [];
    const presented = candidateStatusPresentation(status);
    const anyActionEnabled = actions.some((action) => action.enabled === true);
    host.innerHTML = `
      <div data-mytms-candidate-card>
        <div class="ctms-section-head mytms-candidate-section__head">
          <div>
            <span class="ctms-section-eyebrow">MyTMS</span>
            <h3 class="ctms-section-title">Candidate app access</h3>
          </div>
          <span class="mytms-status-badge mytms-status-badge--${escapeHtml(presented.tone)}">${escapeHtml(presented.label)}</span>
        </div>
        <div class="mytms-candidate-section__body">
          <div class="mytms-candidate-section__copy">
            <p>${escapeHtml(presented.copy)}</p>
            ${anyActionEnabled || !actions.length ? '' : `<p class="mytms-candidate-section__reason">${escapeHtml(disabledReasonPresentation(status, actions[0]))}</p>`}
          </div>
          ${actions.length ? `<div class="mytms-candidate-section__actions">${actions.map((action, index) => {
            const membershipAction = ['CANCEL_INVITATION','CANCEL_PENDING_MEMBERSHIP','REVOKE_MEMBERSHIP']
              .includes(upper(action.code));
            const disabledReason = disabledReasonPresentation(status, action);
            return `<button type="button" class="btn mytms-candidate-section__action${membershipAction ? ' mytms-candidate-section__action--danger' : ''}" data-mytms-candidate-action="${index}"
                    ${action.enabled === true ? '' : 'disabled'}
                    ${disabledReason ? `title="${escapeHtml(disabledReason)}"` : ''}>${escapeHtml(actionPresentation(action.code))}</button>`;
          }).join('')}</div>` : ''}
        </div>
      </div>`;
    host.querySelectorAll('[data-mytms-candidate-action]').forEach((button) => {
      const action = actions[Number(button.dataset.mytmsCandidateAction)];
      if (!action || action.enabled !== true) return;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await confirmAndSend(status, action);
          const refreshed = await candidateStatus(status.candidate_id);
          renderCandidateStatus(host, refreshed);
        } catch (error) {
          global.showModalHint?.(`MyTMS action failed: ${text(error.message)}`, 'err');
          button.disabled = false;
        }
      });
    });
  }

  async function mountCandidateAction(candidate) {
    const candidateId = text(candidate?.id);
    const main = global.document.getElementById('tab-main');
    if (!candidateId || !main) return;
    let host = main.querySelector('[data-mytms-candidate-host]');
    if (!host) {
      host = global.document.createElement('div');
      host.dataset.mytmsCandidateHost = '1';
      host.className = 'ctms-section ctms-section-wide mytms-candidate-section';
      host.innerHTML = `
        <div class="ctms-section-head mytms-candidate-section__head">
          <div><span class="ctms-section-eyebrow">MyTMS</span><h3 class="ctms-section-title">Candidate app access</h3></div>
          <span class="mytms-status-badge mytms-status-badge--neutral">Checking status</span>
        </div>
        <div class="mytms-candidate-section__body"><p>Checking current MyTMS access…</p></div>`;
      main.appendChild(host);
    }
    try {
      const status = await candidateStatus(candidateId);
      if (!host.isConnected || text(global.modalCtx?.data?.id) !== candidateId) return;
      renderCandidateStatus(host, status);
    } catch (error) {
      if (host.isConnected) {
        host.innerHTML = `
          <div class="ctms-section-head mytms-candidate-section__head">
            <div><span class="ctms-section-eyebrow">MyTMS</span><h3 class="ctms-section-title">Candidate app access</h3></div>
            <span class="mytms-status-badge mytms-status-badge--warning">Status unavailable</span>
          </div>
          <div class="mytms-candidate-section__body"><p>MyTMS status is temporarily unavailable. Close and reopen this Candidate to try again.</p></div>`;
      }
    }
  }

  async function offerAfterContractSuccess(payload) {
    try {
      const contract = payload?.contract && typeof payload.contract === 'object'
        ? payload.contract : payload;
      const candidateId = text(contract?.candidate_id);
      if (!candidateId) return { offered: false, reason: 'CANDIDATE_ID_MISSING' };
      const status = await candidateStatus(candidateId);
      if (upper(status.state) !== 'NOT_INVITED'
          || upper(status.action?.code) !== 'INVITE_TO_MYTMS'
          || status.action?.enabled !== true) {
        return { offered: false, reason: 'NOT_ELIGIBLE' };
      }
      const result = await confirmAndSend(
        status,
        'The contract was saved successfully. Sending a MyTMS invitation is a separate action.'
      );
      return { offered: true, ...result };
    } catch (error) {
      try { global.showModalHint?.(`Contract saved. MyTMS invitation was not sent (${text(error.message)}).`, 'warn'); } catch {}
      return { offered: false, reason: 'FAILED' };
    }
  }

  global.CloudTMSMyTmsOffice = Object.freeze({
    openSettings,
    mountCandidateAction,
    offerAfterContractSuccess,
    candidateStatus,
    settingsGet
  });
})(window);
