// ===== Base URL + helpers =====
const BROKER_BASE_URL = window.BROKER_BASE_URL;
const API = (path)=> `${BROKER_BASE_URL}${path}`;

let SESSION = null;  // {accessToken, user, exp}
let refreshTimer = 0;

// Quick DOM helper
const byId = (id)=>document.getElementById(id);

// ===== Session handling =====
function saveSession(sess){
  SESSION = sess;
  const persist = document.getElementById('rememberMe')?.checked ?? true;
  const store = persist ? localStorage : sessionStorage;
  store.setItem('cloudtms.session', JSON.stringify(sess));
  if (persist) sessionStorage.removeItem('cloudtms.session');
  scheduleRefresh();
  renderUserChip();
}
function loadSession(){
  const raw = localStorage.getItem('cloudtms.session') || sessionStorage.getItem('cloudtms.session');
  if (!raw) return null;
  try { SESSION = JSON.parse(raw); return SESSION; } catch { return null; }
}
function clearSession(){
  localStorage.removeItem('cloudtms.session');
  sessionStorage.removeItem('cloudtms.session');
  SESSION = null; renderUserChip();
}
function scheduleRefresh(){
  clearTimeout(refreshTimer);
  if (!SESSION?.exp) return;
  const ms = Math.max(15_000, (SESSION.exp*1000) - Date.now() - 60_000);
  refreshTimer = setTimeout(refreshToken, ms);
}

// Unwrap list/envelope responses into arrays
async function toList(res) {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const j = await res.json();
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.items)) return j.items;
  if (Array.isArray(j.rows))  return j.rows;
  if (j.data && Array.isArray(j.data)) return j.data;
  return [];
}


// ===== Auth fetch with refresh retry =====
async function authFetch(input, init={}){
  const headers = new Headers(init.headers || {});
  if (SESSION?.accessToken) headers.set('Authorization', `Bearer ${SESSION.accessToken}`);
  let res = await fetch(input, { ...init, headers, credentials: init.credentials || 'omit' });
  if (res.status === 401) {
    const ok = await refreshToken();
    if (!ok) throw new Error('Unauthorised');
    headers.set('Authorization', `Bearer ${SESSION.accessToken}`);
    res = await fetch(input, { ...init, headers, credentials: init.credentials || 'omit' });
  }
  return res;
}

// ===== Auth API calls =====
async function apiLogin(email, password){
  const res = await fetch(API('/auth/login'), {
    method:'POST',
    headers:{'content-type':'application/json'},
    credentials: 'include',                // cookie for refresh
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error('Invalid credentials');
  const data = await res.json();
  const token = data.access_token || data.token || data.accessToken;
  const ttl   = data.expires_in || data.token_ttl_sec || data.ttl || 3600;
  saveSession({ accessToken: token, user: data.user || data.profile || null, exp: Math.floor(Date.now()/1000) + ttl });
  return data;
}
async function refreshToken(){
  try{
    const res = await fetch(API('/auth/refresh'), { method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body: JSON.stringify({}) });
    if (!res.ok) { clearSession(); return false; }
    const data = await res.json();
    const token = data.access_token || data.token || data.accessToken;
    const ttl = data.expires_in || data.token_ttl_sec || data.ttl || 3600;
    saveSession({ accessToken: token, user: SESSION?.user || data.user || null, exp: Math.floor(Date.now()/1000) + ttl });
    return true;
  }catch{ clearSession(); return false; }
}
async function apiForgot(email){
  const r = await fetch(API('/auth/forgot'), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email })});
  if(!r.ok) throw new Error('Failed to request reset');
  return true;
}
async function apiReset(token, newPassword){
  const r = await fetch(API('/auth/reset'), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token, new_password: newPassword })});
  if(!r.ok) throw new Error('Failed to reset password');
  return true;
}

// ===== Auth overlays wiring (login / forgot / reset) =====
function openLogin(){ byId('loginOverlay').style.display='grid'; byId('forgotOverlay').style.display='none'; byId('resetOverlay').style.display='none'; }
function openForgot(){ byId('loginOverlay').style.display='none'; byId('forgotOverlay').style.display='grid'; byId('resetOverlay').style.display='none'; }
function openReset(){ byId('loginOverlay').style.display='none'; byId('forgotOverlay').style.display='none'; byId('resetOverlay').style.display='grid'; }

// show/hide password helpers
function toggleVis(inputId, toggleId){
  const inp = byId(inputId), t = byId(toggleId);
  t.onclick = ()=>{ inp.type = inp.type==='password' ? 'text' : 'password'; };
}

function renderUserChip(){
  const chip = byId('userChip');
  if (SESSION?.user) {
    chip.textContent = (SESSION.user.display_name || SESSION.user.email || 'User');
  } else chip.textContent = 'Signed out';
}

function initAuthUI(){
  // Buttons and links
  byId('btnLogout').onclick = ()=>{ clearSession(); openLogin(); };

  toggleVis('loginPassword','toggleLoginPw');
  toggleVis('resetPw1','toggleResetPw1'); toggleVis('resetPw2','toggleResetPw2');

  byId('linkForgot').onclick = openForgot;
  byId('linkBackToLogin').onclick = openLogin;
  byId('linkResetToLogin').onclick = openLogin;

  byId('loginForm').onsubmit = async (e)=>{
    e.preventDefault();
    const email = byId('loginEmail').value.trim();
    const pw = byId('loginPassword').value;
    const err = byId('loginError'); err.style.display='none';
    try{
      await apiLogin(email, pw);
      byId('loginOverlay').style.display='none';
      bootstrapApp();
    }catch(ex){
      err.textContent = ex.message || 'Sign in failed'; err.style.display='block';
    }
  };

  byId('forgotForm').onsubmit = async (e)=>{
    e.preventDefault();
    const email = byId('forgotEmail').value.trim();
    byId('forgotError').style.display='none';
    byId('forgotMsg').style.display='none';
    try{
      await apiForgot(email);
      byId('forgotMsg').textContent = 'If that email exists, a reset link has been sent.'; byId('forgotMsg').style.display='block';
    }catch(ex){
      byId('forgotError').textContent = ex.message || 'Could not send reset email'; byId('forgotError').style.display='block';
    }
  };

  byId('resetForm').onsubmit = async (e)=>{
    e.preventDefault();
    const p1 = byId('resetPw1').value, p2 = byId('resetPw2').value;
    const err = byId('resetError'), ok = byId('resetMsg'); err.style.display='none'; ok.style.display='none';
    if (p1.length < 8) { err.textContent='Use at least 8 characters'; err.style.display='block'; return; }
    if (p1 !== p2) { err.textContent='Passwords do not match'; err.style.display='block'; return; }
    const url = new URL(location.href); const token = url.searchParams.get('k') || url.searchParams.get('token');
    if (!token){ err.textContent='Reset token missing. Use the email link again.'; err.style.display='block'; return; }
    try{
      await apiReset(token, p1);
      ok.textContent='Password updated. You can sign in now.'; ok.style.display='block';
    }catch(ex){
      err.textContent = ex.message || 'Reset failed'; err.style.display='block';
    }
  };

  // Open reset overlay automatically if URL carries a token
  const url = new URL(location.href);
  if (url.searchParams.get('k') || url.searchParams.get('token')) openReset();
}

// ===== App state + rendering =====
const sections = [
  {key:'candidates', label:'Candidates', icon:'👤'},
  {key:'clients', label:'Clients', icon:'🏥'},
  {key:'timesheets', label:'Timesheets', icon:'🗒️'},
  {key:'healthroster', label:'Healthroster', icon:'📅'},
  {key:'invoices', label:'Invoices', icon:'📄'},
  {key:'umbrellas', label:'Umbrellas', icon:'☂️'},
  {key:'settings', label:'Settings', icon:'⚙️'},
  {key:'audit', label:'Audit', icon:'🛡️'}
];
let currentSection = 'candidates';
let currentRows = [];
let currentSelection = null;

// =========================== renderTopNav (kept with reset) ===========================
function renderTopNav(){
  const nav = byId('nav'); nav.innerHTML = '';
  sections.forEach(s=>{
    const b = document.createElement('button');
    b.innerHTML = `<span class="ico">${s.icon}</span> ${s.label}`;
    if (s.key === currentSection) b.classList.add('active');
    b.onclick = ()=>{
      // keep the unsaved-changes prompt
      if (!confirmDiscardChangesIfDirty()) {
        console.debug('[NAV] blocked by dirty modal', { from: currentSection, to: s.key });
        return;
      }
      // always hard-reset modal state to avoid lingering listeners/state
      if ((window.__modalStack?.length || 0) > 0 || modalCtx?.entity) {
        console.debug('[NAV] tearing down modal state before switch', { from: currentSection, to: s.key });
        discardAllModalsAndState();
      }
      currentSection = s.key;
      currentRows = [];           // ensure no stale data flashes
      currentSelection = null;
      console.debug('[NAV] switched to section', currentSection);
      renderAll();
    };
    nav.appendChild(b);
  });
}


// NEW: advanced, section-aware search modal
// === UPDATED: Advanced Search — add Roles (any) multi-select, use UK date pickers ===
// -----------------------------
// Search presets FE cache (optional but handy)
// -----------------------------
const __PRESETS_CACHE__ = new Map(); // key = `${section}:${kind}|shared=${0/1}|q=...|p=..|ps=..`

function cacheKey(section, kind = 'search', opts = {}) {
  const shared = opts.include_shared ? 1 : 0;
  const q      = opts.q ? String(opts.q) : '';
  const page   = Number.isFinite(opts.page) ? opts.page : 1;
  const ps     = Number.isFinite(opts.page_size) ? opts.page_size : 100;
  return `${section || ''}:${kind || 'search'}|shared=${shared}|q=${q}|p=${page}|ps=${ps}`;
}

function invalidatePresetCache(section, kind = 'search', opts) {
  if (opts) {
    __PRESETS_CACHE__.delete(cacheKey(section, kind, opts));
    return;
  }
  // No opts provided: clear all variants for this (section,kind)
  const prefix = `${section || ''}:${kind || 'search'}|`;
  for (const key of __PRESETS_CACHE__.keys()) {
    if (key.startsWith(prefix)) __PRESETS_CACHE__.delete(key);
  }
}

function getPresetCache(section, kind = 'search', opts) {
  return __PRESETS_CACHE__.get(cacheKey(section, kind, opts)) || null;
}

function setPresetCache(section, kind, rows, opts) {
  __PRESETS_CACHE__.set(
    cacheKey(section, kind, opts),
    Array.isArray(rows) ? rows : []
  );
}
// Quick helper for ownership checks; adapt if you keep user in a different global
function currentUserId(){
  try {
    return (window.SESSION && window.SESSION.user && window.SESSION.user.id)
        || (window.__auth && window.__auth.user && window.__auth.user.id)
        || window.__USER_ID
        || null;
  } catch (_) {
    return null;
  }
}

// -----------------------------
// Preset API wrappers
// -----------------------------
async function listReportPresets({ section, kind = 'search', include_shared = true, q, page = 1, page_size = 100 } = {}) {
  const opts = { include_shared, q, page, page_size };
  const cached = getPresetCache(section, kind, opts);
  if (cached) return cached;

  const qs = new URLSearchParams();
  if (section) qs.set('section', section);
  if (kind) qs.set('kind', kind);
  if (include_shared) qs.set('include_shared', 'true');
  if (q) qs.set('q', q);
  qs.set('page', page);
  qs.set('page_size', page_size);

  const res = await authFetch(API(`/api/report-presets?${qs.toString()}`));
  const data = await res.json().catch(() => ({ rows: [] }));
  const rows = data && Array.isArray(data.rows) ? data.rows : [];
  setPresetCache(section, kind, rows, opts);
  return rows;
}
async function createReportPreset({ section, kind='search', name, filters, is_shared=false, is_default=false }) {
  const res = await authFetch(
    API(`/api/report-presets`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ section, kind, name, filters, is_shared, is_default })
    }
  );

  // Handle duplicate-name ergonomics (HTTP 409 from unique (user_id, section, kind, name))
  if (res.status === 409) {
    // Try to locate the conflicting preset so we can preselect it for overwrite mode
    let conflicting = null;
    try {
      const presets = await listReportPresets({ section, kind, include_shared: false, q: name, page: 1, page_size: 100 });
      const lower = String(name || '').toLowerCase();
      conflicting = (presets || []).find(p => String(p.name || '').toLowerCase() === lower) || null;
    } catch (_) {
      // ignore lookup failures; we can still switch the UI to overwrite mode without preselecting
    }

    // Attempt to switch the Save modal into "Overwrite" mode with the conflicting preset selected
    try {
      const form = document.getElementById('saveSearchForm');
      if (form) {
        const overwriteRadio = form.querySelector('input[name="mode"][value="overwrite"]');
        const overwriteRow   = form.querySelector('#overwriteRow');
        const selectEl       = form.querySelector('#overwritePresetId');

        if (overwriteRadio) overwriteRadio.checked = true;
        if (overwriteRow)   overwriteRow.style.display = ''; // reveal the dropdown

        if (selectEl && conflicting) {
          const hasOption = Array.from(selectEl.options).some(o => o.value === String(conflicting.id));
          if (!hasOption) {
            const opt = document.createElement('option');
            opt.value = String(conflicting.id);
            opt.textContent = conflicting.name || '(unnamed)';
            selectEl.appendChild(opt);
          }
          selectEl.value = String(conflicting.id);
        }
      }
    } catch (_) {
      // Non-fatal if DOM not available; caller will still receive a structured error below
    }

    // Throw a structured error so the caller (openSaveSearchModal/onSave) keeps the modal open
    const err = new Error('Preset name already exists. Switched to Overwrite—pick the preset and save again.');
    err.code = 'PRESET_NAME_CONFLICT';
    if (conflicting) err.preset = conflicting;
    err.section = section;
    err.kind = kind;
    throw err;
  }

  if (!res.ok) {
    // Other errors: propagate server message
    throw new Error(await res.text());
  }

  invalidatePresetCache(section, kind);
  const data = await res.json().catch(()=>({}));
  return data.row || null;
}


async function updateReportPreset({ id, name, filters, is_shared, is_default, section, kind }) {
  const patch = {};
  if (typeof name === 'string') patch.name = name;
  if (filters && typeof filters === 'object') patch.filters = filters;
  if (typeof is_shared === 'boolean') patch.is_shared = is_shared;
  if (typeof is_default === 'boolean') patch.is_default = is_default;
  if (typeof section === 'string') patch.section = section;
  if (typeof kind === 'string') patch.kind = kind;

  const res = await authFetch(
    API(`/api/report-presets/${encodeURIComponent(id)}`),
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    }
  );
  if (!res.ok) throw new Error(await res.text());
  // Invalidate caches for the effective section/kind; simplest: nuke all 'search' caches
  __PRESETS_CACHE__.clear();
  const data = await res.json().catch(()=>({}));
  return data.row || null;
}

