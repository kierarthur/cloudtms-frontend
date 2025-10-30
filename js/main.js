// ===== Base URL + helpers =====
const BROKER_BASE_URL = window.BROKER_BASE_URL;
const API = (path)=> `${BROKER_BASE_URL}${path}`;

let SESSION = null;  // {accessToken, user, exp}
let refreshTimer = 0;

// ==== DEBUG SWITCHES (global) ====
// Put this at the very top of main.js so all functions can read them.
window.__LOG_RATES  = true;   // logs for rate staging + rates table + rates tab
window.__LOG_PAYTAB = true;   // logs for payment tab + umbrella prefill
window.__LOG_MODAL  = true;   // logs from modal framework (showModal)
const __LOG_API = true;   // turns on authFetch + rates/hospitals/client POST/PATCH logging



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
  try {
    SESSION = JSON.parse(raw);

    // Mirror to globals used by currentUserId() — PRIMARY FIX
    try {
      if (typeof window !== 'undefined') {
        window.SESSION = SESSION;
        window.__auth = window.__auth || {};
        window.__auth.user = SESSION?.user || null;
        window.__USER_ID = SESSION?.user?.id || null;
      }
    } catch {}

    return SESSION;
  } catch {
    return null;
  }
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

// --- helpers for normalising/time validation ---
function _toHHMM(val) {
  if (val == null) return '';
  const s = String(val).trim();
  if (!s) return '';
  // accept HH:MM, HH:MM:SS, H:MM, HHMM
  const m = s.match(/^(\d{1,2}):?(\d{2})(?::(\d{2}))?$/);
  if (!m) return '';
  let hh = Number(m[1]), mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return '';
  return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
}

function _toHHMMSS(val) {
  const hm = _toHHMM(val);
  return hm ? hm + ':00' : null; // server likes HH:MM:SS (supabase time)
}

// Build a clean object to send to the API

function normalizeClientSettingsForSave(raw) {
  const src = raw || {};
  const out = {};
  // Only normalise keys that were actually provided (form/baseline),
  // and only flag invalid when a provided key fails HH:MM
  let invalid = false;

  ['day_start','day_end','night_start','night_end','timezone_id'].forEach(k => {
    if (!(k in src)) return;            // not provided → ignore
    const v = src[k];
    if (k === 'timezone_id') { if (v) out[k] = String(v); return; }
    if (v == null || v === '') return;  // empty → ignore (do not mark invalid)
    const hhmmss = _toHHMMSS(v);        // returns null if fails
    if (hhmmss === null) { invalid = true; return; }
    out[k] = hhmmss;
  });

  return { cleaned: out, invalid };
}

// ===== Auth fetch with refresh retry =====
async function authFetch(input, init={}){
  const APILOG = (typeof window !== 'undefined' && !!window.__LOG_API) || (typeof __LOG_API !== 'undefined' && !!__LOG_API);
  const headers = new Headers(init.headers || {});
  if (SESSION?.accessToken) headers.set('Authorization', `Bearer ${SESSION.accessToken}`);
  if (APILOG) {
    const safeHeaders = {};
    headers.forEach((v,k)=>{ safeHeaders[k] = (k.toLowerCase()==='authorization') ? '***' : v; });
    const bodyPreview = typeof init.body === 'string' ? (init.body.length > 500 ? init.body.slice(0,500)+'…' : init.body) : init.body;
    console.log('[authFetch] →', { url: typeof input==='string'?input:input?.url, method: (init.method||'GET'), headers: safeHeaders, body: bodyPreview });
  }
  let res = await fetch(input, { ...init, headers, credentials: init.credentials || 'omit' });
  if (APILOG) {
    try { const txt = await res.clone().text(); console.log('[authFetch] ←', res.status, res.ok, txt.slice(0,500)); } catch {}
  }
  if (res.status === 401) {
    const ok = await refreshToken();
    if (!ok) throw new Error('Unauthorised');
    headers.set('Authorization', `Bearer ${SESSION.accessToken}`);
    if (APILOG) console.log('[authFetch] retrying after 401');
    res = await fetch(input, { ...init, headers, credentials: init.credentials || 'omit' });
    if (APILOG) {
      try { const txt2 = await res.clone().text(); console.log('[authFetch] ← (retry)', res.status, res.ok, txt2.slice(0,500)); } catch {}
    }
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

// single, de-duplicated definition
async function refreshToken(){
  try{
    const res = await fetch(API('/auth/refresh'), {
      method:'POST',
      credentials:'include',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({})
    });
    if (!res.ok) { clearSession(); return false; }

    const data  = await res.json();
    const token = data.access_token || data.token || data.accessToken;
    const ttl   = data.expires_in || data.token_ttl_sec || data.ttl || 3600;

    // Preserve existing user; hydrate if missing id
    let user = SESSION?.user || data.user || null;
    if (!user || !user.id) {
      try {
        const meRes = await fetch(API('/api/me'), { headers: { 'Authorization': `Bearer ${token}` } });
        if (meRes.ok) {
          const meJson = await meRes.json().catch(()=> ({}));
          user = (meJson && (meJson.user || meJson)) || user;
        }
      } catch {}
      // Extra guard: fall back to persisted user if present
      if (!user || !user.id) {
        try {
          const persisted = JSON.parse(localStorage.getItem('cloudtms.session')
                           || sessionStorage.getItem('cloudtms.session') || 'null');
          if (persisted?.user?.id) user = persisted.user;
        } catch {}
      }
    }

    saveSession({
      accessToken: token,
      user,
      exp: Math.floor(Date.now()/1000) + ttl
    });
    return true;
  }catch{
    clearSession();
    return false;
  }
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
  // Keep user_id in cache so ownership checks work downstream
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
        const overwriteWrap  = form.querySelector('#overwriteWrap'); // ✅ updated to match current modal markup
        const selectEl       = form.querySelector('#overwritePresetId');

        if (overwriteRadio) overwriteRadio.checked = true;
        if (overwriteWrap)  overwriteWrap.style.display = 'block'; // reveal the dropdown

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

// === REPLACE: openSaveSearchModal (no currentWorked; built-in sanitize) ===
// === REPLACE: openSaveSearchModal (radio-safe + stable layout + full-width dropdown)
async function openSaveSearchModal(section, filters){
  // sanitizer…
  const sanitize = (typeof window !== 'undefined' && typeof window.sanitize === 'function')
    ? window.sanitize
    : (s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                           .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'));

  // Only the caller's presets for overwrite list (server-side gate)…
  const mineServer = await listReportPresets({ section, kind: 'search', include_shared: false }).catch(()=>[]);
  // …and client-side belt & braces in case server behavior changes
  const myId = currentUserId();
  const mine = (mineServer || []).filter(m => String(m.user_id) === String(myId));

  const hasOwned = Array.isArray(mine) && mine.length > 0;
  const optionsHtml = hasOwned
    ? mine.map(m => `<option value="${m.id}">${sanitize(m.name)}</option>`).join('')
    : '';

  const body = html(`
    <div class="form" id="saveSearchForm" style="max-width:640px">
      <div class="row">
        <label for="presetName">Preset name</label>
        <div class="controls">
          <input id="presetName" name="preset_name" class="input" placeholder="e.g. ‘PAYE RMNs’" />
        </div>
      </div>

      <div class="row">
        <label>Mode</label>
        <div class="controls" style="display:flex;flex-direction:column;gap:8px;min-width:0">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <label class="inline"><input type="radio" name="mode" value="new" checked> <span>Save as new</span></label>
            <label class="inline">
              <input type="radio" name="mode" value="overwrite" ${hasOwned ? '' : 'disabled'}>
              <span>Overwrite existing</span>
            </label>
          </div>
          <div id="overwriteWrap" style="display:none; width:100%; max-width:100%">
            <div style="font-size:12px; color:#6b7280; margin:2px 0 4px">${hasOwned ? 'Choose preset to overwrite' : 'You don’t own any presets to overwrite'}</div>
            <select id="overwritePresetId" class="select" style="width:100%; max-width:100%">${optionsHtml}</select>
          </div>
        </div>
      </div>

      <div class="row">
        <label for="presetShared">Visibility</label>
        <div class="controls">
          <label class="inline"><input id="presetShared" type="checkbox"> <span>Visible to all users</span></label>
        </div>
      </div>
    </div>
  `);

  // NOTE: pass utility flags here
  showModal(
    'Save search',
    [{ key: 'form', label: 'Details' }],
    () => body,
    async () => {
      const modeInput = document.querySelector('#saveSearchForm input[name="mode"]:checked');
      const mode  = (modeInput?.value || 'new').toLowerCase();
      const name  = String(document.getElementById('presetName')?.value || '').trim();
      const share = !!document.getElementById('presetShared')?.checked;

      if (!name && mode === 'new') { alert('Please enter a name'); return false; }

      try {
        if (mode === 'overwrite') {
          if (!hasOwned) { alert('You don’t own any presets to overwrite'); return false; }
          const targetId = (document.getElementById('overwritePresetId')?.value) || '';
          if (!targetId) { alert('Select a preset to overwrite'); return false; }
          await updateReportPreset({ id: targetId, name: name || undefined, filters, is_shared: share });
        } else {
          await createReportPreset({ section, kind: 'search', name, filters, is_shared: share });
        }
        invalidatePresetCache(section, 'search');
        try { window.dispatchEvent(new Event('search-preset-updated')); } catch(_) {}
        return true;
      } catch (err) {
        const msg = (err && err.message) ? String(err.message) : 'Unable to save preset';
        if (err.code === 'PRESET_NAME_CONFLICT' || /already exists|duplicate|409/.test(msg)) {
          const overwriteRadio = document.querySelector('#saveSearchForm input[name="mode"][value="overwrite"]');
          const overwriteWrap  = document.getElementById('overwriteWrap');
          if (overwriteRadio && hasOwned) overwriteRadio.checked = true;
          if (overwriteWrap && hasOwned)  overwriteWrap.style.display = 'block';
          alert('A preset with that name already exists. Choose it under “Overwrite existing”, or change the name.');
          return false;
        }
        alert(msg);
        return false;
      }
    },
    false,
    /* onReturn */ undefined,
    /* options */ { noParentGate: true, forceEdit: true, kind: 'search-save' }
  );

  // Wire radio toggles after paint
  setTimeout(() => {
    const formEl = document.getElementById('saveSearchForm');
    if (!formEl || formEl.dataset.wired === '1') return;
    formEl.dataset.wired = '1';

    const overwriteWrap = document.getElementById('overwriteWrap');
    formEl.querySelectorAll('input[name="mode"]').forEach(r =>
      r.addEventListener('change', () => {
        const isOverwrite = r.value === 'overwrite' && r.checked;
        if (overwriteWrap) overwriteWrap.style.display = isOverwrite ? 'block' : 'none';
      })
    );

    const sel = document.getElementById('overwritePresetId');
    if (sel) { sel.style.maxWidth = '100%'; sel.style.width = '100%'; }
  }, 0);
}


// === REPLACE: openLoadSearchModal (built-in sanitize; no globals required) ===
// FRONTEND — UPDATED
// openLoadSearchModal: emit event with filters (so parent re-applies after repaint),
// stage-delete UI kept; shows shared badge and (when present) creator.

async function openLoadSearchModal(section){
  const sanitize = (typeof window !== 'undefined' && typeof window.sanitize === 'function')
    ? window.sanitize
    : (s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                           .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'));

  let list = await listReportPresets({ section, kind: 'search', include_shared: true }).catch(()=>[]);
  let selectedId = null;

  function sortMineThenShared(rows, myId) {
    const mine   = (rows || []).filter(r => String(r.user_id) === String(myId))
                     .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''), undefined, {sensitivity:'base'}));
    const shared = (rows || []).filter(r => String(r.user_id) !== String(myId))
                     .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''), undefined, {sensitivity:'base'}));
    return mine.concat(shared);
  }

  const renderList = () => {
    const myId = currentUserId();
    const rows = sortMineThenShared(list || [], myId);

    const rowsHtml = rows.map(p => {
      const owned    = String(p.user_id) === String(myId);
      const nameHtml = `<span class="name">${sanitize(p.name)}</span>`;
      const creator  = (p.user && (p.user.display_name || p.user.email)) ? ` <span class="hint">• by ${sanitize(p.user.display_name || p.user.email)}</span>` : '';
      const badge    = p.is_shared ? `<span class="badge">shared</span>${creator}` : '';
      const trashBtn = owned ? `<button class="bin btn btn-ghost btn-sm" title="Delete">🗑</button>` : '';
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

  // Small helper to (re)wire the table after (re)render
  function wirePresetTable() {
    const tbl = document.getElementById('presetTable');
    if (!tbl || tbl.__wired) return;
    tbl.__wired = true;

    tbl.addEventListener('click', async (e) => {
      const tr = e.target && e.target.closest('tr[data-id]');
      if (!tr) return;
      const id  = tr.getAttribute('data-id');
      const bin = e.target && e.target.closest('button.bin');

      if (bin) {
        const myIdNow = currentUserId();
        const row = (list || []).find(p => p.id === id);
        if (!row || String(row.user_id) !== String(myIdNow)) return;
        if (!confirm(`Delete saved search “${row.name}”? This cannot be undone.`)) return;

        try { await deleteReportPreset(id); }
        catch (err) { alert(String(err?.message || err || 'Failed to delete preset')); return; }

        // Refresh list from server
        try { invalidatePresetCache(section, 'search'); } catch {}
        list = await listReportPresets({ section, kind:'search', include_shared:true }).catch(()=>[]);

        // ⚠️ Re-inject markup as HTML (not replaceChildren with a string)
        const body = document.getElementById('modalBody');
        if (body) {
          const markup = renderList();
          if (typeof markup === 'string') {
            body.innerHTML = markup;
          } else if (markup && typeof markup.nodeType === 'number') {
            body.replaceChildren(markup);
          } else {
            body.innerHTML = String(markup ?? '');
          }
          // Re-wire the fresh table DOM
          wirePresetTable();
        }
        return;
      }

      // select row
      selectedId = id;
      Array.from(tbl.querySelectorAll('tbody tr')).forEach(r => r.classList.toggle('selected', r === tr));
    });
  }

  showModal(
    'Load saved search',
    [{ key: 'list', label: 'Saved' }],
    renderList,
    async () => {
      if (!selectedId) { alert('Pick a preset to load'); return false; }
      const chosen = (list || []).find(p => p.id === selectedId);
      if (!chosen) { alert('Preset not found'); return false; }
      const filters = chosen.filters || chosen.filters_json || chosen.filtersJson || {};
      const sec = String(section || '').toLowerCase();
      try { window.__PENDING_ADV_PRESET = { section: sec, filters }; } catch {}
      return true;
    },
    false,
    () => {
      const pending = window.__PENDING_ADV_PRESET;
      if (pending && pending.section) {
        try { window.dispatchEvent(new CustomEvent('adv-search-apply-preset', { detail: pending })); } catch {}
      }
      delete window.__PENDING_ADV_PRESET;
    },
    { noParentGate: true, forceEdit: true, kind: 'search-load' }
  );

  // Initial wiring after first paint
  setTimeout(wirePresetTable, 0);
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
// === REPLACE: openSearchModal (icons + robust wiring + fallback for old text buttons) ===
// === FORCE-HIDE legacy buttons (one-time CSS) ===
// Run once: force-hide any legacy white buttons, and add compact button styles
(function ensureAdvancedSearchCSS(){
  if (document.getElementById('advSearchCSS')) return;
  const s = document.createElement('style');
  s.id = 'advSearchCSS';
  s.textContent = `
    /* never show legacy white buttons */
    #btnLoadSavedSearch, #btnSaveSearch { display: none !important; visibility: hidden !important; }

    /* compact, not-white text buttons */
    .adv-btn {
      height: 26px;
      padding: 0 10px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #f3f4f6;          /* not white */
      color: #111827;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .adv-btn:hover { background: #e5e7eb; }
  `;
  document.head.appendChild(s);
})();


// === REPLACE: openSearchModal (icons only, legacy forced hidden, robust wiring) ===
// === REPLACE: openSearchModal (compact text buttons + robust delegated wiring) ===
// FRONTEND — UPDATED
// openSearchModal: compact text buttons + delegated wiring + listens for preset-apply event
// and re-applies filters AFTER parent repaint (onReturn hook).
async function openSearchModal(opts = {}) {
  const TIMESHEET_STATUS = ['ERROR','RECEIVED','REVOKED','STORED','SAT','SUN','BH'];
  const INVOICE_STATUS   = ['DRAFT','ISSUED','ON_HOLD','PAID'];

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

  // Section-specific filters
  let inner = '';
  if (currentSection === 'candidates') {
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
        </select>`),
      row('Roles (any)',          `<select name="roles_any" multiple size="6">${roleOptions.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>`),
      row('Active',               boolSelect('active')),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  } else if (currentSection === 'clients') {
    inner = [
      row('Client name',          inputText('name', 'partial match')),
      row('Client Ref',           inputText('cli_ref')),
      row('Primary invoice email',`<input class="input" type="email" name="primary_invoice_email" placeholder="ap@client" />`),
      row('A/P phone',            inputText('ap_phone')),
      row('VAT chargeable',       boolSelect('vat_chargeable')),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  } else if (currentSection === 'umbrellas') {
    inner = [
      row('Name',                 inputText('name')),
      row('Bank',                 inputText('bank_name')),
      row('Sort code',            inputText('sort_code', '12-34-56')),
      row('Account number',       inputText('account_number')),
      row('VAT chargeable',       boolSelect('vat_chargeable')),
      row('Enabled',              boolSelect('enabled')),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  } else if (currentSection === 'timesheets') {
    inner = [
      row('Booking ID',           inputText('booking_id')),
      row('Candidate key',        inputText('occupant_key_norm', 'candidate_id / key_norm')),
      row('Hospital',             inputText('hospital_norm')),
      datePair('worked_from','Worked from (date)','worked_to','Worked to (date)'),
      datePair('week_ending_from','Week ending from','week_ending_to','Week ending to'),
      row('Status',               multi('status', TIMESHEET_STATUS)),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  } else if (currentSection === 'invoices') {
    inner = [
      row('Invoice no',           inputText('invoice_no')),
      row('Client ID',            inputText('client_id', 'UUID')),
      row('Status',               multi('status', INVOICE_STATUS)),
      datePair('issued_from','Issued from','issued_to','Issued to'),
      datePair('due_from','Due from','due_to','Due to'),
      datePair('created_from','Created from','created_to','Created to')
    ].join('');
  } else {
    inner = `<div class="tabc">No filters for this section.</div>`;
  }

  const headerHtml = `
    <div class="row" id="searchHeaderRow" style="justify-content:flex-end; gap:.35rem; margin-bottom:.5rem">
      <button type="button" class="adv-btn" data-adv-act="load">Load Saved Search</button>
      <button type="button" class="adv-btn" data-adv-act="save">Save Search</button>
    </div>`;

  const formHtml = `
    <div class="form" id="searchForm">
      ${headerHtml}
      ${inner}
    </div>
  `;

  // Pass utility flags + kind to customise chrome/behaviour
  showModal(
    'Advanced Search',
    [{ key: 'filter', title: 'Filters' }],
    () => formHtml,
    async () => {
      const filters = extractFiltersFromForm('#searchForm');
      const rows    = await search(currentSection, filters);
      if (rows) renderSummary(rows);
      return true; // close after running search
    },
    false,
    // Parent onReturn: apply any pending preset AFTER the child modal has closed & repaint finished
    () => {
      const pending = (typeof window !== 'undefined') ? window.__PENDING_ADV_PRESET : null;
      if (pending && pending.section) {
        try {
          window.dispatchEvent(new CustomEvent('adv-search-apply-preset', { detail: pending }));
        } catch {}
      }
      if (typeof window !== 'undefined') delete window.__PENDING_ADV_PRESET;
      // Re-wire listeners last
      try { wireAdvancedSearch(); } catch {}
    },
    { noParentGate: true, forceEdit: true, kind: 'advanced-search' }
  );

  // Ensure listeners are wired after first paint
  setTimeout(wireAdvancedSearch, 0);
}


function wireAdvancedSearch() {
  const bodyEl = document.getElementById('modalBody');
  const formEl = document.getElementById('searchForm');
  if (!bodyEl || !formEl) return;

  formEl.querySelectorAll('input[placeholder="DD/MM/YYYY"]').forEach(el => {
    try { attachUkDatePicker(el); } catch {}
  });

  // hide any legacy buttons
  formEl.querySelectorAll('#btnLoadSavedSearch,#btnSaveSearch').forEach(el => {
    el.style.display = 'none'; el.hidden = true; el.disabled = true;
  });

  // delegated click (survives re-renders)
  if (bodyEl._advSearchHandler) bodyEl.removeEventListener('click', bodyEl._advSearchHandler, true);
  bodyEl._advSearchHandler = async (e) => {
    const btn = e.target && e.target.closest('button[data-adv-act]');
    if (!btn) return;
    const act = btn.dataset.advAct;
    if (act === 'load') {
      await openLoadSearchModal(currentSection);
    } else if (act === 'save') {
      // ↳ Recompute filters at click time so we pass the *current* criteria
      const filters = extractFiltersFromForm('#searchForm');
      await openSaveSearchModal(currentSection, filters);
    }
  };
  bodyEl.addEventListener('click', bodyEl._advSearchHandler, true);

  // listen once for preset apply events
  if (!window.__advPresetListener) {
    window.__advPresetListener = (ev) => {
      const det = ev && ev.detail;
      const here = String(currentSection || '').toLowerCase();
      const inc  = String(det && det.section || '').toLowerCase();
      if (!det || !inc || inc !== here) return;
      try { window.__squelchDirty = true; } catch {}
      try { populateSearchFormFromFilters(det.filters || {}, '#searchForm'); }
      finally {
        setTimeout(() => { try { window.__squelchDirty = false; } catch {} }, 0);
      }
    };
    window.addEventListener('adv-search-apply-preset', window.__advPresetListener);
  }
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

  // Use per-client cache; do NOT treat candidate ids as client ids
  const ctx = window.modalCtx || {};
  const isClientEntity = ctx.entity === 'clients';
  const cid = isClientEntity
    ? ((ctx.data && (ctx.data.id || ctx.data.client_id)) || null)
    : (ctx.data && ctx.data.client_id) || null; // only explicit client_id for non-client entities

  // Initialise caches
  window.__GLOBAL_ROLE_CODES_CACHE__    = window.__GLOBAL_ROLE_CODES_CACHE__    || Object.create(null);
  window.__GLOBAL_ROLE_CODES_CACHE_TS__ = window.__GLOBAL_ROLE_CODES_CACHE_TS__ || Object.create(null);

  // Serve from cache when fresh
  if (cid && window.__GLOBAL_ROLE_CODES_CACHE__[cid] &&
      (now - (window.__GLOBAL_ROLE_CODES_CACHE_TS__[cid] || 0) < 60_000)) {
    return window.__GLOBAL_ROLE_CODES_CACHE__[cid];
  }

  // If we don't have a client id (e.g., candidate create), return any cached fallback
  if (!cid) {
    const fallback = window.__GLOBAL_ROLE_CODES_CACHE__['__fallback__'];
    return Array.isArray(fallback) ? fallback : [];
  }

  // Fetch roles for this specific client id only
  const list = await listClientRates(cid).catch(() => []);
  const set = new Set();
  (list || []).forEach(r => { if (r && r.role) set.add(String(r.role)); });
  const arr = [...set].sort((a,b)=> a.localeCompare(b));

  // Cache per client
  window.__GLOBAL_ROLE_CODES_CACHE__[cid]  = arr;
  window.__GLOBAL_ROLE_CODES_CACHE_TS__[cid]= now;

  // Refresh fallback snapshot so non-client entities have something to show
  window.__GLOBAL_ROLE_CODES_CACHE__['__fallback__']     = arr;
  window.__GLOBAL_ROLE_CODES_CACHE_TS__['__fallback__']  = now;

  return arr;
}


// Render roles editor into a container; updates modalCtx.rolesState
function renderRolesEditor(container, rolesState, allRoleOptions){
  // Detect read-only (view mode) from the active modal frame
  const fr = (window.__modalStack || [])[ (window.__modalStack || []).length - 1 ] || null;
  // ✅ Treat 'create' same as 'edit' (editable)
  const readOnly = !fr || !(fr.mode === 'edit' || fr.mode === 'create');

  // Local, mutable copy of available options so we can refresh after adds/removes
  let roleOptions = Array.isArray(allRoleOptions) ? allRoleOptions.slice() : [];

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
      <div class="roles-add" ${readOnly ? 'style="display:none"' : ''}>
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
    if (!sel) return;
    const opts = ['<option value="">Add role…</option>']
      .concat(availableOptions().map(code => `<option value="${code}">${code}</option>`))
      .join('');
    sel.innerHTML = opts;
  }

  function renderList(){
    ul.innerHTML = '';
    const arr = (rolesState||[]).slice().sort((a,b)=> (a.rank||0) - (b.rank||0));

    arr.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'role-item';
      li.draggable = !readOnly;
      li.dataset.index = String(idx);

      li.innerHTML = `
        <span class="drag" title="Drag to reorder" style="cursor:${readOnly?'default':'grab'}">⋮⋮</span>
        <span class="rank">${idx+1}.</span>
        <span class="code">${item.code}</span>
        <input class="label" type="text" placeholder="Optional label…" value="${item.label || ''}" ${readOnly?'disabled':''}/>
        <button class="remove" type="button" title="Remove" ${readOnly?'disabled style="display:none"':''}>✕</button>
      `;

      if (!readOnly) {
        li.querySelector('.remove').onclick = () => {
          rolesState = (rolesState || []).filter(r => r.code !== item.code);
          rolesState.forEach((r,i)=> r.rank = i+1);
          rolesState = normaliseRolesForSave(rolesState);
          window.modalCtx.rolesState = rolesState;
          markDirty();
          renderList(); refreshAddSelect();
        };

        li.querySelector('.label').oninput = (e) => {
          const rec = byCode(item.code);
          if (rec) rec.label = e.target.value;
          window.modalCtx.rolesState = rolesState;
          // dirty state handled by global tracker
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
      }

      ul.appendChild(li);
    });
  }

  // Delegate DnD only when editable
  if (!readOnly) {
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

      view.forEach((r,i)=> r.rank = i+1);
      rolesState = normaliseRolesForSave(view);
      window.modalCtx.rolesState = rolesState;

      markDirty();
      renderList();
      refreshAddSelect();
    });
  }

  // Add role (only in edit/create)
  if (!readOnly && btn) {
    btn.onclick = () => {
      const code = sel.value;
      if (!code) return;
      if ((rolesState||[]).some(r => r.code === code)) return; // no duplicates
      const nextRank = ((rolesState||[]).length || 0) + 1;
      rolesState = [...(rolesState||[]), { code, rank: nextRank }];
      rolesState = normaliseRolesForSave(rolesState);
      window.modalCtx.rolesState = rolesState;
      markDirty();
      renderList(); refreshAddSelect();
    };
  }

  // Expose a tiny API for refreshing options live
  container.__rolesEditor = {
    updateOptions(newOptions){
      roleOptions = Array.isArray(newOptions) ? newOptions.slice() : [];
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
  const url = API(`/api/clients/${clientId}/hospitals`);
  const APILOG = (typeof window !== 'undefined' && !!window.__LOG_API) || (typeof __LOG_API !== 'undefined' && !!__LOG_API);
  if (APILOG) console.log('[listClientHospitals] → GET', url);
  const r = await authFetch(url);
  if (APILOG) console.log('[listClientHospitals] ←', r.status, r.ok);
  const list = await toList(r);
  if (APILOG) console.log('[listClientHospitals] parsed length', Array.isArray(list) ? list.length : -1);
  return list;
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

// ============================================================================
// NEW HELPERS
// ============================================================================

// Toggle enable/disable via backend endpoint
async function patchClientDefault(id, { disabled }) {
  const url = API(`/api/rates/client-defaults/${encodeURIComponent(id)}`);
  const res = await authFetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ disabled: !!disabled })
  });
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(text || `PATCH failed (${res.status})`);
  }
  const data = await res.json().catch(()=> ({}));
  // Endpoint returns { rate: {...} } or the row; support both
  const row = (data && (data.rate || data)) || null;
  return row;
}

// Format a user reference gracefully
function formatUserRef(u) {
  if (!u) return '';
  const s = String(u);
  if (s.includes('@')) return s;           // email
  if (s.length > 8) return s.slice(0,8)+'…';
  return s;
}

// Trivial HTML escape
function escapeHtml(x) {
  return String(x || '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
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

  // Settings uses a dedicated panel with view/edit gating
  if (currentSection === 'settings') {
    return renderSettingsPanel(content);
  }
  if (currentSection === 'audit') {
    return renderAuditTable(content, rows);
  }

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
    if (!confirmDiscardChangesIfDirty()) return; // dirty guard before opening a new modal

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

  // ---- Jump & highlight if a pending focus token matches this section
  if (window.__pendingFocus) {
    const pf = window.__pendingFocus;
    const pfSection = pf.section || (pf.entity ? (pf.entity + 's') : null);
    if (pfSection && pfSection === currentSection && pf.id != null) {
      const targetId = String(pf.id);
      const sel = `tr[data-id="${CSS.escape ? CSS.escape(targetId) : targetId}"]`;
      let tr = tb.querySelector(sel);

      if (!tr) {
        // Not visible under current filters - attempt one auto-relax/reload pass
        if (!pf._retried) {
          pf._retried = true;
          try {
            if (typeof clearFilters === 'function') clearFilters();
          } catch (_) {}
          try { renderAll(); } catch (e) { console.error('auto-refresh after filter clear failed', e); }
          return; // wait for next render to try again
        }
        // If we've already retried once, leave token set so a manual refresh can still catch it.
        console.debug('[GRID] pending focus row not found under current filters; already retried once');
        return;
      }

      // Select it in our state, scroll, and highlight
      currentSelection = currentRows.find(x => String(x.id) === targetId) || null;
      try { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { tr.scrollIntoView(); }
      tb.querySelectorAll('tr.selected').forEach(n => n.classList.remove('selected'));
      tr.classList.add('selected');
      const oldOutline = tr.style.outline;
      tr.style.outline = '2px solid #ffbf00';
      setTimeout(() => { tr.style.outline = oldOutline || ''; }, 2000);

      // Clear token so we don't jump again
      window.__pendingFocus = null;
    }
  }
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
// ============================================================================
// LIST CLIENT RATES (adds only_enabled support)
// ============================================================================

async function listClientRates(clientId, opts = {}) {
  const APILOG = (typeof window !== 'undefined' && !!window.__LOG_API) || (typeof __LOG_API !== 'undefined' && !!__LOG_API);

  // 🔧 Guard: never fetch without a client_id (prevents global empty lists clobbering staged state)
  if (!clientId) {
    if (APILOG) console.warn('[listClientRates] called without clientId — returning [] to avoid clobbering state');
    return [];
  }

  const qp = new URLSearchParams();
  qp.set('client_id', clientId);
  if (opts.role) qp.set('role', String(opts.role));
  if (opts.band !== undefined && opts.band !== null && `${opts.band}` !== '') {
    qp.set('band', String(opts.band));
  }
  if (opts.active_on) qp.set('active_on', String(opts.active_on)); // YYYY-MM-DD
  if (opts.only_enabled) qp.set('only_enabled', 'true');

  const qs = `?${qp.toString()}`;
  const url = API(`/api/rates/client-defaults${qs}`);
  if (APILOG) console.log('[listClientRates] → GET', url);

  const res = await authFetch(url);
  if (APILOG) console.log('[listClientRates] ←', res.status, res.ok);
  const rows = await toList(res);
  if (APILOG) console.log('[listClientRates] parsed length', Array.isArray(rows) ? rows.length : -1);
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
  const APILOG = (typeof window !== 'undefined' && !!window.__LOG_API) || (typeof __LOG_API !== 'undefined' && !!__LOG_API);

  const body = {
    client_id : String(payload.client_id),
    role      : String(payload.role),
    band      : payload.band ?? null,
    date_from : payload.date_from,
    date_to   : payload.date_to ?? null,

    charge_day   : payload.charge_day   ?? null,
    charge_night : payload.charge_night ?? null,
    charge_sat   : payload.charge_sat   ?? null,
    charge_sun   : payload.charge_sun   ?? null,
    charge_bh    : payload.charge_bh    ?? null,

    paye_day     : payload.paye_day     ?? null,
    paye_night   : payload.paye_night   ?? null,
    paye_sat     : payload.paye_sat     ?? null,
    paye_sun     : payload.paye_sun     ?? null,
    paye_bh      : payload.paye_bh      ?? null,

    umb_day      : payload.umb_day      ?? null,
    umb_night    : payload.umb_night    ?? null,
    umb_sat      : payload.umb_sat      ?? null,
    umb_sun      : payload.umb_sun      ?? null,
    umb_bh       : payload.umb_bh       ?? null
  };

  if (APILOG) console.log('[upsertClientRate] → POST /api/rates/client-defaults', body);
  const res = await authFetch(
    API(`/api/rates/client-defaults`),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (APILOG) console.log('[upsertClientRate] ←', res.status, res.ok);
  if (!res.ok) {
    const msg = await res.text().catch(() => 'Failed to upsert client default window');
    if (APILOG) console.error('[upsertClientRate] error body', msg);
    throw new Error(msg);
  }
  const json = await res.json().catch(() => ({}));
  if (APILOG) console.log('[upsertClientRate] parsed', json);
  return json;
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
  // Fetch ONLY enabled windows for this client/role/date
  const rows = await listClientRates(client_id, { role, band: undefined, active_on, only_enabled: true });
  if (!Array.isArray(rows) || !rows.length) return null;

  const ranked = rows
    // extra guard: ignore any disabled rows that might slip through
    .filter(r =>
      !r.disabled_at_utc &&
      r.role === role &&
      r.date_from &&
      r.date_from <= (active_on || '9999-12-31') &&
      (!r.date_to || r.date_to >= (active_on || '0000-01-01'))
    )
    .sort((a,b) => {
      const aExact = (String(a.band||'') === String(band||''));
      const bExact = (String(b.band||'') === String(band||''));
      if (aExact !== bExact) return aExact ? -1 : 1;          // exact band before band-null
      // newer start first
      return (a.date_from < b.date_from) ? 1 : (a.date_from > b.date_from ? -1 : 0);
    });

  const best = ranked[0];
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
// ===== UPDATED: upsertCandidate — normalize server response so we always return the created/updated object with an id
async function upsertCandidate(payload, id){
  if ('tms_ref' in payload) delete payload.tms_ref; // safety

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
    const data = text ? JSON.parse(text) : null;
    // normalize common shapes: [row], { candidate: {...} }, or { ...row }
    let obj = null;
    if (Array.isArray(data)) obj = data[0] || null;
    else if (data && data.candidate) obj = data.candidate;
    else if (data && typeof data === 'object') obj = data;

    return obj || (id ? { id, ...payload } : {});
  } catch (e) {
    console.warn('Candidate save: non-JSON response body', { body: text });
    return id ? { id, ...payload } : {};
  }
}

// ===== UPDATED: upsertClient — normalize server response so we always return the created/updated object with an id
async function upsertClient(payload, id){
  // Never allow CLI to be sent from UI
  if ('cli_ref' in payload) delete payload.cli_ref;

  // Strip empty-string fields so we don't overwrite existing values with ''
  const clean = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (v === '' || v === undefined) continue;
    clean[k] = v;
  }

  const url    = id ? `/api/clients/${id}` : '/api/clients';
  const method = id ? 'PUT' : 'POST';
  const APILOG = (typeof window !== 'undefined' && !!window.__LOG_API) || (typeof __LOG_API !== 'undefined' && !!__LOG_API);
  if (APILOG) console.log('[upsertClient] →', { method, url: API(url), body: clean });

  const r = await authFetch(API(url), {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(clean)
  });

  if (APILOG) console.log('[upsertClient] ←', r.status, r.ok);
  if (!r.ok) {
    const msg = await r.text().catch(()=> '');
    if (APILOG) console.error('[upsertClient] error body', msg);
    throw new Error(msg || 'Save failed');
  }

  try {
    const data = await r.json();
    if (APILOG) console.log('[upsertClient] parsed', data);
    let obj = null;
    if (Array.isArray(data)) obj = data[0] || null;
    else if (data && data.client) obj = data.client;
    else if (data && typeof data === 'object') obj = data;

    if (obj) return obj;
  } catch (_) { /* fall through to Location/PUT fallback */ }

  let clientId = null;
  try {
    const loc = r.headers && r.headers.get('Location');
    if (loc) {
      const m = loc.match(/\/api\/clients\/([^/?#]+)/i) || loc.match(/\/clients\/([^/?#]+)/i);
      if (m) clientId = m[1];
    }
  } catch (_) {}

  const fallback = clientId ? { id: clientId, ...clean } : (id ? { id, ...clean } : { ...clean });
  if (APILOG) console.log('[upsertClient] fallback', fallback);
  return fallback;
}


// ================== FRONTEND: upsertUmbrella (UPDATED to return saved object) ==================
// ===== UPDATED: upsertUmbrella — normalize server response so we always return the created/updated object with an id
async function upsertUmbrella(payload, id){
  const url = id ? `/api/umbrellas/${id}` : '/api/umbrellas';
  const method = id ? 'PUT' : 'POST';
  const r = await authFetch(API(url), {method, headers:{'content-type':'application/json'}, body: JSON.stringify(payload)});
  if (!r.ok) { 
    const msg = await r.text().catch(()=> 'Save failed');
    throw new Error(msg || 'Save failed'); 
  }
  try {
    const data = await r.json();
    // normalize shapes: [row], { umbrella: {...} }, or { ...row }
    let obj = null;
    if (Array.isArray(data)) obj = data[0] || null;
    else if (data && data.umbrella) obj = data.umbrella;
    else if (data && typeof data === 'object') obj = data;

    return obj || (id ? { id, ...payload } : { ...payload });
  } catch (_) {
    return id ? { id, ...payload } : { ...payload };
  }
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
  // global dirty guard before opening any new modal (also called from dblclick)
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

// FRONTEND — UPDATED
// openCandidate: default Account holder from umbrella name if pay_method is UMBRELLA and empty.
// ================== FRONTEND: openCandidate (UPDATED) ==================
// ================== FIXED: openCandidate (hydrate before showModal) ==================
// ================== FIXED: openCandidate (hydrate before showModal) ==================
async function openCandidate(row) {
  // ===== Logging helpers (toggle with window.__LOG_MODAL = true/false) =====
  const LOG = (typeof window.__LOG_MODAL === 'boolean') ? window.__LOG_MODAL : false;
  const L  = (...a)=> { if (LOG) console.log('[OPEN_CANDIDATE]', ...a); };
  const W  = (...a)=> { if (LOG) console.warn('[OPEN_CANDIDATE]', ...a); };
  const E  = (...a)=> { if (LOG) console.error('[OPEN_CANDIDATE]', ...a); };

  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));
  const incoming = deep(row || {});
  const seedId   = incoming?.id || null;

  L('ENTRY', { incomingKeys: Object.keys(incoming||{}), seedId });

  // helper to unwrap a single record from many common backend shapes
  const unwrapSingle = (data, key) => {
    if (Array.isArray(data)) return data[0] || null;
    if (data && key && data[key]) return unwrapSingle(data[key], null);
    if (data && Array.isArray(data.rows))  return data.rows[0]  || null;
    if (data && Array.isArray(data.items)) return data.items[0] || null;
    if (data && Array.isArray(data.data))  return data.data[0]  || null;
    return (data && typeof data === 'object') ? data : null;
  };

  // 1) Hydrate full record if we have an id
  let full = incoming;
  if (seedId) {
    try {
      const url = API(`/api/candidates/${encodeURIComponent(seedId)}`);
      L('[HTTP] GET', url);
      const res = await authFetch(url);
      L('[HTTP] status', res?.status, res?.ok);

      try {
        const raw = await res.clone().text();
        if (LOG) console.debug('[HTTP] raw body (≤2KB):', raw.slice(0, 2048));
      } catch (peekErr) { W('[HTTP] raw peek failed', peekErr?.message || peekErr); }

      if (res.ok) {
        const data = await res.json().catch((jErr)=>{ W('res.json() failed, using {}', jErr); return {}; });
        const unwrapped = unwrapSingle(data, 'candidate');
        L('hydrated JSON keys', Object.keys(data||{}), 'unwrapped keys', Object.keys(unwrapped||{}));
        full = unwrapped || incoming;
      } else {
        W('non-OK response, using incoming row');
      }
    } catch (e) {
      W('hydrate failed; using summary row', e);
    }
  } else {
    L('no seedId — create mode');
  }

  // 2) Build modal context from hydrated data — ***IMPORTANT: seed window.modalCtx***
  const fullKeys = Object.keys(full || {});
  L('seeding window.modalCtx', { entity: 'candidates', fullId: full?.id, fullKeys });

  window.modalCtx = {
    entity: 'candidates',
    data:   deep(full),
    formState: { __forId: full?.id || null, main: {}, pay: {} },
    rolesState: Array.isArray(full?.roles) ? normaliseRolesForSave(full.roles) : [],
    overrides: { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() },
    clientSettingsState: null,
    openToken: ((full?.id) || 'new') + ':' + Date.now()
  };

  L('window.modalCtx seeded', {
    entity: window.modalCtx.entity,
    dataId: window.modalCtx.data?.id,
    dataKeys: Object.keys(window.modalCtx.data||{}),
    formStateForId: window.modalCtx.formState?.__forId,
    openToken: window.modalCtx.openToken
  });

  // 3) Render modal (now we have real data to populate fields)
  L('calling showModal with hasId=', !!full?.id, 'rawHasIdArg=', full?.id);
  showModal(
    'Candidate',
    [
      { key:'main',     label:'Main Details' },
      { key:'rates',    label:'Rates' },
      { key:'pay',      label:'Payment details' },
      { key:'bookings', label:'Bookings' }
    ],
    (k, r) => {
      L('[renderCandidateTab] tab=', k, 'rowKeys=', Object.keys(r||{}), 'sample=', { first: r?.first_name, last: r?.last_name, id: r?.id });
      return renderCandidateTab(k, r);
    },
    async () => {
      L('[onSave] begin', { dataId: window.modalCtx?.data?.id, forId: window.modalCtx?.formState?.__forId });
      const isNew = !window.modalCtx?.data?.id;

      const fs   = window.modalCtx.formState || { __forId: null, main:{}, pay:{} };
      const same = (!!window.modalCtx.data?.id && fs.__forId === window.modalCtx.data.id) || (!window.modalCtx.data?.id && fs.__forId == null);
      const stateMain = same ? (fs.main || {}) : {};
      const statePay  = same ? (fs.pay  || {}) : {};
      const main      = document.querySelector('#tab-main') ? collectForm('#tab-main') : {};
      const pay       = document.querySelector('#tab-pay')  ? collectForm('#tab-pay')  : {};
      const roles     = normaliseRolesForSave(window.modalCtx.rolesState || window.modalCtx.data?.roles || []);
      const payload   = { ...stateMain, ...statePay, ...main, ...pay, roles };

      L('[onSave] collected', {
        same, stateMainKeys: Object.keys(stateMain||{}), statePayKeys: Object.keys(statePay||{}),
        mainKeys: Object.keys(main||{}), payKeys: Object.keys(pay||{}), rolesCount: roles?.length || 0
      });

      delete payload.umbrella_name;
      delete payload.tms_ref;

      // Carry forward untouched fields from hydrated row
      if (!payload.first_name && full?.first_name) payload.first_name = full.first_name;
      if (!payload.last_name  && full?.last_name)  payload.last_name  = full.last_name;
      if (typeof payload.key_norm === 'undefined' && typeof full?.key_norm !== 'undefined') payload.key_norm = full.key_norm;

      if (!payload.display_name) {
        const dn = [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim();
        payload.display_name = dn || full?.display_name || null;
      }

      if (!payload.pay_method) payload.pay_method = isNew ? 'PAYE' : (full?.pay_method || 'PAYE');

      if (payload.pay_method === 'UMBRELLA') {
        if ((!payload.umbrella_id || payload.umbrella_id === '') && full?.umbrella_id) {
          payload.umbrella_id = full.umbrella_id;
        }
        if (!payload.account_holder) {
          const umbNameEl = document.querySelector('#tab-pay #umbrella_name');
          if (umbNameEl && umbNameEl.value) payload.account_holder = umbNameEl.value;
        }
      }

      if (isNew && !payload.first_name && !payload.last_name) { alert('Enter at least a first or last name.'); return { ok:false }; }
      if (payload.pay_method === 'PAYE') payload.umbrella_id = null;
      else if (!payload.umbrella_id || payload.umbrella_id === '') { alert('Select an umbrella company for UMBRELLA pay.'); return { ok:false }; }
      if (payload.umbrella_id === '') payload.umbrella_id = null;

      for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];

      const idForUpdate = window.modalCtx?.data?.id || full?.id || null;
      const tokenAtSave = window.modalCtx.openToken;
      L('[onSave] upsertCandidate', { idForUpdate, payloadKeys: Object.keys(payload||{}) });
      const saved = await upsertCandidate(payload, idForUpdate).catch(err => { E('upsertCandidate failed', err); return null; });
      const candidateId = idForUpdate || (saved && saved.id);
      L('[onSave] saved', { ok: !!saved, candidateId, savedKeys: Array.isArray(saved)?[]:Object.keys(saved||{}) });
      if (!candidateId) { alert('Failed to save candidate'); return { ok:false }; }

      // Persist staged overrides
      const O = window.modalCtx.overrides || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };
      L('[onSave] overrides', { deletes: Array.from(O.stagedDeletes||[]), edits: Object.keys(O.stagedEdits||{}), newCount: (O.stagedNew||[]).length });

      // Deletes (unchanged)
      for (const delId of O.stagedDeletes) {
        const res = await authFetch(API(`/api/rates/candidate-overrides/${encodeURIComponent(delId)}`), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) { const msg = await res.text().catch(()=> 'Delete override failed'); alert(msg); return { ok:false }; }
      }

      // Edits — PATCH uses candidateId in path + ORIGINAL keys in query, updates in body
      for (const [editId, patchRaw] of Object.entries(O.stagedEdits || {})) {
        const original = (O.existing || []).find(x => String(x.id) === String(editId));
        if (!original) { alert('Cannot locate original override to patch'); return { ok:false }; }

        // Build query string from ORIGINAL keys
        const q = new URLSearchParams();
        if (original.client_id) q.set('client_id', original.client_id);
        if (original.role != null) q.set('role', String(original.role));
        // band=null means bandless window; send empty value for null band
        if (original.band == null || original.band === '') q.set('band', '');
        else q.set('band', String(original.band));
        if (original.rate_type) q.set('rate_type', String(original.rate_type).toUpperCase());

        // Sanitize body: strip empty strings; dates must be ISO YYYY-MM-DD
        const body = {};
        for (const [k,v] of Object.entries(patchRaw || {})) {
          if (v === '' || v === undefined) continue;
          body[k] = v;
        }
        body.candidate_id = candidateId;

        const url = API(`/api/rates/candidate-overrides/${encodeURIComponent(candidateId)}?${q.toString()}`);
        const res = await authFetch(url, {
          method:'PATCH',
          headers:{ 'content-type':'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const msg = await res.text().catch(()=> 'Update override failed');
          alert(msg);
          return { ok:false };
        }
      }

      // Creates (unchanged, but ensure ISO dates are already staged)
      for (const nv of (O.stagedNew || [])) {
        if (!nv.client_id) { alert('Override must include client_id'); return { ok:false }; }
        const clean = {};
        for (const [k,v] of Object.entries(nv)) {
          if (k === '_tmpId' || v === '') continue;
          clean[k] = v;
        }
        const res = await authFetch(
          API(`/api/rates/candidate-overrides`),
          { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...clean, candidate_id: candidateId }) }
        );
        if (!res.ok) { const msg = await res.text().catch(()=> 'Create override failed'); alert(msg); return { ok:false }; }
      }

      // Refresh overrides list from server and clear staging
      try {
        const latest = await listCandidateRates(candidateId);
        if (tokenAtSave === window.modalCtx.openToken && window.modalCtx.data?.id === candidateId) {
          window.modalCtx.overrides.existing = Array.isArray(latest) ? latest : [];
          window.modalCtx.overrides.stagedEdits = {};
          window.modalCtx.overrides.stagedNew = [];
          if (window.modalCtx.overrides.stagedDeletes?.clear) window.modalCtx.overrides.stagedDeletes.clear();
          await renderCandidateRatesTable();
        }
      } catch (e) {
        W('post-save rates refresh failed', e);
      }

      // Keep open; flip to view mode via showModal logic
      // IMPORTANT: do not clear roles; copy back to data & keep rolesState
      const mergedRoles = (saved && saved.roles) || payload.roles || window.modalCtx.data?.roles || [];
      window.modalCtx.data       = { ...(window.modalCtx.data || {}), ...(saved || {}), id: candidateId, roles: mergedRoles };
      window.modalCtx.formState  = { __forId: candidateId, main: {}, pay: {} };
      window.modalCtx.rolesState = mergedRoles;

      L('[onSave] final window.modalCtx', {
        dataId: window.modalCtx.data?.id,
        rolesCount: Array.isArray(window.modalCtx.data?.roles) ? window.modalCtx.data.roles.length : 0,
        formStateForId: window.modalCtx.formState?.__forId
      });

      if (isNew) window.__pendingFocus = { section: 'candidates', id: candidateId };

      return { ok: true, saved: window.modalCtx.data };
    },
    full?.id
  );
  L('showModal returned (sync)', { currentOpenToken: window.modalCtx.openToken });

  // 4) Optional async companion loads
  if (full?.id) {
    const token = window.modalCtx.openToken;
    const id    = full.id;

    try {
      L('[listCandidateRates] GET', { id, token });
      const existing = await listCandidateRates(id);
      L('[listCandidateRates] result', { count: Array.isArray(existing) ? existing.length : -1, sameToken: token === window.modalCtx.openToken, modalCtxId: window.modalCtx.data?.id });
      if (token === window.modalCtx.openToken && window.modalCtx.data?.id === id) {
        window.modalCtx.overrides.existing = Array.isArray(existing) ? existing : [];
        await renderCandidateRatesTable();
      }
    } catch (e) { E('listCandidateRates failed', e); }

    try {
      L('[fetchRelated:timesheets] GET', { id, token });
      const ts = await fetchRelated('candidate', id, 'timesheets');
      L('[fetchRelated:timesheets] result', { rows: Array.isArray(ts) ? ts.length : -1, sameToken: token === window.modalCtx.openToken, modalCtxId: window.modalCtx.data?.id });
      if (token === window.modalCtx.openToken && window.modalCtx.data?.id === id) {
        renderCalendar(ts || []);
      }
    } catch (e) { E('fetchRelated timesheets failed', e); }
  } else {
    L('skip companion loads (no full.id)');
  }
}


// ====================== mountCandidatePayTab (FIXED) ======================
// FRONTEND — UPDATED
// mountCandidatePayTab: also keeps Account Holder in sync with umbrella name when UMNRELLA pay.
// ================== FIXED: openUmbrella (hydrate before showModal) ==================
async function openUmbrella(row){
  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));
  const incoming = deep(row || {});
  const seedId   = incoming?.id || null;

  // 1) Hydrate full umbrella if we have an id
  let full = incoming;
  if (seedId) {
    try {
      const res = await authFetch(API(`/api/umbrellas/${encodeURIComponent(seedId)}`));
      if (res.ok) {
        const data = await res.json().catch(()=> ({}));
        full = Array.isArray(data) ? (data[0] || incoming) : (data.umbrella || data || incoming);
      }
    } catch (e) {
      console.warn('openUmbrella hydrate failed; using summary row', e);
    }
  }

  // 2) Build modal context from hydrated data
  modalCtx = {
    entity: 'umbrellas',
    data: deep(full),
    formState: { __forId: full?.id || null, main: {} },
    rolesState: null,
    ratesState: null,
    clientSettingsState: null,
    openToken: ((full?.id) || 'new') + ':' + Date.now()
  };

  // 3) Render modal (now hydrated)
  showModal(
    'Umbrella',
    [{ key:'main', label:'Main' }],
    (key, r)=> html(`
      <div class="form" id="tab-main">
        ${input('name','Name', r?.name)}
        ${input('remittance_email','Remittance email', r?.remittance_email, 'email')}
        ${input('bank_name','Bank', r?.bank_name)}
        ${input('sort_code','Sort code', r?.sort_code)}
        ${input('account_number','Account number', r?.account_number)}
        ${select('vat_chargeable','VAT chargeable', (r?.vat_chargeable ? 'Yes' : 'No'), ['Yes','No'])}
        ${select('enabled','Enabled', (r?.enabled === false) ? 'No' : 'Yes', ['Yes','No'])}
      </div>
    `),
    async ()=>{
      const fs = modalCtx.formState || { __forId: null, main:{} };
      const sameRecord = (!!modalCtx.data?.id && fs.__forId === modalCtx.data.id) || (!modalCtx.data?.id && fs.__forId == null);

      const staged = sameRecord ? (fs.main || {}) : {};
      const live   = collectForm('#tab-main');
      const payload = { ...staged, ...live };

      if (typeof payload.vat_chargeable !== 'boolean') payload.vat_chargeable = (payload.vat_chargeable === 'Yes' || payload.vat_chargeable === 'true');
      if (typeof payload.enabled        !== 'boolean') payload.enabled        = (payload.enabled        === 'Yes' || payload.enabled        === 'true');

      for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];

      const idForUpdate = modalCtx?.data?.id || full?.id || null;
      const saved = await upsertUmbrella(payload, idForUpdate);
      const umbrellaId = idForUpdate || (saved && saved.id);
      if (!umbrellaId) { alert('Failed to save umbrella'); return { ok:false }; }

      modalCtx.data      = { ...(modalCtx.data || {}), ...(saved || {}), id: umbrellaId };
      modalCtx.formState = { __forId: umbrellaId, main: {} };

      if (!seedId && umbrellaId) window.__pendingFocus = { section: 'umbrellas', id: umbrellaId };

      return { ok: true, saved: modalCtx.data };
    },
    full?.id
  );
}





// Replaces your current function
// =================== renderCandidateRatesTable (FIXED) ===================
// =================== CANDIDATE RATES TABLE (UPDATED) ===================
// ✅ UPDATED — renders from modalCtx.overrides (existing ⊕ staged edits/new ⊖ staged deletes)

// ==================================
// 2) renderCandidateRatesTable(...)
// ==================================
async function renderCandidateRatesTable() {
  const LOG = !!window.__LOG_RATES;
  const token    = window.modalCtx.openToken;
  const idActive = window.modalCtx.data?.id || null;
  const div = byId('ratesTable');
  if (!div) { if (LOG) console.warn('[RATES][renderCandidateRatesTable] no #ratesTable'); return; }
  if (token !== window.modalCtx.openToken || window.modalCtx.data?.id !== idActive) {
    if (LOG) console.warn('[RATES][renderCandidateRatesTable] token/id changed mid-flight');
    return;
  }

  const frame = _currentFrame();
  // ✅ Allow edit or create to enable the Add button in new flow
  const parentEditable = frame && (frame.mode === 'edit' || frame.mode === 'create');
  if (LOG) console.log('[RATES][renderCandidateRatesTable] parentEditable?', parentEditable);

  let clientsById = {};
  try {
    const clients = await listClientsBasic();
    if (token !== window.modalCtx.openToken || window.modalCtx.data?.id !== idActive) return;
    clientsById = Object.fromEntries((clients || []).map(c => [c.id, c.name]));
    if (LOG) console.log('[RATES][renderCandidateRatesTable] clients loaded', (clients||[]).length);
  } catch (e) { console.error('load clients failed', e); }

  const O = window.modalCtx.overrides || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };

  const rows = [];
  for (const ex of (O.existing || [])) {
    if (O.stagedDeletes.has(ex.id)) continue;
    rows.push({ ...ex, ...(O.stagedEdits[ex.id] || {}), _edited: !!O.stagedEdits[ex.id] });
  }
  for (const n of (O.stagedNew || [])) rows.push({ ...n, _isNew: true });

  if (!rows.length) {
    div.innerHTML = `
      <div class="hint" style="margin-bottom:8px">No candidate-specific overrides. Client defaults will apply.</div>
      <div class="actions">
        <button id="btnAddRate"${parentEditable ? '' : ' disabled'}>Add rate override</button>
        ${parentEditable ? '<span class="hint">Changes are staged. Click “Save” in the main dialog to persist.</span>'
                         : '<span class="hint">Read-only. Click “Edit” in the main dialog to add/modify overrides.</span>'}
      </div>
    `;
    const addBtn = byId('btnAddRate');
    if (addBtn && parentEditable) addBtn.onclick = () => openCandidateRateModal(window.modalCtx.data?.id);
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
    if (parentEditable) tr.ondblclick = () => openCandidateRateModal(window.modalCtx.data?.id, r);
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
    <button id="btnAddRate"${parentEditable ? '' : ' disabled'}>Add rate override</button>
    ${parentEditable ? '<span class="hint">Changes are staged. Click “Save” in the main dialog to persist.</span>'
                     : '<span class="hint">Read-only. Click “Edit” in the main dialog to add/modify overrides.</span>'}
  `;

  div.innerHTML = '';
  div.appendChild(tbl);
  div.appendChild(actions);

  const addBtn = byId('btnAddRate');
  if (addBtn && parentEditable) addBtn.onclick = () => openCandidateRateModal(window.modalCtx.data?.id);
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

      <!-- CCR: display-only, never posted -->
      <div class="row">
        <label>CloudTMS Candidate Reference (CCR)</label>
        <input id="tms_ref_display"
               value="${row.tms_ref ? String(row.tms_ref) : 'Awaiting CCR number from server'}"
               disabled
               readonly
               style="opacity:.7" />
      </div>

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

// ==============================
// 3) mountCandidateRatesTab(...)
// ==============================
async function mountCandidateRatesTab() {
  const LOG = !!window.__LOG_RATES;
  const token = window.modalCtx.openToken;
  const id    = window.modalCtx.data?.id || null;
  if (LOG) console.log('[RATES][mountCandidateRatesTab] ENTRY', { token, id });

  const rates = id ? await listCandidateRates(id) : [];
  if (token !== window.modalCtx.openToken || window.modalCtx.data?.id !== id) {
    if (LOG) console.warn('[RATES][mountCandidateRatesTab] token/id changed mid-flight'); 
    return;
  }

  if (Array.isArray(rates)) {
    window.modalCtx.overrides = window.modalCtx.overrides || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };
    window.modalCtx.overrides.existing = rates.slice();
  }
  await renderCandidateRatesTable();
  if (LOG) console.log('[RATES][mountCandidateRatesTab] renderCandidateRatesTable() called');

  const btn = byId('btnAddRate');
  const frame = _currentFrame();
  // ✅ Allow add in create mode too
  if (btn && frame && (frame.mode === 'edit' || frame.mode === 'create')) btn.onclick = () => openCandidateRateModal(window.modalCtx.data?.id);
}



// === UPDATED: Candidate Rate Override modal (Client→Role gated; bands; UK dates; date_to) ===
// ====================== openCandidateRateModal (FIXED) ======================
// =================== CANDIDATE OVERRIDE MODAL (UPDATED) ===================
// ==== CHILD MODAL (CANDIDATE RATE) — throw on errors; return true on success ====
// ✅ UPDATED — Apply (stage), gate against client defaults active at date_from,
//    auto-truncate incumbent of same rate_type at N−1 (staged), NO persistence here

// ==============================
// 1) openCandidateRateModal(...)
// ==============================
async function openCandidateRateModal(candidate_id, existing) {
  const LOG = !!window.__LOG_RATES;
  const G = (label, obj) => { if (LOG) console.groupCollapsed(`[RATES][openCandidateRateModal] ${label}`); if (LOG && obj!==undefined) console.log(obj); if (LOG) console.groupEnd(); };
  if (LOG) console.log('[RATES][openCandidateRateModal] ENTRY', { candidate_id, hasExisting: !!existing });

  const parentFrame = _currentFrame();                       // this is the PARENT at call time
  // ✅ Parent may be in 'create'
  const parentEditable = parentFrame && (parentFrame.mode === 'edit' || parentFrame.mode === 'create');
  if (LOG) console.log('[RATES][openCandidateRateModal] parentEditable?', parentEditable, 'parentMode=', parentFrame?.mode);

  const todayIso = (() => {
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0'), d = String(now.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  })();
  const isPastOrToday = (iso) => !!iso && iso <= todayIso;

  const clients = await listClientsBasic();
  const clientOptions = clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const initialClientId = existing?.client_id || '';

  const defaultRateType = existing?.rate_type
    ? String(existing.rate_type).toUpperCase()
    : String(window.modalCtx?.data?.pay_method || 'PAYE').toUpperCase();

  const formHtml = html(`
    <div class="form" id="candRateForm">
      <div class="row">
        <label>Client (required)</label>
        <select name="client_id" id="cr_client_id" ${parentEditable ? '' : 'disabled'}>
          <option value="">Select client…</option>
          ${clientOptions}
        </select>
      </div>

      <div class="row">
        <label>Rate type (required)</label>
        <select name="rate_type" id="cr_rate_type" ${parentEditable ? '' : 'disabled'}>
          <option ${defaultRateType==='PAYE'?'selected':''}>PAYE</option>
          <option ${defaultRateType==='UMBRELLA'?'selected':''}>UMBRELLA</option>
        </select>
      </div>

      <div class="row">
        <label>Role (required)</label>
        <select name="role" id="cr_role" required ${parentEditable ? '' : 'disabled'}>
          <option value="">Select role…</option>
        </select>
      </div>
      <div class="row" id="cr_band_row" style="display:none">
        <label>Band (optional)</label>
        <select name="band" id="cr_band" ${parentEditable ? '' : 'disabled'}></select>
      </div>

      <div class="row">
        <label>Effective from (DD/MM/YYYY)</label>
        <input type="text" name="date_from" id="cr_date_from" placeholder="DD/MM/YYYY" ${parentEditable ? '' : 'disabled'} />
      </div>
      <div class="row">
        <label>Effective to (optional, DD/MM/YYYY)</label>
        <input type="text" name="date_to" id="cr_date_to" placeholder="DD/MM/YYYY" ${parentEditable ? '' : 'disabled'} />
      </div>

      ${input('pay_day','Pay (Day)',     existing?.pay_day     ?? '', 'number')}
      ${input('pay_night','Pay (Night)', existing?.pay_night   ?? '', 'number')}
      ${input('pay_sat','Pay (Sat)',     existing?.pay_sat     ?? '', 'number')}
      ${input('pay_sun','Pay (Sun)',     existing?.pay_sun     ?? '', 'number')}
      ${input('pay_bh','Pay (BH)',       existing?.pay_bh       ?? '', 'number')}
    </div>
  `);

  let cache = { windows: [], roles: [], bandsByRole: {} };

  showModal(
    existing ? 'Edit Candidate Rate Override' : 'Add Candidate Rate Override',
    [{ key:'form', label:'Form' }],
    () => formHtml,
    async () => {
      // ✅ Allow Apply when parent is 'edit' or 'create'
      if (!parentEditable) {
        alert('Open the candidate in Edit mode to add/modify overrides.');
        if (LOG) console.warn('[RATES][openCandidateRateModal] Apply blocked: parent not editable');
        return false;
      }

      const raw = collectForm('#candRateForm');
      if (LOG) G('Apply collected form', raw);

      const client_id = (raw.client_id || '').trim();
      const role = (raw.role || '').trim();
      const band = (raw.band || '').trim() || null;
      const rate_type = String(raw.rate_type || '').toUpperCase();

      if (!client_id) { alert('Client is required'); return false; }
      if (!role) { alert('Role is required'); return false; }
      if (rate_type !== 'PAYE' && rate_type !== 'UMBRELLA') { alert('Rate type must be PAYE or UMBRELLA'); return false; }

      const isoFromUI = parseUkDateToIso(raw.date_from);
      let isoFrom = isoFromUI;
      if (!isoFrom) { alert('Invalid “Effective from” date'); return false; }
      if (existing?.date_from) isoFrom = existing.date_from || isoFrom;

      let isoTo = null;
      if (raw.date_to) {
        isoTo = parseUkDateToIso(raw.date_to);
        if (!isoTo) { alert('Invalid “Effective to” date'); return false; }
      }

      const locked = !!existing?.date_from && isPastOrToday(existing.date_from);
      if (locked) {
        if (!isoTo) { alert('You can only set or extend the end date for past/today starts.'); return false; }
        if (isoTo < (existing.date_from || isoFrom)) { alert('“Effective to” cannot be before “Effective from”.'); return false; }
      } else {
        if (isoTo && isoTo < isoFrom) { alert('“Effective to” cannot be before “Effective from”.'); return false; }
      }

      // Gate by client defaults (using isoFrom) — loads enabled windows for the date
      const active_on = isoFrom;
      const list = await listClientRates(client_id, { active_on, only_enabled: true });
      cache.windows = (Array.isArray(list) ? list.filter(w => !w.disabled_at_utc) : []);

      const roles = new Set();
      const bandsByRole = {};
      (cache.windows).forEach(w => {
        if (!w.role) return;
        roles.add(w.role);
        const bKey = (w.band == null ? '' : String(w.band));
        (bandsByRole[w.role] ||= new Set()).add(bKey);
      });
      cache.roles = [...roles];
      cache.bandsByRole = Object.fromEntries(
        cache.roles.map(code => [code, [...(bandsByRole[code] || new Set())]])
      );

      const allowed = cache.roles.slice().sort((a,b)=> a.localeCompare(b));
      if (!allowed.includes(role)) { alert(`No active client default for role ${role} at ${formatIsoToUk(isoFrom)}`); return false; }
      const bands = cache.bandsByRole[role] || [];
      const hasNull = bands.includes('');
      if (band == null && !hasNull) { alert(`This client has no band-null window for ${role} on ${formatIsoToUk(isoFrom)}.`); return false; }
      if (band != null && !bands.includes(String(band))) { alert(`No active band ${band} for ${role} on ${formatIsoToUk(isoFrom)}.`); return false; }

      const stagedAll = {
        id        : existing?.id,
        candidate_id,
        client_id,
        role, band,
        rate_type,
        date_from : isoFrom,
        date_to   : isoTo ?? null,
        pay_day   : raw['pay_day']   !== '' ? Number(raw['pay_day'])   : null,
        pay_night : raw['pay_night'] !== '' ? Number(raw['pay_night']) : null,
        pay_sat   : raw['pay_sat']   !== '' ? Number(raw['pay_sat'])   : null,
        pay_sun   : raw['pay_sun']   !== '' ? Number(raw['pay_sun'])   : null,
        pay_bh    : raw['pay_bh']    !== '' ? Number(raw['pay_bh'])    : null
      };

      const stagedPatch = (locked ? { date_to: stagedAll.date_to } : stagedAll);

      const O = window.modalCtx.overrides || (window.modalCtx.overrides = { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });

      const universe = [
        ...O.existing.filter(x => !O.stagedDeletes.has(x.id)),
        ...O.stagedNew
      ];
      const sameKey = o =>
        String(o.client_id) === client_id &&
        String(o.role||'')  === role &&
        String((o.rate_type || '')).toUpperCase() === rate_type &&
        String(o.band||'')  === String(band||'');

      const overlapping = universe
        .filter(o => sameKey(o) && (!existing?.id || o.id !== existing.id))
        .filter(o => rangesOverlap(o.date_from||null, o.date_to||null, stagedAll.date_from, stagedAll.date_to));
      if (overlapping.length) {
        const ov = overlapping[0];
        const d = new Date(stagedAll.date_from+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-1);
        const cut = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
        const ok = window.confirm(
          `An override for ${ov.role}${ov.band?` / ${ov.band}`:''} (${ov.rate_type}) is active `+
          `${formatIsoToUk(ov.date_from)}–${formatIsoToUk(ov.date_to||'')}. End it on ${formatIsoToUk(cut)}?`
        );
        if (!ok) return false;

        if (ov.id) O.stagedEdits[ov.id] = { ...(O.stagedEdits[ov.id]||{}), date_to: cut };
        else {
          const ix = O.stagedNew.findIndex(s => s._tmpId && ov._tmpId && s._tmpId === ov._tmpId);
          if (ix >= 0) O.stagedNew[ix] = { ...O.stagedNew[ix], date_to: cut };
          else {
            const ix2 = O.stagedNew.indexOf(ov);
            if (ix2 >= 0) O.stagedNew[ix2] = { ...ov, date_to: cut };
          }
        }
      }

      if (existing?.id) {
        O.stagedEdits[existing.id] = { ...O.stagedEdits[existing.id], ...stagedPatch };
      } else if (existing && !existing.id) {
        const tmpId = existing._tmpId || null;
        let idx = (tmpId ? O.stagedNew.findIndex(r => r._tmpId === tmpId) : -1);
        if (idx < 0) {
          idx = O.stagedNew.findIndex(r =>
            String(r.client_id) === client_id &&
            String(r.role||'')  === role &&
            String(r.rate_type || '').toUpperCase() === rate_type &&
            String(r.band||'')  === String(band||'') &&
            String(r.date_from||'') === String(existing.date_from||'') &&
            String(r.date_to||'')   === String(existing.date_to||'')
          );
        }
        if (idx >= 0) {
          const keepTmp = O.stagedNew[idx]._tmpId || tmpId || `tmp_${Date.now()}`;
          O.stagedNew[idx] = { ...O.stagedNew[idx], ...stagedPatch, _tmpId: keepTmp };
        } else {
          O.stagedNew.push({ ...stagedPatch, _tmpId: tmpId || `tmp_${Date.now()}` });
        }
      } else {
        O.stagedNew.push({ ...stagedPatch, _tmpId: `tmp_${Date.now()}` });
      }

      if (document.getElementById('ratesTable')) await renderCandidateRatesTable();
      try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
      return true;
    },
    false,
    () => {
      const parent = _currentFrame();
      if (parent) {
        if (LOG) console.log('[RATES][openCandidateRateModal] onReturn → setTab("rates")');
        parent.currentTabKey = 'rates'; parent.setTab('rates');
      }
    }
  );

  // After mount: prefill & wire
  const selClient = document.getElementById('cr_client_id');
  const selRateT  = document.getElementById('cr_rate_type');
  const selRole   = document.getElementById('cr_role');
  const selBand   = document.getElementById('cr_band');
  const bandRow   = document.getElementById('cr_band_row');
  const inFrom    = document.getElementById('cr_date_from');
  const inTo      = document.getElementById('cr_date_to');

  if (initialClientId) selClient.value = initialClientId;
  if (existing?.date_from) inFrom.value = formatIsoToUk(existing.date_from);
  if (existing?.date_to)   inTo.value   = formatIsoToUk(existing.date_to);

  attachUkDatePicker(inFrom);
  attachUkDatePicker(inTo);

  const lockThis = !!existing?.date_from && isPastOrToday(existing.date_from);
  if (lockThis) {
    selClient.disabled = true;
    selRateT.disabled  = true;
    selRole.disabled   = true;
    selBand.disabled   = true;
    inFrom.disabled    = true;

    ['pay_day','pay_night','pay_sat','pay_sun','pay_bh'].forEach(n => {
      const el = document.querySelector(`#candRateForm input[name="${n}"]`);
      if (el) el.disabled = true;
    });
  }

  async function refreshClientRoles(clientId) {
    selRole.innerHTML = `<option value="">Select role…</option>`;
    selRole.disabled = true;
    bandRow.style.display = 'none';
    selBand.innerHTML = '';
    if (!clientId) return;

    const active_on = parseUkDateToIso(inFrom.value || '') || null;
    const list = await listClientRates(clientId, { active_on, only_enabled: true });
    cache.windows = (Array.isArray(list) ? list.filter(w => !w.disabled_at_utc) : []);

    const roles = new Set();
    const bandsByRole = {};
    (cache.windows).forEach(w => {
      if (!w.role) return;
      roles.add(w.role);
      const bKey = (w.band == null ? '' : String(w.band));
      (bandsByRole[w.role] ||= new Set()).add(bKey);
    });

    const allowed = [...roles].sort((a,b)=> a.localeCompare(b));
    if (!allowed.length) {
      selRole.innerHTML = `<option value="">Select role…</option>`;
      selRole.disabled = true;
      return;
    }

    selRole.innerHTML = `<option value="">Select role…</option>` +
      allowed.map(code => `<option value="${code}">${code}</option>`).join('');
    selRole.disabled = !!lockThis;

    cache.roles = allowed;
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
    selBand.disabled = !!lockThis;
  }

  selClient.addEventListener('change', () => { if (!lockThis) refreshClientRoles(selClient.value); });
  selRateT .addEventListener('change', () => { if (!lockThis) refreshClientRoles(selClient.value); });
  inFrom.addEventListener('change', () => { if (!lockThis) refreshClientRoles(selClient.value); });
  selRole.addEventListener('change', onRoleChanged);

  if (initialClientId) {
    selClient.value = initialClientId;
    await refreshClientRoles(initialClientId);
  }
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

// ================== FRONTEND: openClient (UPDATED) ==================
// ================== FIXED: openClient (hydrate before showModal) ==================
// ================== FIXED: openClient (hydrate before showModal) ==================

// ============================================================================
// OPEN CLIENT (parent modal) — skip posting disabled windows on Save
// (No delete button is added here; ensure any existing parent delete UI is removed elsewhere.)
// ============================================================================
async function openClient(row) {
  // ===== Logging helpers (toggle with window.__LOG_MODAL = true/false) =====
  const LOG = (typeof window.__LOG_MODAL === 'boolean') ? window.__LOG_MODAL : true;
  const APILOG = (typeof window !== 'undefined' && !!window.__LOG_API) || (typeof __LOG_API !== 'undefined' && !!__LOG_API);
  const L  = (...a)=> { if (LOG) console.log('[OPEN_CLIENT]', ...a); };
  const W  = (...a)=> { if (LOG) console.warn('[OPEN_CLIENT]', ...a); };
  const E  = (...a)=> { if (LOG) console.error('[OPEN_CLIENT]', ...a); };

  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));
  const incoming = deep(row || {});
  const seedId   = incoming?.id || null;

  L('ENTRY', { incomingKeys: Object.keys(incoming||{}), seedId });

  const unwrapSingle = (data, key) => {
    if (Array.isArray(data)) return data[0] || null;
    if (data && key && data[key]) return unwrapSingle(data[key], null);
    if (data && Array.isArray(data.rows))  return data.rows[0]  || null;
    if (data && Array.isArray(data.items)) return data.items[0] || null;
    if (data && Array.isArray(data.data))  return data.data[0]  || null;
    return (data && typeof data === 'object') ? data : null;
  };

  // 1) Hydrate full client if we have an id
  let full = incoming;
  let settingsSeed = null; // PRESEED client settings to avoid time-validator race
  if (seedId) {
    try {
      const url = API(`/api/clients/${encodeURIComponent(seedId)}`);
      L('[HTTP] GET', url);
      const r = await authFetch(url);
      L('[HTTP] status', r?.status, r?.ok);

      try {
        const raw = await r.clone().text();
        if (LOG) console.debug('[HTTP] raw body (≤2KB):', raw.slice(0, 2048));
      } catch (peekErr) { W('[HTTP] raw peek failed', peekErr?.message || peekErr); }

      if (r.ok) {
        const data = await r.json().catch(()=> ({}));
        const clientObj   = data?.client || unwrapSingle(data, 'client') || null;
        const settingsObj = data?.client_settings || data?.settings || null;
        settingsSeed = settingsObj ? deep(settingsObj) : null;
        full = clientObj || incoming;
        L('hydrated JSON keys', Object.keys(data||{}), 'client keys', Object.keys(clientObj||{}), 'hasSettingsSeed', !!settingsSeed);
      } else {
        W('non-OK response, using incoming row');
      }
    } catch (e) {
      W('openClient hydrate failed; using summary row', e);
    }
  } else {
    L('no seedId — create mode');
  }

  // 2) Seed window.modalCtx and show  (+ preseed clientSettingsState to remove race)
  const fullKeys = Object.keys(full || {});
  L('seeding window.modalCtx', { entity: 'clients', fullId: full?.id, fullKeys });

  window.modalCtx = {
    entity: 'clients',
    data: deep(full),
    formState: { __forId: full?.id || null, main: {} },
    ratesState: [],
    ratesBaseline: [], // baseline snapshot to detect status toggles on Save
    hospitalsState: { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() },
    clientSettingsState: settingsSeed ? deep(settingsSeed) : {},
    openToken: ((full?.id) || 'new') + ':' + Date.now()
  };

  L('window.modalCtx seeded', {
    entity: window.modalCtx.entity,
    dataId: window.modalCtx.data?.id,
    dataKeys: Object.keys(window.modalCtx.data||{}),
    formStateForId: window.modalCtx.formState?.__forId,
    openToken: window.modalCtx.openToken,
    preseededSettings: Object.keys(window.modalCtx.clientSettingsState||{}),
  });

  // 3) Render modal (first paint uses hydrated "full")
  L('calling showModal with hasId=', !!full?.id, 'rawHasIdArg=', full?.id);
  showModal(
    'Client',
    [
      {key:'main',     label:'Main'},
      {key:'rates',    label:'Rates'},
      {key:'settings', label:'Client settings'},
      {key:'hospitals',label:'Hospitals & wards'}
    ],
    (k, r) => { L('[renderClientTab] tab=', k, 'rowKeys=', Object.keys(r||{}), 'sample=', { name: r?.name, id: r?.id }); return renderClientTab(k, r); },
    async ()=> {
      L('[onSave] begin', { dataId: window.modalCtx?.data?.id, forId: window.modalCtx?.formState?.__forId });
      const isNew = !window.modalCtx?.data?.id;

      // Collect "main" form
      const fs = window.modalCtx.formState || { __forId: null, main:{} };
      const same = (!!window.modalCtx.data?.id && fs.__forId === window.modalCtx.data.id) || (!window.modalCtx.data?.id && fs.__forId == null);
      const stagedMain = same ? (fs.main || {}) : {};
      const liveMain   = byId('tab-main') ? collectForm('#tab-main') : {};
      const payload    = { ...stagedMain, ...liveMain };

      L('[onSave] collected', { same, stagedKeys: Object.keys(stagedMain||{}), liveKeys: Object.keys(liveMain||{}) });

      // Immutable on server
      delete payload.but_let_cli_ref;
      if (!payload.name && full?.name) payload.name = full.name;
      if (!payload.name) { alert('Please enter a Client name.'); return { ok:false }; }

      // ===== Settings normalization (GUARDED) =====
      const baseline = window.modalCtx.clientSettingsState || {};
      const hasFormMounted = !!byId('clientSettingsForm');
      const hasFullBaseline = ['day_start','day_end','night_start','night_end'].every(k => typeof baseline[k] === 'string' && baseline[k] !== '');
      const shouldValidateSettings = hasFormMounted || hasFullBaseline;

      if (shouldValidateSettings) {
        let csMerged = { ...(baseline || {}) };
        if (hasFormMounted) {
          const liveSettings = collectForm('#clientSettingsForm', false);
          ['day_start','day_end','night_start','night_end'].forEach(k=>{
            const v = _toHHMM(liveSettings[k]); // returns '' if empty
            if (v) csMerged[k] = v;
          });
          if (typeof liveSettings.timezone_id === 'string' && liveSettings.timezone_id.trim() !== '') {
            csMerged.timezone_id = liveSettings.timezone_id.trim();
          }
        }
        const { cleaned: csClean, invalid: csInvalid } = normalizeClientSettingsForSave(csMerged);
        if (APILOG) console.log('[OPEN_CLIENT] client_settings (merged→clean)', { csMerged, csClean, csInvalid, hasFormMounted, hasFullBaseline });
        if (csInvalid) { alert('Times must be HH:MM (24-hour).'); return { ok:false }; }
        if (Object.keys(csClean).length) {
          payload.client_settings = csClean;
        }
      } else {
        if (APILOG) console.log('[OPEN_CLIENT] skip settings normalisation (no form & incomplete baseline)');
      }
      // ============================================

      // 1) Upsert client (must have id before hospitals/rates)
      const idForUpdate = window.modalCtx?.data?.id || full?.id || null;
      if (APILOG) console.log('[OPEN_CLIENT] upsertClient → request', { idForUpdate, payload });
      L('[onSave] upsertClient', { idForUpdate, payloadKeys: Object.keys(payload||{}) });
      const clientResp  = await upsertClient(payload, idForUpdate).catch(err => { E('upsertClient failed', err); return null; });
      const clientId    = idForUpdate || (clientResp && clientResp.id);
      if (APILOG) console.log('[OPEN_CLIENT] upsertClient ← response', { ok: !!clientResp, clientId });
      if (!clientId) { alert('Failed to save client'); return { ok:false }; }

      // 2) Flush Hospitals staged CRUD (deletes → edits → creates). Abort on first failure.
      try {
        const hs = window.modalCtx.hospitalsState || {};
        // deletes
        if (hs.stagedDeletes && hs.stagedDeletes.size) {
          for (const hid of hs.stagedDeletes) {
            const url = API(`/api/clients/${encodeURIComponent(clientId)}/hospitals/${encodeURIComponent(hid)}`);
            if (APILOG) console.log('[OPEN_CLIENT] DELETE hospital →', url);
            const res = await authFetch(url, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
          }
        }
        // edits
        if (hs.stagedEdits && typeof hs.stagedEdits === 'object') {
          for (const [hid, patchRaw] of Object.entries(hs.stagedEdits)) {
            const patch = {};
            if (patchRaw && Object.prototype.hasOwnProperty.call(patchRaw,'hospital_name_norm')) {
              const name = String(patchRaw.hospital_name_norm || '').trim();
              if (!name) throw new Error('Hospital name cannot be blank.');
              patch.hospital_name_norm = name;
            }
            if (patchRaw && Object.prototype.hasOwnProperty.call(patchRaw,'ward_hint')) {
              const hint = String(patchRaw.ward_hint ?? '').trim();
              patch.ward_hint = hint === '' ? null : hint;
            }
            if (Object.keys(patch).length === 0) continue; // nothing to send
            const url = API(`/api/clients/${encodeURIComponent(clientId)}/hospitals/${encodeURIComponent(hid)}`);
            if (APILOG) console.log('[OPEN_CLIENT] PATCH hospital →', url, patch);
            const res = await authFetch(url, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patch)
            });
            if (!res.ok) throw new Error(await res.text());
          }
        }
        // creates
        if (Array.isArray(hs.stagedNew) && hs.stagedNew.length) {
          for (const n of hs.stagedNew) {
            const body = {
              hospital_name_norm: String(n?.hospital_name_norm || '').trim(),
              ward_hint: (String(n?.ward_hint ?? '').trim() || null)
            };
            if (!body.hospital_name_norm) throw new Error('Hospital name cannot be blank.');
            const url = API(`/api/clients/${encodeURIComponent(clientId)}/hospitals`);
            if (APILOG) console.log('[OPEN_CLIENT] POST hospital →', url, body);
            const res = await authFetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(await res.text());
          }
        }
        // clear staging and refresh authoritative list in modal
        if (hs.stagedDeletes) hs.stagedDeletes.clear();
        if (hs.stagedEdits)   window.modalCtx.hospitalsState.stagedEdits = {};
        if (hs.stagedNew)     window.modalCtx.hospitalsState.stagedNew = [];
        try {
          const fresh = await listClientHospitals(clientId);
          window.modalCtx.hospitalsState.existing = Array.isArray(fresh) ? fresh : [];
          try { renderClientHospitalsTable(); } catch {}
        } catch (e) {
          W('[OPEN_CLIENT] hospitals refresh failed', e);
        }
      } catch (err) {
        alert(`Failed to save Hospitals & wards: ${String(err?.message || err)}`);
        return { ok:false };
      }

      // 3) Persist rate window status toggles (before upserts)
      const baselineRates = Array.isArray(window.modalCtx.ratesBaseline) ? window.modalCtx.ratesBaseline : [];
      const prevById = new Map(baselineRates.filter(r => r && r.id).map(r => [String(r.id), r]));
      const windows = Array.isArray(window.modalCtx.ratesState) ? window.modalCtx.ratesState.slice() : [];

      const toggles = [];
      for (const w of windows) {
        if (!w?.id) continue;
        const prev = prevById.get(String(w.id));
        if (!prev) continue;
        const prevDisabled = !!prev.disabled_at_utc;
        const currDisabled = !!w.disabled_at_utc;
        if (prevDisabled !== currDisabled) toggles.push({ id: w.id, disabled: currDisabled });
      }

      if (toggles.length) {
        if (APILOG) console.log('[OPEN_CLIENT] applying toggles', toggles);
        for (const t of toggles) {
          try {
            await patchClientDefault(t.id, { disabled: t.disabled });
          } catch (e) {
            const msg = String(e?.message || e || '');
            if (msg.includes('duplicate key') || msg.includes('duplicate')) {
              alert('Cannot enable this window: another enabled window already starts on the same date for the same role/band.');
            } else {
              alert(`Failed to update status: ${msg}`);
            }
            return { ok:false };
          }
        }
      }

      // 4) Persist enabled windows (skip disabled)
      if (clientId && windows.length) {
        // guard for intra-batch overlap (enabled windows only)
        for (let i = 0; i < windows.length; i++) {
          for (let j = i + 1; j < windows.length; j++) {
            const A = windows[i], B = windows[j];
            if (A.disabled_at_utc || B.disabled_at_utc) continue; // ignore disabled in this guard
            if (String(A.role||'') === String(B.role||'') &&
                String(A.band||'') === String(B.band||'')) {
              const a0 = A.date_from || null, a1 = A.date_to || null;
              const b0 = B.date_from || null, b1 = B.date_to || null;
              if (rangesOverlap(a0, a1, b0, b1)) {
                alert(`Client default windows overlap for role=${A.role} band=${A.band||'(none)'}.\n` +
                      `${formatIsoToUk(a0)}–${formatIsoToUk(a1||'')}  vs  ${formatIsoToUk(b0)}–${formatIsoToUk(b1||'')}`);
                if (APILOG) console.warn('[OPEN_CLIENT] overlap detected', { A, B });
                return { ok:false };
              }
            }
          }
        }

        for (const w of windows) {
          try {
            if (w.disabled_at_utc) {
              if (APILOG) console.log('[OPEN_CLIENT] skip disabled window (not upserting)', { id: w.id, role: w.role, band: w.band });
              continue;
            }
            if (APILOG) console.log('[OPEN_CLIENT] upsertClientRate →', w);
            await upsertClientRate({
              client_id : clientId,
              role      : w.role || '',
              band      : w.band ?? null,
              date_from : w.date_from || null,
              date_to   : w.date_to ?? null,

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
            if (APILOG) console.log('[OPEN_CLIENT] upsertClientRate ← ok');
          } catch (e) {
            E('Upsert client default window failed', w, e);
            alert('Failed to save a client rate window. See console for details.');
            return { ok:false };
          }
        }
      }

      // Refresh list & rebuild baseline (authoritative names from server)
      try {
        const refreshed = await listClientRates(clientId /* all incl. disabled */);
        window.modalCtx.ratesState    = Array.isArray(refreshed) ? refreshed.map(x => ({ ...x })) : [];
        window.modalCtx.ratesBaseline = JSON.parse(JSON.stringify(window.modalCtx.ratesState));
        try { renderClientRatesTable(); } catch {}
      } catch (e) {
        W('[openClient] post-save refresh failed', e);
      }

      // Keep data fresh in the modal
      window.modalCtx.data      = { ...(window.modalCtx.data || {}), ...(clientId ? { id: clientId } : {} ) };
      window.modalCtx.formState = { __forId: clientId, main:{} };

      if (isNew) window.__pendingFocus = { section: 'clients', id: clientId };
      return { ok: true, saved: window.modalCtx.data };
    },
    full?.id
  );

  // 4) Post-paint async loads (merge metadata when staged so names flow in)
  if (full?.id) {
    const token = window.modalCtx.openToken;
    const id    = full.id;
    try {
      const unified = await listClientRates(id /* all, incl. disabled */);
      if (token === window.modalCtx.openToken && window.modalCtx.data?.id === id) {
        const hasStaged = Array.isArray(window.modalCtx.ratesState) && window.modalCtx.ratesState.length > 0;
        if (!hasStaged) {
          window.modalCtx.ratesState    = Array.isArray(unified) ? unified.map(r => ({ ...r })) : [];
          window.modalCtx.ratesBaseline = JSON.parse(JSON.stringify(window.modalCtx.ratesState)); // capture baseline
        } else {
          // Merge authoritative metadata (e.g., disabled_by_name, disabled_at_utc) by id into staged rows
          const staged = Array.isArray(window.modalCtx.ratesState) ? window.modalCtx.ratesState.slice() : [];
          const stagedById = new Map(staged.map(r => [String(r.id), r]));
          (Array.isArray(unified) ? unified : []).forEach(srv => {
            const s = stagedById.get(String(srv.id));
            if (s) {
              s.disabled_at_utc  = srv.disabled_at_utc ?? null;
              s.disabled_by_name = srv.disabled_by_name ?? null;
            } else {
              staged.push({ ...srv });
            }
          });
          window.modalCtx.ratesState = staged;
          // Do not touch ratesBaseline here; keep original baseline for toggle diffing
        }
        try { renderClientRatesTable(); } catch {}
      }
    } catch (e) { W('openClient POST-PAINT rates error', e); }

    // === NEW: fetch hospitals on first open ===
    try {
      const freshHosp = await listClientHospitals(id);
      if (token === window.modalCtx.openToken && window.modalCtx.data?.id === id) {
        window.modalCtx.hospitalsState.existing = Array.isArray(freshHosp) ? freshHosp : [];
        try { renderClientHospitalsTable(); } catch {}
      }
    } catch (e) { W('openClient POST-PAINT hospitals error', e); }

    // other post-paint loads unchanged...
  } else {
    L('skip companion loads (no full.id)');
  }
}


// =================== CLIENT RATES TABLE (UPDATED) ===================
// ✅ UPDATED — unified table view, dbl-click opens unified modal
// ============================================================================
// RENDER CLIENT RATES TABLE (adds "Status" col; shows disabled who/when)
// ============================================================================

function renderClientRatesTable() {
  const div = byId('clientRates'); if (!div) return;

  const ctx = window.modalCtx;
  const staged = Array.isArray(ctx.ratesState) ? ctx.ratesState : [];
  const frame = _currentFrame();
  // ✅ Allow buttons in create mode for new client
  const parentEditable = frame && (frame.mode === 'edit' || frame.mode === 'create');

  div.innerHTML = '';

  if (!staged.length) {
    div.innerHTML = `
      <div class="hint" style="margin-bottom:8px">No client default windows yet.</div>
      <div class="actions">
        <button id="btnAddClientRate"${parentEditable ? '' : ' disabled'}>Add / Upsert client window</button>
        ${parentEditable ? '<span class="hint">Changes are staged. Click “Save” in the main dialog to persist.</span>'
                         : '<span class="hint">Read-only. Click “Edit” in the main dialog to add/modify windows.</span>'}
      </div>
    `;
    const addBtn = byId('btnAddClientRate');
    if (addBtn && parentEditable) {
      addBtn.onclick = () => {
        const cid = (ctx && ctx.data && (ctx.data.id || ctx.data.client_id)) || null;
        return openClientRateModal(cid);
      };
    }
    return;
  }

  const cols    = [
    'status',
    'role','band',
    'paye_day','paye_night','paye_sat','paye_sun','paye_bh',
    'umb_day','umb_night','umb_sat','umb_sun','umb_bh',
    'charge_day','charge_night','charge_sat','charge_sun','charge_bh',
    'date_from','date_to'
  ];
  const headers = [
    'Status',
    'Role','Band',
    'PAYE Day','PAYE Night','PAYE Sat','PAYE Sun','PAYE BH',
    'UMB Day','UMB Night','UMB Sat','UMB Sun','UMB BH',
    'Charge Day','Charge Night','Charge Sat','Charge Sun','Charge BH',
    'From','To'
  ];

  const tbl   = document.createElement('table'); tbl.className='grid';
  const thead = document.createElement('thead');
  const trh   = document.createElement('tr');
  headers.forEach(h => { const th=document.createElement('th'); th.textContent = h; trh.appendChild(th); });
  thead.appendChild(trh);
  tbl.appendChild(thead);

  const tb = document.createElement('tbody');
  staged.forEach(r => {
    const tr = document.createElement('tr');
    if (r.disabled_at_utc) tr.classList.add('row-disabled');

    if (parentEditable) tr.ondblclick = () => {
      const cid = (ctx && ctx.data && (ctx.data.id || ctx.data.client_id)) || r.client_id || null;
      return openClientRateModal(cid, r);
    };

    cols.forEach(c => {
      const td = document.createElement('td');

      if (c === 'status') {
        if (r.disabled_at_utc) {
          const pending = r.__toggle ? ' (pending save)' : '';
          td.innerHTML = `<span class="pill tag-fail" aria-label="Disabled">❌ Disabled${pending}</span>`;
        } else {
          const pending = r.__toggle === 'enable' ? ' (pending save)' : '';
          td.innerHTML = `<span class="pill tag-ok" aria-label="Active">✓ Active${pending}</span>`;
        }
      } else {
        td.textContent = formatDisplayValue(c, r[c]);
      }

      tr.appendChild(td);
    });

    tb.appendChild(tr);
  });
  tbl.appendChild(tb);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button id="btnAddClientRate"${parentEditable ? '' : ' disabled'}>Add / Upsert client window</button>
    ${parentEditable ? ''
                     : '<span class="hint">Read-only. Click “Edit” in the main dialog to add/modify windows.</span>'}
  `;

  div.appendChild(tbl);
  div.appendChild(actions);

  const addBtn = byId('btnAddClientRate');
  if (addBtn && parentEditable) {
    addBtn.onclick = () => {
      const cid = (ctx && ctx.data && (ctx.data.id || ctx.data.client_id)) || null;
      return openClientRateModal(cid);
    };
  }
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

function renderClientTab(key, row = {}){
  if (key==='main') return html(`
    <div class="form" id="tab-main">
      ${input('name','Client name', row.name)}

      <!-- CLI: display-only, never posted -->
      <div class="row">
        <label>Client Ref (CLI-…)</label>
        <input id="cli_ref_display"
               value="${row.cli_ref ? String(row.cli_ref) : 'Awaiting CLI number from server'}"
               disabled
               readonly
               style="opacity:.7" />
      </div>

      <div class="row" style="grid-column:1/-1"><label>Invoice address</label><textarea name="invoice_address">${row.invoice_address || ''}</textarea></div>
      ${input('primary_invoice_email','Primary invoice email', row.primary_invoice_email,'email')}
      ${input('ap_phone','A/P phone', row.ap_phone)}
      ${select('vat_chargeable','VAT chargeable', row.vat_chargeable? 'Yes' : 'No', ['Yes','No'])}
      ${input('payment_terms_days','Payment terms (days)', row.payment_terms_days || 30, 'number')}
    </div>
  `);

  if (key==='rates')     return html(`<div id="clientRates"></div>`);
  if (key==='settings')  return html(`<div id="clientSettings"></div>`);

  if (key==='hospitals') {
    // Ensure initial render AND first-mount fetch if needed, then render the table
    setTimeout(async () => {
      try {
        const id = window.modalCtx?.data?.id || null;
        const hs = window.modalCtx?.hospitalsState || {};
        const hasExisting = Array.isArray(hs.existing) && hs.existing.length > 0;

        if (id && !hasExisting) {
          const fresh = await listClientHospitals(id);
          if (window.modalCtx?.data?.id === id) {
            window.modalCtx.hospitalsState.existing = Array.isArray(fresh) ? fresh : [];
          }
        }
        try { renderClientHospitalsTable(); } catch {}
      } catch (_) {}
    }, 0);

    return html(`<div id="clientHospitals"></div>`);
  }

  return '';
}

// ===========================
// 5) mountCandidatePayTab(...)
// (auto-populate Umbrella or PAYE bank fields + logging)
// ===========================
async function mountCandidatePayTab(){
  const LOG = !!window.__LOG_PAYTAB;
  const fr = (window.__modalStack || [])[ (window.__modalStack || []).length - 1 ] || null;
  const mode = fr ? fr.mode : 'view';
  // ✅ Treat create as editable
  const isEdit = (mode === 'edit' || mode === 'create');
  if (LOG) console.log('[PAYTAB] ENTRY', { mode, isEdit });

  const payMethod = (window.modalCtx?.payMethodState || window.modalCtx?.data?.pay_method || 'PAYE').toUpperCase();
  const currentUmbId = window.modalCtx?.data?.umbrella_id || '';

  const umbRow    = document.getElementById('umbRow');
  const nameInput = document.getElementById('umbrella_name');
  const listEl    = document.getElementById('umbList');
  const idHidden  = document.getElementById('umbrella_id');

  const accHolder = document.querySelector('#tab-pay input[name="account_holder"]');
  const bankName  = document.querySelector('#tab-pay input[name="bank_name"]');
  const sortCode  = document.querySelector('#tab-pay input[name="sort_code"]');
  const accNum    = document.querySelector('#tab-pay input[name="account_number"]');

  function setBankDisabled(disabled) {
    [accHolder, bankName, sortCode, accNum].forEach(el => { if (el) el.disabled = !!disabled; });
    if (LOG) console.log('[PAYTAB] setBankDisabled', disabled);
  }

  // Helpers
  const unwrapList = (data) => {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && Array.isArray(data.rows))  return data.rows;
    if (data && Array.isArray(data.data))  return data.data;
    return [];
  };
  
  const normaliseSort = (v) => {
    if (!v) return '';
    const digits = String(v).replace(/\D+/g, '').slice(0,6);
    if (digits.length !== 6) return v; // leave as-is if unusual
    return digits.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3');
  };

  async function fetchUmbrellaById(id) {
    try {
      const res = await authFetch(API(`/api/umbrellas/${encodeURIComponent(id)}`));
      if (!res || !res.ok) return null;
      const json = await res.json().catch(() => null);
      // FIX: handle `{ umbrella: {...} }` envelope as well as generic shapes
      const row = json && (json.umbrella || unwrapSingle(json));
      return row || null;
    } catch (_) {
      return null;
    }
  }

  // Updated to gracefully unwrap common single-row envelopes
  function unwrapSingle(json) {
    if (!json) return null;
    if (Array.isArray(json)) return json[0] || null;
    if (json.data && Array.isArray(json.data)) return json.data[0] || null;
    if (Array.isArray(json.rows)) return json.rows[0] || null;
    if (json.item && typeof json.item === 'object' && !Array.isArray(json.item)) return json.item;
    const keys = Object.keys(json);
    if (keys.length === 1) {
      const only = json[keys[0]];
      if (only && typeof only === 'object' && !Array.isArray(only)) return only;
    }
    return json;
  }

  function fillFromCandidate() {
    const d = window.modalCtx?.data || {};
    if (accHolder) accHolder.value = d.account_holder || '';
    if (bankName)  bankName.value  = d.bank_name || '';
    if (sortCode)  sortCode.value  = normaliseSort(d.sort_code || '');
    if (accNum)    accNum.value    = d.account_number || '';
    if (LOG) console.log('[PAYTAB] fillFromCandidate', {
      account_holder: accHolder?.value, bank_name: bankName?.value,
      sort_code: sortCode?.value, account_number: accNum?.value
    });
  }

  function prefillUmbrellaBankFields(umb) {
    if (!umb) return;
    const bank = umb.bank_name || umb.bank || umb.bankName || '';
    const sc   = umb.sort_code || umb.bank_sort_code || umb.sortCode || '';
    const an   = umb.account_number || umb.bank_account_number || umb.accountNumber || '';
    const ah   = umb.name || umb.account_holder || umb.bank_account_name || umb.accountHolder || '';

    if (bankName)  bankName.value  = bank;
    if (sortCode)  sortCode.value  = normaliseSort(sc);
    if (accNum)    accNum.value    = an;
    if (accHolder) accHolder.value = ah;
    if (nameInput) nameInput.value = umb.name || nameInput.value || '';

    if (LOG) console.log('[PAYTAB] prefillUmbrellaBankFields', {
      umb_id: umb.id, name: umb.name, bank, sc, an, ah
    });
  }

  async function fetchAndPrefill(id) {
    if (!id) return;
    const umb = await fetchUmbrellaById(id);
    if (umb) {
      if (idHidden)  idHidden.value  = umb.id || idHidden.value || '';
      prefillUmbrellaBankFields(umb);
    } else {
      if (LOG) console.warn('[PAYTAB] fetchAndPrefill: umbrella not found', id);
    }
  }

  if (payMethod === 'UMBRELLA') {
    if (umbRow) umbRow.style.display = '';
    setBankDisabled(true);

    let umbrellas = [];
    try {
      const res = await authFetch(API('/api/umbrellas'));
      if (res && res.ok) {
        const j = await res.json().catch(()=>[]);
        umbrellas = unwrapList(j);
      }
    } catch (_) { umbrellas = []; }
    if (LOG) console.log('[PAYTAB] umbrellas list loaded', umbrellas.length);

    if (listEl) {
      listEl.innerHTML = (umbrellas || []).map(u => {
        const label = u.name || u.remittance_email || u.id;
        return `<option data-id="${u.id}" value="${label}"></option>`;
      }).join('');
    }

    if (currentUmbId) {
      if (LOG) console.log('[PAYTAB] prefill by currentUmbId', currentUmbId);
      await fetchAndPrefill(currentUmbId);
    } else {
      const typed = nameInput && nameInput.value ? nameInput.value.trim() : '';
      if (typed && umbrellas.length) {
        const hit = umbrellas.find(u => (u.name || '').trim() === typed);
        if (hit) await fetchAndPrefill(hit.id);
      }
    }

    function syncUmbrellaSelection() {
      const val = (nameInput && nameInput.value) ? nameInput.value.trim() : '';
      if (!val) { 
        if (idHidden) idHidden.value = ''; 
        if (LOG) console.log('[PAYTAB] selection cleared');
        return; 
      }
      const allOpts = Array.from((listEl && listEl.options) ? listEl.options : []);
      const hitOpt = allOpts.find(o => o.value === val);
      const id = hitOpt && hitOpt.getAttribute('data-id');
      if (id) {
        if (LOG) console.log('[PAYTAB] selected umbrella', { label: val, id });
        if (idHidden) idHidden.value = id;
        fetchAndPrefill(id);
      } else {
        if (LOG) console.warn('[PAYTAB] no exact label match; clearing id & bank fields');
        if (idHidden) idHidden.value = '';
        if (bankName) bankName.value = '';
        if (sortCode)  sortCode.value  = '';
        if (accNum)   accNum.value   = '';
      }
    }

    if (nameInput) {
      nameInput.disabled = !isEdit;
      nameInput.oninput = syncUmbrellaSelection;
      nameInput.onchange = syncUmbrellaSelection;
    }

    if (idHidden) {
      idHidden.addEventListener('change', () => fetchAndPrefill(idHidden.value));
    }

    const onPmChanged = () => {
      const pm = (window.modalCtx?.payMethodState || window.modalCtx?.data?.pay_method || 'PAYE').toUpperCase();
      if (LOG) console.log('[PAYTAB] pay-method-changed', pm);
      if (pm !== 'UMBRELLA') {
        if (umbRow) umbRow.style.display = 'none';
        setBankDisabled(!isEdit);
        fillFromCandidate();
      } else {
        if (umbRow) umbRow.style.display = '';
        setBankDisabled(true);
        const id = (idHidden && idHidden.value) ? idHidden.value : (window.modalCtx?.data?.umbrella_id || '');
        if (id) fetchAndPrefill(id);
      }
    };
    try { window.addEventListener('pay-method-changed', onPmChanged, { once: true }); } catch {}

  } else {
    if (umbRow) umbRow.style.display = 'none';
    setBankDisabled(!isEdit);
    if (nameInput && idHidden) { nameInput.value = ''; idHidden.value = ''; }
    fillFromCandidate();
  }
}


// =================== MOUNT CLIENT RATES TAB (unchanged glue) ===================
async function mountClientRatesTab() {
  const ctx = window.modalCtx; // use canonical context

  // render uses ctx.ratesState directly; no args needed
  renderClientRatesTable();

  // Always resolve a real client id before opening the modal
  const btn = byId('btnAddClientRate');
  if (btn) {
    btn.onclick = () => {
      const cid = (ctx && ctx.data && (ctx.data.id || ctx.data.client_id)) || null;
      return openClientRateModal(cid);
    };
  }
}


// =================== MOUNT HOSPITALS TAB (unchanged glue) ===================
function mountClientHospitalsTab() {
  const ctx = window.modalCtx; // 🔧 use canonical context
  const H = ctx.hospitalsState || (ctx.hospitalsState = { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });

  renderClientHospitalsTable();

  const addBtn = byId('btnAddClientHospital');
  if (addBtn) addBtn.onclick = () => openClientHospitalModal(ctx.data?.id);

  const wrap = byId('clientHospitals');
  if (wrap && !wrap.__wiredDelete) {
    wrap.addEventListener('click', (ev) => {
      const t = ev.target;
      const el = t && (t.closest('[data-action="delete"]') || t.closest('.btnDelHospital'));
      if (!el) return;

      const hid = el.getAttribute('data-hid') || el.getAttribute('data-id');
      if (!hid) return;

      H.stagedDeletes = H.stagedDeletes || new Set();
      H.stagedDeletes.add(String(hid));

      try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
      renderClientHospitalsTable();
    }, true);
    wrap.__wiredDelete = true;
  }
}



// === UPDATED: Client Default Rate modal (Role dropdown + new-role option; UK dates; date_to) ===
// ======================== openClientRateModal (FIXED) ========================
// =================== CLIENT DEFAULT RATE MODAL (UPDATED) ===================
// ✅ UPDATED — unified 3×5 grid (PAYE | Umbrella | Charge), date prefill, staged N−1 truncation of incumbent window

// ============================================================================
// CLIENT RATE MODAL (child) — adds status block + enable/disable button;
// overlap/rollback logic now IGNORES disabled rows
// ============================================================================
async function openClientRateModal(client_id, existing) {
  const parentFrame = _currentFrame();
  // ✅ Allow create OR edit to be interactive
  const parentEditable = parentFrame && (parentFrame.mode === 'edit' || parentFrame.mode === 'create');
  const APILOG = (typeof window !== 'undefined' && !!window.__LOG_API) || (typeof __LOG_API !== 'undefined' && !!__LOG_API);

  const ctx = window.modalCtx; // 🔧 use canonical context
  // Robust client_id resolution
  const resolvedClientId =
    client_id ||
    (existing && existing.client_id) ||
    (ctx && ctx.data && (ctx.data.id || ctx.data.client_id)) ||
    null;

  if (APILOG) console.log('[openClientRateModal] resolvedClientId', resolvedClientId, { passed: client_id, existing });

  const globalRoles = await loadGlobalRoleOptions();
  const roleOptions = globalRoles.map(r => `<option value="${r}">${r}</option>`).join('')
                    + `<option value="__OTHER__">+ Add new role…</option>`;

  const ex = existing || {};
  const isDisabled = !!ex.disabled_at_utc;
  const who  = ex.disabled_by_name || ''; // show short name only; UUID intentionally not used
  const when = ex.disabled_at_utc ? formatIsoToUk(String(ex.disabled_at_utc).slice(0,10)) : '';

  const statusBlock = `
    <div class="row" id="cl_status_row" style="align-items:center; gap:8px;">
      <div>
        ${is_disabled_marker(ex) /* helper below inlined */ ? `
          <span class="pill tag-fail" id="cl_status_pill">❌ Disabled</span>
          <div class="hint" id="cl_status_meta">by ${escapeHtml(who || 'unknown')} on ${escapeHtml(when || '')}</div>
        ` : `
          <span class="pill tag-ok" id="cl_status_pill">✓ Active</span>
          <div class="hint" id="cl_status_meta">&nbsp;</div>
        `}
      </div>
      ${parentEditable && ex.id
        ? `<div style="margin-left:auto">
             <button id="btnToggleDisable" class="${isDisabled ? 'btn-primary' : 'btn-danger'}">
               ${isDisabled ? 'Enable' : 'Disable'}
             </button>
           </div>`
        : ''
      }
    </div>`;

  function is_disabled_marker(r){ return !!r && !!r.disabled_at_utc; }

  const formHtml = html(`
    <div class="form" id="clientRateForm">
      ${statusBlock}

      <div class="row">
        <label>Role (required)</label>
        <select name="role" id="cl_role" required ${parentEditable ? '' : 'disabled'}>
          <option value="">Select role…</option>
          ${roleOptions}
        </select>
      </div>
      <div class="row" id="cl_role_new_row" style="display:none">
        <label>New role code</label>
        <input type="text" id="cl_role_new" placeholder="e.g. RMN-Lead" ${parentEditable ? '' : 'disabled'} />
        <div class="hint">Uppercase letters/numbers/[-_/ ] recommended.</div>
      </div>

      <div class="row">
        <label>VBR5809: Band (optional)</label>
        <input type="text" name="band" id="cl_band" value="${ex.band ?? ''}" ${parentEditable ? '' : 'disabled'} />
      </div>

      <div class="row">
        <label>Effective from (DD/MM/YYYY)</label>
        <input type="text" name="date_from" id="cl_date_from" placeholder="DD/MM/YYYY" ${parentEditable ? '' : 'disabled'} />
      </div>
      <div class="row">
        <label>Effective to (optional, DD/MM/YYYY)</label>
        <input type="text" name="date_to" id="cl_date_to" placeholder="DD/MM/YYYY" ${parentEditable ? '' : 'disabled'} />
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
                <td><input type="number" step="0.01" name="paye_${bucket}" value="${ex[`paye_${bucket}`] ?? ''}" ${parentEditable ? '' : 'disabled'} /></td>
                <td><input type="number" step="0.01" name="umb_${bucket}"  value="${ex[`umb_${bucket}`]  ?? ''}" ${parentEditable ? '' : 'disabled'} /></td>
                <td><input type="number" step="0.01" name="charge_${bucket}" value="${ex[`charge_${bucket}`] ?? ''}" ${parentEditable ? '' : 'disabled'} /></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `);

  showModal(
    existing ? 'Edit Client Default Window' : 'Add/Upsert Client Default Window',
    [{ key:'form', label:'Form' }],
    () => formHtml,
    async () => {
      const pf = _parentFrame();
      // ✅ Allow create OR edit to apply
      if (!pf || (pf.mode !== 'edit' && pf.mode !== 'create')) return false;

      if (!resolvedClientId) {
        alert('Cannot determine client. Please close and reopen the client, then try again.');
        if (APILOG) console.error('[openClientRateModal] missing client_id — aborting apply');
        return false;
      }

      const raw = collectForm('#clientRateForm');
      if ( APILOG ) console.log('[openClientRateModal] Apply collected', raw);

      let role = (raw.role || '').trim();
      const newRole = (document.getElementById('cl_role_new')?.value || '').trim();
      if (role === '__OTHER__') {
        if (!newRole) { alert('Enter a new role code'); return false; }
        role = newRole.toUpperCase();
        if (typeof invalidateGlobalRoleOptionsCache === 'function') {
          try { invalidateGlobalRoleOptionsCache(); window.dispatchEvent(new CustomEvent('global-roles-updated')); } catch {}
        }
      }
      if (!role) { alert('Role is required'); return false; }

      const isoFrom = parseUkDateToIso(raw.date_from);
      if (!isoFrom) { alert('Invalid “Effective from” date'); return false; }
      let isoTo = null;
      if (raw.date_to) {
        isoTo = parseUkDateToIso(raw.date_to);
        if (!isoTo) { alert('Invalid “Effective to” date'); return false; }
        if (isoTo < isoFrom) { alert('“Effective to” cannot be before “Effective from”'); return false; }
      }

      const staged = {
        id: existing?.id || undefined,               // keep id if present
        client_id: resolvedClientId,
        role,
        band: (raw.band || '').trim() || null,
        date_from: isoFrom,
        date_to:   isoTo,

        charge_day  : raw['charge_day']  !== '' ? Number(raw['charge_day'])  : null,
        charge_night: raw['charge_night']!== '' ? Number(raw['charge_night']): null,
        charge_sat  : raw['charge_sat']  !== '' ? Number(raw['charge_sat'])  : null,
        charge_sun  : raw['charge_sun']  !== '' ? Number(raw['charge_sun'])  : null,
        charge_bh   : raw['charge_bh']   !== '' ? Number(raw['charge_bh'])   : null,

        paye_day    : raw['paye_day']    !== '' ? Number(raw['paye_day'])    : null,
        paye_night  : raw['paye_night']  !== '' ? Number(raw['paye_night'])  : null,
        paye_sat    : raw['paye_sat']    !== '' ? Number(raw['paye_sat'])    : null,
        paye_sun    : raw['paye_sun']    !== '' ? Number(raw['paye_sun'])    : null,
        paye_bh     : raw['paye_bh']     !== '' ? Number(raw['paye_bh'])     : null,

        umb_day     : raw['umb_day']     !== '' ? Number(raw['umb_day'])     : null,
        umb_night   : raw['umb_night']   !== '' ? Number(raw['umb_night'])   : null,
        umb_sat     : raw['umb_sat']     !== '' ? Number(raw['umb_sat'])     : null,
        umb_sun     : raw['umb_sun']     !== '' ? Number(raw['umb_sun'])     : null,
        umb_bh      : raw['umb_bh']      !== '' ? Number(raw['umb_bh'])      : null,

        // carry disabled fields from existing (possibly staged toggle)
        disabled_at_utc : existing?.disabled_at_utc ?? null,
        disabled_by_name: existing?.disabled_by_name ?? null,
        __toggle        : existing?.__toggle || undefined
      };

      // EARLY EXIT for pure status toggle (no other field changed)
      const compareKeys = ['role','band','date_from','date_to',
                           'charge_day','charge_night','charge_sat','charge_sun','charge_bh',
                           'paye_day','paye_night','paye_sat','paye_sun','paye_bh',
                           'umb_day','umb_night','umb_sat','umb_sun','umb_bh'];
      const nonToggleChanged = existing
        ? compareKeys.some(k => String(existing[k] ?? '') !== String(staged[k] ?? ''))
        : false;
      const isPureToggle = !!(existing && existing.id && staged.__toggle && !nonToggleChanged);

      if (isPureToggle) {
        // Just stage the toggle; no overlap/truncate checks; parent Save will PATCH
        ctx.ratesState = Array.isArray(ctx.ratesState) ? ctx.ratesState : [];
        const idx = ctx.ratesState.findIndex(r => r === existing);
        if (idx >= 0) ctx.ratesState[idx] = { ...existing, disabled_at_utc: staged.disabled_at_utc, disabled_by_name: staged.disabled_by_name, __toggle: staged.__toggle };
        else ctx.ratesState.push({ ...staged });
        try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
        try { renderClientRatesTable(); } catch {}
        if (APILOG) console.log('[openClientRateModal] pure toggle staged', { id: existing.id, toDisabled: !!staged.disabled_at_utc });
        return true;
      }

      // --- Normal path (role/band/dates/rates changed): run enabled-only overlap/rollover guards

      // 🔧 Read/merge against canonical ctx
      const list = Array.isArray(ctx.ratesState) ? ctx.ratesState : [];
      const sameCat = r => String(r.role||'')===staged.role && String(r.band||'')===String(staged.band||'');

      // Ignore DISABLED rows when looking for incumbent at start date
      const activeAtStart = list.filter(r =>
        !r.disabled_at_utc &&
        sameCat(r) &&
        r.date_from && r.date_from <= staged.date_from &&
        (!r.date_to || r.date_to >= staged.date_from)
      );
      if (APILOG) console.log('[openClientRateModal] activeAtStart (enabled only)', activeAtStart);
      if (activeAtStart.length > 1) {
        alert(`Multiple active windows for role=${staged.role} band=${staged.band||'(none)'} at ${formatIsoToUk(isoFrom)}.\nPlease tidy them first.`);
        return false;
      }
      if (activeAtStart.length === 1) {
        const inc = activeAtStart[0];
        if (String(inc.date_from) === String(staged.date_from)) {
          alert(`A window for this role/band already starts on ${formatIsoToUk(isoFrom)}.\nEdit that window or choose a different date.`);
          return false;
        }
        const d = new Date(isoFrom + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-1);
        const cut = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
        const ok = window.confirm(
          `An existing window ${formatIsoToUk(inc.date_from)} → ${formatIsoToUk(inc.date_to||'')} overlaps ${formatIsoToUk(isoFrom)}.\n`+
          `We will end it on ${formatIsoToUk(cut)}. Continue?`
        );
        if (!ok) return false;
        const idx = list.indexOf(inc);
        if (idx >= 0) ctx.ratesState[idx] = { ...inc, date_to: cut };
        if (APILOG) console.log('[openClientRateModal] truncated incumbent', { from: inc.date_from, to: cut });
      }

      // Final overlap guard against ENABLED rows only
      const after = (Array.isArray(ctx.ratesState) ? ctx.ratesState.slice() : [])
        .filter(r => sameCat(r) && !r.disabled_at_utc);
      for (const r of after) {
        if (existing && r === existing) continue;
        const a0 = r.date_from || null, a1 = r.date_to || null;
        const b0 = staged.date_from || null, b1 = staged.date_to || null;
        if (rangesOverlap(a0, a1, b0, b1)) {
          if (APILOG) console.warn('[openClientRateModal] final overlap guard failed', { r, staged });
          alert(`Window still overlaps existing ${formatIsoToUk(a0)}–${formatIsoToUk(a1||'')} for role=${staged.role} / ${staged.band||'(none)'}`);
          return false;
        }
      }

      // Stage into ctx
      ctx.ratesState = Array.isArray(ctx.ratesState) ? ctx.ratesState : [];
      if (existing) {
        const idx = ctx.ratesState.findIndex(r => r === existing);
        if (idx >= 0) ctx.ratesState[idx] = staged; else ctx.ratesState.push(staged);
      } else {
        ctx.ratesState.push(staged);
      }
      if (APILOG) console.log('[openClientRateModal] ratesState size', ctx.ratesState.length);

      try {
        const parent = _currentFrame();
        if (parent && typeof parent.setTab === 'function') {
          parent.currentTabKey = 'rates';
          parent.setTab('rates');
        }
      } catch(_) {}
      try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}

      // Update table immediately
      try { renderClientRatesTable(); } catch {}

      return true;
    },
    false,
    () => {
      const parent = _currentFrame();
      if (parent) { parent.currentTabKey = 'rates'; parent.setTab('rates'); }
    }
  );

  // Prefill & minor wiring
  const selRole = document.getElementById('cl_role');
  const newRow  = document.getElementById('cl_role_new_row');
  const inFrom  = document.getElementById('cl_date_from');
  const inTo    = document.getElementById('cl_date_to');

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

  // Enable/Disable handler — stage ONLY; require Apply + parent Save to persist
  const toggleBtn = byId('btnToggleDisable');
  if (toggleBtn && existing?.id && parentEditable) {
    toggleBtn.onclick = () => {
      const nowIso = new Date().toISOString().slice(0,10);
      const willDisable = !existing.disabled_at_utc;
      // Stage in-memory change
      existing.__toggle = willDisable ? 'disable' : 'enable';
      if (willDisable) {
        existing.disabled_at_utc = nowIso; // placeholder for UI; backend will set precise timestamp on save
        // derive short name from any known user/email globals (best effort)
        let short = '';
        try {
          const u = (window.__ME__ || window.me || window.currentUser || window.AUTH_USER || {});
          const em = (u.email || u.user?.email || '');
          short = em && typeof em === 'string' ? (em.split('@')[0] || '') : (u.name || '');
        } catch(_) {}
        existing.disabled_by_name = short || existing.disabled_by_name || '';
      } else {
        existing.disabled_at_utc = null;
        existing.disabled_by_name = null;
      }

      // Reflect “pending” status in UI
      const pill = byId('cl_status_pill');
      const meta = byId('cl_status_meta');
      if (pill && meta) {
        if (willDisable) {
          pill.className = 'pill tag-fail';
          pill.textContent = '❌ Disabled (pending save)';
          meta.textContent = existing.disabled_by_name
            ? `by ${existing.disabled_by_name} on ${formatIsoToUk(nowIso)} — will apply on Save`
            : `Will disable on ${formatIsoToUk(nowIso)} (save to confirm)`;
          toggleBtn.text = 'Enable'; toggleBtn.textContent = 'Enable'; toggleBtn.className = 'btn-primary';
        } else {
          pill.className = 'pill tag-ok';
          pill.textContent = '✓ Active (pending save)';
          meta.textContent = 'Will enable on Save';
          toggleBtn.text = 'Disable'; toggleBtn.textContent = 'Disable'; toggleBtn.className = 'btn-danger';
        }
      }

      try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
      try { renderClientRatesTable(); } catch {}
    };
  }
}

function showModal(title, tabs, renderTab, onSave, hasId, onReturn, options) {
  // ===== Logging helpers (toggle with window.__LOG_MODAL = true/false) =====
  const LOG = (typeof window.__LOG_MODAL === 'boolean') ? window.__LOG_MODAL : false;
  const L  = (...a)=> { if (LOG) console.log('[MODAL]', ...a); };
  const GC = (label)=> { if (LOG) console.groupCollapsed('[MODAL]', label); };
  const GE = ()=> { if (LOG) console.groupEnd(); };

  // ——— Helpers (scoped) ————————————————————————————————————————————————
  const stack = () => (window.__modalStack ||= []);
  const currentFrame = () => stack()[stack().length - 1] || null;
  const parentFrame  = () => (stack().length > 1 ? stack()[stack().length - 2] : null);
  const deep = (o) => JSON.parse(JSON.stringify(o));

  // Backward-compat for optional params:
  // If onReturn is actually an options object, shift params.
  let opts = options || {};
  if (onReturn && typeof onReturn === 'object' && options === undefined) {
    opts = onReturn; onReturn = undefined;
  }

  // Drop keys whose values are '', null or undefined (keep 0/false)
  const stripEmpty = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (v === '' || v == null) continue;
      out[k] = v;
    }
    return out;
  };

  function setFormReadOnly(root, ro) {
    if (!root) return;
    root.querySelectorAll('input, select, textarea, button').forEach((el) => {
      const isDisplayOnly = el.id === 'tms_ref_display' || el.id === 'cli_ref_display';
      if (el.type === 'button') {
        const controlIds = new Set(['btnCloseModal','btnDelete','btnEditModal','btnSave','btnRelated']);
        if (!controlIds.has(el.id)) el.disabled = !!ro;
        return;
      }
      if (isDisplayOnly) {
        el.setAttribute('disabled','true');
        el.setAttribute('readonly','true');
        return;
      }
      if (ro) { el.setAttribute('disabled','true'); el.setAttribute('readonly','true'); }
      else    { el.removeAttribute('disabled');   el.removeAttribute('readonly'); }
    });
  }

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

  // ——— Frame object ————————————————————————————————————————————————
  const frame = {
    title,
    tabs: Array.isArray(tabs) ? tabs.slice() : [],
    renderTab,
    onSave,
    onReturn,
    hasId: !!hasId,
    entity: (window.modalCtx && window.modalCtx.entity) || null,

    // utility modal flags
    noParentGate: !!opts.noParentGate,
    forceEdit:    !!opts.forceEdit,
    kind:         opts.kind || null,

    currentTabKey: (Array.isArray(tabs) && tabs.length ? tabs[0].key : null),

    // State
    mode: (opts.forceEdit ? 'edit' : (hasId ? 'view' : 'create')),
    isDirty: false,
    _snapshot: null,

    _detachDirty: null,
    _detachGlobal: null,
    _hasMountedOnce: false,
    _wired: false,
    _closing: false,
    _saving: false,
    _confirmingDiscard: false, // re-entrancy guard for discard confirm

    persistCurrentTabState() {
      if (!window.modalCtx || (this.mode === 'view')) {
        L('persist(skip)', { reason: 'mode=view or no modalCtx', mode: this.mode });
        return;
      }
      // ✅ Seed a stable sentinel for create mode so tab switches keep the same record
      const sentinel = window.modalCtx?.openToken || null;
      const initialId = (window.modalCtx.data?.id ?? sentinel);

      const fs = window.modalCtx.formState || { __forId: initialId, main:{}, pay:{} };
      if (fs.__forId == null) fs.__forId = initialId;

      if (this.currentTabKey === 'main' && byId('tab-main')) {
        const collected = collectForm('#tab-main');
        const cleaned   = stripEmpty(collected);
        fs.main = { ...(fs.main||{}), ...cleaned };
      }
      if (this.currentTabKey === 'pay' && byId('tab-pay')) {
        const collected = collectForm('#tab-pay');
        const cleaned   = stripEmpty(collected);
        fs.pay = { ...(fs.pay||{}), ...cleaned };
      }
      window.modalCtx.formState = fs;
    },

    mergedRowForTab(k) {
      const base = { ...(window.modalCtx?.data || {}) };
      const fs   = window.modalCtx?.formState || {};
      const rid  = window.modalCtx?.data?.id ?? null;
      const fid  = fs.__forId ?? null;
      const sentinel = window.modalCtx?.openToken ?? null;

      // ✅ Treat create as “same record” by matching the sentinel; or null===null
      const sameRecord =
        (fid === rid) ||
        (rid == null && (fid === sentinel || fid == null));

      const stagedRaw = sameRecord
        ? ((k === 'main') ? (fs.main || {}) : (k === 'pay') ? (fs.pay || {}) : {})
        : {};

      const staged = stripEmpty(stagedRaw);
      return { ...base, ...staged };
    },

    _attachDirtyTracker() {
      if (this._detachDirty) { try { this._detachDirty(); } catch(_){}; this._detachDirty = null; }
      const root = byId('modalBody'); if (!root) return;
      const onDirty = (ev)=>{
        if (ev && !ev.isTrusted) return;
        if (this.mode !== 'edit' && this.mode !== 'create') return;
        this.isDirty = true;
        if (typeof this._updateButtons === 'function') this._updateButtons();
        if (stack().length <= 1) {
          try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
        }
      };
      root.addEventListener('input', onDirty, true);
      root.addEventListener('change', onDirty, true);
      this._detachDirty = ()=> {
        root.removeEventListener('input', onDirty, true);
        root.removeEventListener('change', onDirty, true);
      };
    },

    setTab(k) {
      GC(`setTab(${k})`);
      const doPersist = this._hasMountedOnce;
      if (doPersist) this.persistCurrentTabState();

      const rowForTab = this.mergedRowForTab(k);
      byId('modalBody').innerHTML = this.renderTab(k, rowForTab) || '';

      // Mount per-entity extras
      if (this.entity === 'candidates' && k === 'rates') { mountCandidateRatesTab?.(); }
      if (this.entity === 'candidates' && k === 'pay')   { mountCandidatePayTab?.(); }
      if (this.entity === 'candidates' && k === 'main')  {
        // ✅ Preserve staged pay method when remounting Main
        const pmSel = document.querySelector('#pay-method');
        if (pmSel) {
          // Prefer staged formState or existing payMethodState
          const stagedPm = window.modalCtx?.formState?.main?.pay_method;
          const preferred = (window.modalCtx?.payMethodState || stagedPm || pmSel.value);
          pmSel.value = preferred;

          pmSel.addEventListener('change', () => {
            window.modalCtx.payMethodState = pmSel.value;
            try { window.dispatchEvent(new CustomEvent('pay-method-changed')); }
            catch { window.dispatchEvent(new Event('pay-method-changed')); }
          });
          window.modalCtx.payMethodState = pmSel.value;
        }
        const el = document.querySelector('#rolesEditor');
        if (el) {
          (async () => {
            try {
              const opts = await loadGlobalRoleOptions();
              renderRolesEditor(el, window.modalCtx.rolesState || [], opts);
            } catch (e) {
              console.error('[MODAL] roles mount failed', e);
            }
          })();
        }
      }
      if (this.entity === 'clients' && k === 'rates')     { mountClientRatesTab?.(); }
      if (this.entity === 'clients' && k === 'hospitals') { mountClientHospitalsTab?.(); }
      if (this.entity === 'clients' && k === 'settings')  { renderClientSettingsUI?.(window.modalCtx.clientSettingsState || {}); }

      this.currentTabKey = k;
      this._attachDirtyTracker();

      // Read-only gating (bypass when utility)
      const isChild = stack().length > 1;
      if (this.noParentGate) {
        setFormReadOnly(byId('modalBody'), (this.mode === 'view' || this.mode === 'saving'));
      } else if (isChild) {
        const p = parentFrame();
        setFormReadOnly(byId('modalBody'), !(p && (p.mode === 'edit' || p.mode === 'create')));
      } else {
        setFormReadOnly(byId('modalBody'), (this.mode === 'view' || this.mode === 'saving'));
      }

      this._hasMountedOnce = true;
      GE();
    }
  };

  function setFrameMode(frameObj, mode) {
    const prevMode = frameObj.mode;
    frameObj.mode = mode; // 'create' | 'view' | 'edit' | 'saving'
    const isChild = stack().length > 1;

    if (frameObj.noParentGate) {
      setFormReadOnly(document.getElementById('modalBody'), (mode === 'view' || mode === 'saving'));
    } else if (isChild) {
      const p = parentFrame();
      setFormReadOnly(document.getElementById('modalBody'), !(p && (p.mode === 'edit' || p.mode === 'create')));
    } else {
      setFormReadOnly(document.getElementById('modalBody'), (mode === 'view' || mode === 'saving'));
    }

    if (typeof frameObj._updateButtons === 'function') frameObj._updateButtons();

    const willRepaint = !!(frameObj._hasMountedOnce && frameObj.currentTabKey);
    L('setFrameMode', { prevMode, nextMode: mode, _hasMountedOnce: frameObj._hasMountedOnce, willRepaint });
    if (willRepaint) frameObj.setTab(frameObj.currentTabKey);
  }

  // ——— Push frame & show overlay ———————————————————————————————————————
  stack().push(frame);
  byId('modalBack').style.display = 'flex';

  function renderTop() {
    GC('renderTop()');
    const isChild = stack().length > 1;
    const top = currentFrame();
    const parent = parentFrame();

    if (typeof top._detachGlobal === 'function') {
      try { top._detachGlobal(); } catch(_) {}
      top._wired = false;
    }

    byId('modalTitle').textContent = top.title;

    const tabsEl = byId('modalTabs');
    tabsEl.innerHTML = '';
    (top.tabs || []).forEach((t, i) => {
      const b = document.createElement('button');
      b.textContent = t.label || t.title || t.key;
      if (i === 0 && !top.currentTabKey) top.currentTabKey = t.key;
      if (t.key === top.currentTabKey || (i === 0 && !top.currentTabKey)) b.classList.add('active');
      b.onclick = () => {
        if (top.mode === 'saving') return;
        tabsEl.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        top.setTab(t.key);
      };
      tabsEl.appendChild(b);
    });

    if (top.currentTabKey) { top.setTab(top.currentTabKey); }
    else if (top.tabs && top.tabs[0]) { top.setTab(top.tabs[0].key); }
    else { byId('modalBody').innerHTML = top.renderTab('form', {}) || ''; }

    const btnSave   = byId('btnSave');
    const btnClose  = byId('btnCloseModal');
    const btnDelete = byId('btnDelete');
    const header    = byId('modalDrag');
    const modalNode = byId('modal');

    btnDelete.style.display = (top.noParentGate ? 'none' : (top.hasId ? '' : 'none'));
    btnDelete.onclick = openDelete;

    let btnEdit = byId('btnEditModal');
    if (!btnEdit) {
      btnEdit = document.createElement('button');
      btnEdit.id = 'btnEditModal';
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn-outline btn-sm';
      btnEdit.textContent = 'Edit';
      const actionsBar = btnSave?.parentElement || btnClose?.parentElement;
      if (actionsBar) actionsBar.insertBefore(btnEdit, btnSave);
    }

    (function ensureDragUI() {
      if (!header || !modalNode) return;
      const onDown = (e) => {
        if ((e.button !== 0 && e.type === 'mousedown') || e.target.closest('button')) return;
        const rect = modalNode.getBoundingClientRect();
        modalNode.style.position = 'fixed';
        modalNode.style.left = rect.left + 'px';
        modalNode.style.top = rect.top + 'px';
        modalNode.style.right = 'auto';
        modalNode.style.bottom = 'auto';
        modalNode.style.transform = 'none';
        modalNode.classList.add('dragging');
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        document.onmousemove = (ev) => {
          let l = ev.clientX - offsetX;
          let t = ev.clientY - offsetY;
          const maxL = Math.max(0, window.innerWidth  - rect.width);
          const maxT = Math.max(0, window.innerHeight - rect.height);
          if (l < 0) l = 0; if (t < 0) t = 0;
          if (l > maxL) l = maxL; if (t > maxT) t = maxT;
          modalNode.style.left = l + 'px';
          modalNode.style.top  = t + 'px';
        };
        document.onmouseup = () => {
          modalNode.classList.remove('dragging');
          document.onmousemove = null;
          document.onmouseup = null;
        };
        e.preventDefault();
      };
      const onDbl = (e) => { if (!e.target.closest('button')) sanitizeModalGeometry(); };
      header.addEventListener('mousedown', onDown);
      header.addEventListener('dblclick', onDbl);
      const prevDetach = top._detachGlobal;
      top._detachGlobal = () => {
        try { header.removeEventListener('mousedown', onDown); } catch {}
        try { header.removeEventListener('dblclick', onDbl); } catch {}
        document.onmousemove = null;
        document.onmouseup = null;
        if (typeof prevDetach === 'function') { try { prevDetach(); } catch {} }
      };
    })();

    const defaultPrimary =
      (top.kind === 'advanced-search') ? 'Search'
      : (top.noParentGate ? 'Apply' : (isChild ? 'Apply' : 'Save'));
    btnSave.textContent = defaultPrimary;
    btnSave.setAttribute('aria-label', defaultPrimary);

    const updateSecondaryLabel = () => {
      const label =
        (top.kind === 'advanced-search') ? 'Close'
        : ((isChild || top.mode === 'edit' || top.mode === 'create')
            ? (top.isDirty ? 'Discard' : 'Cancel')
            : 'Close');
      btnClose.textContent = label;
      btnClose.setAttribute('aria-label', label);
      btnClose.setAttribute('title', label);
    };

    top._updateButtons = () => {
      const parentEditable = top.noParentGate ? true : (parent ? (parent.mode === 'edit' || parent.mode === 'create') : true);
      const relatedBtn = document.getElementById('btnRelated');

      if (top.kind === 'advanced-search') {
        btnEdit.style.display = 'none';
        btnSave.style.display = '';
        btnSave.disabled = !!top._saving;
        if (relatedBtn) relatedBtn.disabled = true;
      } else if (isChild && !top.noParentGate) {
        btnSave.style.display = parentEditable ? '' : 'none';
        btnSave.disabled = (!parentEditable) || top._saving;
        btnEdit.style.display = 'none';
        if (relatedBtn) relatedBtn.disabled = true;
      } else {
        btnEdit.style.display = (top.mode === 'view' && top.hasId) ? '' : 'none';
        if (relatedBtn) relatedBtn.disabled = !(top.mode === 'view' && top.hasId);
        if (top.mode === 'view') {
          btnSave.style.display = top.noParentGate ? '' : 'none';
          btnSave.disabled = top._saving;
        } else {
          btnSave.style.display = '';
          btnSave.disabled = top._saving;
        }
      }
      updateSecondaryLabel();
    };

    top._updateButtons();

    btnEdit.onclick = () => {
      if (isChild || top.noParentGate || top.kind === 'advanced-search') return;
      if (top.mode === 'view') {
        top._snapshot = {
          data:                 deep(window.modalCtx?.data || null),
          formState:            deep(window.modalCtx?.formState || null),
          rolesState:           deep(window.modalCtx?.rolesState || null),
          ratesState:           deep(window.modalCtx?.ratesState || null),
          hospitalsState:       deep(window.modalCtx?.hospitalsState || null),
          clientSettingsState:  deep(window.modalCtx?.clientSettingsState || null)
        };
        top.isDirty = false;
        setFrameMode(top, 'edit');
      }
    };

    const handleSecondary = () => {
      if (top._confirmingDiscard || top._closing) return;

      if (top.kind === 'advanced-search') {
        top._closing = true;
        document.onmousemove = null; document.onmouseup = null;
        const m = byId('modal'); if (m) m.classList.remove('dragging');
        sanitizeModalGeometry();
        const closing = stack().pop();
        if (closing && closing._detachDirty)  { try { closing._detachDirty(); } catch(_){}; closing._detachDirty = null; }
        if (closing && closing._detachGlobal) { try { closing._detachGlobal(); } catch(_){}; closing._detachGlobal = null; }
        top._wired = false;
        if (stack().length > 0) {
          const parent = currentFrame();
          renderTop();
          try { parent.onReturn && parent.onReturn(); } catch(_) {}
        } else {
          discardAllModalsAndState();
          if (window.__pendingFocus) { try { renderAll(); } catch (e) { console.error('refresh after modal close failed', e); } }
        }
        return;
      }

      const isChild = stack().length > 1;
      if (!isChild && !top.noParentGate && top.mode === 'edit') {
        if (!top.isDirty) {
          top.isDirty = false; setFrameMode(top, 'view'); top._snapshot = null;
          try { window.__toast?.('No changes'); } catch {}
          return;
        } else {
          let ok = false;
          try { top._confirmingDiscard = true; btnClose.disabled = true; ok = window.confirm('Discard changes and return to view?'); }
          finally { top._confirmingDiscard = false; btnClose.disabled = false; }
          if (!ok) return;
          if (top._snapshot && window.modalCtx) {
            window.modalCtx.data                = deep(top._snapshot.data);
            window.modalCtx.formState           = deep(top._snapshot.formState);
            window.modalCtx.rolesState          = deep(top._snapshot.rolesState);
            window.modalCtx.ratesState          = deep(top._snapshot.ratesState);
            window.modalCtx.hospitalsState      = deep(top._snapshot.hospitalsState);
            window.modalCtx.clientSettingsState = deep(top._snapshot.clientSettingsState);
          }
          top.isDirty = false; top._snapshot = null; setFrameMode(top, 'view'); return;
        }
      }

      if (top._closing) return;
      top._closing = true;

      document.onmousemove = null;
      document.onmouseup   = null;
      const m = byId('modal'); if (m) m.classList.remove('dragging');

      if (!isChild && !top.noParentGate && (top.mode === 'create') && top.isDirty) {
        let ok = false;
        try { top._confirmingDiscard = true; btnClose.disabled = true; ok = window.confirm('You have unsaved changes. Discard them and close?'); }
        finally { top._confirmingDiscard = false; btnClose.disabled = false; }
        if (!ok) { top._closing = false; return; }
      }

      sanitizeModalGeometry();

      const closing = stack().pop();
      if (closing && closing._detachDirty)  { try { closing._detachDirty(); } catch(_){}; closing._detachDirty = null; }
      if (closing && closing._detachGlobal) { try { closing._detachGlobal(); } catch(_){}; closing._detachGlobal = null; }
      top._wired = false;

      if (stack().length > 0) {
        const parent = currentFrame();
        renderTop();
        try { parent.onReturn && parent.onReturn(); } catch(_) {}
      } else {
        discardAllModalsAndState();
        if (window.__pendingFocus) {
          try { renderAll(); } catch (e) { console.error('refresh after modal close failed', e); }
        }
      }
    };
    byId('btnCloseModal').onclick = handleSecondary;

    const onSaveClick = async () => {
      if (top._saving) return;

      if (top.kind !== 'advanced-search' && !top.noParentGate && top.mode !== 'view' && !top.isDirty) {
        const isChild = stack().length > 1;
        if (isChild) {
          sanitizeModalGeometry();
          stack().pop();
          if (stack().length > 0) {
            const parent = currentFrame();
            renderTop();
            try { parent.onReturn && parent.onReturn(); } catch(_) {}
          } else {
            discardAllModalsAndState();
          }
        } else {
          top.isDirty = false; top._snapshot = null; setFrameMode(top, 'view'); top._updateButtons && top._updateButtons();
        }
        try { window.__toast?.('No changes'); } catch {}
        return;
      }

      top.persistCurrentTabState();

      const isChild = stack().length > 1;
      if (isChild && !top.noParentGate && top.kind !== 'advanced-search') {
        const parent = parentFrame();
        if (!parent || !(parent.mode === 'edit' || parent.mode === 'create')) return;
      }

      top._saving = true; top._updateButtons();

      let ok = false; let savedRow = null;
      if (typeof top.onSave === 'function') {
        try {
          const res = await top.onSave();
          ok = (res === true) || (res && res.ok === true);
          if (res && res.saved) savedRow = res.saved;
        } catch (_) { ok = false; }
      }

      top._saving = false;

      if (!ok) { top._updateButtons(); return; }

      const isChild2 = stack().length > 1;
      if (isChild2) {
        try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
        sanitizeModalGeometry();
        stack().pop();
        if (stack().length > 0) {
          const parent = currentFrame();
          parent.isDirty = true;
          parent._updateButtons && parent._updateButtons();
          renderTop();
          try { parent.onReturn && parent.onReturn(); } catch(_) {}
        } else {
          discardAllModalsAndState();
        }
      } else {
        if (savedRow && window.modalCtx) {
          window.modalCtx.data = { ...(window.modalCtx.data || {}), ...savedRow };
          top.hasId = !!window.modalCtx.data?.id;
        }
        top.isDirty = false; top._snapshot = null; setFrameMode(top, 'view');
      }
    };
    byId('btnSave').onclick = onSaveClick;

    const onDirtyEvt = () => {
      if (stack().length <= 1 && (top.mode === 'edit' || top.mode === 'create')) {
        top.isDirty = true; top._updateButtons();
      }
    };

    if (!top._wired) {
      window.addEventListener('modal-dirty', onDirtyEvt);

      const onEsc = (e) => {
        if (e.key === 'Escape') {
          if (top._confirmingDiscard || top._closing) return;
          e.preventDefault(); byId('btnCloseModal').click();
        }
      };
      window.addEventListener('keydown', onEsc);

      const onOverlayClick = (e) => {
        if (top._confirmingDiscard || top._closing) return;
        if (e.target === byId('modalBack')) byId('btnCloseModal').click();
      };
      byId('modalBack').addEventListener('click', onOverlayClick, true);

      top._detachGlobal = () => {
        try { window.removeEventListener('modal-dirty', onDirtyEvt); } catch {}
        try { window.removeEventListener('keydown', onEsc); } catch {}
        try { byId('modalBack').removeEventListener('click', onOverlayClick, true); } catch {}
      };

      top._wired = true;
    }

    if (isChild && !top.noParentGate) {
      const parentEditable = parent && (parent.mode === 'edit' || parent.mode === 'create');
      setFormReadOnly(byId('modalBody'), !parentEditable);
    } else {
      setFrameMode(top, top.mode);
    }
    GE();
  }

  byId('modalBack').style.display = 'flex';
  window.__getModalFrame = currentFrame;
  renderTop();
}







// =================== ADD HOSPITAL MODAL (UPDATED: push into stagedNew) ===================
// ==== CHILD MODAL (ADD HOSPITAL) — throw on errors; return true on success ====

function openClientHospitalModal(client_id) {
  const parentFrame = _currentFrame();
  // ✅ Allow create OR edit to add hospitals pre-save
  const parentEditable = parentFrame && (parentFrame.mode === 'edit' || parentFrame.mode === 'create');
  const ctx = window.modalCtx; // 🔧 use canonical context

  const formHtml = html(`
    <div class="form" id="hospitalForm">
      ${input('hospital_name_norm','Hospital / Trust (normalised)','', 'text', parentEditable ? {} : { disabled:true })}
      ${input('ward_hint','Ward hint (optional)','', 'text', parentEditable ? {} : { disabled:true })}
    </div>
  `);

  showModal(
    'Add Hospital / Ward',
    [{key:'form',label:'Form'}],
    () => formHtml,
    async ()=> {
      const pf = _parentFrame();
      // ✅ Allow create OR edit to apply
      if (!pf || (pf.mode !== 'edit' && pf.mode !== 'create')) return false;

      const raw  = collectForm('#hospitalForm');
      const name = String(raw.hospital_name_norm || '').trim();
      if (!name) { alert('Hospital / Trust is required'); return false; }

      const H = ctx.hospitalsState || (ctx.hospitalsState = { existing: [], stagedNew: [], stagedEdits:{}, stagedDeletes: new Set() });
      H.stagedNew.push({ hospital_name_norm: name, ward_hint: (raw.ward_hint || '').trim() || null });

      try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
      return true; // Apply closes child
    },
    false,
    () => {
      const parent = _currentFrame();
      if (parent) { parent.currentTabKey = 'hospitals'; parent.setTab('hospitals'); }
    }
  );
}




// =================== HOSPITALS TABLE (UPDATED: staged delete & edit) ===================

function renderClientHospitalsTable() {
  const el = byId('clientHospitals'); if (!el) return;

  const frame = _currentFrame();
  // ✅ Allow create OR edit to add/edit hospitals
  const parentEditable = frame && (frame.mode === 'edit' || frame.mode === 'create');

  const ctx = window.modalCtx; // 🔧 use canonical context
  const H = ctx.hospitalsState || (ctx.hospitalsState = { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });
  H.stagedDeletes = H.stagedDeletes || new Set();
  H.stagedNew     = Array.isArray(H.stagedNew) ? H.stagedNew : [];
  H.existing      = Array.isArray(H.existing) ? H.existing : [];
  H.stagedEdits   = H.stagedEdits || {};

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
    if (H.stagedDeletes.has(String(x.id))) return;

    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.value = x.hospital_name_norm || '';
    nameInp.disabled = !parentEditable;
    nameInp.oninput = () => {
      H.stagedEdits[String(x.id)] = { ...(H.stagedEdits[String(x.id)] || {}), hospital_name_norm: nameInp.value };
      try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
    };
    nameTd.appendChild(nameInp);

    const hintTd = document.createElement('td');
    const hintInp = document.createElement('input');
    hintInp.type = 'text'; hintInp.value = x.ward_hint || '';
    hintInp.disabled = !parentEditable;
    hintInp.oninput = () => {
      H.stagedEdits[String(x.id)] = { ...(H.stagedEdits[String(x.id)] || {}), ward_hint: hintInp.value || null };
      try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
    };
    hintTd.appendChild(hintInp);

    const actTd = document.createElement('td');
    const rmBtn = document.createElement('button');
    rmBtn.textContent = 'Remove';
    rmBtn.disabled = !parentEditable;
    rmBtn.setAttribute('data-action', 'delete');
    rmBtn.setAttribute('data-hid', String(x.id));
    rmBtn.className = 'btnDelHospital';
    actTd.appendChild(rmBtn);

    tr.appendChild(nameTd); tr.appendChild(hintTd); tr.appendChild(actTd);
    tb.appendChild(tr);
  });

  // New (unsaved) rows
  (H.stagedNew || []).forEach((x, idx) => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.value = x.hospital_name_norm || '';
    nameInp.disabled = !parentEditable;
    nameInp.oninput = () => { x.hospital_name_norm = nameInp.value; try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {} };
    nameTd.appendChild(nameInp);

    const hintTd = document.createElement('td');
    const hintInp = document.createElement('input');
    hintInp.type = 'text'; hintInp.value = x.ward_hint || '';
    hintInp.disabled = !parentEditable;
    hintInp.oninput = () => { x.ward_hint = hintInp.value || null; try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {} };
    hintTd.appendChild(hintInp);

    const actTd = document.createElement('td');
    const rm = document.createElement('button'); rm.textContent = 'Remove (staged)';
    rm.disabled = !parentEditable;
    rm.onclick = () => { if (!parentEditable) return; H.stagedNew.splice(idx, 1); renderClientHospitalsTable(); try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {} };
    actTd.appendChild(rm);

    tr.appendChild(nameTd); tr.appendChild(hintTd); tr.appendChild(actTd);
    tb.appendChild(tr);
  });

  tbl.appendChild(tb);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `<button id="btnAddClientHospital"${parentEditable ? '' : ' disabled'}>Add Hospital / Ward</button>
    ${parentEditable ? '' : '<span class="hint">Read-only. Click “Edit” in the main dialog to add/modify hospitals.</span>'}`;

  el.appendChild(tbl);
  el.appendChild(actions);

  const addBtn = byId('btnAddClientHospital');
  if (addBtn && parentEditable) addBtn.onclick = () => openClientHospitalModal(ctx.data?.id);
}



async function renderClientSettingsUI(settingsObj){
  const div = byId('clientSettings'); if (!div) return;

  const ctx = window.modalCtx; // use canonical context

  // Prefer staged copy
  const initial = (ctx.clientSettingsState && typeof ctx.clientSettingsState === 'object')
    ? ctx.clientSettingsState
    : (settingsObj && typeof settingsObj === 'object' ? settingsObj : {});

  // Strip seconds for the UI (server may return HH:MM:SS)
  const s = {
    timezone_id : initial.timezone_id ?? 'Europe/London',
    day_start   : _toHHMM(initial.day_start)   || '06:00',
    day_end     : _toHHMM(initial.day_end)     || '20:00',
    night_start : _toHHMM(initial.night_start) || '20:00',
    night_end   : _toHHMM(initial.night_end)   || '06:00'
  };

  // One source of truth in staged state (kept as HH:MM in the UI)
  ctx.clientSettingsState = { ...initial, ...s };

  // Render the form
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

  const root = document.getElementById('clientSettingsForm');
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

  // Keep last valid values for non-destructive revert
  let lastValid = { ...s };
  // Prevent duplicate bindings across re-renders
  if (root.__wired) {
    root.removeEventListener('input', root.__syncSoft, true);
    root.removeEventListener('change', root.__syncValidate, true);
    ['day_start','day_end','night_start','night_end'].forEach(k=>{
      const el = root.querySelector(`input[name="${k}"]`);
      if (el && el.__syncValidate) el.removeEventListener('blur', el.__syncValidate, true);
    });
  }

  // During typing: update staged state but DO NOT alert; ignore obviously bad partials
  const syncSoft = ()=>{
    const frame = _currentFrame();
    if (!frame || frame.mode !== 'edit') return;

    const vals = collectForm('#clientSettingsForm', false);
    const next = { ...ctx.clientSettingsState, ...vals };
    ['day_start','day_end','night_start','night_end'].forEach(k=>{
      const v = String(vals[k] ?? '').trim();
      if (v && !hhmm.test(v)) next[k] = lastValid[k]; // hold previous good value until validated
    });
    ctx.clientSettingsState = next;
  };

  // On change/blur: validate once, revert field if invalid, then commit
  let lastAlertAt = 0;
  const syncValidate = (ev)=>{
    const frame = _currentFrame();
    if (!frame || frame.mode !== 'edit') return;

    const vals = collectForm('#clientSettingsForm', false);
    let hadError = false;

    ['day_start','day_end','night_start','night_end'].forEach(k=>{
      const v = String(vals[k] ?? '').trim();
      if (v && !hhmm.test(v)) {
        hadError = true;
        const el = root.querySelector(`input[name="${k}"]`);
        if (el) el.value = lastValid[k] || '';
      }
    });

    if (hadError) {
      const now = Date.now();
      if (now - lastAlertAt > 400) {
        alert('Times must be HH:MM (24-hour)');
        lastAlertAt = now;
      }
      return;
    }

    ctx.clientSettingsState = { ...ctx.clientSettingsState, ...vals };
    lastValid = {
      day_start:   ctx.clientSettingsState.day_start,
      day_end:     ctx.clientSettingsState.day_end,
      night_start: ctx.clientSettingsState.night_start,
      night_end:   ctx.clientSettingsState.night_end,
      timezone_id: ctx.clientSettingsState.timezone_id
    };
  };

  // Bind listeners
  root.__syncSoft = syncSoft;
  root.__syncValidate = syncValidate;
  root.addEventListener('input',  syncSoft, true);
  root.addEventListener('change', syncValidate, true);
  ['day_start','day_end','night_start','night_end'].forEach(k=>{
    const el = root.querySelector(`input[name="${k}"]`);
    if (el) {
      el.__syncValidate = syncValidate;
      el.addEventListener('blur', syncValidate, true);
      el.setAttribute('step', '60'); // minute precision
    }
  });
  root.__wired = true;
}


// ---- Umbrella modal
// ========================= openUmbrella (FIXED) =========================
// ---- Umbrella modal
// ========================= openUmbrella (FIXED) =========================
// ================== FRONTEND: openUmbrella (UPDATED) ==================
// ================== FIXED: openUmbrella (hydrate before showModal) ==================
// ================== FIXED: openUmbrella (hydrate before showModal) ==================
async function openUmbrella(row){
  // ===== Logging helpers (toggle with window.__LOG_MODAL = true/false) =====
  const LOG = (typeof window.__LOG_MODAL === 'boolean') ? window.__LOG_MODAL : true;
  const L  = (...a)=> { if (LOG) console.log('[OPEN_UMBRELLA]', ...a); };
  const W  = (...a)=> { if (LOG) console.warn('[OPEN_UMBRELLA]', ...a); };
  const E  = (...a)=> { if (LOG) console.error('[OPEN_UMBRELLA]', ...a); };

  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));
  const incoming = deep(row || {});
  const seedId   = incoming?.id || null;

  L('ENTRY', { incomingKeys: Object.keys(incoming||{}), seedId });

  const unwrapSingle = (data, key) => {
    if (Array.isArray(data)) return data[0] || null;
    if (data && key && data[key]) return unwrapSingle(data[key], null);
    if (data && Array.isArray(data.rows))  return data.rows[0]  || null;
    if (data && Array.isArray(data.items)) return data.items[0] || null;
    if (data && Array.isArray(data.data))  return data.data[0]  || null;
    return (data && typeof data === 'object') ? data : null;
  };

  // 1) Hydrate full umbrella if we have an id
  let full = incoming;
  if (seedId) {
    try {
      const url = API(`/api/umbrellas/${encodeURIComponent(seedId)}`);
      L('[HTTP] GET', url);
      const res = await authFetch(url);
      L('[HTTP] status', res?.status, res?.ok);

      try {
        const raw = await res.clone().text();
        if (LOG) console.debug('[HTTP] raw body (≤2KB):', raw.slice(0, 2048));
      } catch (peekErr) { W('[HTTP] raw peek failed', peekErr?.message || peekErr); }

      if (res.ok) {
        const data = await res.json().catch(()=> ({}));
        const unwrapped = unwrapSingle(data, 'umbrella');
        L('hydrated JSON keys', Object.keys(data||{}), 'unwrapped keys', Object.keys(unwrapped||{}));
        full = unwrapped || incoming;
      } else {
        W('non-OK response, using incoming row');
      }
    } catch (e) {
      W('openUmbrella hydrate failed; using summary row', e);
    }
  } else {
    L('no seedId — create mode');
  }

  // 2) Seed window.modalCtx and SHOW IMMEDIATELY
  const fullKeys = Object.keys(full || {});
  L('seeding window.modalCtx', { entity: 'umbrellas', fullId: full?.id, fullKeys });

  window.modalCtx = {
    entity: 'umbrellas',
    data: deep(full),
    formState: { __forId: full?.id || null, main: {} },
    rolesState: null,
    ratesState: null,
    clientSettingsState: null,
    openToken: ((full?.id) || 'new') + ':' + Date.now()
  };

  L('window.modalCtx seeded', {
    entity: window.modalCtx.entity,
    dataId: window.modalCtx.data?.id,
    dataKeys: Object.keys(window.modalCtx.data||{}),
    formStateForId: window.modalCtx.formState?.__forId,
    openToken: window.modalCtx.openToken
  });

  // 3) Render modal NOW
  L('calling showModal with hasId=', !!full?.id, 'rawHasIdArg=', full?.id);
  showModal(
    'Umbrella',
    [{ key:'main', label:'Main' }],
    (key, r)=> {
      L('[renderUmbrellaTab] tab=', key, 'rowKeys=', Object.keys(r||{}), 'sample=', { name: r?.name, id: r?.id });
      return html(`
        <div class="form" id="tab-main">
          ${input('name','Name', r?.name)}
          ${input('remittance_email','Remittance email', r?.remittance_email, 'email')}
          ${input('bank_name','Bank', r?.bank_name)}
          ${input('sort_code','Sort code', r?.sort_code)}
          ${input('account_number','Account number', r?.account_number)}
          ${select('vat_chargeable','VAT chargeable', (r?.vat_chargeable ? 'Yes' : 'No'), ['Yes','No'])}
          ${select('enabled','Enabled', (r?.enabled === false) ? 'No' : 'Yes', ['Yes','No'])}
        </div>
      `);
    },
    async ()=>{
      L('[onSave] begin', { dataId: window.modalCtx?.data?.id, forId: window.modalCtx?.formState?.__forId });

      const fs = window.modalCtx.formState || { __forId: null, main:{} };
      const sameRecord = (!!window.modalCtx.data?.id && fs.__forId === window.modalCtx.data.id) || (!window.modalCtx.data?.id && fs.__forId == null);

      const staged = sameRecord ? (fs.main || {}) : {};
      const live   = collectForm('#tab-main');
      const payload = { ...staged, ...live };

      L('[onSave] collected', { sameRecord, stagedKeys: Object.keys(staged||{}), liveKeys: Object.keys(live||{}) });

      if (typeof payload.vat_chargeable !== 'boolean') payload.vat_chargeable = (payload.vat_chargeable === 'Yes' || payload.vat_chargeable === 'true');
      if (typeof payload.enabled        !== 'boolean') payload.enabled        = (payload.enabled        === 'Yes' || payload.enabled        === 'true');

      for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];

      const idForUpdate = window.modalCtx?.data?.id || full?.id || null;
      L('[onSave] upsertUmbrella', { idForUpdate, payloadKeys: Object.keys(payload||{}) });
      const saved = await upsertUmbrella(payload, idForUpdate).catch(err => { E('upsertUmbrella failed', err); return null; });
      const umbrellaId = idForUpdate || (saved && saved.id);
      L('[onSave] saved', { ok: !!saved, umbrellaId, savedKeys: Object.keys(saved||{}) });
      if (!umbrellaId) { alert('Failed to save umbrella'); return { ok:false }; }

      window.modalCtx.data      = { ...(window.modalCtx.data || {}), ...(saved || {}), id: umbrellaId };
      window.modalCtx.formState = { __forId: umbrellaId, main: {} };

      if (!seedId && umbrellaId) window.__pendingFocus = { section: 'umbrellas', id: umbrellaId };

      L('[onSave] final window.modalCtx', {
        dataId: window.modalCtx.data?.id,
        dataKeys: Object.keys(window.modalCtx.data||{})
      });

      return { ok: true, saved: window.modalCtx.data };
    },
    full?.id
  );

  // (Umbrella has no heavy post-paint preloads in your snippet; if you add any later,
  // keep them here, after showModal, and guard with token/id like in openClient.)
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
    s = await getSettings(); // unwraps {settings:{...}} → {...}
  } catch (e) {
    content.innerHTML = `
      <div class="tabc">
        <div class="error">Couldn’t load settings: ${e?.message || 'Unknown error'}</div>
      </div>`;
    return;
  }

  // Establish mode + snapshot for Cancel/Discard semantics
  let mode = 'view';            // 'view' | 'edit' | 'saving'
  let dirty = false;            // enable Save only when true
  let snapshot = JSON.parse(JSON.stringify(s)); // original values to restore on Discard

  // Prefer the new key; fall back to legacy if needed (still GLOBAL-only)
  const erniValue = (s.employers_ni_pct ?? s.erni_pct ?? 0);

  // Render panel shell with explicit Edit / Save / Cancel buttons
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
        ${input('vat_rate_pct','VAT %', s.vat_rate_pct ?? 20, 'number')}
        ${input('holiday_pay_pct','Holiday pay %', s.holiday_pay_pct ?? 0, 'number')}
        ${input('erni_pct','ERNI %', erniValue, 'number')}
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
        <span class="hint" id="settingsHint"></span>
        <div class="spacer"></div>
        <button id="btnEditSettings">Edit</button>
        <button id="btnCancelSettings">Close</button>
        <button id="btnSaveSettings" class="primary" disabled>Save</button>
      </div>
    </div>
  `;

  // Elements
  const formEl   = byId('settingsForm');
  const effInput = byId('settings_effective_from');
  const btnEdit  = byId('btnEditSettings');
  const btnSave  = byId('btnSaveSettings');
  const btnCancel= byId('btnCancelSettings');
  const hintEl   = byId('settingsHint');

  // Attach date picker
  if (effInput) attachUkDatePicker(effInput);

  // Helpers for view/edit toggling
  function setReadOnly(ro) {
    formEl.querySelectorAll('input, select, textarea').forEach(el => {
      el.disabled = !!ro;
      el.readOnly = !!ro && el.tagName === 'INPUT';
    });
  }
  function repaintButtons() {
    // Secondary button label: Cancel (edit & not dirty) / Discard (edit & dirty) / Close (view)
    if (mode === 'view') {
      btnCancel.textContent = 'Close';
      hintEl.textContent = '';
      btnEdit.style.display = '';
      btnSave.style.display = 'none';
    } else if (mode === 'edit') {
      btnCancel.textContent = dirty ? 'Discard' : 'Cancel';
      hintEl.textContent = dirty ? 'You have unsaved changes' : '';
      btnEdit.style.display = 'none';
      btnSave.style.display = '';
      btnSave.disabled = !dirty;
    } else if (mode === 'saving') {
      btnCancel.textContent = 'Saving…';
      btnEdit.style.display = 'none';
      btnSave.style.display = '';
      btnSave.disabled = true;
    }
  }
  function toView() { mode = 'view'; dirty = false; setReadOnly(true);  repaintButtons(); }
  function toEdit() { mode = 'edit'; dirty = false; setReadOnly(false); repaintButtons(); }

  function refillFrom(obj) {
    // Reset form inputs from a settings object
    const map = new Map([...formEl.querySelectorAll('input,select,textarea')].map(el => [el.name, el]));
    if (map.has('timezone_id')) map.get('timezone_id').value = obj.timezone_id || 'Europe/London';
    if (map.has('day_start'))   map.get('day_start').value   = obj.day_start || '06:00';
    if (map.has('day_end'))     map.get('day_end').value     = obj.day_end || '20:00';
    if (map.has('night_start')) map.get('night_start').value = obj.night_start || '20:00';
    if (map.has('night_end'))   map.get('night_end').value   = obj.night_end || '06:00';
    if (map.has('bh_source'))   map.get('bh_source').value   = obj.bh_source || 'MANUAL';
    if (map.has('bh_list'))     map.get('bh_list').value     = JSON.stringify(obj.bh_list || [], null, 2);
    if (map.has('bh_feed_url')) map.get('bh_feed_url').value = obj.bh_feed_url || '';
    if (map.has('vat_rate_pct'))map.get('vat_rate_pct').value= obj.vat_rate_pct ?? 20;
    if (map.has('holiday_pay_pct')) map.get('holiday_pay_pct').value = obj.holiday_pay_pct ?? 0;
    if (map.has('erni_pct'))    map.get('erni_pct').value    = (obj.employers_ni_pct ?? obj.erni_pct ?? 0);
    if (map.has('apply_holiday_to')) map.get('apply_holiday_to').value = obj.apply_holiday_to || 'PAYE_ONLY';
    if (map.has('apply_erni_to'))    map.get('apply_erni_to').value    = obj.apply_erni_to || 'PAYE_ONLY';
    if (map.has('margin_includes'))  map.get('margin_includes').value  = JSON.stringify(obj.margin_includes || {}, null, 2);
    if (map.has('effective_from'))   map.get('effective_from').value   = obj.effective_from ? formatIsoToUk(obj.effective_from) : '';
  }

  // Initial view-only mode
  setReadOnly(true);
  repaintButtons();

  // Dirty tracking (only in edit mode)
  const onDirty = (e) => { if (mode !== 'edit') return; dirty = true; repaintButtons(); };
  formEl.addEventListener('input', onDirty, true);
  formEl.addEventListener('change', onDirty, true);

  // Edit
  btnEdit.onclick = () => {
    if (mode !== 'view') return;
    snapshot = JSON.parse(JSON.stringify(s)); // capture original
    toEdit();
  };

  // Cancel / Discard / Close
  btnCancel.onclick = () => {
    if (mode === 'edit') {
      if (!dirty) { toView(); return; }
      const ok = window.confirm('Discard changes and return to view?');
      if (!ok) return;
      s = JSON.parse(JSON.stringify(snapshot));
      refillFrom(s);
      toView();
      return;
    }
    // mode === 'view' → Close the settings panel view (navigate away)
    // Keep behaviour consistent with the rest of the app: go back to the main list.
    currentSection = 'candidates';
    renderAll();
  };

  // Save
  btnSave.onclick = async () => {
    if (mode !== 'edit' || !dirty) return;
    mode = 'saving'; repaintButtons();

    const payload = collectForm('#settingsForm', true);
    if (payload.effective_from) {
      const iso = parseUkDateToIso(payload.effective_from);
      if (!iso) { alert('Invalid Effective from date'); mode='edit'; repaintButtons(); return; }
      payload.effective_from = iso;
    }

    try {
      await saveSettings(payload);
      s = { ...s, ...payload };           // Update live settings + snapshot
      snapshot = JSON.parse(JSON.stringify(s));
      toView();
      hintEl.textContent = 'Saved.';
      setTimeout(()=> { if (hintEl.textContent === 'Saved.') hintEl.textContent=''; }, 1500);
    } catch (e) {
      mode = 'edit'; repaintButtons();
      alert('Save failed: ' + (e?.message || 'Unknown error'));
    }
  };
}

// ===== Generic modal plumbing =====

// =============================== showModal (FIXED) ===============================
// ==== FIXED MODAL FRAMEWORK: close only on explicit success from onSave ====
// ==== CHILD MODAL (CANDIDATE RATE) — throw on errors; return true on success ====



// =============================== closeModal (kept) ===============================
// ================== FRONTEND: closeModal (UPDATED to refresh if pending focus) ==================
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

    // If a pending focus token exists, refresh the summary now so it can jump & highlight
    if (window.__pendingFocus) {
      try { renderAll(); } catch (e) { console.error('refresh after modal close failed', e); }
    }
  }
}

// === Helpers for modal mode & interactivity ===
function _currentFrame() {
  const stk = window.__modalStack || [];
  return stk[stk.length - 1] || null;
}
function _parentFrame() {
  const stk = window.__modalStack || [];
  return stk.length >= 2 ? stk[stk.length - 2] : null;
}
function _setFormReadOnly(root, ro) {
  if (!root) return;
  root.querySelectorAll('input, select, textarea, button').forEach(el => {
    const isDisplayOnly = el.id === 'tms_ref_display' || el.id === 'cli_ref_display';
    if (el.type === 'button') {
      // Buttons are generally disabled only when parent is view/child not editable
      if (ro && !isDisplayOnly) el.disabled = true;
      else if (!isDisplayOnly) el.disabled = false;
      return;
    }
    if (isDisplayOnly) {
      el.setAttribute('disabled', 'true');
      el.setAttribute('readonly', 'true');
      return;
    }
    if (ro) { el.setAttribute('disabled','true'); el.setAttribute('readonly','true'); }
    else    { el.removeAttribute('disabled'); el.removeAttribute('readonly'); }
  });
}
function _setFrameMode(frame, mode) {
  // mode: 'create' | 'view' | 'edit' | 'saving'
  frame.mode = mode;
  // read-only if view or saving
  const readOnly = (mode === 'view' || mode === 'saving');
  _setFormReadOnly(byId('modalBody'), readOnly);
  // buttons update
  if (typeof frame._updateButtons === 'function') frame._updateButtons();
}


// ===== Small helpers (fixed attribute serialization + HTML escaping) =====
const html = (s)=> s;

const _esc = (v) => String(v)
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

const _attrStr = (extra) => {
  if (!extra) return '';
  if (typeof extra === 'string') {
    const t = extra.trim();
    return t ? (' ' + t) : '';
  }
  if (typeof extra !== 'object') return '';
  let out = '';
  for (const [k, v] of Object.entries(extra)) {
    if (v === false || v == null) continue;      // skip false/null/undefined
    if (v === true) { out += ` ${k}`; continue; } // boolean attribute
    out += ` ${k}="${_esc(v)}"`;                  // key="value"
  }
  return out;
};

const input = (name, label, val = '', type = 'text', extra = '') => {
  const attrs = _attrStr(extra);
  const value = (val == null ? '' : val);
  return `<div class="row"><label>${_esc(label)}</label><input name="${_esc(name)}" type="${_esc(type)}" value="${_esc(value)}"${attrs}/></div>`;
};

const select = (name, label, val, options = [], extra = {}) => {
  const attrs = _attrStr(extra);
  const opts = options.map(o => {
    const selected = String(o) === String(val) ? ' selected' : '';
    return `<option${selected}>${_esc(o)}</option>`;
  }).join('');
  return `<div class="row"><label>${_esc(label)}</label><select name="${_esc(name)}"${attrs}>${opts}</select></div>`;
};

const readonly = (label, value) =>
  `<div class="row"><label>${_esc(label)}</label><input value="${_esc(value ?? '')}" readonly/></div>`;


/**
 * Safer form collector:
 * - Skips elements with no name
 * - Skips disabled/readonly or data-no-collect
 * - Converts Yes/No selects to booleans
 */
function collectForm(sel, jsonTry=false){
  const root = document.querySelector(sel);
  if (!root) return {}; // null-safe

  const out = {};
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    // skip non-collectable fields
    if (!el.name) return;
    if (el.disabled || el.readOnly || el.dataset.noCollect === 'true') return;

    const k = el.name;
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

// FRONTEND — UPDATED
// showModal: ignore non-trusted events for dirty; ensure drag handlers cleared early on close
// ================== FRONTEND: renderSummary (UPDATED to jump & highlight pending focus) ==================

// ===== UPDATED: renderSummary — if pending focus row isn't visible, try one auto-relax/reload pass, then highlight when found
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
    if (!confirmDiscardChangesIfDirty()) return; // dirty guard before opening a new modal

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

  // ---- Jump & highlight if a pending focus token matches this section
  if (window.__pendingFocus) {
    const pf = window.__pendingFocus;
    const pfSection = pf.section || (pf.entity ? (pf.entity + 's') : null);
    if (pfSection && pfSection === currentSection && pf.id != null) {
      const targetId = String(pf.id);
      const sel = `tr[data-id="${CSS.escape ? CSS.escape(targetId) : targetId}"]`;
      let tr = tb.querySelector(sel);

      if (!tr) {
        // Not visible under current filters - attempt one auto-relax/reload pass
        if (!pf._retried) {
          pf._retried = true;
          try {
            if (typeof clearFilters === 'function') clearFilters();
          } catch (_) {}
          try { renderAll(); } catch (e) { console.error('auto-refresh after filter clear failed', e); }
          return; // wait for next render to try again
        }
        // If we've already retried once, leave token set so a manual refresh can still catch it.
        console.debug('[GRID] pending focus row not found under current filters; already retried once');
        return;
      }

      // Select it in our state, scroll, and highlight
      currentSelection = currentRows.find(x => String(x.id) === targetId) || null;
      try { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { tr.scrollIntoView(); }
      tb.querySelectorAll('tr.selected').forEach(n => n.classList.remove('selected'));
      tr.classList.add('selected');
      const oldOutline = tr.style.outline;
      tr.style.outline = '2px solid #ffbf00';
      setTimeout(() => { tr.style.outline = oldOutline || ''; }, 2000);

      // Clear token so we don't jump again
      window.__pendingFocus = null;
    }
  }
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

// ================== NEW: openSettings (parent modal; opens in View) ==================
async function openSettings() {
  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));

  // Hydrate settings first
  let settings;
  try {
    settings = await getSettings(); // unwraps {settings:{...}} → {...}
  } catch (e) {
    alert('Could not load settings.');
    return;
  }

  // Seed modal context
  modalCtx = {
    entity: 'settings',
    data: deep(settings),                    // single source of truth for showModal
    formState: { __forId: 'global', main:{} },
    openToken: 'settings:' + Date.now()
  };

  // Open in VIEW mode (hasId=true) and let showModal manage Edit/Cancel/Discard/Save
  showModal(
    'Settings',
    [{ key:'main', label:'Defaults' }],
    renderSettingsTab,
    handleSaveSettings,
    true // hasId → opens in View mode
  );
}


// ================== NEW: renderSettingsTab (tab renderer; showModal controls read-only) ==================
function renderSettingsTab(key, s = {}) {
  if (key !== 'main') return '';

  const erniValue = (s.employers_ni_pct ?? s.erni_pct ?? 0);

  return html(`
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
      ${input('vat_rate_pct','VAT %', s.vat_rate_pct ?? 20, 'number')}
      ${input('holiday_pay_pct','Holiday pay %', s.holiday_pay_pct ?? 0, 'number')}
      ${input('erni_pct','ERNI %', erniValue, 'number')}
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
  `);
}


// ================== NEW: handleSaveSettings (parent onSave; persist then stay open in View) ==================
async function handleSaveSettings() {
  // Collect with JSON parsing for bh_list / margin_includes
  const payload = collectForm('#settingsForm', true) || {};

  // Normalise date
  if (payload.effective_from) {
    const iso = parseUkDateToIso(payload.effective_from);
    if (!iso) {
      alert('Invalid “Effective from” date');
      return { ok:false };
    }
    payload.effective_from = iso;
  }

  try {
    await saveSettings(payload);
  } catch (e) {
    alert('Save failed: ' + (e?.message || 'Unknown error'));
    return { ok:false };
  }

  // Return the merged saved state so showModal flips to View and repaints with new values
  const saved = { ...(modalCtx.data || {}), ...payload };
  return { ok:true, saved };
}




// ===== Boot =====
async function renderAll(){
  renderTopNav(); renderTools();
  const data = await loadSection();
  if (currentSection==='settings' || currentSection==='audit') renderSummary(data);
  else renderSummary(data); // list functions already return arrays via toList()
}
async function bootstrapApp(){
  // Belt & braces: if loadSession() ran but globals are not mirrored, mirror now
  try {
    if (typeof window !== 'undefined') {
      if (window.SESSION !== SESSION) window.SESSION = SESSION;
      window.__auth = window.__auth || {};
      if (!window.__auth.user && SESSION?.user) window.__auth.user = SESSION.user;
      if (!window.__USER_ID && SESSION?.user?.id) window.__USER_ID = SESSION.user.id;
    }

    // If token exists but user.id is missing, hydrate via /api/me (non-blocking safety)
    if (SESSION?.accessToken && (!SESSION.user || !SESSION.user.id)) {
      try {
        const meRes = await fetch(API('/api/me'), { headers: { 'Authorization': `Bearer ${SESSION.accessToken}` } });
        if (meRes.ok) {
          const meJson = await meRes.json().catch(()=> ({}));
          const profile = meJson && (meJson.user || meJson);
          if (profile && profile.id) {
            saveSession({ ...SESSION, user: profile }); // also re-mirrors globals
          }
        }
      } catch {}
    }
  } catch {}

  ensureSelectionStyles();   // ← ensure the highlight is clearly visible
  renderTopNav();
  renderTools();
  await renderAll();
}


// Initialize
initAuthUI();
if (loadSession()) { scheduleRefresh(); bootstrapApp(); }
else openLogin();