async function deleteReportPreset(id) {
  const res = await authFetch(API(`/api/report-presets/${encodeURIComponent(id)}`), { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  __PRESETS_CACHE__.clear();
  const data = await res.json().catch(()=> ({}));
  return data.deleted_id || id;
}

// -----------------------------
// Search helpers
// -----------------------------
function extractFiltersFromForm(formSel='#searchForm'){
  const raw = collectForm(formSel, false);

  // Convert select[multiple] to array and booleans from "true"/"false"
  Object.keys(raw).forEach(k=>{
    const el = document.querySelector(`${formSel} [name="${k}"]`);
    if (!el) return;
    if (el.tagName==='SELECT' && el.multiple){
      raw[k] = Array.from(el.selectedOptions).map(o=>o.value);
    }
    if (el.tagName==='SELECT' && (el.value === 'true' || el.value === 'false')){
      raw[k] = (el.value === 'true');
    }
    if (el.type === 'number' && raw[k] === '') raw[k] = null;
    if (raw[k] === '') delete raw[k];
  });

  // Convert UK dates → ISO (backend expects ISO)
  ['created_from','created_to','worked_from','worked_to','week_ending_from','week_ending_to','issued_from','issued_to','due_from','due_to']
    .forEach(f => {
      if (raw[f]) {
        const iso = parseUkDateToIso(raw[f]);
        if (iso) raw[f] = iso;
      }
    });

  return raw;
}

function populateSearchFormFromFilters(filters={}, formSel='#searchForm'){
  const form = document.querySelector(formSel);
  if (!form) return;

  for (const [k,v] of Object.entries(filters || {})) {
    const el = form.querySelector(`[name="${k}"]`);
    if (!el) continue;

    if (Array.isArray(v) && el.tagName === 'SELECT' && el.multiple) {
      const values = new Set(v.map(String));
      Array.from(el.options).forEach(opt => { opt.selected = values.has(opt.value); });
      continue;
    }

    if (typeof v === 'boolean' && el.tagName === 'SELECT') {
      el.value = v ? 'true' : 'false';
      continue;
    }

    // Dates: try to present as UK DD/MM/YYYY for text inputs we later parse
    const isDateField = ['created_from','created_to','worked_from','worked_to','week_ending_from','week_ending_to','issued_from','issued_to','due_from','due_to'].includes(k);
    if (isDateField && typeof v === 'string') {
      const uk = (typeof formatIsoToUk === 'function') ? formatIsoToUk(v) : v;
      el.value = uk || '';
      continue;
    }

    // Default
    el.value = (v == null ? '' : String(v));
  }
}

// Build querystring per section
function buildSearchQS(section, filters={}){
  const qs = new URLSearchParams();
  const add = (key, val) => { if (val==null || val==='') return; qs.append(key, String(val)); };
  const addArr = (key, arr) => { if (!Array.isArray(arr)) return; arr.forEach(v => { if (v!=null && v!=='') qs.append(key, String(v)); }); };

  switch (section) {
    case 'candidates': {
      const { first_name,last_name,email,phone,pay_method,roles_any,active,created_from,created_to } = filters;
      add('first_name', first_name);
      add('last_name',  last_name);
      add('email',      email);
      add('phone',      phone);
      add('pay_method', pay_method);
      if (typeof active === 'boolean') add('active', active);
      add('created_from', created_from);
      add('created_to',   created_to);
      addArr('roles_any', roles_any);
      break;
    }
    case 'clients': {
      const { name, cli_ref, primary_invoice_email, ap_phone, vat_chargeable, created_from, created_to } = filters;
      if (name) add('q', name);       // backend uses q for name ilike
      add('cli_ref', cli_ref);
      add('primary_invoice_email', primary_invoice_email);
      add('ap_phone', ap_phone);
      if (typeof vat_chargeable === 'boolean') add('vat_chargeable', vat_chargeable);
      add('created_from', created_from);
      add('created_to',   created_to);
      break;
    }
    case 'umbrellas': {
      const { name, bank_name, sort_code, account_number, vat_chargeable, enabled, created_from, created_to } = filters;
      if (name) add('q', name);
      add('bank_name', bank_name);
      add('sort_code', sort_code);
      add('account_number', account_number);
      if (typeof vat_chargeable === 'boolean') add('vat_chargeable', vat_chargeable);
      if (typeof enabled === 'boolean') add('enabled', enabled);
      add('created_from', created_from);
      add('created_to',   created_to);
      break;
    }
    case 'timesheets': {
      const { booking_id, occupant_key_norm, hospital_norm, worked_from, worked_to, week_ending_from, week_ending_to, status, created_from, created_to } = filters;
      add('booking_id', booking_id);
      add('occupant_key_norm', occupant_key_norm);
      add('hospital_norm', hospital_norm);
      add('worked_from', worked_from);
      add('worked_to',   worked_to);
      add('week_ending_from', week_ending_from);
      add('week_ending_to',   week_ending_to);
      addArr('status', status);
      add('created_from', created_from);
      add('created_to',   created_to);
      break;
    }
    case 'invoices': {
      const { invoice_no, client_id, status, issued_from, issued_to, due_from, due_to, created_from, created_to } = filters;
      add('invoice_no',  invoice_no);   // backend supports invoice_no (and/or q)
      add('client_id',   client_id);
      addArr('status',   status);
      add('issued_from', issued_from);
      add('issued_to',   issued_to);
      add('due_from',    due_from);
      add('due_to',      due_to);
      add('created_from', created_from);
      add('created_to',   created_to);
      break;
    }
  }
  return qs.toString();
}

// -----------------------------
// UPDATED: search()
// -----------------------------
async function search(section, filters={}){
  const map = {
    candidates:'/api/search/candidates',
    clients:'/api/search/clients',
    umbrellas:'/api/search/umbrellas',
    timesheets:'/api/search/timesheets',
    invoices:'/api/search/invoices'
  };
  const p = map[section]; if (!p) return [];
  const qs = buildSearchQS(section, filters);
  const url = qs ? `${p}?${qs}` : p;
  const r = await authFetch(API(url));
  return toList(r);
}

// -----------------------------
// NEW: Save search modal (new / overwrite / shared)
// -----------------------------
async function openSaveSearchModal(section, filters){
  const myId  = currentWorked || currentUserId(); // if you expose a current user helper
  const mine  = await listReportPresets({ section, kind: 'search', include_shared: false });

  const options = (mine || []).map(m => `<option value="${m.id}">${sanitize(m.name)}</option>`).join('');

  const body = html(`
    <div class="form" id="saveSearchForm">
      <div class="row">
        <label for="presetName">Preset name</label>
        <div class="controls">
          <input id="presetName" name="preset_name" class="input" placeholder="e.g. ‘PAYE RMNs’" />
        </div>
      </div>

      <div class="row">
        <label>Mode</label>
        <div class="controls flex items-center gap-3">
          <label class="inline"><input type="radio" name="mode" value="new" checked> <span>Save as new</span></label>
          <label class="inline"><input type="radio" name="mode" value="overwrite"> <span>Overwrite existing</span></label>
        </div>
      </div>

      <div class="row" id="overwriteRow" style="display:none">
        <label for="overwritePresetId">Choose preset</label>
        <div class="controls">
          <select id="overwritePresetId" class="select">${options}</select>
        </div>
      </div>

      <div class="row">
        <label for="presetShared">Visibility</label>
        <div class="controls">
          <label class="inline"><input id="presetShared" type="checkbox"> <span>Visible to all users</span></label>
        </div>
      </div>

      <div class="hint">Only your own presets can be overwritten. Shared presets remain yours unless you delete them.</div>
    </div>
  `);

  // Use showModal; it will label the primary as “Save”
  showModal('Save search', [{ key: 'form', title: 'Details' }], () => body, async () => {
    const form  = collectForms('#saveSearchForm', false); // use your helper; ensure it returns { preset_name, mode, ... }
    const mode  = (form.mode || 'new').toLowerCase();
    const name  = String(form.preset_name || '').trim();
    const share = !!byId('presetShared')?.checked;

    if (!name && mode === 'new') { alert('Please enter a name'); return false; }

    try {
      if (mode === 'overwrite') {
        const targetId = (byId('overwritePresetId') && byId('overwritePresetId').value) || '';
        if (!targetId) { alert('Select a preset to overwrite'); return false; }
        await updateReportPresets({ id: targetId, name: name || undefined, filters, is_shared: share });
      } else {
        await createReportPreset({ section, kind: 'search', name, filters, is_shared: share });
      }
      invalidateReport(section, 'search');
      try { window.dispatchEvent(new Event('search-preset-updated')); } catch(_) {}
      return true; // close the save modal
    } catch (err) {
      // If backend returns 409 (duplicate name), switch to overwrite mode instead of closing
      const msg = (err && err.message) ? String(err.message) : 'Unable to save preset';
      if (/409|already exists|duplicate/i.test(msg)) {
        // auto-switch to overwrite mode to be helpful
        const overwriteRadio = Array.from(document.querySelectorAll('#saveSearch')).find(i => i.value === 'overwrite');
        if (overwriteRadio) { overwriteRadio.checked = true; }
        alert('A preset with that name already exists. Switched to “Overwrite existing”. Choose the preset to overwrite or change the name.');
        return false;
      }
      alert(msg);
      return false;
    }
  }, false);

  // Idempotent wiring for the radio toggle
  setTimeout(() => {
    const formEl = byId('saveSearchForm');
    if (!formEl || formEl.dataset.wired === '1') return;
    formEl.dataset.wired = '1';
    const modeRadios = formEl.querySelectorAll('input[name="mode"]');
    const overwriteRow = byId('overwriteRow');
    modeRadios.forEach(r => r.addEventListener('change', () => {
      overwriteRow.style.display = (r.value === 'overwrite' && r.checked) ? '' : 'none';
    }));
  }, 0);
}

// -----------------------------
// NEW: Load saved search modal (with staged delete/edit apply)
// -----------------------------
async function openLoadSearchModal(section){
  const myId = currentUserId();
  let list = await listReportPresets({ section, kind: 'search', include_shared: true });
  let selectedId = null;
  const ctx = { stagedDeletes: new Set(), stagedEdits: {} };

  const renderList = () => {
    const rowsHtml = (list || []).map(p => {
      const owned    = p.user_id === myId;
      const isDeleting = ctx.stagedDeletes.has(p.id);
      const nameHtml = `<span class="name"${isDeleting ? ' style="text-decoration:line-through;opacity:.6"' : ''}>${sanitize(p.name)}</span>`;
      const badge    = p.is_shared ? `<span class="badge">shared</span>` : '';
      const trashBtn = `<button class="bin btn btn-ghost btn-sm" ${owned ? '' : 'disabled'} title="${owned ? 'Delete' : 'Not yours'}">🗑</button>`;
      return `
        <tr data-id="${p.id}">
          <td class="pick">${nameHtml} ${badge}</td>
          <td>${new Date(p.updated_at || p.created_at).toLocaleString()}</td>
          <td class="actions">${trashBtn}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="3" class="hint">No saved searches</td></tr>`;

    return html(`
      <div class="form">
        <div class="row" style="justify-content:space-between;align-items:center">
          <strong>Saved searches</strong>
          <span class="hint">Section: <code>${sanitize(section)}</code></span>
        </div>
        <div class="row">
          <table class="grid compact" id="presetTable">
            <thead><tr><th>Name</th><th>Updated</th><th></th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `);
  };

  showModal('Load saved search', [{ key: 'list', title: 'Saved' }], renderList, async () => {
    if (!selectedId) { alert('Pick a preset to load'); return false; }
    const chosen = (list || []).find(p => p.id === selectedId);
    if (!chosen) { alert('Preset not found'); return false; }
    populateSearchFormFromFilters(chosen.filters_json, '#searchForm');
    return true; // close this child only
  }, false);

  setTimeout(() => {
    const tbl = document.getElementById('presetTable');
    if (tbl && !tbl.__wired) {
      tbl.__wired = true;
      tbl.addEventListener('click', (e) => {
        const tr = e.target && e.target.closest('tr[data-id]');
        if (!tr) return;
        const id  = tr.getAttribute('data-id');
        const bin = e.target && e.target.closest('button.bin');

        if (bin) {
          const row = (list || []).find(p => p.id === id);
          if (!row || row.user_id !== myId) return;
          if (ctx.stagedDeletes.has(id)) ctx.stagedDeletes.delete(id); else ctx.stagedDeletes.add(id);
          // re-render body only; don’t re-append footer buttons
          const body = document.getElementById('modalBody');
          if (body) body.replaceChildren(renderList());
          // toggle secondary “Save changes” visibility
          const secondary = document.getElementById('btnSavePresetChanges');
          if (secondary) {
            const hasChanges = ctx.stagedDeletes.size > 0 || Object.keys(ctx.stagedEdits).length > 0;
            secondary.style.display = hasChanges ? '' : 'none';
            secondary.disabled = !hasChanges;
          }
          return;
        }

        // selection
        selectedId = id;
        Array.from(tbl.querySelectorAll('tbody tr'))
          .forEach(r => r.classList.toggle('selected', r.getAttribute('id') === id));
      });
    }

    // Ensure a single “Save changes” button is present and wired
    const primary = byId('btnSave');
    if (primary && !byId('btnSavePresetChanges')) {
      const aux = document.createElement('button');
      aux.id = 'btnSavePresetChanges';
      aux.textContent = 'Save changes';
      aux.className = 'btn btn-outline btn-sm';
      aux.style.marginLeft = '.5rem';
      aux.style.display = 'none';
      aux.onclick = async () => {
        if (!ctx.stillMine && !ctx.stagedDeletes.size && !Object.keys(ctx.stagedEdits).length) return;
        for (const id of ctx.stagedDeletes) {
          const row = (list || []).find(p => p.id === id);
          if (!row || row.user_id !== myId) continue;
          try { await deleteReportPresets(id); } catch (e) { alert(String(e)); return; }
        }
        ctx.stagedDeletes.clear();
        invalidateReport(section, 'search');
        list = await listReportPresets({ section, kind:'search', include_shared:true });
        const body = document.getElementById('modalBody');
        if (body) body.replaceChildren(renderList());
        const btn = byId('btnSavePresetChanges');
        if (btn) { btn.style.display = 'none'; btn.disabled = true; }
      };
      primary.parentElement.appendChild(aux);
    }
  }, 0);
}



// -----------------------------
// UPDATED: openSearchModal()
// - Fix search submit path (object filters, not JSON string)
// - Provide inline Save/Load buttons that open child modals
// -----------------------------
// -----------------------------
// FIXED: openSearchModal()
// - No undefined variables
// - Uses attachUkDatePicker + extractFiltersFromForm
// - Section-aware fields that match buildSearchQS()
// -----------------------------
async function openSearchModal(opts = {}) {
  // Keep your existing status vocab (timesheets) and add invoice statuses
  const TIMESHEET_STATUS = ['ERROR','RECEIVED','REVOKED','STORED','SAT','SUN','BH'];
  const INVOICE_STATUS   = ['DRAFT','ISSUED','ON_HOLD','PAID'];

  // Small, local HTML helpers (no external deps)
  const row = (label, inner) => `
    <div class="row">
      <label>${label}</label>
      <div class="controls">${inner}</div>
    </div>`;

  const inputText = (name, placeholder='') =>
    `<input class="input" type="text" name="${name}" placeholder="${placeholder}" />`;

  const boolSelect = (name) => `
    <select name="${name}">
      <option value="">Any</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>`;

  const datePair = (fromName, fromLabel, toName, toLabel) => `
    ${row(fromLabel, `<input class="input" type="text" name="${fromName}" placeholder="DD/MM/YYYY" />`)}
    ${row(toLabel,   `<input class="input" type="text" name="${toName}"   placeholder="DD/MM/YYYY" />`)}`;

  const multi = (name, values) =>
    `<select name="${name}" multiple size="6">${values.map(v=>`<option value="${v}">${v}</option>`).join('')}</select>`;

  // Build section-specific form body
  let inner = '';

  if (currentSection === 'candidates') {
    // Roles are taken from client-default windows; load once here
    let roleOptions = [];
    try { roleOptions = await loadGlobalRoleOptions(); } catch { roleOptions = []; }

    inner = [
      row('First name',           inputText('first_name')),
      row('Last name',            inputText('last_name')),
      row('Email',                `<input class="input" type="email" name="email" placeholder="name@domain" />`),
      row('Telephone',            inputText('phone')),
      row('Pay method', `
        <select name="pay_method">
          <option value="">Any</option>
          <option value="PAYE">PAYE</option>
          <option value="UMBRELLA">UMBRELLA</option>
        </select>
      `),
      row('Roles (any)',          `<select name="roles_any" multiple size="6">${roleOptions.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>`),
      row('Active',               boolSelect('active')),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  }

  else if (currentSection === 'clients') {
    inner = [
      row('Client name',          inputText('name', 'partial match')),
      row('Client Ref',           inputText('cli_ref')),
      row('Primary invoice email',`<input class="input" type="email" name="primary_invoice_email" placeholder="ap@client" />`),
      row('A/P phone',            inputText('ap_phone')),
      row('VAT chargeable',       boolSelect('vat_chargeable')),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  }

  else if (currentSection === 'umbrellas') {
    inner = [
      row('Name',                 inputText('name')),
      row('Bank',                 inputText('bank_name')),
      row('Sort code',            inputText('sort_code', '12-34-56')),
      row('Account number',       inputText('account_number')),
      row('VAT chargeable',       boolSelect('vat_chargeable')),
      row('Enabled',              boolSelect('enabled')),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  }

  else if (currentSection === 'timesheets') {
    inner = [
      row('Booking ID',           inputText('booking_id')),
      row('Candidate key',        inputText('occupant_key_norm', 'candidate_id / key_norm')),
      row('Hospital',             inputText('hospital_norm')),
      datePair('worked_from','Worked from (date)','worked_to','Worked to (date)'),
      datePair('week_ending_from','Week ending from','week_ending_to','Week ending to'),
      row('Status',               multi('status', TIMESHEET_STATUS)),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  }

  else if (currentSection === 'invoices') {
    inner = [
      row('Invoice no',           inputText('invoice_no')),
      row('Client ID',            inputText('client_id', 'UUID')),
      row('Status',               multi('status', INVOICE_STATUS)),
      datePair('issued_from','Issued from','issued_to','Issued to'),
      datePair('due_from','Due from','due_to','Due to'),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  }

  else {
    inner = `<div class="tabc">No filters for this section.</div>`;
  }

  // Wrap the form with Save/Load buttons
  const form = html(`
    <div class="form" id="searchForm">
      <div class="row" style="justify-content:flex-end; gap:.5rem; margin-bottom:.5rem">
        <button id="btnLoadSavedSearch" type="button" class="btn btn-ghost btn-sm">Load saved search…</button>
        <button id="btnSaveSearch"      type="button" class="btn btn-primary btn-sm">Save search</button>
      </div>
      ${inner}
    </div>
  `);

  // Show the modal; primary button runs the search
  showModal(
    'Advanced Search',
    [{ key: 'filter', title: 'Filters' }],
    () => form,
    async () => {
      const filters = extractFiltersFromForm('#searchForm'); // UK→ISO conversion happens here
      const rows    = await search(currentSection, filters);
      if (rows) renderSummary(rows);
      return true; // close modal
    },
    false
  );

  // After mount: wire date pickers and Save/Load actions
  setTimeout(() => {
    // Attach UK date pickers to all DD/MM/YYYY inputs
    document
      .querySelectorAll('#searchForm input[placeholder="DD/MM/YYYY"]')
      .forEach(el => attachUkDatePicker(el));

    const saveBtn = document.getElementById('btnSaveSearch');
    const loadBtn = document.getElementById('btnLoadSavedSearch');

    if (saveBtn) saveBtn.onclick = async () => {
      const filters = extractFiltersFromForm('#searchForm');
      await openSaveSearchModal(currentSection, filters);
    };

    if (loadBtn) loadBtn.onclick = async () => {
      await openLoadSearchModal(currentSection);
    };
  }, 0);
}

// Small helper to render Advanced Search with proper labels and idempotent wiring
function showOpenSearchModalWithForm(form, opts = {}) {
  showModal('Advanced Search', [{ key: 'filter', title: 'Filters' }], () => form, async () => {
    const filters = extractFiltersFromForm('#searchForm');
    const rows = await search(currentSection, filters);
    if (rows) renderSummary(rows);
    return true; // close after search
  }, false);

  // Bind controls once per open
  setTimeout(() => {
    document.querySelectorAll('#searchForm input[placeholder="DD/MM/YYYY"]').forEach(attachOption);
    const saveBtn  = byId('btnSaveSearch');
    const loadBtn  = byId('btnLoadSavedSearch');
    if (saveBtn) saveBtn.onclick = async () => {
      const filters = extractFiltersFromNew('#searchForm', false);
      await openSaveSearchModal(currentSection, filters);
    };
    if (loadBtn) loadBtn.onclick = async () => {
      await openLoadSearchModal(currentSection);
    };
  }, 0);
}

// Small helper to render Advanced Search with proper labels and idempotent wiring
function showOpenSearchModalWithForm(form, opts = {}) {
  showModal('Advanced Search', [{ key: 'filter', title: 'Filters' }], () => form, async () => {
    const filters = extractFiltersFromForm('#searchForm');
    const rows = await search(currentSection, filters);
    if (rows) renderSummary(rows);
    return true; // close after search
  }, false);

  // Bind controls once per open
  setTimeout(() => {
    document.querySelectorAll('#searchForm input[placeholder="DD/MM/YYYY"]').forEach(attachOption);
    const saveBtn  = byId('btnSaveSearch');
    const loadBtn  = byId('btnLoadSavedSearch');
    if (saveBtn) saveBtn.onclick = async () => {
      const filters = extractFiltersFromNew('#searchForm', false);
      await openSaveSearchModal(currentSection, filters);
    };
    if (loadBtn) loadBtn.onclick = async () => {
      await openLoadSearchModal(currentSection);
    };
  }, 0);
}

// -----------------------------
// UPDATED: renderTools()
// - Keep Search…, add “Saved searches…” shortcut that opens Search modal pre-focused on loading presets
// -----------------------------
function renderTools(){
  const el = byId('toolButtons');
  const canCreate = ['candidates','clients','umbrellas'].includes(currentSection);
  const canEdit = ['candidates','clients','umbrellas','settings'].includes(currentSection);
  const canDelete = ['candidates','clients','umbrellas'].includes(currentSection);

  el.innerHTML = '';
  const addBtn = (txt, cb)=>{ const b=document.createElement('button'); b.textContent = txt; b.onclick=cb; el.appendChild(b); };

  addBtn('Create New Record', ()=> openCreate());
  addBtn('Edit Record',   ()=> openEdit());
  addBtn('Delete Record', ()=> openDelete());
  addBtn('Search…',       ()=> openSearchModal()); // 🔧 removed "Saved searches…" per brief

  if (!canCreate) el.children[0].classList.add('btn');
  if (!canEdit)   el.children[1].classList.add('btn');
  if (!canDelete) el.children[2].classList.add('btn');
}

// ===================== NEW HELPERS (UI + data) =====================

// Cache for global roles
// Cache for global roles
let __GLOBAL_ROLE_CODES_CACHE__ = null;
let __GLOBAL_ROLE_CODES_CACHE_TS__ = 0;
function invalidateGlobalRoleOptionsCache(){
  __GLOBAL_ROLE_CODES_CACHE__ = null;
  __GLOBAL_ROLE_CODES_CACHE_TS__ = 0;
}

// Load and dedupe all role codes from client defaults across all clients
async function loadGlobalRoleOptions(){
  const now = Date.now();
  if (__GLOBAL_ROLE_CODES_CACHE__ && (now - __GLOBAL_ROLE_CODES_CACHE_TS__ < 60_000)) {
    return __GLOBAL_ROLE_CODES_CACHE__;
  }
  const list = await listClientRates().catch(() => []);  // unified windows; no rate_type
  const set = new Set();
  (list || []).forEach(r => { if (r && r.role) set.add(String(r.role)); });
  const arr = [...set].sort((a,b)=> a.localeCompare(b)); // <-- fixed
  __GLOBAL_ROLE_CODES_CACHE__ = arr;
  __GLOBAL_ROLE_CODES_CACHE_TS__ = now;
  return arr;
}


// Render roles editor into a container; updates modalCtx.rolesState
function renderRolesEditor(container, rolesState, allRoleOptions){
  // Local, mutable copy of available options so we can refresh after adds/removes
  let roleOptions = Array.isArray(allRoleOptions) ? allRoleOptions.slice() : [];

  // Helper: mark the current modal as dirty and notify UI to update the Discard/Close label
  function markDirty() {
    try {
      const stack = window.__modalStack || [];
      const top = stack[stack.length - 1];
      if (top) top.isDirty = true;
      try { window.dispatchEvent(new CustomEvent('modal-dirty')); }
      catch { try { window.dispatchEvent(new Event('modal-dirty')); } catch(_) {} }
    } catch (_) {}
  }

  container.innerHTML = `
    <div class="roles-editor">
      <div class="roles-add">
        <select id="rolesAddSelect">
          <option value="">Add role…</option>
          ${roleOptions.map(code => `<option value="${code}">${code}</option>`).join('')}
        </select>
        <button id="rolesAddBtn" type="button">Add</button>
      </div>
      <ul id="rolesList" class="roles-list"></ul>
    </div>
  `;

  const sel = container.querySelector('#rolesAddSelect');
  const btn = container.querySelector('#rolesAddBtn');
  const ul  = container.querySelector('#rolesList');

  const byCode = (code) => (rolesState || []).find(r => String(r.code) === String(code));

  function availableOptions(){
    const picked = new Set((rolesState||[]).map(x => x.code));
    return roleOptions.filter(code => !picked.has(code));
  }

  function refreshAddSelect(){
    const opts = ['<option value="">Add role…</option>']
      .concat(availableOptions().map(code => `<option value="${code}">${code}</option>`))
      .join('');
    sel.innerHTML = opts;
  }

  function renderList(){
    ul.innerHTML = '';
    // Always render in current rank order
    const arr = (rolesState||[]).slice().sort((a,b)=> (a.rank||0) - (b.rank||0));

    arr.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'role-item';
      li.draggable = true;
      li.dataset.index = String(idx);

      li.innerHTML = `
        <span class="drag" title="Drag to reorder" style="cursor:grab">⋮⋮</span>
        <span class="rank">${idx+1}.</span>
        <span class="code">${item.code}</span>
        <input class="label" type="text" placeholder="Optional label…" value="${item.label || ''}" />
        <button class="remove" type="button" title="Remove">✕</button>
      `;

      // Remove by identity (code), not by stale index
      li.querySelector('.remove').onclick = () => {
        rolesState = (rolesState || []).filter(r => r.code !== item.code);
        // Re-rank 1..N
        rolesState.forEach((r,i)=> r.rank = i+1);
        rolesState = normaliseRolesForSave(rolesState);
        modalCtx.rolesState = rolesState;
        markDirty();                 // ← mark dirty on remove
        renderList(); refreshAddSelect();
      };

      // Label edits by identity (this already triggers input/change and will mark dirty via modal tracker)
      li.querySelector('.label').oninput = (e) => {
        const rec = byCode(item.code);
        if (rec) rec.label = e.target.value;
        modalCtx.rolesState = rolesState;
        // no explicit markDirty() needed; _attachDirtyTracker handles input/change
      };

      // Drag payload
      li.addEventListener('dragstart', (e) => {
        const from = li.dataset.index || String(idx);
        try { e.dataTransfer.setData('text/x-role-index', from); } catch {}
        try { e.dataTransfer.setData('text/plain', from); } catch {}
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        ul.querySelectorAll('.over').forEach(n => n.classList.remove('over'));
      });

      ul.appendChild(li);
    });
  }

  // Delegate DnD: highlight target & allow drop
  ul.addEventListener('dragover', (e) => {
    e.preventDefault();
    const overLi = e.target && e.target.closest('li.role-item');
    ul.querySelectorAll('.over').forEach(n => n.classList.remove('over'));
    if (overLi) overLi.classList.add('over');
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });

  ul.addEventListener('drop', (e) => {
    e.preventDefault();
    const toLi = e.target && e.target.closest('li.role-item');
    if (!toLi) return;

    // Read source index; support custom & plain types
    let from = NaN;
    try { from = parseInt(e.dataTransfer.getData('text/x-role-index'), 10); } catch {}
    if (isNaN(from)) {
      try { from = parseInt(e.dataTransfer.getData('text/plain'), 10); } catch {}
    }
    const to = parseInt(toLi.dataset.index, 10);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;

    // Reorder against current rank-sorted view
    const view = (rolesState||[]).slice().sort((a,b)=> (a.rank||0) - (b.rank||0));
    const [moved] = view.splice(from, 1);
    view.splice(to, 0, moved);

    // Rewrite ranks to new order before normalising
    view.forEach((r,i)=> r.rank = i+1);

    // Normalise (dedupe/tidy) without losing the new order
    rolesState = normaliseRolesForSave(view);
    modalCtx.rolesState = rolesState;

    markDirty();                     // ← mark dirty on reorder
    renderList();
    refreshAddSelect();
  });

  // Add role
  btn.onclick = () => {
    const code = sel.value;
    if (!code) return;
    if ((rolesState||[]).some(r => r.code === code)) return; // no duplicates
    const nextRank = ((rolesState||[]).length || 0) + 1;
    rolesState = [...(rolesState||[]), { code, rank: nextRank }];
    rolesState = normaliseRolesForSave(rolesState);
    modalCtx.rolesState = rolesState;
    markDirty();                     // ← mark dirty on add
    renderList(); refreshAddSelect();
  };

  // Expose a tiny API for refreshing options live
  container.__rolesEditor = {
    updateOptions(newOptions){
      roleOptions = Array.isArray(newOptions) ? newRoleOptions = newOptions.slice() : [];
      refreshAddSelect();
    }
  };

  // Initial paint
  refreshAddSelect();
  renderList();
}


// Drop dups (by code), sort by rank, rewrite rank 1..N
function normaliseRolesForSave(roles){
  const out = [];
  const seen = new Set();
  (Array.isArray(roles) ? roles : []).forEach(r => {
    const code = String(r.code || '').trim();
    if (!code) return;
    if (seen.has(code)) return;
    seen.add(code);
    out.push({ code, rank: Number(r.rank) || 0, label: r.label ? String(r.label) : undefined });
  });
  out.sort((a,b)=> a.rank - b.rank);
  out.forEach((r,i)=> r.rank = i+1);
  return out;
}

async function listClientHospitals(clientId){
  if (!clientId) return [];
  const r = await authFetch(API(`/api/clients/${clientId}/hospitals`));
  return toList(r);
}


function formatRolesSummary(roles){
  if (!Array.isArray(roles) || !roles.length) return '';
  const sorted = roles.slice().sort((a,b)=> (a.rank||0)-(b.rank||0));
  return sorted.map(r => `${ordinal(r.rank)} ${r.code}`).join(', ');
}

function ordinal(n){
  const s = ["th","st","nd","rd"], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

// Basic clients list for dropdowns (id + name)
async function listClientsBasic(){
  const r = await authFetch(API('/api/clients'));
  const rows = await r.json().catch(()=>({items:[]}));
  const list = Array.isArray(rows?.items) ? rows.items : (Array.isArray(rows) ? rows : []);
  return list.map(x => ({ id: x.id, name: x.name })).filter(x => x.id && x.name);
}

// ===== UK date helpers & lightweight picker =====

function formatIsoToUk(iso){ // 'YYYY-MM-DD' -> 'DD/MM/YYYY'
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function parseUkDateToIso(ddmmyyyy){ // 'DD/MM/YYYY' -> 'YYYY-MM-DD' or null
  if (!ddmmyyyy || typeof ddmmyyyy !== 'string') return null;
  const m = ddmmyyyy.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1],10), mo=parseInt(m[2],10), y=parseInt(m[3],10);
  if (mo<1||mo>12||d<1||d>31||y<1900||y>3000) return null;
  const dt = new Date(Date.UTC(y, mo-1, d));
  if (dt.getUTCFullYear()!==y || (dt.getUTCMonth()+1)!==mo || dt.getUTCDate()!==d) return null; // invalid date like 31/02
  const mm = String(mo).padStart(2,'0'), dd = String(d).padStart(2,'0');
  return `${y}-${mm}-${dd}`;
}

// Minimal calendar that sits above modals; ESC / outside closes; keyboard nav supported
function attachUkDatePicker(inputEl){
  if (!inputEl) return;
  inputEl.setAttribute('autocomplete','off');

  let portal, current;

  function openPicker(){
    closePicker();
    // Parse current value if present
    let today = new Date();
    if (inputEl.value) {
      const iso = parseUkDateToIso(inputEl.value);
      if (iso) {
        const [y,m,d] = iso.split('-').map(Number);
        today = new Date(Date.UTC(y, m-1, d));
      }
    }
    current = { year: today.getUTCFullYear(), month: today.getUTCMonth() }; // 0-based

    portal = document.createElement('div');
    portal.className = 'uk-datepicker-portal';
    portal.style.position = 'fixed';
    portal.style.zIndex = '99999';
    portal.style.background = '#fff';
    portal.style.border = '1px solid #ccc';
    portal.style.borderRadius = '8px';
    portal.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
    portal.style.padding = '8px';

    positionPortal();

    portal.innerHTML = renderCalendarHtml(current.year, current.month, inputEl.value);
    document.body.appendChild(portal);

    portal.addEventListener('click', onPortalClick);
    window.addEventListener('resize', positionPortal);
    document.addEventListener('keydown', onKeyDown, true);
    setTimeout(()=> document.addEventListener('click', onOutside, true), 0);
  }

  function positionPortal(){
    const r = inputEl.getBoundingClientRect();
    portal.style.left = `${Math.max(8, r.left)}px`;
    portal.style.top  = `${Math.max(8, r.top + window.scrollY + r.height + 6)}px`;
  }

  function closePicker(){
    if (!portal) return;
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', positionPortal);
    portal.removeEventListener('click', onPortalClick);
    portal.remove();
    portal = null;
  }

  function onOutside(e){
    if (portal && !portal.contains(e.target) && e.target !== inputEl) closePicker();
  }

  function onKeyDown(e){
    if (!portal) return;
    if (e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
  }

  function onPortalClick(e){
    const t = e.target;
    if (t.matches('.nav-prev')) { e.preventDefault(); navMonth(-1); }
    if (t.matches('.nav-next')) { e.preventDefault(); navMonth(+1); }
    const dayBtn = t.closest('button.day');
    if (dayBtn) {
      const y = Number(dayBtn.dataset.y), m = Number(dayBtn.dataset.m), d = Number(dayBtn.dataset.d);
      const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      inputEl.value = formatIsoToUk(iso);
      closePicker();
      inputEl.dispatchEvent(new Event('change'));
    }
  }

  function navMonth(delta){
    current.month += delta;
    if (current.month < 0) { current.month = 11; current.year--; }
    if (current.month > 11){ current.month = 0;  current.year++; }
    portal.innerHTML = renderCalendarHtml(current.year, current.month, inputEl.value);
  }

  function renderCalendarHtml(year, month0, selectedUk){
    const selectedIso = parseUkDateToIso(selectedUk || '') || '';
    const sel = selectedIso ? selectedIso.split('-').map(Number) : null;

    const first = new Date(Date.UTC(year, month0, 1));
    const startDow = first.getUTCDay(); // 0=Sun
    const daysInMonth = new Date(Date.UTC(year, month0+1, 0)).getUTCDate();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    let grid = '<div class="cal-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      `<a href="#" class="nav-prev" aria-label="Previous month">‹</a>` +
      `<div class="title" style="font-weight:600">${monthNames[month0]} ${year}</div>` +
      `<a href="#" class="nav-next" aria-label="Next month">›</a>` +
      '</div>';

    grid += `<div class="cal-grid" style="display:grid;grid-template-columns:repeat(7,2em);gap:2px;justify-items:center;align-items:center">`;
    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => grid += `<div style="font-size:12px;color:#666">${d}</div>`);

    // leading blanks
    for (let i=0;i<startDow;i++) grid += `<div></div>`;
    for (let d=1; d<=daysInMonth; d++){
      const iso = `${year}-${String(month0+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isSel = sel && sel[0]===year && (sel[1]-1)===month0 && sel[2]===d;
      grid += `<button type="button" class="day${isSel?' selected':''}" data-y="${year}" data-m="${month0}" data-d="${d}"` +
              ` style="width:2em;height:2em;border:1px solid #ddd;border-radius:4px;background:${isSel?'#eef':'#fff'}">${d}</button>`;
    }
    grid += `</div>`;
    return grid;
  }

  inputEl.addEventListener('focus', openPicker);
  inputEl.addEventListener('click', openPicker);
}



function defaultColumnsFor(section){
  const ls = localStorage.getItem('cloudtms.cols.'+section);
  if (ls) try { return JSON.parse(ls); } catch{}
  switch(section){
    case 'candidates': return ['last_name','first_name','phone','role','postcode','email'];
    case 'clients': return ['name','primary_invoice_email','invoice_address','postcode','ap_phone'];
    case 'umbrellas': return ['name','vat_chargeable','bank_name','sort_code','account_number','enabled'];
    case 'audit': return ['type','to','subject','status','created_at_utc','last_error'];
    default: return ['id'];
  }
}
function headersFromRows(rows){
  if (!rows.length) return [];
  const keys = new Set(Object.keys(rows[0]));
  rows.forEach(r=> Object.keys(r).forEach(k=> keys.add(k)));
  return [...keys];
}

/* ===== UK date/time formatter helpers (display only) =====
   - Date-only 'YYYY-MM-DD' -> 'DD/MM/YYYY'
   - UTC timestamps -> 'DD/MM/YYYY HHMMhrs' (Europe/London, no seconds)
*/
function formatUkDate(isoDateStr){
  if (!isoDateStr || typeof isoDateStr !== 'string') return isoDateStr;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDateStr);
  if (!m) return isoDateStr;
  const [,y,mo,d] = m;
  return `${d}/${mo}/${y}`;
}
function formatUkTimestampFromUtc(isoLike){
  if (!isoLike) return isoLike;
  const dt = new Date(isoLike); // parse ISO / ISO-like (+00:00, with ms) to JS Date
  if (isNaN(dt.getTime())) return isoLike;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false
  });
  const parts = fmt.formatToParts(dt);
  const g = (type)=> (parts.find(p=>p.type===type)?.value || '');
  const dd = g('day'), mm = g('month'), yyyy = g('year');
  const hh = g('hour'), mi = g('minute');
  return `${dd}/${mm}/${yyyy} ${hh}${mi}hrs`;
}
function formatDisplayValue(key, val){
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';

  if (typeof val === 'string'){
    // date-only?
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return formatUkDate(val);
    // ISO-ish timestamp?
    if (/\d{4}-\d{2}-\d{2}T/.test(val))  return formatUkTimestampFromUtc(val);
  }

  // Heuristic by column name
  if (typeof key === 'string' && (
      key.endsWith('_at_utc') ||
      key === 'created_at' || key === 'updated_at' ||
      key.endsWith('_timestamp') || key.endsWith('_utc')
    )){
    return formatUkTimestampFromUtc(val);
  }

  return String(val);
}

// === UPDATED: Summary renders role summary for candidates (computed from JSON) ===
function renderSummary(rows){
  currentRows = rows;
  currentSelection = null;

  const cols = defaultColumnsFor(currentSection);
  byId('title').textContent = sections.find(s=>s.key===currentSection)?.label || '';
  const content = byId('content'); content.innerHTML = '';

  if (currentSection === 'settings') return renderSettingsPanel(content);
  if (currentSection === 'audit')    return renderAuditTable(content, rows);

  if (currentSection === 'candidates') {
    rows.forEach(r => {
      r.role = (r && Array.isArray(r.roles)) ? formatRolesSummary(r.roles) : '';
    });
  }

  const tbl = document.createElement('table'); tbl.className='grid';
  const thead = document.createElement('thead'); const trh=document.createElement('tr');
  cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; trh.appendChild(th); });
  thead.appendChild(trh); tbl.appendChild(thead);

  const tb = document.createElement('tbody');

  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.dataset.id = (r && r.id) ? String(r.id) : '';
    tr.dataset.section = currentSection;

    cols.forEach(c=>{
      const td=document.createElement('td');
      const v = r[c];
      td.textContent = formatDisplayValue(c, v);
      tr.appendChild(td);
    });

    tb.appendChild(tr);
  });

  tb.addEventListener('click', (ev) => {
    const tr = ev.target && ev.target.closest('tr');
    if (!tr) return;
    tb.querySelectorAll('tr.selected').forEach(n => n.classList.remove('selected'));
    tr.classList.add('selected');
    const id = tr.dataset.id;
    currentSelection = currentRows.find(x => String(x.id) === id) || null;
    console.debug('[GRID] click select', { section: currentSection, id, found: !!currentSelection });
  });

  tb.addEventListener('dblclick', (ev) => {
    const tr = ev.target && ev.target.closest('tr');
    if (!tr) return;
    if (!confirmDiscardChangesIfDirty()) return;

    tb.querySelectorAll('tr.selected').forEach(n => n.classList.remove('selected'));
    tr.classList.add('selected');

    const id = tr.dataset.id;
    const row = currentRows.find(x => String(x.id) === id) || null;
    console.debug('[GRID] dblclick open', { section: currentSection, id, found: !!row });

    if (!row) return;

    const beforeDepth = (window.__modalStack && window.__modalStack.length) || 0;
    openDetails(row);

    setTimeout(() => {
      const afterDepth = (window.__modalStack && window.__modalStack.length) || 0;
      if (afterDepth > beforeDepth) {
        tb.querySelectorAll('tr.selected').forEach(n => n.classList.remove('selected'));
        console.debug('[GRID] modal opened for', id);
      }
    }, 0);
  });

  tbl.appendChild(tb);
  content.appendChild(tbl);
}


function renderAuditTable(content, rows){
  const cols = defaultColumnsFor('audit');
  const tbl = document.createElement('table'); tbl.className='grid';
  const thead = document.createElement('thead'); const trh=document.createElement('tr');
  cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; trh.appendChild(th); });
  thead.appendChild(trh); tbl.appendChild(thead);
  const tb = document.createElement('tbody');
  rows.forEach(r=>{
    const tr=document.createElement('tr'); tr.ondblclick=()=> openAuditItem(r);
    cols.forEach(c=>{
      const td=document.createElement('td');
      let v=r[c];
      if (c==='status') td.innerHTML = `<span class="pill ${v==='SENT'?'tag-ok':v==='FAILED'?'tag-fail':'tag-warn'}">${v}</span>`;
      else td.textContent = formatDisplayValue(c, v);
      tr.appendChild(td);
    }); tb.appendChild(tr);
  }); tbl.appendChild(tb); content.appendChild(tbl);
}

// Column manager
byId('btnColumns').onclick = ()=>{
  const cols = headersFromRows(currentRows);
  const cur = new Set(defaultColumnsFor(currentSection));
  const dlg = document.createElement('div'); dlg.className='auth-card'; dlg.style.position='fixed'; dlg.style.right='16px'; dlg.style.bottom='16px';
  dlg.innerHTML = `<div class="auth-h"><div class="ttl">Columns</div></div>`;
  const wrap = document.createElement('div'); wrap.className='auth-f';
  cols.forEach(k=>{
    const id='col_'+k;
    const row=document.createElement('div'); row.className='row';
    row.innerHTML = `<label><input type="checkbox" ${cur.has(k)?'checked':''} id="${id}" /> ${k}</label>`;
    wrap.appendChild(row);
  });
  const act=document.createElement('div'); act.className='actions';
  const closeBtn=document.createElement('button'); closeBtn.textContent='Close'; closeBtn.onclick=()=>dlg.remove();
  const saveBtn=document.createElement('button'); saveBtn.className='primary'; saveBtn.textContent='Save';
  saveBtn.onclick=()=>{
    const selected = Array.from(wrap.querySelectorAll('input[type=checkbox]')).filter(x=>x.checked).map(x=>x.id.replace('col_',''));
    localStorage.setItem('cloudtms.cols.'+currentSection, JSON.stringify(selected));
    dlg.remove(); renderSummary(currentRows);
  };
  act.append(closeBtn, saveBtn); wrap.appendChild(act); dlg.appendChild(wrap); document.body.appendChild(dlg);
};

// ===== Data fetchers =====
async function listCandidates(){ const r = await authFetch(API('/api/candidates')); return toList(r); }
async function listClients(){   const r = await authFetch(API('/api/clients'));   return toList(r); }

async function listUmbrellas(){
  const r = await authFetch(API('/api/umbrellas'));
  return toList(r);
}


async function listOutbox(){    const r = await authFetch(API('/api/email/outbox')); return toList(r); }
// ===================== API WRAPPERS (UPDATED) =====================

// GET /api/rates/client-defaults with optional filters:
//   clientId (path param), opts: { rate_type, role, band, active_on }
// Note: charge is shared; rate_type filter is optional and used by UI lists.
// ✅ UPDATED — unified FE model; grouping raw per-type rows into unified windows
//    Returned shape: [{ client_id, role, band|null, date_from, date_to|null,
//                       charge_day..bh, paye_day..bh, umb_day..bh }]
async function listClientRates(clientId, opts = {}) {
  const qp = new URLSearchParams();
  if (clientId) qp.set('client_id', clientId);
  if (opts.role) qp.set('role', String(opts.role));
  if (opts.band !== undefined && opts.band !== null && `${opts.band}` !== '') {
    qp.set('band', String(opts.band));
  }
  if (opts.active_on) qp.set('active_on', String(opts.active_on)); // YYYY-MM-DD

  // Backend returns unified rows (paye_*, umb_*, charge_*) — no rate_type
  const qs = qp.toString() ? `?${qp.toString()}` : '';
  const res = await authFetch(API(`/api/rates/client-defaults${qs}`));
  const rows = await toList(res);
  return Array.isArray(rows) ? rows : [];
}



// POST /api/rates/client-defaults — requires rate_type = 'PAYE' | 'UMBRELLA'

// POST /api/rates/candidate-overrides — requires rate_type
async function addCandidateRate(payload) {
  const rt = String(payload?.rate_type || '').toUpperCase();
  if (rt !== 'PAYE' && rt !== 'UMBRELLA') throw new Error("rate_type must be 'PAYE' or 'UMBRELLA'");
  const r = await authFetch(API('/api/rates/candidate-overrides'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, rate_type: rt })
  });
  return r.ok;
}
// ✅ UPDATED — FE accepts a unified window payload; bridges to current per-type backend
//    Posts TWO rows: PAYE (pay from paye_*), UMBRELLA (pay from umb_*), both with same charge set
async function upsertClientRate(payload) {
  if (!payload || !payload.client_id || !payload.role || !payload.date_from) {
    throw new Error('upsertClientRate: client_id, role and date_from are required');
  }

  // Single unified payload: one window with 5× charge + 5× PAYE + 5× UMBRELLA
  const body = {
    client_id : String(payload.client_id),
    role      : String(payload.role),
    band      : payload.band ?? null,
    date_from : payload.date_from,
    date_to   : payload.date_to ?? null,

    // charge (five-way)
    charge_day   : payload.charge_day   ?? null,
    charge_night : payload.charge_night ?? null,
    charge_sat   : payload.charge_sat   ?? null,
    charge_sun   : payload.charge_sun   ?? null,
    charge_bh    : payload.charge_bh    ?? null,

    // PAYE pay (five-way)
    paye_day     : payload.paye_day     ?? null,
    paye_night   : payload.paye_night   ?? null,
    paye_sat     : payload.paye_sat     ?? null,
    paye_sun     : payload.paye_sun     ?? null,
    paye_bh      : payload.paye_bh      ?? null,

    // Umbrella pay (five-way)
    umb_day      : payload.umb_day      ?? null,
    umb_night    : payload.umb_night    ?? null,
    umb_sat      : payload.umb_sat      ?? null,
    umb_sun      : payload.umb_sun      ?? null,
    umb_bh       : payload.umb_bh       ?? null
  };

  const res = await authFetch(
    API(`/api/rates/client-defaults`),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => 'Failed to upsert client default window');
    throw new Error(msg);
  }
  return res.json().catch(() => ({}));
}


// Small helper: cached settings (for ERNI%)
// Falls back to 0 if missing; returns { erni_pct: number (e.g. 0.15), ... }
let __SETTINGS_CACHE__ = null;
async function getSettingsCached() {
  if (__SETTINGS_CACHE__) return __SETTINGS_CACHE__;
  try {
    const s = await getSettings();
    __SETTINGS_CACHE__ = s || {};
  } catch {
    __SETTINGS_CACHE__ = {};
  }
  return __SETTINGS_CACHE__;
}

// Small helper: pick best shared charge row for {client_id, role, band, active_on}
// Uses backend’s selection logic via filters; no rate_type filter here (shared).
// ✅ UPDATED — works against unified rows returned by listClientRates()
//    Picks exact band first, then band-null; newest start date wins
async function findBestChargeFor({ client_id, role, band, active_on }) {
  const rows = await listClientRates(client_id, { role, band: undefined, active_on });
  if (!Array.isArray(rows) || !rows.length) return null;

  const ranked = rows
    .filter(r => r.role === role && r.date_from && r.date_from <= (active_on || '9999-12-31') && (!r.date_to || r.date_to >= (active_on || '0000-01-01')))
    .sort((a,b) => {
      const aExact = (String(a.band||'') === String(band||''));
      const bExact = (String(b.band||'') === String(band||''));
      if (aExact !== bExact) return aExact ? -1 : 1;          // exact band before band-null
      // newer start first
      return (a.date_from < b.date_from) ? 1 : (a.date_from > b.date_from ? -1 : 0);
    });

  const best = ranked[0] || rows[0];
  return best ? {
    charge_day  : best.charge_day  ?? null,
    charge_night: best.charge_night?? null,
    charge_sat  : best.charge_sat  ?? null,
    charge_sun  : best.charge_sun  ?? null,
    charge_bh   : best.charge_bh   ?? null
  } : null;
}


// Small helper: per-bucket margin
function calcMargin(charge, pay, rate_type, erni_pct = 0) {
  if (charge == null || pay == null) return null;
  const rt = String(rate_type || '').toUpperCase();
  if (rt === 'PAYE') {
    const factor = 1 + (Number.isFinite(erni_pct) ? erni_pct : 0);
    return +(charge - (pay * factor)).toFixed(2);
  }
  return +(charge - pay).toFixed(2);
}


// Helper: basic date overlap check for YYYY-MM-DD strings (null = open-ended)
function rangesOverlap(a_from, a_to, b_from, b_to) {
  const A0 = a_from || '0000-01-01';
  const A1 = a_to   || '9999-12-31';
  const B0 = b_from || '0000-01-01';
  const B1 = b_to   || '9999-12-31';
  return !(A1 < B0 || B1 < A0);
}

// ====================== listCandidateRates (unchanged API) ======================
async function listCandidateRates(candidate_id){
  const r = await authFetch(API(`/api/rates/candidate-overrides?candidate_id=${encodeURIComponent(candidate_id)}`));
  return toList(r);
}
// =========================== fetchRelated (unchanged API) ===========================
async function fetchRelated(entity, id, type){
  const url = API(`/api/related/${entity}/${id}/${type}`);
  let res;
  try {
    res = await authFetch(url);
  } catch (err) {
    console.error('fetchRelated network error:', { url, error: err });
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    console.error('fetchRelated failed:', { status: res.status, url, server: text });
    throw new Error(`Request failed: ${res.status}`);
  }
  return toList(res);
}


// Settings (singleton)
async function getSettings(){
  const r = await authFetch(API('/api/settings/defaults'));
  if (!r.ok) throw new Error('Fetch settings failed');
  const j = await r.json();
  return j?.settings || j || {};   // <-- unwrap {settings: {...}}
}

async function saveSettings(payload){
  const r = await authFetch(API('/api/settings/defaults'), {
    method:'PUT',
    headers:{'content-type':'application/json'},
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error('Save failed');
  return true;
}

// Related counts (object map: {type: count, ...})
async function fetchRelatedCounts(entity, id){
  const r = await authFetch(API(`/api/related/${entity}/${id}/counts`));
  if (!r.ok) return {};
  return r.json();
}


async function upsertCandidate(payload, id){
  const url = id ? `/api/candidates/${id}` : '/api/candidates';
  const method = id ? 'PUT' : 'POST';

  let res;
  try {
    res = await authFetch(API(url), {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Candidate save request/network error:', { url, method, payload, error: err });
    throw err;
  }

  const text = await res.text().catch(() => '');

  if (!res.ok) {
    console.error('Candidate save failed:', { status: res.status, url, method, payload, server: text });
    throw new Error(text || `Save failed (${res.status})`);
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    console.warn('Candidate save: non-JSON response body', { body: text });
    return {};
  }
}
async function upsertClient(payload, id){
  const url    = id ? `/api/clients/${id}` : '/api/clients';
  const method = id ? 'PUT' : 'POST';

  const r = await authFetch(API(url), {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const msg = await r.text().catch(()=>'');
    throw new Error(msg || 'Save failed');
  }

  // Try JSON response first
  try {
    const data = await r.json();
    if (data && typeof data === 'object') return data;
  } catch (_) { /* no JSON body (e.g., 204) */ }

  // Fallbacks: Location header or known id (PUT)
  let clientId = null;
  try {
    const loc = r.headers && r.headers.get('Location');
    if (loc) {
      const m = loc.match(/\/api\/clients\/([^/?#]+)/i) || loc.match(/\/clients\/([^/?#]+)/i);
      if (m) clientId = m[1];
    }
  } catch (_) {}

  if (!clientId && method === 'PUT' && id) clientId = id;

  return clientId ? { id: clientId, ...payload } : { ...payload };
}

async function upsertUmbrella(payload, id){
  const url = id ? `/api/umbrellas/${id}` : '/api/umbrellas';
  const method = id ? 'PUT' : 'POST';
  const r = await authFetch(API(url), {method, headers:{'content-type':'application/json'}, body: JSON.stringify(payload)});
  if (!r.ok) throw new Error('Save failed'); return true;
}

async function deleteCandidateRatesFor(candidate_id){
  const r = await authFetch(API(`/api/rates/candidate-overrides/${candidate_id}`), {method:'DELETE'}); return r.ok;
}


// ===== Section loaders =====
async function loadSection(){
  switch(currentSection){
    case 'candidates': return await listCandidates();
    case 'clients': return await listClients();
    case 'umbrellas': return await listUmbrellas();
    case 'settings': return await getSettings();
    case 'audit': return await listOutbox();
    case 'timesheets': return []; // placeholder
    case 'invoices': return []; // placeholder
    case 'healthroster': return []; // placeholder
    default: return [];
  }
}

// ===== Details Modals =====
let modalCtx = { entity:null, data:null };
function openDetails(rowOrId){
  if (!confirmDiscardChangesIfDirty()) return;

  let row = rowOrId;
  if (!row || typeof row !== 'object') {
    const id = String(rowOrId || '');
    row = currentRows.find(x => String(x.id) === id) || null;
  }
  if (!row) { alert('Record not found'); return; }

  currentSelection = row;
  console.debug('[OPEN] openDetails', { section: currentSection, id: row.id });

  if (currentSection === 'candidates')      openCandidate(row);
  else if (currentSection === 'clients')    openClient(row);
  else if (currentSection === 'umbrellas')  openUmbrella(row);
  else if (currentSection === 'audit')      openAuditItem(row);
}


function openCreate(){
  if (!confirmDiscardChangesIfDirty()) return;
  if (currentSection==='candidates') openCandidate({});
  else if (currentSection==='clients') openClient({});
  else if (currentSection==='umbrellas') openUmbrella({});
  else alert('Create not supported for this section yet.');
}

function openEdit(){
  if (!confirmDiscardChangesIfDirty()) return;
  if (!currentSelection) return alert('Select by double-clicking a row first.');
  openDetails(currentSelection);
}
async function openDelete(){
  const inModal = (window.__modalStack?.length || 0) > 0;
  const row = inModal ? (modalCtx?.data || null) : currentSelection;

  if (!row) return alert('Select a record (or open it) first.');
  if (!confirm('Delete (or disable) this record?')) return;

  console.debug('[DELETE] request', {
    section: inModal ? modalCtx?.entity : currentSection,
    inModal, id: row.id
  });

  const section = inModal ? modalCtx?.entity : currentSection;

  if (section === 'candidates'){
    await upsertCandidate({ ...row, active:false }, row.id);
  } else if (section === 'umbrellas'){
    await upsertUmbrella({ ...row, enabled:false }, row.id);
  } else {
    alert('Delete is not available for this section.');
    return;
  }

  if (inModal) {
    // Ensure no lingering state after delete
    discardAllModalsAndState();
  }
  await renderAll();
}

// ---- Candidate modal
// === UPDATED: Candidate open modal (mount roles editor; include roles on save) ===
// === UPDATED: openCandidate — save uses full persisted state + current tab values ===

// ========================= openCandidate (FIXED) =========================

// =================== CANDIDATE MODAL (unchanged save; ensures pay_method present) ===================
// ✅ UPDATED — staged candidate overrides model (apply vs save)
//    Parent Save commits staged deletes → edits → creates
async function openCandidate(row) {
  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));
  const seedId = row?.id || null;

  modalCtx = {
    entity: 'candidates',
    data:   deep(row),
    formState: { __forId: seedId, main: {}, pay: {} },
    rolesState: Array.isArray(row?.roles) ? normaliseRolesForSave(row.roles) : [],
    // staged overrides (separate from server)
    overrides: { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() },
    clientSettingsState: null,
    openToken: (seedId || 'new') + ':' + Date.now()
  };

  showModal(
    'Candidate',
    [
      { key:'main',     label:'Main Details' },
      { key:'rates',    label:'Rates' },
      { key:'pay',      label:'Payment details' },
      { key:'bookings', label:'Bookings' }
    ],
    renderCandidateTab,
    async () => {
      const isNew = !modalCtx?.data?.id;

      // collect main & pay
      const fs = modalCtx.formState || { __forId: null, main:{}, pay:{} };
      const sameRecord = (!!modalCtx.data?.id && fs.__forId === modalCtx.data.id) || (!modalCtx.data?.id && fs.__forId == null);
      const stateMain = sameRecord ? (fs.main || {}) : {};
      const statePay  = sameRecord ? (fs.pay  || {}) : {};
      const main      = document.querySelector('#tab-main') ? collectForm('#tab-main') : {};
      const pay       = document.querySelector('#tab-pay')  ? collectForm('#tab-pay')  : {};
      const roles     = normaliseRolesForSave(modalCtx.rolesState || []);

      const payload   = { ...stateMain, ...statePay, ...main, ...pay, roles };
      if ('umbrella_name' in payload) delete payload.umbrella_name;

      if (!payload.first_name && row?.first_name) payload.first_name = row.first_name;
      if (!payload.last_name  && row?.last_name)  payload.last_name  = row.last_name;

      if (typeof payload.key_norm === 'undefined' && typeof row?.key_norm !== 'undefined') payload.key_norm = row.key_norm;
      if (typeof payload.tms_ref  === 'undefined' && typeof row?.tms_ref  !== 'undefined') payload.tms_ref  = row.tms_ref;

      if (!payload.display_name) {
        const dn = [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim();
        payload.display_name = dn || row?.display_name || null;
      }

      if (!payload.pay_method) payload.pay_method = isNew ? 'PAYE' : (row?.pay_method || 'PAYE');

      // ✅ FIX: if Pay tab wasn’t opened, honour existing umbrella_id for UMBRELLA before validating.
      if (payload.pay_method === 'UMBRELLA' && (!payload.umbrella_id || payload.umbrella_id === '') && row?.umbrella_id) {
        payload.umbrella_id = row.umbrella_id;
      }

      if (isNew && !payload.first_name && !payload.last_name) { alert('Enter at least a first or last name.'); return; }
      if (payload.pay_method === 'PAYE') payload.umbrella_id = null;
      else {
        if (!payload.umbrella_id || payload.umbrella_id === '') { alert('Select an umbrella company for UMBRELLA pay.'); return; }
      }
      if (payload.umbrella_id === '') payload.umbrella_id = null;

      for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];

      const idForUpdate = modalCtx?.data?.id || row?.id || null;
      const saved = await upsertCandidate(payload, idForUpdate);
      const candidateId = idForUpdate || (saved && saved.id);
      if (!candidateId) { alert('Failed to save candidate'); return; }

      // ✅ commit staged overrides (delete → patch → create)
      const O = modalCtx.overrides || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };

      // deletes
      for (const delId of O.stagedDeletes) {
        const res = await authFetch(API(`/api/rates/candidate-overrides/${encodeURIComponent(delId)}`), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) {
          const msg = await res.text().catch(()=> 'Delete override failed');
          alert(msg); return;
        }
      }

      // edits (PATCH)
      for (const [id, patch] of Object.entries(O.stagedEdits || {})) {
        if (!patch.client_id) { alert('Override must include client_id'); return; }
        const res = await authFetch(
          API(`/api/rates/candidate-overrides/${encodeURIComponent(id)}`),
          { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...patch, candidate_id: candidateId }) }
        );
        if (!res.ok) {
          const msg = await res.text().catch(()=> 'Update override failed');
          alert(msg); return;
        }
      }

      // creates (POST)
      for (const nv of (O.stagedNew || [])) {
        if (!nv.client_id) { alert('Override must include client_id'); return; }
        const res = await authFetch(
          API(`/api/rates/candidate-overrides`),
          { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...nv, candidate_id: candidateId }) }
        );
        if (!res.ok) {
          const msg = await res.text().catch(()=> 'Create override failed');
          alert(msg); return;
        }
      }

      // reset staged state
      modalCtx.overrides = { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };
      modalCtx.formState = { __forId: candidateId || null, main: {}, pay: {} };
      modalCtx.rolesState = undefined;

      closeModal();
      renderAll();
    },
    row?.id
  );

  try {
    const allRoleOptions = await loadGlobalRoleOptions();
    const container = document.querySelector('#rolesEditor');
    if (container) renderRolesEditor(container, modalCtx.rolesState, allRoleOptions);

    modalCtx._rolesUpdatedHandler = async () => {
      try {
        const refreshed = await loadGlobalRoleOptions();
        const c = document.querySelector('#rolesEditor');
        if (!c) return;
        if (c.__rolesEditor && typeof c.__rolesEditor.updateOptions === 'function') {
          c.__rolesEditor.updateOptions(refreshed);
        } else {
          renderRolesEditor(c, modalCtx.rolesState || [], refreshed);
        }
      } catch (e) { console.error('Failed to soft-refresh global roles', e); }
    };
    window.addEventListener('global-roles-updated', modalCtx._rolesUpdatedHandler);
  } catch (e) { console.error('Failed to load global roles', e); }

  // preload existing overrides + timesheets
  if (row?.id) {
    const token = modalCtx.openToken;
    const id    = row.id;

    try {
      const existing = await listCandidateRates(id); // server list
      if (token === modalCtx.openToken && modalCtx.data?.id === id) {
        modalCtx.overrides.existing = Array.isArray(existing) ? existing : [];
        await renderCandidateRatesTable(); // uses modalCtx.overrides
      }
    } catch (e) { console.error('listCandidateRates failed', e); }

    try {
      const ts = await fetchRelated('candidate', id, 'timesheets');
      if (token === modalCtx.openToken && modalCtx.data?.id === id) {
        renderCalendar(ts || []);
      }
    } catch (e) { console.error('fetchRelated timesheets failed', e); }
  }
}


// ====================== mountCandidatePayTab (FIXED) ======================
async function mountCandidatePayTab(){
  const token    = modalCtx.openToken;
  const idActive = modalCtx.data?.id || null;

  // Elements inside Pay tab
  const umbRow    = document.querySelector('#tab-pay #umbRow');
  const nameInput = document.querySelector('#tab-pay #umbrella_name');
  const idHidden  = document.querySelector('#tab-pay #umbrella_id');
  const bankName  = document.querySelector('#tab-pay input[name="bank_name"]');
  const sortCode  = document.querySelector('#tab-pay input[name="sort_code"]');
  const accNum    = document.querySelector('#tab-pay input[name="account_number"]');
  const dl        = document.querySelector('#tab-pay #umbList');

  if (!umbRow || !nameInput || !idHidden || !bankName || !sortCode || !accNum || !dl) return;

  // Fetch umbrellas and populate datalist (token-gated)
  const umbrellas = await listUmbrellas().catch(()=>[]);
  if (token !== modalCtx.openToken || modalCtx.data?.id !== idActive) {
    console.debug('[ASYNC] umbrellas dropped (stale)', { forId: idActive, active: modalCtx.data?.id });
    return;
  }

  const byName = new Map((umbrellas||[]).map(u => [String(u.name || '').toLowerCase(), u]));
  const byId   = new Map((umbrellas||[]).map(u => [u.id, u]));
  dl.innerHTML = (umbrellas||[]).map(u => `<option value="${u.name}"></option>`).join('');

  // Helpers
  function lockFromUmb(u){
    bankName.value = u.bank_name || '';
    sortCode.value = u.sort_code || '';
    accNum.value   = u.account_number || '';
    [bankName, sortCode, accNum].forEach(i => i.readOnly = true);
  }
  function unlockBank(){ [bankName, sortCode, accNum].forEach(i => i.readOnly = false); }
  function snapshotIfNeeded(){
    if (!modalCtx.bankSnapshot) {
      modalCtx.bankSnapshot = {
        bank_name: bankName.value,
        sort_code: sortCode.value,
        account_number: accNum.value
      };
    }
  }
  function restoreSnapshot(){
    if (modalCtx.bankSnapshot) {
      bankName.value = modalCtx.bankSnapshot.bank_name || '';
      sortCode.value = modalCtx.bankSnapshot.sort_code || '';
      accNum.value   = modalCtx.bankSnapshot.account_number || '';
    }
    unlockBank();
  }
  function clearUmbrellaOnly(){
    idHidden.value = '';
    nameInput.value = '';
  }
  function resolveUmbrella(val){
    const v = String(val||'').trim().toLowerCase();
    if (!v) { clearUmbrellaOnly(); unlockBank(); return; }
    let match = byName.get(v);
    if (!match) match = (umbrellas||[]).find(u => String(u.name || '').toLowerCase().startsWith(v));
    if (match) {
      idHidden.value = match.id;
      lockFromUmb(match);
    } else {
      clearUmbrellaOnly();
      unlockBank();
    }
  }

  function currentPayMethod(){
    return modalCtx?.payMethodState || modalCtx?.data?.pay_method || 'PAYE';
  }

  function updateUmbVisibility(){
    const pm = currentPayMethod();
    const prev = modalCtx._lastPayMethod;

    if (prev !== pm) {
      if (prev !== 'UMBRELLA' && pm === 'UMBRELLA') snapshotIfNeeded();
      if (prev === 'UMBRELLA' && pm !== 'UMBRELLA') restoreSnapshot();
      modalCtx._lastPayMethod = pm;
    }

    if (pm === 'UMBRELLA') {
      umbRow.style.display = '';
      const u = byId.get(idHidden.value);
      if (u) {
        nameInput.value = u.name || '';
        lockFromUmb(u);
      } else {
        unlockBank();
      }
    } else {
      umbRow.style.display = 'none';
      clearUmbrellaOnly();
      restoreSnapshot();
    }
  }

  // Initial visibility + prefill when opening existing record
  updateUmbVisibility();

  // Pre-fill umbrella name if we have an id
  if (idHidden.value) {
    const u = byId.get(idHidden.value);
    if (u) {
      nameInput.value = u.name || '';
      lockFromUmb(u);
    }
  }

  // Bind events
  nameInput.addEventListener('change', () => resolveUmbrella(nameInput.value));
  nameInput.addEventListener('blur',   () => resolveUmbrella(nameInput.value));

  // Listen for cross-tab pay method changes
  const onPmChanged = () => updateUmbVisibility();
  window.addEventListener('pay-method-changed', onPmChanged, { passive: true });
  modalCtx._payMethodChangedHandler = onPmChanged;
}



// Replaces your current function
// =================== renderCandidateRatesTable (FIXED) ===================
// =================== CANDIDATE RATES TABLE (UPDATED) ===================
// ✅ UPDATED — renders from modalCtx.overrides (existing ⊕ staged edits/new ⊖ staged deletes)
async function renderCandidateRatesTable() {
  const token   = modalCtx.openToken;
  const idActive= modalCtx.data?.id || null;
  const div = byId('ratesTable'); 
  if (!div) return;
  if (token !== modalCtx.openToken || modalCtx.data?.id !== idActive) return;

  // Build a lookup of client_id -> client name
  let clientsById = {};
  try {
    const clients = await listClientsBasic();
    if (token !== modalCtx.openToken || modalCtx.data?.id !== idActive) return;
    clientsById = Object.fromEntries((clients || []).map(c => [c.id, c.name]));
  } catch (e) { console.error('load clients failed', e); }

  const O = modalCtx.overrides || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };

  // materialize view
  const rows = [];
  for (const ex of (O.existing || [])) {
    if (O.stagedDeletes.has(ex.id)) continue;
    rows.push({ ...ex, ...(O.stagedEdits[ex.id] || {}), _edited: !!O.stagedEdits[ex.id] });
  }
  for (const n of (O.stagedNew || [])) rows.push({ ...n, _isNew: true });

  if (!rows.length) {
    div.innerHTML = `
      <div class="hint" style="margin-bottom:8px">No candidate-specific overrides. Client defaults will apply.</div>
      <div class="actions"><button id="btnAddRate">Add rate override</button></div>
    `;
    const addBtn = byId('btnAddRate');
    if (addBtn) addBtn.onclick = () => openCandidateRateModal(modalCtx.data?.id);
    return;
  }

  const cols    = ['client','role','band','rate_type','pay_day','pay_night','pay_sat','pay_sun','pay_bh','date_from','date_to','_state'];
  const headers = ['Client','Role','Band','Type','Pay Day','Pay Night','Pay Sat','Pay Sun','Pay BH','From','To','Status'];

  const tbl   = document.createElement('table'); tbl.className = 'grid';
  const thead = document.createElement('thead'); const trh = document.createElement('tr');
  headers.forEach(h => { const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); }); 
  thead.appendChild(trh); 
  tbl.appendChild(thead);

  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.ondblclick = () => openCandidateRateModal(modalCtx.data?.id, r);
    const pretty = {
      client: clientsById[r.client_id] || '',
      role  : r.role || '',
      band  : r.band ?? '',
      rate_type: r.rate_type || '',
      pay_day:   r.pay_day ?? '—',
      pay_night: r.pay_night ?? '—',
      pay_sat:   r.pay_sat ?? '—',
      pay_sun:   r.pay_sun ?? '—',
      pay_bh:    r.pay_bh ?? '—',
      date_from: formatDisplayValue('date_from', r.date_from),
      date_to  : formatDisplayValue('date_to',   r.date_to),
      _state   : r._isNew ? 'Staged (new)' : (r._edited ? 'Staged (edited)' : '')
    };
    cols.forEach(c => { const td=document.createElement('td'); td.textContent=String(pretty[c] ?? ''); tr.appendChild(td); });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button id="btnAddRate">Add rate override</button>
    <span class="hint">Changes here are staged. Click “Save” in the main dialog to persist.</span>
  `;

  div.innerHTML = '';
  div.appendChild(tbl);
  div.appendChild(actions);

  const addBtn = byId('btnAddRate');
  if (addBtn) addBtn.onclick = () => openCandidateRateModal(modalCtx.data?.id);
}


// === UPDATED: Candidate modal tabs (adds Roles editor placeholder on 'main') ===


function renderCandidateTab(key, row = {}) {
  if (key === 'main') return html(`
    <div class="form" id="tab-main">
      ${input('first_name','First name', row.first_name)}
      ${input('last_name','Last name', row.last_name)}
      ${input('email','Email', row.email, 'email')}
      ${input('phone','Telephone', row.phone)}
      ${select('pay_method','Pay method', row.pay_method || 'PAYE', ['PAYE','UMBRELLA'], {id:'pay-method'})}

      ${input('key_norm','Global Candidate Key (CGK)', row.key_norm)}
      ${input('tms_ref','CloudTMS Candidate Reference (CCR)', row.tms_ref)}

      ${input('display_name','Display name', row.display_name)}

      <!-- Roles editor -->
      <div class="row">
        <label>Roles (ranked)</label>
        <div id="rolesEditor" data-init="1"></div>
        <div class="hint">Pick from global roles (from Client Default Rates). Drag to reorder. Remove to delete. No duplicates.</div>
      </div>

      <div class="row"><label>Notes</label><textarea name="notes" placeholder="Free text…">${row.notes || ''}</textarea></div>
    </div>
  `);

  // ✅ FIX: remove the top-level "Add rate override" button here.
  // renderCandidateRatesTable() is the single place that renders the Add button (in both empty/non-empty states).
  if (key === 'rates') return html(`
    <div id="tab-rates">
      <div id="ratesTable"></div>
    </div>
  `);

  if (key === 'pay') return html(`
    <div class="form" id="tab-pay">
      <div class="row"><label class="hint">
        PAYE bank fields are editable. If UMBRELLA is selected, bank details are taken from the umbrella and locked.
      </label></div>

      ${input('account_holder','Account holder', row.account_holder)}
      ${input('bank_name','Bank name', row.bank_name)}
      ${input('sort_code','Sort code', row.sort_code)}
      ${input('account_number','Account number', row.account_number)}

      <!-- Umbrella chooser: text input + datalist + hidden canonical id -->
      <div class="row" id="umbRow">
        <label>Umbrella company</label>
        <!-- IMPORTANT: no name attribute so it isn't posted -->
        <input id="umbrella_name" list="umbList" placeholder="Type to search umbrellas…" value="" />
        <datalist id="umbList"></datalist>
        <input type="hidden" name="umbrella_id" id="umbrella_id" value="${row.umbrella_id || ''}"/>
      </div>
    </div>
  `);

  if (key === 'bookings') return html(`
    <div id="calendarWrap">
      <div class="legend">
        <div class="lg"><span class="sq a"></span> Authorised</div>
        <div class="lg"><span class="sq i"></span> Invoiced</div>
        <div class="lg"><span class="sq p"></span> Paid</div>
      </div>
      <div class="calendar" id="calendar"></div>
    </div>
  `);
}


// === DIRTY NAVIGATION GUARDS (add) ===
function isAnyModalDirty(){
  const st = window.__modalStack || [];
  return st.some(f => f && f.isDirty);
}
// ==================== discardAllModalsAndState (kept with geometry reset) ====================
function discardAllModalsAndState(){
  try {
    if (modalCtx && modalCtx._rolesUpdatedHandler) {
      window.removeEventListener('global-roles-updated', modalCtx._rolesUpdatedHandler);
      modalCtx._rolesUpdatedHandler = undefined;
    }
    if (modalCtx && modalCtx._payMethodChangedHandler) {
      window.removeEventListener('pay-method-changed', modalCtx._payMethodChangedHandler);
      modalCtx._payMethodChangedHandler = undefined;
    }
  } catch (e) {
    console.warn('[MODAL] listener cleanup failed', e);
  }

  // Detach any remaining frame-level listeners (dirty/global) from all frames
  try {
    if (Array.isArray(window.__modalStack)) {
      while (window.__modalStack.length) {
        const fr = window.__modalStack.pop();
        if (fr && fr._detachDirty)  { try { fr._detachDirty();  } catch(_) {} }
        if (fr && fr._detachGlobal) { try { fr._detachGlobal(); } catch(_) {} }
      }
    }
  } catch (_) {}

  // Reset modal geometry to prevent "snap to right" on the next open
  const modal = byId('modal');
  if (modal) {
    modal.style.position = '';
    modal.style.left = '';
    modal.style.top = '';
    modal.style.right = '';
    modal.style.bottom = '';
    modal.style.transform = '';
    modal.classList.remove('dragging');
    // Cancel any document-level drag handlers that might still be live
    document.onmousemove = null;
    document.onmouseup   = null;
  }

  // 🔒 Clear any hidden modal DOM so stale inputs can't be read on next open
  const modalBody = document.getElementById('modalBody');
  if (modalBody) modalBody.replaceChildren();
  const modalTabs = document.getElementById('modalTabs');
  if (modalTabs) modalTabs.replaceChildren();
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = '';

  // Reset modal context
  modalCtx = {
    entity: null, data: null,
    formState: null, rolesState: null,
    ratesState: null, hospitalsState: null,
    clientSettingsState: null,
    openToken: null
  };

  // Hide overlay last
  const back = document.getElementById('modalBack');
  if (back) back.style.display = 'none';

  console.debug('[MODAL] hard reset complete');
}


function confirmDiscardChangesIfDirty(){
  if (!isAnyModalDirty()) return true; // not dirty → acts as plain "Close" guard
  const ok = window.confirm('You have unsaved changes. Discard them and continue?');
  if (!ok) return false;

  // Sanitize geometry before teardown
  const m = byId('modal');
  if (m) {
    m.style.position = '';
    m.style.left = '';
    m.style.top = '';
    m.style.right = '';
    m.style.bottom = '';
    m.style.transform = '';
    m.classList.remove('dragging');
  }
  document.onmousemove = null;
  document.onmouseup   = null;

  discardAllModalsAndState();
  return true;
}


// ====================== mountCandidateRatesTab (FIXED) ======================
// =================== MOUNT CANDIDATE RATES TAB (unchanged flow) ===================
async function mountCandidateRatesTab() {
  const token = modalCtx.openToken;
  const id    = modalCtx.data?.id || null;

  const rates = id ? await listCandidateRates(id) : [];
  if (token !== modalCtx.openToken || modalCtx.data?.id !== id) return;

  await renderCandidateRatesTable(rates);

  const btn = byId('btnAddRate');
  if (btn) btn.onclick = () => openCandidateRateModal(modalCtx.data?.id);
}


// === UPDATED: Candidate Rate Override modal (Client→Role gated; bands; UK dates; date_to) ===
// ====================== openCandidateRateModal (FIXED) ======================
// =================== CANDIDATE OVERRIDE MODAL (UPDATED) ===================
// ==== CHILD MODAL (CANDIDATE RATE) — throw on errors; return true on success ====
// ✅ UPDATED — Apply (stage), gate against client defaults active at date_from,
//    auto-truncate incumbent of same rate_type at N−1 (staged), NO persistence here
async function openCandidateRateModal(candidate_id, existing) {
  const parentToken  = modalCtx.openToken;
  const parentEntity = modalCtx.entity;
  const parentId     = modalCtx.data?.id || null;

  const clients = await listClientsBasic();
  const clientOptions = clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  // ✅ FIX: do NOT auto-select the first client for new overrides; start blank.
  const initialClientId = existing?.client_id || '';

  const defaultRateType = existing?.rate_type
    ? String(existing.rate_type).toUpperCase()
    : String(modalCtx?.data?.pay_method || 'PAYE').toUpperCase();

  const formHtml = html(`
    <div class="form" id="candRateForm">
      <div class="row">
        <label>Client (required)</label>
        <select name="client_id" id="cr_client_id" required>
          <option value="">Select client…</option>
          ${clientOptions}
        </select>
      </div>

      <div class="row">
        <label>Rate type (required)</label>
        <select name="rate_type" id="cr_rate_type" required>
          <option ${defaultRateType==='PAYE'?'selected':''}>PAYE</option>
          <option ${defaultRateType==='UMBRELLA'?'selected':''}>UMBRELLA</option>
        </select>
      </div>

      <div class="row">
        <label>Role (required)</label>
        <select name="role" id="cr_role" required disabled>
          <option value="">Select role…</option>
        </select>
      </div>
      <div class="row" id="cr_band_row" style="display:none">
        <label>Band (optional)</label>
        <select name="band" id="cr_band"></select>
      </div>

      <div class="row">
        <label>Effective from (DD/MM/YYYY)</label>
        <input type="text" name="date_from" id="cr_date_from" placeholder="DD/MM/YYYY" />
      </div>
      <div class="row">
        <label>Effective to (optional, DD/MM/YYYY)</label>
        <input type="text" name="date_to" id="cr_date_to" placeholder="DD/MM/YYYY" />
      </div>

      ${input('pay_day','Pay (Day)',     existing?.pay_day     ?? '', 'number')}
      ${input('pay_night','Pay (Night)', existing?.pay_night   ?? '', 'number')}
      ${input('pay_sat','Pay (Sat)',     existing?.pay_sat     ?? '', 'number')}
      ${input('pay_sun','Pay (Sun)',     existing?.pay_sun     ?? '', 'number')}
      ${input('pay_bh','Pay (BH)',       existing?.pay_bh       ?? '', 'number')}

      <div class="row"><label class="hint">Leave any pay field blank if not applicable (will be saved as null).</label></div>

      <div class="row" style="grid-column:1/-1">
        <div id="cr_margin_box" class="hint" style="padding:8px;border:1px dashed #ddd;border-radius:8px">
          Enter pay and select rate type to preview margin (per bucket) using current client charge and Employers NI%.
        </div>
      </div>
    </div>
  `);

  let cache = { roles: [], bandsByRole: {}, windows: [] };
  let lastCharge = null;

  showModal(
    existing ? 'Edit Candidate Rate Override' : 'Add Candidate Rate Override',
    [{ key:'form', label:'Form' }],
    () => formHtml,
    async () => {
      if (parentToken !== modalCtx.openToken || parentEntity !== 'candidates' || modalCtx.data?.id !== candidate_id) {
        alert('This rate form is no longer current. Please reopen it.');
        throw new Error('STALE_CONTEXT');
      }
      const raw = collectForm('#candRateForm');

      const client_id = (raw.client_id || '').trim();
      if (!client_id) { alert('Client is required'); throw new Error('VALIDATION'); }

      const rate_type = String(raw.rate_type || '').toUpperCase();
      if (rate_type !== 'PAYE' && rate_type !== 'UMBRELLA') { alert('Rate type must be PAYE or UMBRELLA'); throw new Error('VALIDATION'); }

      const role = (raw.role || '').trim();
      if (!role) { alert('Role is required'); throw new Error('VALIDATION'); }

      const isoFrom = parseUkDateToIso(raw.date_from);
      if (!isoFrom) { alert('Invalid “Effective from” date'); throw new Error('VALIDATION'); }
      let isoTo = null;
      if (raw.date_to) {
        isoTo = parseUkDateToIso(raw.date_to);
        if (!isoTo) { alert('Invalid “Effective to” date'); throw new Error('VALIDATION'); }
        if (isoTo < isoFrom) { alert('“Effective to” cannot be before “Effective from”'); throw new Error('VALIDATION'); }
      }

      const band = (raw.band || '').trim() || null;

      // Gate by client defaults for this (client, role, band|null) active on isoFrom
      const candidatesForRole = (cache.windows || []).filter(w => w.role === role && w.date_from <= isoFrom && (!w.date_to || w.date_to >= isoFrom));
      if (!candidatesForRole.length) {
        alert(`No active client default window for role ${role} at ${formatIsoToUk(isoFrom)}.`); 
        throw new Error('VALIDATION');
      }
      const hasExactBand = candidatesForRole.some(w => String(w.band||'') === String(band||''));
      const hasBandNull  = candidatesForRole.some(w => !w.band || w.band === '');
      if (band == null && !hasBandNull) {
        alert(`This client has no band-null window for ${role} on ${formatIsoToUk(isoFrom)}.`); 
        throw new Error('VALIDATION');
      }
      if (band != null && !hasExactBand) {
        alert(`This client has no active window for ${role} / band ${band} on ${formatIsoToUk(isoFrom)}.`);
        throw new Error('VALIDATION');
      }

      // Build staged override payload
      const staged = {
        id        : existing?.id, // may be undefined for new
        candidate_id,
        client_id,
        role, band,
        rate_type,
        date_from : isoFrom,
        date_to   : isoTo,
        // five-way pay
        pay_day   : raw['pay_day']   !== '' ? Number(raw['pay_day'])   : null,
        pay_night : raw['pay_night'] !== '' ? Number(raw['pay_night']) : null,
        pay_sat   : raw['pay_sat']   !== '' ? Number(raw['pay_sat'])   : null,
        pay_sun   : raw['pay_sun']   !== '' ? Number(raw['pay_sun'])   : null,
        pay_bh    : raw['pay_bh']    !== '' ? Number(raw['pay_bh'])    : null
      };

      // Stage (do not persist). Track edits/new/deletes in modalCtx.overrides
      const O = modalCtx.overrides || (modalCtx.overrides = { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });

      // Client-side truncate of incumbent of SAME TYPE at N-1 (staged)
      const universe = [
        ...O.existing.filter(x => !O.stagedDeletes.has(x.id)),
        ...O.stagedNew
      ];

      const sameKey = o =>
        String(o.client_id) === client_id &&
        String(o.role||'')  === role &&
        String((o.rate_type || '')).toUpperCase() === rate_type &&
        String(o.band||'')  === String(band||'');

      const overlapping = universe.filter(o => sameKey(o) && (!staged.id || o.id !== staged.id))
        .filter(o => rangesOverlap(o.date_from||null, o.date_to||null, staged.date_from, staged.date_to));

      if (overlapping.length) {
        const ov = overlapping[0];
        const cut = (()=>{ const d=new Date(staged.date_from+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-1);
                           return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; })();
        const ok = window.confirm(
          `An override for ${ov.role}${ov.band?` / ${ov.band}`:''} (${ov.rate_type}) is active `+
          `${formatIsoToUk(ov.date_from)}–${formatIsoToUk(ov.date_to||'')}. End it on ${formatIsoToUk(cut)}?`
        );
        if (!ok) throw new Error('CANCELLED');

        if (ov.id) {
          O.stagedEdits[ov.id] = { ...(O.stagedEdits[ov.id]||{}), date_to: cut };
        } else {
          // staged new one: adjust its end date locally
          const idx = O.stagedNew.findIndex(s => s === ov);
          if (idx >= 0) O.stagedNew[idx] = { ...ov, date_to: cut };
        }
      }

      if (existing?.id) {
        O.stagedEdits[existing.id] = { ...O.stagedEdits[existing.id], ...staged };
      } else if (existing && !existing.id) {
        // editing a staged new row (has _tmpId)
        const idx = O.stagedNew.findIndex(r => r === existing);
        if (idx >= 0) O.stagedNew[idx] = { ...existing, ...staged };
        else O.stagedNew.push({ ...staged, _tmpId: `tmp_${Date.now()}` });
      } else {
        O.stagedNew.push({ ...staged, _tmpId: `tmp_${Date.now()}` });
      }

      await renderCandidateRatesTable();
      return true; // success (staged only)
    },
    false
  );

  // After mount: wire up gating & preview
  const selClient = document.getElementById('cr_client_id');
  const selRateT  = document.getElementById('cr_rate_type');
  const selRole   = document.getElementById('cr_role');
  const selBand   = document.getElementById('cr_band');
  const bandRow   = document.getElementById('cr_band_row');
  const inFrom    = document.getElementById('cr_date_from');
  const inTo      = document.getElementById('cr_date_to');
  const box       = document.getElementById('cr_margin_box');

  if (initialClientId) selClient.value = initialClientId;
  if (existing?.date_from) inFrom.value = formatIsoToUk(existing.date_from);
  if (existing?.date_to)   inTo.value   = formatIsoToUk(existing.date_to);

  attachUkDatePicker(inFrom);
  attachUkDatePicker(inTo);

  async function refreshClientRoles(clientId) {
    selRole.innerHTML = `<option value="">Select role…</option>`;
    selRole.disabled = true; 
    bandRow.style.display = 'none'; 
    selBand.innerHTML = '';
    if (!clientId) return;

    const active_on = parseUkDateToIso(inFrom.value || '') || null;

    // ✅ Unified client defaults; no rate_type filter
    const list = await listClientRates(clientId, { active_on });
    if (parentToken !== modalCtx.openToken || modalCtx.entity !== 'candidates' || modalCtx.data?.id !== parentId) return;

    cache.windows = Array.isArray(list) ? list : [];

    // Build role set and available bands (track band-null as '' so we can offer "(none)")
    const roles = new Set(); 
    const bandsByRole = {};
    (cache.windows).forEach(w => {
      if (!w.role) return;
      roles.add(w.role);
      const bKey = (w.band == null ? '' : String(w.band));
      (bandsByRole[w.role] ||= new Set()).add(bKey);
    });

    // Candidate’s own roles filter
    const liveRoles = Array.isArray(modalCtx?.rolesState) && modalCtx.rolesState.length
      ? modalCtx.rolesState
      : (Array.isArray(modalCtx?.data?.roles) ? modalCtx.data.roles : []);
    const candRoleCodes = new Set((liveRoles || []).map(x => String(x.code)));

    const allowed = [...roles].filter(code => candRoleCodes.has(code)).sort((a,b)=> a.localeCompare(b));
    if (!allowed.length) {
      selRole.innerHTML = `<option value="">Select role…</option>`;
      selRole.disabled = true;
      alert("This candidate has no matching roles for this client's active windows at the selected start date.");
      return;
    }

    selRole.innerHTML = `<option value="">Select role…</option>` + 
                        allowed.map(code => `<option value="${code}">${code}</option>`).join('');
    selRole.disabled = false;

    cache.roles = allowed;
    // Convert band sets to arrays (include '' when band-null exists so UI can show “(none)”)
    cache.bandsByRole = Object.fromEntries(
      allowed.map(code => [code, [...(bandsByRole[code] || new Set())]])
    );

    if (existing?.role) {
      selRole.value = existing.role;
      selRole.dispatchEvent(new Event('change'));
      if (existing?.band != null) selBand.value = existing.band;
    }
  }

  function onRoleChanged() {
    const role = selRole.value;
    const bands = cache.bandsByRole[role] || [];
    const hasNull = bands.includes('');
    if (bands.length) {
      const opts = (hasNull ? `<option value="">(none)</option>` : '') + 
                   bands.filter(b=>b!=='').sort((a,b)=> String(a).localeCompare(String(b)))
                        .map(b => `<option value="${b}">${b}</option>`).join('');
      selBand.innerHTML = opts;
      bandRow.style.display = '';
    } else {
      selBand.innerHTML = '';
      bandRow.style.display = 'none';
    }
    refreshMargin();
  }

  async function refreshMargin() {
    const s = await getSettingsCached();
    const erniPct = (() => {
      const v = s?.erni_pct;
      if (v == null) return 0;
      if (typeof v === 'string') {
        const m = v.trim(); if (!m) return 0;
        if (m.endsWith('%')) { const n = parseFloat(m.slice(0,-1)); return Number.isFinite(n) ? Math.max(0,n/100) : 0; }
        const n = parseFloat(m); return Number.isFinite(n) ? (n>1? n/100 : n) : 0;
      }
      const n = Number(v); return Number.isFinite(n) ? (n>1? n/100 : n) : 0;
    })();

    const role = selRole.value || null;
    const band = selBand.value || null;
    const rt   = String((document.getElementById('cr_rate_type') || {}).value || '').toUpperCase();
    const client_id = selClient.value || null;
    const active_on = parseUkDateToIso(inFrom.value || '') || null;

    lastCharge = client_id && role ? (await findBestChargeFor({ client_id, role, band, active_on })) : null;

    const raw = collectForm('#candRateForm');
    const pays = {
      day:   raw['pay_day']   === '' ? null : Number(raw['pay_day']),
      night: raw['pay_night'] === '' ? null : Number(raw['pay_night']),
      sat:   raw['pay_sat']   === '' ? null : Number(raw['pay_sat']),
      sun:   raw['pay_sun']   === '' ? null : Number(raw['pay_sun']),
      bh:    raw['pay_bh']    === '' ? null : Number(raw['pay_bh'])
    };
    const c = lastCharge || {};
    const line = (lbl, bucket) => {
      const m = calcMargin(c[`charge_${bucket}`], pays[bucket], rt, rt==='PAYE'? erniPct : 0);
      const v = (c[`charge_${bucket}`]==null || pays[bucket]==null) ? '—' : `£${m.toFixed(2)}`;
      return `<div>${lbl}: <strong>${v}</strong></div>`;
    };
    const expl = (rt==='PAYE')
      ? `PAYE margin uses Employers NI ${(erniPct*100).toFixed(2)}%`
      : `Umbrella margin: margin = charge − pay`;
    box.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
        ${line('Day','day')}${line('Night','night')}${line('Sat','sat')}
        ${line('Sun','sun')}${line('BH','bh')}<div></div>
      </div>
      <div class="hint" style="margin-top:6px">${expl}</div>`;
  }

  selClient.addEventListener('change', () => { refreshClientRoles(selClient.value); refreshMargin(); });
  selRateT .addEventListener('change', () => { refreshClientRoles(selClient.value); refreshMargin(); });
  document.querySelectorAll('#candRateForm input[type="number"]').forEach(el => el.addEventListener('input', refreshMargin));
  inFrom.addEventListener('change', () => { refreshClientRoles(selClient.value); refreshMargin(); });
  selRole.addEventListener('change', onRoleChanged);
  selBand.addEventListener('change', refreshMargin);

  // ✅ FIX: only pre-select & refresh when editing an existing override with a client.
  if (initialClientId) {
    selClient.value = initialClientId;
    await refreshClientRoles(initialClientId);
  }
  attachUkDatePicker(inFrom); 
  attachUkDatePicker(inTo);
  if (existing?.role) {
    selRole.value = existing.role;
    selRole.dispatchEvent(new Event('change'));
    if (existing?.band != null) selBand.value = existing.band;
  }
  await refreshMargin();
}


function renderCalendar(timesheets){
  const wrap = byId('calendar'); if (!wrap) return;
  const map = new Map();
  (timesheets || []).forEach(t=>{
    const d = (t.worked_start_iso || t.worked_start || t.date || t.week_ending_date);
    if (!d) return;
    const key = (d+'').slice(0,10);
    const paid = t.paid_at_utc;
    const invoiced = t.locked_by_invoice_id || (t.invoice_id);
    const auth = t.authorised_at_server || (t.validation_status==='VALIDATION_OK');
    let mark = 'a'; if (invoiced) mark = 'i'; if (paid) mark = 'p';
    if (auth && !invoiced && !paid) mark = 'a';
    map.set(key, mark);
  });
  const now = new Date(); const yr = now.getFullYear(); wrap.innerHTML = '';
  for (let m=0;m<12;m++){
    const first = new Date(yr, m, 1);
    const box = document.createElement('div'); box.className='month';
    box.innerHTML = `<h4>${first.toLocaleString(undefined,{month:'long'})} ${yr}</h4>`;
    const days = document.createElement('div'); days.className='days';
    for (let i=0;i<first.getDay();i++) days.appendChild(document.createElement('div'));
    const daysInMonth = new Date(yr, m+1, 0).getDate();
    for (let d=1; d<=daysInMonth; d++){
      const cell = document.createElement('div'); cell.className='d';
      const key = `${yr}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const mark = map.get(key);
      if (mark) cell.classList.add('mark-'+mark);
      cell.textContent = d;
      days.appendChild(cell);
    }
    box.appendChild(days); wrap.appendChild(box);
  }
}

// ---- Client modal

// =========================== openClient (FIXED) ==========================
// =================== CLIENT MODAL (UPDATED: rates rate_type + hospitals staged-CRUD) ===================
// ✅ UPDATED — unified FE model; on load, convert server rows to unified; on save, validate overlaps, bridge to per-type API
async function openClient(row) {
  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));
  const seedId = row?.id || null;

  modalCtx = {
    entity: 'clients',
    data: deep(row),
    formState: { __forId: seedId, main: {} },
    // unified client-default windows (no rate_type in FE)
    ratesState: [],  // [{ client_id, role, band|null, date_from, date_to|null, paye_*, umb_*, charge_* }]
    // Hospitals staged model
    hospitalsState: { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() },
    clientSettingsState: {},
    openToken: (seedId || 'new') + ':' + Date.now()
  };

  if (seedId) {
    const token = modalCtx.openToken;
    try {
      // 🚜 get per-type rows from API and group into unified for FE
      const unified = await listClientRates(seedId);
      if (token === modalCtx.openToken && modalCtx.data?.id === seedId) {
        modalCtx.ratesState = Array.isArray(unified) ? unified.map(r => ({ ...r })) : [];
      }
    } catch (e) {
      console.error('openClient preload rates error', e);
    }

    try {
      const hospitals = await listClientHospitals(seedId);
      if (token === modalCtx.openToken && modalCtx.data?.id === seedId) {
        modalCtx.hospitalsState.existing = Array.isArray(hospitals) ? hospitals.slice() : [];
      }
    } catch (e) { console.error('openClient preload hospitals error', e); }

    try {
      const r = await authFetch(API(`/api/clients/${seedId}`));
      if (r.ok) {
        const clientObj = await r.json().catch(()=> ({}));
        const cs = clientObj && (clientObj.client_settings || clientObj.settings || {});
        if (token === modalCtx.openToken && modalCtx.data?.id === seedId) {
          modalCtx.clientSettingsState = (cs && typeof cs === 'object') ? JSON.parse(JSON.stringify(cs)) : {};
        }
      }
    } catch (e) { console.error('openClient preload client settings error', e); }
  }

  showModal(
    'Client',
    [
      {key:'main',     label:'Main'},
      {key:'rates',    label:'Rates'},
      {key:'settings', label:'Client settings'},
      {key:'hospitals',label:'Hospitals & wards'}
    ],
    renderClientTab,
    async ()=> {
      const fs = modalCtx.formState || { __forId: null, main:{} };
      const same = (!!modalCtx.data?.id && fs.__forId === modalCtx.data.id) || (!modalCtx.data?.id && fs.__forId == null);
      const stagedMain = same ? (fs.main || {}) : {};
      const liveMain   = byId('tab-main') ? collectForm('#tab-main') : {};
      const payload    = { ...stagedMain, ...liveMain };
      if (!payload.name && row?.name) payload.name = row.name;
      if (!payload.name) { alert('Client name is required.'); return; }

      if (modalCtx.clientSettingsState && typeof modalCtx.clientSettingsState === 'object') {
        payload.client_settings = modalCtx.clientSettingsState;
      }

      const clientIdFromCtx = modalCtx?.data?.id || row?.id || null;
      const clientResp = await upsertClient(payload, clientIdFromCtx);
      const clientId   = clientIdFromCtx || (clientResp && clientResp.id);

      // === Commit staged unified RATES (overlap validation per (role,band))
      if (clientId && Array.isArray(modalCtx.ratesState)) {
        const windows = modalCtx.ratesState.slice();

        // client-side overlap guard within same category (ignore per-type entirely)
        for (let i = 0; i < windows.length; i++) {
          for (let j = i + 1; j < windows.length; j++) {
            const A = windows[i], B = windows[j];
            if (String(A.role||'') === String(B.role||'') &&
                String(A.band||'') === String(B.band||'')) {
              const a0 = A.date_from || null, a1 = A.date_to || null;
              const b0 = B.date_from || null, b1 = B.date_to || null;
              if (rangesOverlap(a0, a1, b0, b1)) {
                alert(`Client default windows overlap for role=${A.role} band=${A.band||'(none)'}.\n` +
                      `${formatIsoToUk(a0)}–${formatIsoToUk(a1||'')}  vs  ${formatIsoToUk(b0)}–${formatIsoToUk(b1||'')}`);
                return;
              }
            }
          }
        }

        // bridge each unified window to two per-type posts
        for (const w of windows) {
          try {
            await upsertClientRate({
              client_id : clientId,
              role      : w.role || '',
              band      : w.band ?? null,
              date_from : w.date_from || null,
              date_to   : w.date_to ?? null,

              // charge & pay blocks — unified
              charge_day   : w.charge_day   ?? null,
              charge_night : w.charge_night ?? null,
              charge_sat   : w.charge_sat   ?? null,
              charge_sun   : w.charge_sun   ?? null,
              charge_bh    : w.charge_bh    ?? null,

              paye_day     : w.paye_day     ?? null,
              paye_night   : w.paye_night   ?? null,
              paye_sat     : w.paye_sat     ?? null,
              paye_sun     : w.paye_sun     ?? null,
              paye_bh      : w.paye_bh      ?? null,

              umb_day      : w.umb_day      ?? null,
              umb_night    : w.umb_night    ?? null,
              umb_sat      : w.umb_sat      ?? null,
              umb_sun      : w.umb_sun      ?? null,
              umb_bh       : w.umb_bh       ?? null
            });
          } catch (e) {
            console.error('Upsert client default window failed', w, e);
            alert('Failed to save a client rate window. See console for details.');
            return;
          }
        }
      }

      // === Commit staged HOSPITALS — three-phase (create, update, delete)
      if (clientId && modalCtx.hospitalsState && typeof modalCtx.hospitalsState === 'object') {
        const H = modalCtx.hospitalsState;

        // dedupe/blank validation
        const existingAlive = (H.existing || []).filter(x => !H.stagedDeletes.has(x.id));
        const names = new Set(existingAlive.map(x => String(x.hospital_name_norm||'').trim().toUpperCase()).filter(Boolean));

        for (const n of H.stagedNew) {
          const nm = String(n.hospital_name_norm||'').trim();
          if (!nm) { alert('Hospital / Trust is required'); return; }
          const norm = nm.toUpperCase();
          if (names.has(norm)) { alert(`Duplicate hospital: ${nm}`); return; }
          names.add(norm);
        }
        for (const [id, patch] of Object.entries(H.stagedEdits || {})) {
          if (H.stagedDeletes.has(id)) continue;
          if (patch.hospital_name_norm !== undefined) {
            const nm = String(patch.hospital_name_norm||'').trim();
            if (!nm) { alert('Hospital / Trust is required'); return; }
            const norm = nm.toUpperCase();
            const orig = (H.existing || []).find(x => String(x.id)===String(id));
            const currentNorm = String(orig?.hospital_name_norm||'').trim().toUpperCase();
            if (norm !== currentNorm && names.has(norm)) { alert(`Duplicate hospital: ${nm}`); return; }
            names.add(norm);
          }
        }

        // creates
        for (const h of (H.stagedNew || [])) {
          const res = await authFetch(API(`/api/clients/${clientId}/hospitals`), {
            method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({
              hospital_name_norm: (h.hospital_name_norm||'').trim(),
              ward_hint: h.ward_hint ?? null
            })
          });
          if (!res.ok) {
            const msg = await res.text().catch(()=> ''); 
            alert(`Create hospital failed: ${msg}`); 
            return;
          }
        }

        // updates
        for (const [hid, patch] of Object.entries(H.stagedEdits || {})) {
          if (H.stagedDeletes.has(hid)) continue;
          const res = await authFetch(API(`/api/clients/${clientId}/hospitals/${encodeURIComponent(hid)}`), {
            method:'PATCH', headers:{'content-type':'application/json'},
            body: JSON.stringify(patch)
          });
          if (!res.ok) {
            const msg = await res.text().catch(()=> ''); 
            alert(`Update hospital failed: ${msg}`); 
            return;
          }
        }

        // deletes
        for (const hid of (H.stagedDeletes || new Set())) {
          const res = await authFetch(API(`/api/clients/${clientId}/hospitals/${encodeURIComponent(hid)}`), { method:'DELETE' });
          if (!res.ok && res.status !== 404) {
            const msg = await res.text().catch(()=> ''); 
            alert(`Delete hospital failed: ${msg}`); 
            return;
          }
        }
      }

      closeModal();
      renderAll();
    },
    row?.id
  );
}

// =================== CLIENT RATES TABLE (UPDATED) ===================
// ✅ UPDATED — unified table view, dbl-click opens unified modal
function renderClientRatesTable() {
  const div = byId('clientRates'); if (!div) return;
  const staged = Array.isArray(modalCtx.ratesState) ? modalCtx.ratesState : [];
  div.innerHTML = '';

  if (!staged.length) {
    div.innerHTML = `
      <div class="hint" style="margin-bottom:8px">No client default windows yet.</div>
      <div class="actions"><button id="btnAddClientRate">Add / Upsert client window</button></div>
    `;
    const addBtn = byId('btnAddClientRate');
    if (addBtn) addBtn.onclick = () => openClientRateModal(modalCtx.data?.id);
    return;
  }

  const cols    = [
    'role','band',
    'paye_day','paye_night','paye_sat','paye_sun','paye_bh',
    'umb_day','umb_night','umb_sat','umb_sun','umb_bh',
    'charge_day','charge_night','charge_sat','charge_sun','charge_bh',
    'date_from','date_to'
  ];
  const headers = [
    'Role','Band',
    'PAYE Day','PAYE Night','PAYE Sat','PAYE Sun','PAYE BH',
    'UMB Day','UMB Night','UMB Sat','UMB Sun','UMB BH',
    'Charge Day','Charge Night','Charge Sat','Charge Sun','Charge BH',
    'From','To'
  ];

  const tbl   = document.createElement('table'); tbl.className='grid';
  const thead = document.createElement('thead');
  const trh   = document.createElement('tr');
  headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
  thead.appendChild(trh); 
  tbl.appendChild(thead);

  const tb = document.createElement('tbody');
  staged.forEach(r => {
    const tr = document.createElement('tr');
    tr.ondblclick = () => openClientRateModal(modalCtx.data?.id, r);
    cols.forEach(c => {
      const td = document.createElement('td');
      td.textContent = formatDisplayValue(c, r[c]);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `<button id="btnAddClientRate">Add / Upsert client window</button>`;

  div.appendChild(tbl);
  div.appendChild(actions);

  const addBtn = byId('btnAddClientRate');
  if (addBtn) addBtn.onclick = () => openClientRateModal(modalCtx.data?.id);
}

function ensureSelectionStyles(){
  const ID = 'gridSelectionStyles';
  if (document.getElementById(ID)) return;
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = `
    /* Subtle selected-row highlight — readable, not shouty */
    .grid tbody tr.selected {
      background: rgba(30,136,229,0.12) !important;  /* soft blue tint */
      color: inherit !important;                     /* keep text color */
      box-shadow: inset 0 0 0 1px rgba(29,78,216,.35); /* delicate rim */
    }
    .grid tbody tr.selected td { color: inherit !important; }

    /* Hover stays understated */
    .grid tbody tr:hover {
      background: rgba(0,0,0,0.04);
    }
  `;
  document.head.appendChild(style);
}


function renderClientTab(key, row={}){
  if (key==='main') return html(`
    <div class="form" id="tab-main">
      ${input('name','Client name', row.name)}
      ${input('cli_ref','Client Ref (CLI-…) ', row.cli_ref)}
      <div class="row" style="grid-column:1/-1"><label>Invoice address</label><textarea name="invoice_address">${row.invoice_address || ''}</textarea></div>
      ${input('primary_invoice_email','Primary invoice email', row.primary_invoice_email,'email')}
      ${input('ap_phone','A/P phone', row.ap_phone)}
      ${select('vat_chargeable','VAT chargeable', row.vat_chargeable? 'Yes' : 'No', ['Yes','No'])}
      ${input('payment_terms_days','Payment terms (days)', row.payment_terms_days || 30, 'number')}
    </div>
  `);

  // Rates tab: container only (Add button is rendered by renderClientRatesTable)
  if (key==='rates') return html(`<div id="clientRates"></div>`);

  // Settings tab: container only (real staged form rendered by renderClientSettingsUI)
  if (key==='settings') return html(`<div id="clientSettings"></div>`);

  // Hospitals tab: container only (table + Add button rendered by renderClientHospitalsTable)
  if (key==='hospitals') return html(`<div id="clientHospitals"></div>`);

  return '';
}
// =================== MOUNT CLIENT RATES TAB (unchanged glue) ===================
async function mountClientRatesTab() {
  // render uses modalCtx.ratesState directly; no args needed
  renderClientRatesTable();

  // wire the "Add / Upsert client window" button to the unified modal
  const btn = byId('btnAddClientRate');
  if (btn) btn.onclick = () => openClientRateModal(modalCtx.data?.id);
}

// =================== MOUNT HOSPITALS TAB (unchanged glue) ===================
function mountClientHospitalsTab() {
  renderClientHospitalsTable();
  const addBtn = byId('btnAddClientHospital');
  if (addBtn) addBtn.onclick = () => openClientHospitalModal(modalCtx.data?.id);
}



// === UPDATED: Client Default Rate modal (Role dropdown + new-role option; UK dates; date_to) ===
// ======================== openClientRateModal (FIXED) ========================
// =================== CLIENT DEFAULT RATE MODAL (UPDATED) ===================
// ✅ UPDATED — unified 3×5 grid (PAYE | Umbrella | Charge), date prefill, staged N−1 truncation of incumbent window
async function openClientRateModal(client_id, existing) {
  const parentToken  = modalCtx.openToken;
  const parentEntity = modalCtx.entity;

  const globalRoles = await loadGlobalRoleOptions();
  const roleOptions = globalRoles.map(r => `<option value="${r}">${r}</option>`).join('')
                    + `<option value="__OTHER__">+ Add new role…</option>`;

  const ex = existing || {};
  const formHtml = html(`
    <div class="form" id="clientRateForm">
      <div class="row">
        <label>Role (required)</label>
        <select name="role" id="cl_role" required>
          <option value="">Select role…</option>
          ${roleOptions}
        </select>
      </div>
      <div class="row" id="cl_role_new_row" style="display:none">
        <label>New role code</label>
        <input type="text" id="cl_role_new" placeholder="e.g. RMN-Lead" />
        <div class="hint">Uppercase letters/numbers/[-_/ ] recommended.</div>
      </div>

      <div class="row">
        <label>Band (optional)</label>
        <input type="text" name="band" id="cl_band" value="${ex.band ?? ''}" />
      </div>

      <div class="row">
        <label>Effective from (DD/MM/YYYY)</label>
        <input type="text" name="date_from" id="cl_date_from" placeholder="DD/MM/YYYY" />
      </div>
      <div class="row">
        <label>Effective to (optional, DD/MM/YYYY)</label>
        <input type="text" name="date_to" id="cl_date_to" placeholder="DD/MM/YYYY" />
      </div>

      <div class="row" style="grid-column: 1 / -1">
        <table class="grid" style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th>Bucket</th>
              <th>PAYE pay</th>
              <th>Umbrella pay</th>
              <th>Charge</th>
            </tr>
          </thead>
          <tbody>
            ${['day','night','sat','sun','bh'].map(bucket => `
              <tr>
                <td style="white-space:nowrap">${bucket.toUpperCase()}</td>
                <td><input type="number" step="0.01" name="paye_${bucket}" value="${ex[`paye_${bucket}`] ?? ''}" /></td>
                <td><input type="number" step="0.01" name="umb_${bucket}"  value="${ex[`umb_${bucket}`]  ?? ''}" /></td>
                <td><input type="number" step="0.01" name="charge_${bucket}" value="${ex[`charge_${bucket}`] ?? ''}" /></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="hint" style="margin-top:8px">
          Five-way buckets are rows (Day / Night / Sat / Sun / BH). Columns are PAYE pay, Umbrella pay, and Charge.
        </div>
      </div>

      <div class="row" style="grid-column:1/-1">
        <div id="cl_margin_box" class="hint" style="padding:8px;border:1px dashed #ddd;border-radius:8px">
          Enter values to preview margins for both PAYE and Umbrella.
        </div>
      </div>
    </div>
  `);

  const title = existing ? 'Edit Client Default Window' : 'Add/Upsert Client Default Window';

  showModal(
    title,
    [{ key:'form', label:'Form' }],
    () => formHtml,
    async () => {
      if (parentToken !== modalCtx.openToken || parentEntity !== 'clients' || modalCtx.data?.id !== client_id) {
        alert('This rate form is no longer current. Please reopen it.');
        throw new Error('STALE_CONTEXT');
      }

      const raw = collectForm('#clientRateForm');

      // role/new role
      let role = (raw.role || '').trim();
      const newRole = (document.getElementById('cl_role_new')?.value || '').trim();
      if (role === '__OTHER__') {
        if (!newRole) { alert('Enter a new role code'); throw new Error('VALIDATION'); }
        role = newRole.toUpperCase();
        if (typeof invalidateGlobalRoleOptionsCache === 'function') {
          try { invalidateGlobalRoleOptionsCache(); window.dispatchEvent(new CustomEvent('global-roles-updated')); } catch {}
        }
      }
      if (!role) { alert('Role is required'); throw new Error('VALIDATION'); }

      const isoFrom = parseUkDateToIso(raw.date_from);
      if (!isoFrom) { alert('Invalid “Effective from” date'); throw new Error('VALIDATION'); }
      let isoTo = null;
      if (raw.date_to) {
        isoTo = parseUkDateToIso(raw.date_to);
        if (!isoTo) { alert('Invalid “Effective to” date'); throw new Error('VALIDATION'); }
        if (isoTo < isoFrom) { alert('“Effective to” cannot be before “Effective from”'); throw new Error('VALIDATION'); }
      }

      const staged = {
        client_id: client_id,
        role,
        band: (raw.band || '').trim() || null,
        date_from: isoFrom,
        date_to:   isoTo,

        // charges
        charge_day  : raw['charge_day']  !== '' ? Number(raw['charge_day'])  : null,
        charge_night: raw['charge_night']!== '' ? Number(raw['charge_night']): null,
        charge_sat  : raw['charge_sat']  !== '' ? Number(raw['charge_sat'])  : null,
        charge_sun  : raw['charge_sun']  !== '' ? Number(raw['charge_sun'])  : null,
        charge_bh   : raw['charge_bh']   !== '' ? Number(raw['charge_bh'])   : null,

        // paye five-way
        paye_day   : raw['paye_day']   !== '' ? Number(raw['paye_day'])   : null,
        paye_night : raw['paye_night'] !== '' ? Number(raw['paye_night']) : null,
        paye_sat   : raw['paye_sat']   !== '' ? Number(raw['paye_sat'])   : null,
        paye_sun   : raw['paye_sun']   !== '' ? Number(raw['paye_sun'])   : null,
        paye_bh    : raw['paye_bh']    !== '' ? Number(raw['paye_bh'])    : null,

        // umbrella five-way
        umb_day    : raw['umb_day']    !== '' ? Number(raw['umb_day'])    : null,
        umb_night  : raw['umb_night']  !== '' ? Number(raw['umb_night'])  : null,
        umb_sat    : raw['umb_sat']    !== '' ? Number(raw['umb_sat'])    : null,
        umb_sun    : raw['umb_sun']    !== '' ? Number(raw['umb_sun'])    : null,
        umb_bh     : raw['umb_bh']     !== '' ? Number(raw['umb_bh'])     : null
      };

      const dayBeforeYmd = (ymd) => {
        if (!ymd) return null;
        const d = new Date(ymd + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth()+1).padStart(2,'0');
        const dd= String(d.getUTCDate()).padStart(2,'0');
        return `${y}-${m}-${dd}`;
      };

      // ROLLOVER: find any incumbent unified window for same (role,band) active at isoFrom
      const list = Array.isArray(modalCtx.ratesState) ? modalCtx.ratesState : [];
      const sameCat = r => String(r.role||'')===staged.role && String(r.band||'')===String(staged.band||'');
      const activeAtStart = list.filter(r => sameCat(r) && r.date_from && r.date_from <= staged.date_from && (!r.date_to || r.date_to >= staged.date_from));

      if (activeAtStart.length > 1) {
        alert(`Multiple active windows for role=${staged.role} band=${staged.band||'(none)'} at ${formatIsoToUk(isoFrom)}.\nPlease tidy them first.`);
        throw new Error('VALIDATION');
      }
      if (activeAtStart.length === 1) {
        const inc = activeAtStart[0];
        if (inc.date_from === staged.date_from) {
          alert(`A window for this role/band already starts on ${formatIsoToUk(isoFrom)}.\nEdit that window instead or choose a different start date.`);
          throw new Error('VALIDATION');
        }
        const cut = dayBeforeYmd(isoFrom);
        const ok = window.confirm(
          `An existing window ${formatIsoToUk(inc.date_from)} → ${formatIsoToUk(inc.date_to||'')} overlaps ${formatIsoToUk(isoFrom)}.\n`+
          `We will end it on ${formatIsoToUk(cut)}. Continue?`
        );
        if (!ok) throw new Error('CANCELLED');
        const idx = list.indexOf(inc);
        if (idx >= 0) {
          const patched = { ...inc, date_to: cut };
          modalCtx.ratesState[idx] = patched;
        }
      }

      // final overlap guard within staged set (same category)
      const after = (Array.isArray(modalCtx.ratesState) ? modalCtx.ratesState.slice() : []).filter(sameCat);
      for (const r of after) {
        if (existing && r === existing) continue;
        const a0 = r.date_from || null, a1 = r.date_to || null;
        const b0 = staged.date_from || null, b1 = staged.date_to || null;
        if (rangesOverlap(a0, a1, b0, b1)) {
          alert(`Window still overlaps existing ${formatIsoToUk(a0)}–${formatIsoToUk(a1||'')} for role=${staged.role} / ${staged.band||'(none)'}`);
          throw new Error('VALIDATION');
        }
      }

      // stage new/edited window
      modalCtx.ratesState = Array.isArray(modalCtx.ratesState) ? modalCtx.ratesState : [];
      if (existing) {
        const idx = modalCtx.ratesState.findIndex(r => r === existing);
        if (idx >= 0) modalCtx.ratesState[idx] = staged; else modalCtx.ratesState.push(staged);
      } else {
        modalCtx.ratesState.push(staged);
      }

      // refresh parent rates tab
      try {
        const parent = window.__modalStack && window.__modalStack[window.__modalStack.length - 2];
        if (parent && typeof parent.setTab === 'function') {
          parent.currentTabKey = 'rates';
          parent.setTab('rates');
        }
      } catch(_) {}

      return true;
    },
    false,
    () => {
      const parent = window.__modalStack && window.__modalStack[window.__modalStack.length-1];
      if (parent) { parent.currentTabKey = 'rates'; parent.setTab('rates'); }
    }
  );

  // After mount: prefill + wire
  const selRole = document.getElementById('cl_role');
  const newRow  = document.getElementById('cl_role_new_row');
  const inFrom  = document.getElementById('cl_date_from');
  const inTo    = document.getElementById('cl_date_to');
  const box     = document.getElementById('cl_margin_box');

  if (existing?.role) {
    selRole.value = globalRoles.includes(existing.role) ? existing.role : '__OTHER__';
    if (selRole.value === '__OTHER__') {
      newRow.style.display = '';
      const nr = document.getElementById('cl_role_new'); if (nr) nr.value = existing.role || '';
    }
  }
  if (existing?.date_from) inFrom.value = formatIsoToUk(existing.date_from);
  if (existing?.date_to   ) inTo.value   = formatIsoToUk(existing.date_to);

  attachUkDatePicker(inFrom);
  attachUkDatePicker(inTo);

  selRole.addEventListener('change', () => {
    if (selRole.value === '__OTHER__') newRow.style.display = '';
    else { newRow.style.display = 'none'; const nr = document.getElementById('cl_role_new'); if (nr) nr.value = ''; }
  });

  async function refreshClientMargin() {
    const s = await getSettingsCached();
    const erniPct = (() => {
      const v = s?.erni_pct;
      if (v == null) return 0;
      if (typeof v === 'string') {
        const m = v.trim();
        if (!m) return 0;
        if (m.endsWith('%')) {
          const n = parseFloat(m.slice(0,-1));
          return Number.isFinite(n) ? Math.max(0, n/100) : 0;
        }
        const n = parseFloat(m);
        return Number.isFinite(n) ? (n > 1 ? n/100 : n) : 0;
      }
      const n = Number(v);
      return Number.isFinite(n) ? (n > 1 ? n/100 : n) : 0;
    })();

    const raw = collectForm('#clientRateForm');
    const chg  = {}, paye={}, umb ={};
    for (const k of ['day','night','sat','sun','bh']) {
      chg[k]  = raw[`charge_${k}`] !== '' ? Number(raw[`charge_${k}`]) : null;
      paye[k] = raw[`paye_${k}`]   !== '' ? Number(raw[`paye_${k}`])   : null;
      umb[k]  = raw[`umb_${k}`]    !== '' ? Number(raw[`umb_${k}`])    : null;
    }
    const line = (label, k) => {
      const mP = calcMargin(chg[k], paye[k], 'PAYE',      erniPct);
      const mU = calcMargin(chg[k], umb[k] , 'UMBRELLA',  0);
      const vP = (chg[k]==null || paye[k]==null) ? '—' : `£${mP.toFixed(2)}`;
      const vU = (chg[k]==null || umb[k] ==null) ? '—' : `£${mU.toFixed(2)}`;
      return `<tr><td>${label}</td><td>${vP}</td><td>${vU}</td></tr>`;
    };
    box.innerHTML = `
      <table class="grid"><thead><tr><th>Bucket</th><th>Margin (PAYE)</th><th>Margin (Umbrella)</th></tr></thead>
      <tbody>
        ${line('Day','day')}
        ${line('Night','night')}
        ${line('Sat','sat')}
        ${line('Sun','sun')}
        ${line('BH','bh')}
      </tbody></table>
      <div class="hint" style="margin-top:6px">
        PAYE margin uses Employers NI ${ (erniPct*100).toFixed(2) }%. Umbrella margin = charge − pay.
      </div>`;
  }
  document.querySelectorAll('#clientRateForm input[type="number"]').forEach(el => el.addEventListener('input', refreshClientMargin));
  await refreshClientMargin();
}


// =================== ADD HOSPITAL MODAL (UPDATED: push into stagedNew) ===================
// ==== CHILD MODAL (ADD HOSPITAL) — throw on errors; return true on success ====
function openClientHospitalModal(client_id) {
  const formHtml = html(`
    <div class="form" id="hospitalForm">
      ${input('hospital_name_norm','Hospital / Trust (normalised)','')}
      ${input('ward_hint','Ward hint (optional)','')}
    </div>
  `);

  showModal(
    'Add Hospital / Ward',
    [{key:'form',label:'Form'}],
    () => formHtml,
    async ()=> {
      const raw  = collectForm('#hospitalForm');
      const name = String(raw.hospital_name_norm || '').trim();
      if (!name) { alert('Hospital / Trust is required'); throw new Error('VALIDATION'); }

      const H = modalCtx.hospitalsState || (modalCtx.hospitalsState = { existing: [], stagedNew: [], stagedEdits:{}, stagedDeletes: new Set() });
      H.stagedNew.push({ hospital_name_norm: name, ward_hint: (raw.ward_hint || '').trim() || null });

      return true; // success: close child modal; parent Hospitals tab will refresh onReturn
    },
    false,
    () => {
      const parent = window.__modalStack && window.__modalStack[window.__modalStack.length-1];
      if (parent) { parent.currentTabKey = 'hospitals'; parent.setTab('hospitals'); }
    }
  );
}



// =================== HOSPITALS TABLE (UPDATED: staged delete & edit) ===================
function renderClientHospitalsTable() {
  const el = byId('clientHospitals'); if (!el) return;

  const H = modalCtx.hospitalsState || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };
  el.innerHTML = '';

  const tbl = document.createElement('table'); tbl.className = 'grid';
  const cols = ['hospital_name_norm','ward_hint','status'];
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  cols.forEach(c => { const th = document.createElement('th'); th.textContent = c; trh.appendChild(th); });
  thead.appendChild(trh); tbl.appendChild(thead);

  const tb = document.createElement('tbody');

  // Existing rows (DB)
  (H.existing || []).forEach((x) => {
    const tr = document.createElement('tr');
    if (H.stagedDeletes.has(x.id)) tr.style.textDecoration = 'line-through';

    const nameTd = document.createElement('td');
    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.value = x.hospital_name_norm || '';
    nameInp.oninput = () => {
      H.stagedEdits[String(x.id)] = { ...(H.stagedEdits[String(x.id)] || {}), hospital_name_norm: nameInp.value };
    };
    nameTd.appendChild(nameInp);

    const hintTd = document.createElement('td');
    const hintInp = document.createElement('input');
    hintInp.type = 'text'; hintInp.value = x.ward_hint || '';
    hintInp.oninput = () => {
      H.stagedEdits[String(x.id)] = { ...(H.stagedEdits[String(x.id)] || {}), ward_hint: hintInp.value || null };
    };
    hintTd.appendChild(hintInp);

    const actTd = document.createElement('td');
    const toggle = document.createElement('button');
    toggle.textContent = H.stagedDeletes.has(x.id) ? 'Undo remove' : 'Remove';
    toggle.onclick = () => {
      if (H.stagedDeletes.has(x.id)) {
        H.stagedDeletes.delete(x.id);
      } else {
        H.stagedDeletes.add(x.id);
      }
      renderClientHospitalsTable();
    };
    actTd.appendChild(toggle);

    tr.appendChild(nameTd); tr.appendChild(hintTd); tr.appendChild(actTd);
    tb.appendChild(tr);
  });

  // New (unsaved) rows
  (H.stagedNew || []).forEach((x, idx) => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.value = x.hospital_name_norm || '';
    nameInp.oninput = () => { x.hospital_name_norm = nameInp.value; };
    nameTd.appendChild(nameInp);

    const hintTd = document.createElement('td');
    const hintInp = document.createElement('input');
    hintInp.type = 'text'; hintInp.value = x.ward_hint || '';
    hintInp.oninput = () => { x.ward_hint = hintInp.value || null; };
    hintTd.appendChild(hintInp);

    const actTd = document.createElement('td');
    const rm = document.createElement('button'); rm.textContent = 'Remove (staged)';
    rm.onclick = () => { H.stagedNew.splice(idx, 1); renderClientHospitalsTable(); };
    actTd.appendChild(rm);

    tr.appendChild(nameTd); tr.appendChild(hintTd); tr.appendChild(actTd);
    tb.appendChild(tr);
  });

  tbl.appendChild(tb);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `<button id="btnAddClientHospital">Add Hospital / Ward</button>`;

  el.appendChild(tbl);
  el.appendChild(actions);

  const addBtn = byId('btnAddClientHospital');
  if (addBtn) addBtn.onclick = () => openClientHospitalModal(modalCtx.data?.id);
}



async function renderClientSettingsUI(settingsObj){
  const div = byId('clientSettings'); if (!div) return;

  // Use staged object; fall back to what we were passed
  const initial = (modalCtx.clientSettingsState && typeof modalCtx.clientSettingsState === 'object')
    ? modalCtx.clientSettingsState
    : (settingsObj && typeof settingsObj === 'object' ? settingsObj : {});

  // Fill sensible defaults (non-destructive)
  const s = {
    timezone_id : initial.timezone_id ?? 'Europe/London',
    day_start   : initial.day_start   ?? '06:00',
    day_end     : initial.day_end     ?? '20:00',
    night_start : initial.night_start ?? '20:00',
    night_end   : initial.night_end   ?? '06:00'
  };

  // Persist initial back into staged state (one source of truth)
  modalCtx.clientSettingsState = { ...initial, ...s };

  // Render structured form (no raw JSON box)
  div.innerHTML = `
    <div class="form" id="clientSettingsForm">
      ${input('timezone_id','Timezone', s.timezone_id)}
      ${input('day_start','Day shift starts (HH:MM)', s.day_start, 'time')}
      ${input('day_end','Day shift ends (HH:MM)', s.day_end, 'time')}
      ${input('night_start','Night shift starts (HH:MM)', s.night_start, 'time')}
      ${input('night_end','Night shift ends (HH:MM)', s.night_end, 'time')}
      <div class="hint" style="grid-column:1/-1">
        Example: Day 06:00–20:00, Night 20:00–06:00. These settings override global defaults for this client only.
      </div>
    </div>
  `;

  // Two‑way binding: update staged settings on any input/change
  const root = document.getElementById('clientSettingsForm');
  const sync = ()=>{
    const vals = collectForm('#clientSettingsForm', false);
    // Minimal validation: HH:MM 24‑hour
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    ['day_start','day_end','night_start','night_end'].forEach(k=>{
      if (vals[k] && !hhmm.test(vals[k])) {
        alert(`${k.replace('_',' ')} must be HH:MM (24-hour)`);
        // do not write invalid values into staged state
        delete vals[k];
      }
    });
    modalCtx.clientSettingsState = { ...modalCtx.clientSettingsState, ...vals };
  };
  root.addEventListener('input',  sync, true);
  root.addEventListener('change', sync, true);
}

// ---- Umbrella modal
// ========================= openUmbrella (FIXED) =========================
async function openUmbrella(row){
  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));
  const seedId = row?.id || null;

  // Fresh, isolated modal context for this record
  modalCtx = {
    entity: 'umbrellas',
    data: deep(row),
    formState: { __forId: seedId, main: {} },
    rolesState: null,
    ratesState: null,
    clientSettingsState: null,
    openToken: (seedId || 'new') + ':' + Date.now()
  };

  showModal(
    'Umbrella',
    [{ key:'main', label:'Main' }],
    // Use rowForTab (second arg) provided by showModal to avoid stale closure
    (key, r)=> html(`
      <div class="form" id="tab-main">
        ${input('name','Name', r?.name)}
        ${input('remittance_email','Remittance email', r?.remittance_email, 'email')}
        ${input('bank_name','Bank', r?.bank_name)}
        ${input('sort_code','Sort code', r?.sort_code)}
        ${input('account_number','Account number', r?.account_number)}
        ${select('vat_chargeable','VAT chargeable', (r?.vat_chargeable? 'Yes' : 'No'), ['Yes','No'])}
        ${select('enabled','Enabled', (r?.enabled===false)?'No':'Yes', ['Yes','No'])}
      </div>
    `),
    async ()=>{
      // Only use staged state if it belongs to THIS record
      const fs = modalCtx.formState || { __forId: null, main:{} };
      const sameRecord = (!!modalCtx.data?.id && fs.__forId === modalCtx.data.id) || (!modalCtx.data?.id && fs.__forId == null);

      const staged = sameRecord ? (fs.main || {}) : {};
      const live   = collectForm('#tab-main');
      const payload = { ...staged, ...live };

      payload.vat_chargeable = payload.vat_chargeable === 'Yes';
      payload.enabled = payload.enabled !== 'No';

      // Strip empty-string fields
      for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];

      const idForUpdate = modalCtx?.data?.id || row?.id || null;
      await upsertUmbrella(payload, idForUpdate);

      // Clear staged state and close
      modalCtx.formState = { __forId: idForUpdate || null, main: {} };
      closeModal();
      renderAll();
    },
    row?.id
  );
}


// ---- Audit (Outbox)
function openAuditItem(row){
  const body = html(`
    <div class="form">
      ${readonly('Type', row.type)}
      ${readonly('To', row.to)}
      ${readonly('Subject', row.subject)}
      ${readonly('Status', row.status)}
      <div class="row" style="grid-column:1/-1"><label>Last error</label><textarea readonly>${row.last_error || ''}</textarea></div>
    </div>
  `);
  showModal('Outbox', [{key:'v',label:'View'}], ()=>body, async ()=>{ closeModal(); }, row?.id);
  const act = byId('modalActions');
  const retry = document.createElement('button'); retry.textContent='Retry send';
  retry.onclick = async ()=>{ await retryOutbox(row.id); alert('Retry queued'); }
  act.insertBefore(retry, byId('btnSave'));
}

// ---- Settings (global defaults)
async function renderSettingsPanel(content){
  // Load settings with a visible error if the call fails
  let s;
  try {
    // getSettings() should now unwrap { settings: {...} } → {...}
    s = await getSettings();
  } catch (e) {
    content.innerHTML = `
      <div class="tabc">
        <div class="error">Couldn’t load settings: ${e?.message || 'Unknown error'}</div>
      </div>`;
    return;
  }

  // Prefer the new key; fall back to legacy if needed (still GLOBAL-only)
  const erniValue = (s.employers_ni_pct ?? s.erni_pct ?? 0);

  content.innerHTML = `
    <div class="tabc">
      <div class="form" id="settingsForm">
        ${input('timezone_id','Timezone', s.timezone_id || 'Europe/London')}
        ${input('day_start','Day start', s.day_start || '06:00')}
        ${input('day_end','Day end', s.day_end || '20:00')}
        ${input('night_start','Night start', s.night_start || '20:00')}
        ${input('night_end','Night end', s.night_end || '06:00')}
        ${select('bh_source','Bank Holidays source', s.bh_source || 'MANUAL', ['MANUAL','FEED'])}
        <div class="row" style="grid-column:1/-1">
          <label>Bank Holidays list (JSON dates)</label>
          <textarea name="bh_list">${JSON.stringify(s.bh_list || [], null, 2)}</textarea>
        </div>
        ${input('bh_feed_url','BH feed URL', s.bh_feed_url || '')}
        ${input('vat_rate_pct','VAT %', s.vat_rate_pct ?? 20)}
        ${input('holiday_pay_pct','Holiday pay %', s.holiday_pay_pct ?? 0)}
        ${input('erni_pct','ERNI %', erniValue)}
        ${select('apply_holiday_to','Apply holiday to', s.apply_holiday_to || 'PAYE_ONLY', ['PAYE_ONLY','ALL','NONE'])}
        ${select('apply_erni_to','Apply ERNI to', s.apply_erni_to || 'PAYE_ONLY', ['PAYE_ONLY','ALL','NONE'])}
        <div class="row" style="grid-column:1/-1">
          <label>Margin includes (JSON)</label>
          <textarea name="margin_includes">${JSON.stringify(s.margin_includes || {}, null, 2)}</textarea>
        </div>

        <div class="row">
          <label>Effective from (DD/MM/YYYY)</label>
          <input type="text" name="effective_from" id="settings_effective_from" placeholder="DD/MM/YYYY"
                 value="${s.effective_from ? formatIsoToUk(s.effective_from) : ''}" />
        </div>
      </div>
      <div class="actions">
        <div class="spacer"></div>
        <button id="btnSaveSettings" class="primary">Save defaults</button>
      </div>
    </div>
  `;

  // Attach UK date picker
  const eff = document.getElementById('settings_effective_from');
  if (eff) attachUkDatePicker(eff);

  byId('btnSaveSettings').onclick = async ()=>{
    const payload = collectForm('#settingsForm', true);

    // Convert UK date (if present)
    if (payload.effective_from) {
      const iso = parseUkDateToIso(payload.effective_from);
      if (!iso) { alert('Invalid Effective from date'); return; }
      payload.effective_from = iso;
    }

    // ERNI is global-only; just pass the field as entered (backend owns validation)
    try {
      await saveSettings(payload);
      alert('Saved.');
    } catch (e) {
      alert('Save failed: ' + (e?.message || 'Unknown error'));
    }
  };
}

// ===== Generic modal plumbing =====

// =============================== showModal (FIXED) ===============================
// ==== FIXED MODAL FRAMEWORK: close only on explicit success from onSave ====
// ==== CHILD MODAL (CANDIDATE RATE) — throw on errors; return true on success ====



// =============================== closeModal (kept) ===============================
function closeModal(){
  if (!window.__modalStack || !window.__modalStack.length) {
    // nothing to close; ensure overlay hidden and geometry clean
    discardAllModalsAndState();
    return;
  }

  // Sanitize geometry before changing frames
  const m = byId('modal');
  if (m) {
    m.style.position = '';
    m.style.left = '';
    m.style.top = '';
    m.style.right = '';
    m.style.bottom = '';
    m.style.transform = '';
    m.classList.remove('dragging');
  }
  document.onmousemove = null;
  document.onmouseup   = null;

  const closing = window.__modalStack.pop();
  if (closing) {
    // Detach per-frame listeners
    if (closing._detachDirty)  { try { closing._detachDirty();  } catch(_) {} closing._detachDirty  = null; }
    if (closing._detachGlobal) { try { closing._detachGlobal(); } catch(_) {} closing._detachGlobal = null; }
  }

  if (window.__modalStack.length > 0) {
    const parent = window.__modalStack[window.__modalStack.length - 1];
    byId('modalBack').style.display = 'flex';

    // Rebuild tabs
    const tabsEl = byId('modalTabs'); tabsEl.innerHTML = '';
    (parent.tabs || []).forEach((t) => {
      const b = document.createElement('button');
      b.textContent = t.label;
      if (t.key === parent.currentTabKey) b.classList.add('active');
      b.onclick = () => {
        tabsEl.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        parent.setTab(t.key);
      };
      tabsEl.appendChild(b);
    });

    // Re-show parent current tab
    if (parent.currentTabKey) parent.setTab(parent.currentTabKey);
    else if (parent.tabs && parent.tabs[0]) parent.setTab(parent.tabs[0].key);
  } else {
    // last frame closed -> full teardown so nothing lingers
    discardAllModalsAndState();
  }
}



// ===== Small helpers =====
const html = (s)=> s;
const input = (name, label, val='', type='text', extra='') => `<div class="row"><label>${label}</label><input name="${name}" type="${type}" value="${val ?? ''}" ${extra}/></div>`;
const select = (name, label, val, options=[], extra={})=>{
  const id = extra.id ? `id="${extra.id}"` : '';
  const opts = options.map(o=>`<option ${String(o)===String(val)?'selected':''}>${o}</option>`).join('');
  return `<div class="row"><label>${label}</label><select name="${name}" ${id}>${opts}</select></div>`;
};
const readonly = (label, value)=> `<div class="row"><label>${label}</label><input value="${value ?? ''}" readonly/></div>`;

function collectForm(sel, jsonTry=false){
  const root = document.querySelector(sel);
  if (!root) return {}; // null-safe

  const out = {};
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    const k = el.name; if (!k) return;
    let v = el.value;

    // keep blanks as '' so callers can map '' → null (fixes 0 vs null)
    if (el.type === 'number') v = (el.value === '' ? '' : Number(el.value));

    // Yes/No -> boolean (existing behaviour)
    if (el.tagName === 'SELECT' && (v === 'Yes' || v === 'No')) v = (v === 'Yes');

    // Optional JSON parses for specific fields
    if (jsonTry && (k === 'bh_list' || k === 'margin_includes')) {
      try { v = JSON.parse(v || (k === 'bh_list' ? '[]' : '{}')); } catch {}
    }

    out[k] = v;
  });
  return out;
}

// ==== FIXED MODAL FRAMEWORK: close only on explicit success from onSave ====
// ==== FIXED MODAL FRAMEWORK: close only on explicit success from onSave ====

function showModal(title, tabs, renderTab, onSave, hasId, onReturn) {
  // Sanitize any previous geometry so we never inherit a dragged position
  const modalEl = byId('modal');
  if (modalEl) {
    modalEl.style.position = '';
    modalEl.style.left = '';
    modalEl.style.top = '';
    modalEl.style.right = '';
    modalEl.style.bottom = '';
    modalEl.style.transform = '';
    modalEl.classList.remove('dragging');
  }

  if (!window.__modalStack) window.__modalStack = [];
  const closeToken = (showModal._tokenCounter = (showModal._tokenCounter || 0) + 1);

  function sanitizeModalGeometry() {
    const m = byId('modal');
    if (m) {
      m.style.position = '';
      m.style.left = '';
      m.style.top = '';
      m.style.right = '';
      m.style.bottom = '';
      m.style.transform = '';
      m.classList.remove('dragging');
    }
    document.onmousemove = null;
    document.onmouseup   = null;
  }

  const frame = {
    title,
    tabs: Array.isArray(tabs) ? tabs.slice() : [],
    renderTab,
    onSave,
    onReturn,
    hasId: !!hasId,
    entity: modalCtx.entity,
    currentTabKey: (Array.isArray(tabs) && tabs.length ? tabs[0].key : null),
    isDirty: false,
    _detachDirty: null,
    _detachGlobal: null,
    _hasMountedOnce: false,
    _wired: false,      // single-attach guard for global listeners
    _closing: false,    // re-entrancy guard for close/discard

    persistCurrentTabState() {
      const back = byId('modalBack');
      const overlayVisible = back && getComputedStyle(back).display !== 'none';
      if (!overlayVisible) return;

      if (this.currentTabKey === 'main' && byId('tab-main')) {
        const cur = collectForm('#tab-main');
        const fs = modalCtx.formState || { __forId: modalCtx.data?.id || null, main:{}, pay:{} };
        if (fs.__forId == null) fs.__forId = modalCtx.data?.id || null;
        modalCtx.formState = fs;
        modalCtx.formState.main = { ...(modalCtx.formState.main||{}), ...cur };
      }
      if (this.currentTabKey === 'pay' && byId('tab-pay')) {
        const cur = collectForm('#tab-pay');
        const fs = modalCtx.formState || { __forId: modalCtx.data?.id || null, main:{}, pay:{} };
        if (fs.__forId == null) fs.__forId = modalCtx.data?.id || null;
        modalCtx.formState = fs;
        modalCtx.formState.pay = { ...(modalCtx.formState.pay||{}), ...cur };
      }
    },

    mergedRowForTab(k) {
      const base = { ...modalCtx.data };
      const fs = modalCtx.formState;
      const sameRecord = fs && fs.__forId === modalCtx.data?.id;

      if (k === 'main') return sameRecord ? { ...base, ...(fs.main || {}) } : base;
      if (k === 'pay')  return sameRecord ? { ...base, ...(fs.pay  || {}) } : base;
      return base;
    },

    _attachDirtyTracker() {
      if (this._detachDirty) { try { this._detachDirty(); } catch(_){}; this._detachDirty = null; }
      const root = byId('modalBody');
      if (!root) return;
      const onDirty = ()=>{
        this.isDirty = true;
        try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
      };
      root.addEventListener('input', onDirty, true);
      root.addEventListener('change', onDirty, true);
      this._detachDirty = ()=>{
        root.removeEventListener('input', onDirty, true);
        root.removeEventListener('change', onDirty, true);
      };
    },

    setTab(k) {
      if (this._hasMountedOnce) this.persistCurrentTabState();

      const rowForTab = this.mergedRowForTab(k);
      byId('modalBody').innerHTML = this.renderTab(k, rowForTab) || '';

      if (this.entity === 'candidates' && k === 'rates') { mountCandidateRatesTab?.(); }
      if (this.entity === 'candidates' && k === 'pay')   { mountCandidatePayTab?.(); }

      if (this.entity === 'candidates' && k === 'main') {
        const pmSel = document.querySelector('#pay-method');
        if (pmSel) {
          pmSel.addEventListener('change', () => {
            modalCtx.payMethodState = pmSel.value;
            try { window.dispatchEvent(new CustomEvent('pay-method-changed')); }
            catch { window.dispatchEvent(new Event('pay-method-changed')); }
          });
          modalCtx.payMethodState = pmSel.value;
        }

        const el = document.querySelector('#rolesEditor');
        if (el) {
          (async () => {
            try {
              const opts = await loadGlobalRoleOptions();
              renderRolesEditor(el, modalCtx.rolesState || [], opts);
            } catch (e) {
              console.error('[MODAL] roles mount failed', e);
            }
          })();
        }
      }

      if (this.entity === 'clients' && k === 'rates')     { mountClientRatesTab?.(); }
      if (this.entity === 'clients' && k === 'hospitals') { mountClientHospitalsTab?.(); }
      if (this.entity === 'clients' && k === 'settings')  { renderClientSettingsUI?.(modalCtx.clientSettingsState || {}); }

      this.currentTabKey = k;
      this._attachDirtyTracker();
      this._hasMountedOnce = true;
    }
  };

  window.__modalStack.push(frame);
  byId('modalBack').style.display = 'flex';

  function renderTop() {
    const depth = window.__modalStack.length;
    const top = window.__modalStack[window.__modalStack.length - 1];
    const isChild = depth > 1;

    // Ensure we don't keep stale global listeners between renders
    if (typeof top._detachGlobal === 'function') {
      try { top._detachGlobal(); } catch(_) {}
      top._wired = false;
    }

    byId('modalTitle').textContent = top.title;

    const tabsEl = byId('modalTabs');
    tabsEl.innerHTML = '';
    (top.tabs || []).forEach((t, i) => {
      const b = document.createElement('button');
      b.textContent = t.label;
      if (i === 0 && !top.currentTabKey) top.currentTabKey = t.key;
      if (t.key === top.currentTabKey || (i === 0 && !top.currentTabKey)) b.classList.add('active');
      b.onclick = () => {
        tabsEl.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        top.setTab(t.key);
      };
      tabsEl.appendChild(b);
    });

    if (top.currentTabKey) top.setTab(top.currentTabKey);
    else if (top.tabs && top.tabs[0]) top.setTab(top.tabs[0].key);
    else byId('modalBody').innerHTML = top.renderTab('form', {}) || '';

    const primaryBtn = byId('btnSave');
    const discardBtn = byId('btnCloseModal');
    const backEl     = byId('modalBack');

    // 🔧 Primary label mapping (keeps UX clean without changing signature)
    const defaultPrimary = isChild ? 'Apply' : 'Save';
    let primaryLabel = defaultPrimary;
    if (top.title === 'Advanced Search')    primaryLabel = 'Search';
    if (top.title === 'Load saved search')  primaryLabel = 'Load';
    if (top.title === 'Save search')        primaryLabel = 'Save';

    primaryBtn.textContent = primaryLabel;
    primaryBtn.setAttribute('aria-label', primaryLabel);

    const delBtn = byId('btnDelete');
    delBtn.style.display = top.hasId ? '' : 'none';
    delBtn.onclick = openDelete;

    function updateSecondaryLabel() {
      const label = top.isDirty ? 'Discard' : 'Close';
      discardBtn.textContent = label;
      discardBtn.setAttribute('aria-label', label);
      discardBtn.setAttribute('title', top.isDirty ? 'Discard changes and close' : 'Close');
    }
    updateSecondaryLabel();

    const onDirtyLabel = () => updateSecondaryLabel();

    // Global wiring — single-attach with guard
    if (!top._wired) {
      window.addEventListener('modal-dirty', onDirtyLabel);

      const onEsc = (e) => { if (e.key === 'Escape') { e.preventDefault(); handleSecondary(); } };
      window.addEventListener('keydown', onEsc);

      const onOverlayClick = (e) => { if (e.target === backEl) handleSecondary(); };
      backEl.addEventListener('click', onOverlayClick, true);

      top._detachGlobal = () => {
        try { window.removeEventListener('modal-dirty', onDirtyLabel); } catch {}
        try { window.removeEventListener('keydown', onEsc); } catch {}
        try { backEl.removeEventListener('click', onOverlayClick, true); } catch {}
      };

      top._wired = true;
    }

    const handleSecondary = () => {
      if (top._closing) return;
      top._closing = true;

      if (top.isDirty) {
        const ok = window.confirm('You have unsaved changes. Discard them and close?');
        if (!ok) { top._closing = false; return; }
      }

      sanitizeModalGeometry();

      const closing = window.__modalStack.pop();
      if (closing && closing._detachDirty)  { try { closing._detachDirty(); } catch(_){}; closing._detachDirty = null; }
      if (closing && closing._detachGlobal) { try { closing._detachGlobal(); } catch(_){}; closing._detachGlobal = null; }
      top._wired = false;

      if (window.__modalStack.length > 0) {
        renderTop();
        const parent = window.__modalStack[window.__modalStack.length - 1];
        try { parent.onReturn && parent.onReturn(); } catch(_) {}
      } else {
        discardAllModalsAndState();
      }
    };

    // PRIMARY (Search/Load/Save/Apply): close ONLY on explicit success
    primaryBtn.onclick = async () => {
      top.persistCurrentTabState();

      let shouldClose = true;

      if (typeof top.onSave === 'function') {
        try {
          const res = await top.onSave();
          const ok  = (res === true) || (res && res.ok === true);
          if (ok) {
            top.isDirty = false;
            updateSecondaryLabel();
            shouldClose = true;
          } else {
            shouldClose = false;
          }
        } catch (e) {
          shouldClose = false;
        }
      }

      if (!window.__modalStack.length || window.__modalStack[window.__modalStack.length - 1] !== top) {
        return;
      }

      if (!shouldClose) return;

      sanitizeModalGeometry();

      if (isChild) {
        if (top._detachDirty)  { try { top._detachDirty(); } catch(_){}; top._detachDirty = null; }
        if (top._detachGlobal) { try { top._detachGlobal(); } catch(_){}; top._detachGlobal = null; }
        top._wired = false;
        window.__modalStack.pop();
        if (window.__modalStack.length > 0) {
          const parent = window.__modalStack[window.__modalStack.length - 1];
          renderTop();
          try { parent.onReturn && parent.onReturn(); } catch(_) {}
        } else {
          discardAllModalsAndState();
        }
      } else {
        if (top._detachGlobal) { try { top._detachGlobal(); } catch(_){}; top._detachGlobal = null; }
        window.removeEventListener('modal-dirty', onDirtyLabel); // safety
        discardAllModalsAndState();
      }
    };

    discardBtn.onclick = handleSecondary;

    // Drag (unchanged)
    const modal = byId('modal');
    const drag  = byId('modalDrag');
    let offX = 0, offY = 0, dragging = false;
    drag.onmousedown = (e) => {
      dragging = true; modal.classList.add('dragging'); offX = e.offsetX; offY = e.offsetY;
      document.onmousemove = mm; document.onmouseup = mu;
    };
    function mm(e){ if(!dragging) return; modal.style.position = 'absolute'; modal.style.left = (e.clientX - offX) + 'px'; modal.style.top = (e.clientY - offY) + 'px'; }
    function mu(){ dragging = false; modal.classList.remove('dragging'); document.onmousemove = null; document.onmouseup = null; }
  }

  renderTop();
}



// Close any existing floating menu
function closeRelatedMenu(){
  const m = document.getElementById('relatedMenu');
  if (m) m.remove();
  document.removeEventListener('click', closeRelatedMenu, { capture: true });
  document.removeEventListener('keydown', escCloseRelatedMenu, true);
}
function escCloseRelatedMenu(ev){
  if (ev.key === 'Escape') closeRelatedMenu();
}

// Create & show a context menu near (x,y)
// ========================= showRelatedMenu (FIXED) =========================
function showRelatedMenu(x, y, counts, entity, id){
  closeRelatedMenu();

  const entries = counts && typeof counts === 'object'
    ? Object.entries(counts).filter(([k])=>k && k.trim().length>0)
    : [];

  const menu = document.createElement('div');
  menu.id = 'relatedMenu';
  menu.style.position = 'fixed';
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  menu.style.zIndex = 1000;
  menu.style.minWidth = '220px';
  menu.style.maxWidth = '280px';
  menu.style.background = '#0b1221';
  menu.style.border = '1px solid #334155';
  menu.style.borderRadius = '10px';
  menu.style.boxShadow = '0 10px 24px rgba(0,0,0,.35)';
  menu.style.padding = '6px';
  menu.style.color = '#f8fafc';
  menu.style.font = '14px/1.4 system-ui,Segoe UI,Roboto,Helvetica,Arial';

  function item(label, disabled, onClick){
    const it = document.createElement('div');
    it.textContent = label;
    it.style.padding = '8px 10px';
    it.style.borderRadius = '8px';
    it.style.cursor = disabled ? 'default' : 'pointer';
    it.style.opacity = disabled ? '.6' : '1';
    it.onmouseenter = ()=>{ if (!disabled) it.style.background = 'rgba(255,255,255,.06)'; };
    it.onmouseleave = ()=>{ it.style.background = 'transparent'; };
    if (!disabled) it.onclick = async (ev)=>{
      ev.stopPropagation();
      const rows = await fetchRelated(entity, id, onClick.type);
      if (rows) {
        // When jumping sections via Related, tear down any open modal to avoid stale state
        if ((window.__modalStack?.length || 0) > 0 || modalCtx?.entity) {
          discardAllModalsAndState();
        }
        if (onClick.type === 'timesheets' || onClick.type === 'invoices') {
          currentSection = onClick.type;
        }
        renderSummary(rows);
      }
      closeRelatedMenu();
    };
    menu.appendChild(it);
  }

  if (!entries.length) {
    item('No related records', true, {});
  } else {
    entries.sort((a,b)=> (b[1]||0)-(a[1]||0));
    entries.forEach(([type, count])=>{
      const label = `${count} related ${type}`;
      item(label, count===0, { type });
    });
  }

  document.body.appendChild(menu);
  setTimeout(()=>{
    document.addEventListener('click', closeRelatedMenu, { capture: true, once: true });
    document.addEventListener('keydown', escCloseRelatedMenu, true);
  }, 0);

  menu.addEventListener('click', ev => ev.stopPropagation());
}

// ===== Quick search =====
// ✅ Quick search: build minimal per-section filters (with timesheet heuristic)
// ✅ Quick search: build minimal per-section filters (with timesheet heuristic)
// Helper to build minimal quick-search filters per section
function buildQuickFilters(section, text) {
  const q = String(text || '').trim();
  if (!q) return {};

  switch (section) {
    case 'clients':
    case 'umbrellas':
    case 'invoices':
      // backend supports ?q=... (ilike on name / invoice_no depending on endpoint)
      return { q: q };

    case 'timesheets': {
      // Pick ONE field to avoid AND-ing and missing matches
      const looksLikeUUID   = /^[0-9a-f-]{10,}$/i.test(q);
      const looksLikeBkId   = /^[A-Za-z0-9-]{6,}$/.test(q);
      const looksLikeOccKey = /^[A-Za-z0-9_.-]{4,}$/.test(q);

      if (looksLikeBkId || looksLikeUUID) return { booking_id: q };
      if (looksLikeOccKey)                return { occupant_key_norm: q };
      return { hospital_norm: q };
    }

    case 'candidates':
      return { first_name: q, last_name: q, email: q, phone: q };

    default:
      return {};
  }
}

// ✅ Quick search: use heuristic builder (includes timesheets fix)
byId('quickSearch').onkeydown = async (e) => {
  if (e.key !== 'Enter') return;

  const text = String(e.target.value || '').trim();
  if (!text) return renderAll();

  const filters = buildQuickFilters(currentStage ?? currentSection, text); // use your actual section var
  const rows = await search(currentSection, filters);
  if (rows) renderSummary(rows);
};

async function openSearch() {
  const q = prompt('Search text:');
  if (!q) return;

  // reflect in the quick box for consistency
  const box = byId('quickSearch');
  if (box) box.value = q;

  const filters = buildQuickFilters(currentSection, q);
  const rows = await search(currentSection, filters);
  if (rows) renderSummary(rows);
}

// OPTIONAL: open ALT+F for fast search
document.addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    openSearchModal();
  }
});





// ===== Boot =====
async function renderAll(){
  renderTopNav(); renderTools();
  const data = await loadSection();
  if (currentSection==='settings' || currentSection==='audit') renderSummary(data);
  else renderSummary(data); // list functions already return arrays via toList()
}
async function bootstrapApp(){
  ensureSelectionStyles();   // ← ensure the highlight is clearly visible
  renderTopNav();
  renderTools();
  await renderAll();
}


// Initialize
initAuthUI();
if (loadSession()) { scheduleRefresh(); bootstrapApp(); }
else openLogin();
