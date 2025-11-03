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
  try {
    const raw = localStorage.getItem('cloudtms.session') || sessionStorage.getItem('cloudtms.session');
    const sess = raw ? JSON.parse(raw) : null;
    if (!sess || !sess.accessToken) return false;
    saveSession(sess);             // mirrors globals & schedules refresh
    return true;
  } catch { return false; }
}

async function loadSection(){
  // unified paging entry point
  window.__listState = window.__listState || {};
  const st = (window.__listState[currentSection] ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });

  // selection fingerprint reset if dataset changed (IDs-only)
  window.__selection = window.__selection || {};
  const sel = (window.__selection[currentSection] ||= { fingerprint:'', ids:new Set() });
  const fp = JSON.stringify({ section: currentSection, filters: st.filters || {} });
  if (sel.fingerprint !== fp) {
    sel.fingerprint = fp;
    sel.ids.clear();
  }

  // choose which loader to use (search vs plain list)
  const useSearch = !!st.filters && (Object.keys(st.filters).length > 0);

  // helper to fetch one page
  const fetchOne = async (section, page, pageSize) => {
    // push paging so builders pick it up
    window.__listState[section].page = page;
    window.__listState[section].pageSize = pageSize;
    if (useSearch) {
      return await search(section, window.__listState[section].filters || {});
    } else {
      switch(section){
        case 'candidates': return await listCandidates();
        case 'clients':    return await listClients();
        case 'umbrellas':  return await listUmbrellas();
        case 'settings':   return await getSettings();
        case 'audit':      return await listOutbox();
        default:           return [];
      }
    }
  };

  // "ALL" via sequential paging
  if (st.pageSize === 'ALL') {
    const acc = [];
    let p = 1;
    const chunk = 200;
    while (true) {
      const rows = await fetchOne(currentSection, p, chunk);
      acc.push(...(rows || []));
      if (!Array.isArray(rows) || rows.length < chunk) break;
      p += 1;
    }
    window.__listState[currentSection].page = 1;
    window.__listState[currentSection].hasMore = false;
    window.__listState[currentSection].total = acc.length;
    return acc;
  }

  // normal one-page
  const page = Number(st.page || 1);
  const ps   = Number(st.pageSize || 50);
  const rows = await fetchOne(currentSection, page, ps);
  window.__listState[currentSection].hasMore = Array.isArray(rows) && rows.length === ps;
  return rows;
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
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include', // cookie for refresh
    body: JSON.stringify({ email, password })
  });

  let data = {};
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    const msg = data?.error || data?.message || 'Invalid credentials';
    throw new Error(msg);
  }

  const token =
    data.access_token ||
    data.token ||
    data.accessToken;

  if (!token) {
    throw new Error('No access token returned');
  }

  const rawTtl = data.expires_in ?? data.token_ttl_sec ?? data.ttl ?? 3600; // seconds
  const ttl    = Math.max(60, Number(rawTtl) || 3600); // floor at 60s
  const skew   = 30; // renew slightly early

  saveSession({
    accessToken: token,
    user: data.user || data.profile || null,
    exp: Math.floor(Date.now() / 1000) + (ttl - skew)
  });

  if (typeof scheduleRefresh === 'function') {
    scheduleRefresh();
  }

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
      if (typeof scheduleRefresh === 'function') scheduleRefresh();
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

  // Open reset overlay automatically if URL carries a token (only if not already signed in)
  const url = new URL(location.href);
  const hasResetToken = url.searchParams.get('k') || url.searchParams.get('token');
  if (hasResetToken && !(typeof getSession === 'function' && getSession()?.accessToken)) openReset();
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

  // ensure per-section list + selection exist
  window.__listState = window.__listState || {};
  window.__selection = window.__selection || {};

  sections.forEach(s => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="ico">${s.icon}</span> ${s.label}`;
    if (s.key === currentSection) b.classList.add('active');

    b.onclick = () => {
      if (!confirmDiscardChangesIfDirty()) return;

      if ((window.__modalStack?.length || 0) > 0 || modalCtx?.entity) {
        discardAllModalsAndState();
      }

      if (!window.__listState[s.key]) {
        window.__listState[s.key] = { page: 1, pageSize: 50, total: null, hasMore: false, filters: null };
      }

      // IDs-only selection seed for the new section
      window.__selection[s.key] = window.__selection[s.key] || { fingerprint:'', ids:new Set() };

      currentSection   = s.key;
      currentRows      = [];
      currentSelection = null;

      renderAll();
    };

    nav.appendChild(b);
  });

  // Quick search: Enter runs a search and resets to page 1
  try {
    const q = byId('quickSearch');
    if (q && !q.__wired) {
      q.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        if (!confirmDiscardChangesIfDirty()) return;

        window.__listState = window.__listState || {};
        window.__selection = window.__selection || {};

        const st  = (window.__listState[currentSection]  ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });
        const sel = (window.__selection[currentSection] ||= { fingerprint:'', ids:new Set() });

        st.page = 1;
        const text = (q.value || '').trim();

        if (!text) {
          st.filters = null;
          sel.fingerprint = JSON.stringify({ section: currentSection, filters: {} });
          sel.ids.clear();
          const data = await loadSection();
          return renderSummary(data);
        }

        // Minimal quick-search filters by section
        let filters = null;
        if (currentSection === 'candidates') {
          if (text.includes('@'))       filters = { email: text };
          else if (text.replace(/\D/g,'').length >= 7) filters = { phone: text };
          else if (text.includes(' ')) {
            const [fn, ln] = text.split(' ').filter(Boolean);
            filters = { first_name: fn || text, last_name: ln || '' };
          } else filters = { first_name: text };
        } else if (currentSection === 'clients' || currentSection === 'umbrellas') {
          filters = { name: text };
        } else {
          const data = await loadSection();
          return renderSummary(data);
        }

        st.filters = filters;
        sel.fingerprint = JSON.stringify({ section: currentSection, filters });
        sel.ids.clear();

        const rows = await search(currentSection, filters);
        renderSummary(rows);
      });
      q.__wired = true;
    }
  } catch {}
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

async function createReportPreset({ section, kind='search', name, filters, selection, is_shared=false, is_default=false }) {
  const res = await authFetch(
    API(`/api/report-presets`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ section, kind, name, filters, selection, is_shared, is_default })
    }
  );

  if (res.status === 409) {
    let conflicting = null;
    try {
      const presets = await listReportPresets({ section, kind, include_shared: false, q: name, page: 1, page_size: 100 });
      const lower = String(name || '').toLowerCase();
      conflicting = (presets || []).find(p => String(p.name || '').toLowerCase() === lower) || null;
    } catch {}

    try {
      const form = document.getElementById('saveSearchForm');
      if (form) {
        const overwriteRadio = form.querySelector('input[name="mode"][value="overwrite"]') || form.querySelector('input[name="mode"][value="append"]');
        const overwriteWrap  = form.querySelector('#overwriteWrap') || form.querySelector('#appendWrap');
        const selectEl       = form.querySelector('#overwritePresetId') || form.querySelector('#appendPresetId');
        if (overwriteRadio) overwriteRadio.checked = true;
        if (overwriteWrap)  overwriteWrap.style.display = 'block';
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
    } catch {}

    const err = new Error('Preset name already exists. Switched to Overwrite—pick the preset and save again.');
    err.code = 'PRESET_NAME_CONFLICT';
    if (conflicting) err.preset = conflicting;
    err.section = section;
    err.kind = kind;
    throw err;
  }

  if (!res.ok) throw new Error(await res.text());

  invalidatePresetCache(section, kind);
  const data = await res.json().catch(()=>({}));
  return data.row || null;
}


async function updateReportPreset({ id, name, filters, selection, is_shared, is_default, section, kind }) {
  const patch = {};
  if (typeof name === 'string') patch.name = name;
  if (filters && typeof filters === 'object') patch.filters = filters;
  if (selection && typeof selection === 'object') patch.selection = selection;
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


// -----------------------------
// UPDATED: search()
// -----------------------------
// ======================================
// FRONTEND — search (UPDATED: no extra logic beyond existing; kept for completeness)
// ======================================

async function search(section, filters={}){
  window.__listState = window.__listState || {};
  const st = (window.__listState[section] ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });

  // Reset selection when applying a new dataset (fingerprint change)
  window.__selection = window.__selection || {};
  const sel = (window.__selection[section] ||= { fingerprint:'', ids:new Set() });
  sel.fingerprint = JSON.stringify({ section, filters: filters || {} });
  sel.ids.clear();

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
  const rows = toList(r);

  // update state
  st.filters = { ...(filters || {}) };
  const ps = (st.pageSize === 'ALL') ? null : Number(st.pageSize || 50);
  st.hasMore = (ps != null) ? (Array.isArray(rows) && rows.length === ps) : false;

  return rows;
}



// ─────────────────────────────────────────────────────────────
// NEW: Quick wrapper to focus current ticked selection
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// NEW: Render the tiny Selection toolbar under the grid
// Buttons: 🔍 Focus | 🔍 Save | 🔍 Load
// Call from renderSummary() after the pager, or anywhere you want.
// ─────────────────────────────────────────────────────────────
function renderSelectionToolbar(section, mountAfterEl) {
  // Locate a mount point
  const content = document.getElementById('content');
  const host = mountAfterEl || content;
  if (!host) return null;

  // Read selection
  window.__selection = window.__selection || {};
  const sel = (window.__selection[section] ||= { fingerprint: '', ids: new Set() });
  const hasSelection = sel.ids && sel.ids.size > 0;

  // Create bar
  const bar = document.createElement('div');
  bar.className = 'selection-toolbar';
  bar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:6px 10px;border-top:1px dashed var(--line)';

  // Button factory
  const mkBtn = (title, text) => {
    const b = document.createElement('button');
    b.title = title;
    b.textContent = text;
    b.style.cssText = 'border:1px solid var(--line);background:#0b152a;color:var(--text);padding:4px 8px;border-radius:8px;cursor:pointer';
    return b;
  };

  const btnFocus = mkBtn('Focus on records', '🔍 Focus');
  const btnSave  = mkBtn('Save selection',   '🔍 Save');
  const btnLoad  = mkBtn('Load selection',   '🔍 Load');

  btnFocus.disabled = !hasSelection;
  btnSave.disabled  = !hasSelection;

  btnFocus.addEventListener('click', async () => {
    try { await focusCurrentSelection(section); } catch (e) { console.error('Focus failed', e); }
  });

  btnSave.addEventListener('click', async () => {
    try { await openSaveSelectionModal(section); } catch (e) { console.error('Save selection failed', e); }
  });

  btnLoad.addEventListener('click', async () => {
    try { await openLoadSelectionModal(section); } catch (e) { console.error('Load selection failed', e); }
  });

  bar.appendChild(btnFocus);
  bar.appendChild(btnSave);
  bar.appendChild(btnLoad);

  host.appendChild(bar);
  return bar;
}


// ─────────────────────────────────────────────────────────────
// NEW: Save the current ticked selection (IDs-only)
// Modes: Save as new, Append to existing (selection kind only)
// ─────────────────────────────────────────────────────────────
async function openSaveSelectionModal(section) {
  const sanitize = (typeof window !== 'undefined' && typeof window.sanitize === 'function')
    ? window.sanitize
    : (s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                           .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
                           .replace(/'/g,'&#39;'));

  window.__selection = window.__selection || {};
  const curSel = window.__selection[section] || { fingerprint:'', ids:new Set() };
  const idsNow = Array.from(new Set((Array.from(curSel.ids || []).map(String).filter(Boolean)))); // dedupe

  if (!idsNow.length) {
    alert('No records selected to save.');
    return;
  }

  // Load owned selection presets for Append
  const myId = currentUserId();
  const mine = await listReportPresets({ section, kind: 'selection', include_shared: false }).catch(() => []);
  const owned = (mine || []).filter(p => String(p.user_id) === String(myId));
  const optionsHtml = owned.map(p => `<option value="${p.id}">${sanitize(p.name || '(unnamed)')}</option>`).join('');

  const body = html(`
    <div class="form" id="saveSelectionForm" style="max-width:720px">
      <div class="row">
        <label for="selPresetName">Preset name</label>
        <div class="controls">
          <input id="selPresetName" class="input" placeholder="e.g. ‘Shortlist — RMNs’" />
        </div>
      </div>

      <div class="row">
        <label>Mode</label>
        <div class="controls" style="display:flex;flex-direction:column;gap:8px;min-width:0">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <label class="inline"><input type="radio" name="mode" value="new" checked> <span>Save as new selection</span></label>
            <label class="inline">
              <input type="radio" name="mode" value="append" ${owned.length ? '' : 'disabled'}>
              <span>Append to existing selection</span>
            </label>
          </div>
          <div id="selAppendWrap" style="display:none; width:100%; max-width:100%">
            <div class="hint" style="margin:2px 0 4px">${owned.length ? 'Choose selection to append to' : 'You don’t own any selections to append'}</div>
            <select id="selAppendPresetId" class="select" style="width:100%; max-width:100%">${optionsHtml}</select>
          </div>
        </div>
      </div>

      <div class="row">
        <label for="selPresetShared">Visibility</label>
        <div class="controls">
          <label class="inline"><input id="selPresetShared" type="checkbox"> <span>Visible to all users</span></label>
        </div>
      </div>
    </div>
  `);

  showModal(
    'Save selection',
    [{ key: 'form', label: 'Details' }],
    () => body,
    async () => {
      const name  = String(document.getElementById('selPresetName')?.value || '').trim();
      const share = !!document.getElementById('selPresetShared')?.checked;

      // Re-read & dedupe IDs at submit time
      const ids = Array.from(new Set((Array.from((window.__selection?.[section]?.ids) || []))
        .map(String).filter(Boolean)));

      if (!ids.length) { alert('No records selected.'); return false; }

      const mode = (document.querySelector('#saveSelectionForm input[name="mode"]:checked')?.value || 'new').toLowerCase();
      if (mode === 'append') {
        if (!owned.length) { alert('You don’t own any selections to append.'); return false; }
        const targetId = (document.getElementById('selAppendPresetId')?.value) || '';
        if (!targetId) { alert('Select a selection to append to.'); return false; }

        // Fetch target → dedupe-union → PATCH kind: 'selection'
        const targetList = await listReportPresets({ section, kind: 'selection', include_shared: false }).catch(()=>[]);
        const target = (targetList || []).find(p => String(p.id) === String(targetId));
        const targetIds = Array.isArray(target?.selection_json?.ids) ? target.selection_json.ids.map(String).filter(Boolean) : [];
        const targetSet = new Set(targetIds);

        // Only add what isn't there already
        const toAdd = ids.filter(id => !targetSet.has(id));
        if (toAdd.length === 0) {
          alert('Those records are already in that selection. Nothing to append.');
          return false;
        }

        const merged = Array.from(new Set([...targetIds, ...toAdd]));

        await updateReportPreset({
          id: targetId,
          kind: 'selection',
          selection: { ids: merged }
          // keep name/visibility as-is
        });
      } else {
        if (!name) { alert('Please enter a name'); return false; }
        await createReportPreset({
          section,
          kind: 'selection',
          name,
          is_shared: share,
          filters: {},                         // not used for selections
          selection: { ids }                   // already deduped
        });
      }

      try { invalidatePresetCache(section, 'selection'); } catch {}
      return true;
    },
    false,
    undefined,
    { noParentGate: true, forceEdit: true, kind: 'selection-save' }
  );

  // Wire append toggling
  setTimeout(() => {
    const formEl = document.getElementById('saveSelectionForm');
    if (!formEl || formEl.dataset.wired === '1') return;
    formEl.dataset.wired = '1';

    const appendWrap = document.getElementById('selAppendWrap');
    formEl.querySelectorAll('input[name="mode"]').forEach(r => {
      r.addEventListener('change', () => {
        const isAppend = r.value === 'append' && r.checked;
        if (appendWrap) appendWrap.style.display = isAppend ? 'block' : 'none';
      });
    });
  }, 0);
}


async function openLoadSelectionModal(section) {
  const sanitize = (typeof window !== 'undefined' && typeof window.sanitize === 'function')
    ? window.sanitize
    : (s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                           .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
                           .replace(/'/g,'&#39;'));

  let list = await listReportPresets({ section, kind: 'selection', include_shared: true }).catch(()=>[]);
  let selectedId = null;

  const renderList = () => {
    const myId = currentUserId();
    const mine   = (list || []).filter(r => String(r.user_id) === String(myId))
                     .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''), undefined, {sensitivity:'base'}));
    const shared = (list || []).filter(r => String(r.user_id) !== String(myId))
                     .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''), undefined, {sensitivity:'base'}));
    const rows = mine.concat(shared);

    const rowsHtml = rows.map(p => {
      const owned    = String(p.user_id) === String(myId);
      const nameHtml = `<span class="name">${sanitize(p.name || '(unnamed)')}</span>`;
      const creator  = (p.user && (p.user.display_name || p.user.email)) ? ` <span class="hint">• by ${sanitize(p.user.display_name || p.user.email)}</span>` : '';
      const badge    = p.is_shared ? `<span class="badge">shared</span>${creator}` : '';
      const trashBtn = owned ? `<button class="bin btn btn-ghost btn-sm" title="Delete">🗑</button>` : '';
      return `
        <tr data-id="${p.id}">
          <td class="pick">${nameHtml} ${badge}</td>
          <td>${new Date(p.updated_at || p.created_at).toLocaleString()}</td>
          <td class="actions">${trashBtn}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="3" class="hint">No saved selections</td></tr>`;

    return html(`
      <div class="form">
        <div class="row" style="justify-content:space-between;align-items:center">
          <strong>Saved selections</strong>
          <span class="hint">Section: <code>${sanitize(section)}</code></span>
        </div>
        <div class="row">
          <table class="grid compact" id="selPresetTable">
            <thead><tr><th>Name</th><th>Updated</th><th></th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `);
  };

  function wireTable() {
    const tbl = document.getElementById('selPresetTable');
    if (!tbl || tbl.__wired) return;
    tbl.__wired = true;

    // click → select
    tbl.addEventListener('click', (e) => {
      const tr = e.target && e.target.closest('tr[data-id]');
      if (!tr) return;
      selectedId = tr.getAttribute('data-id');
      Array.from(tbl.querySelectorAll('tbody tr')).forEach(r => r.classList.toggle('selected', r === tr));
    });

    // dblclick → apply immediately
    tbl.addEventListener('dblclick', async (e) => {
      const tr = e.target && e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.getAttribute('data-id');
      const chosen = (list || []).find(p => p.id === id);
      if (!chosen) return;

      const ids = Array.isArray(chosen?.selection_json?.ids) ? chosen.selection_json.ids : [];
      await applySelectionAsFilter(section, { ids });
      const closeBtn = document.getElementById('btnCloseModal');
      if (closeBtn) closeBtn.click();
    });

    // delete owned selection
    tbl.addEventListener('click', async (e) => {
      const bin = e.target && e.target.closest('button.bin');
      if (!bin) return;
      const tr = e.target && e.target.closest('tr[data-id]');
      const id = tr && tr.getAttribute('data-id');
      const row = (list || []).find(p => p.id === id);
      if (!row) return;
      const myIdNow = currentUserId();
      if (String(row.user_id) !== String(myIdNow)) return;
      if (!confirm(`Delete saved selection “${row.name || '(unnamed)'}”?`)) return;

      try { await deleteReportPreset(id); } catch (err) { alert(String(err?.message || err || 'Failed to delete preset')); return; }
      try { invalidatePresetCache(section, 'selection'); } catch {}
      list = await listReportPresets({ section, kind:'selection', include_shared:true }).catch(()=>[]);

      const body = document.getElementById('modalBody');
      if (body) {
        const markup = renderList();
        if (typeof markup === 'string') body.innerHTML = markup;
        else if (markup && typeof markup.nodeType === 'number') body.replaceChildren(markup);
        else body.innerHTML = String(markup ?? '');
        wireTable();
      }
    });
  }

  showModal(
    'Load selection',
    [{ key: 'list', label: 'Saved' }],
    renderList,
    async () => {
      if (!selectedId) { alert('Pick a selection to load'); return false; }
      const chosen = (list || []).find(p => p.id === selectedId);
      if (!chosen) { alert('Selection not found'); return false; }
      const ids = Array.isArray(chosen?.selection_json?.ids) ? chosen.selection_json.ids : [];
      await applySelectionAsFilter(section, { ids });
      return true;
    },
    false,
    undefined,
    { noParentGate: true, forceEdit: true, kind: 'selection-load' }
  );

  setTimeout(wireTable, 0);
}


// ======================================
// FRONTEND — buildSearchQS (UPDATED: support ids[] → id=in.(...))
// ======================================
function buildSearchQS(section, filters={}){
  window.__listState = window.__listState || {};
  const st = (window.__listState[section] ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });

  const qs = new URLSearchParams();
  const add = (key, val) => { if (val==null || val==='') return; qs.append(key, String(val)); };
  const addArr = (key, arr) => { if (!Array.isArray(arr)) return; arr.forEach(v => { if (v!=null && v!=='') qs.append(key, String(v)); }); };

  // paging
  if (st.pageSize !== 'ALL') {
    add('page', st.page || 1);
    add('page_size', st.pageSize || 50);
    add('include_count', 'true');
  } else {
    add('page', 1);
    add('include_count', 'true');
  }

  // IDs filter (show only these records)
  if (Array.isArray(filters.ids) && filters.ids.length > 0) {
    qs.append('id', `in.(${filters.ids.map(String).join(',')})`);
  }

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
      if (name) add('q', name);
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
      add('invoice_no',  invoice_no);
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
// NEW: Save search modal (new / overwrite / shared)
// -----------------------------

// === REPLACE: openSaveSearchModal (no currentWorked; built-in sanitize) ===
// === REPLACE: openSaveSearchModal (radio-safe + stable layout + full-width dropdown)
// ======================================
// FRONTEND — openSaveSearchModal (UPDATED)
// Behaviour:
// - If there IS a selection: show “Save Selection” UI only (Save new / Append).
// - If there is NO selection: show “Save Filters” UI only.
// ======================================
// Save selection/search modal — simplified choices per your spec
async function openSaveSearchModal(section, filters){
  const sanitize = (typeof window !== 'undefined' && typeof window.sanitize === 'function')
    ? window.sanitize
    : (s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                           .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'));

  // Selection present?
  window.__selection = window.__selection || {};
  const sel = window.__selection[section];
  const hasSelection = !!sel && sel.ids && sel.ids.size > 0;

  // If we’re going to append, we need the user’s presets list
  const mineServer = await listReportPresets({ section, kind: 'search', include_shared: false }).catch(()=>[]);
  const myId = currentUserId();
  const mine = (mineServer || []).filter(m => String(m.user_id) === String(myId));
  const hasOwned = Array.isArray(mine) && mine.length > 0;
  const optionsHtml = hasOwned
    ? mine.map(m => `<option value="${m.id}">${sanitize(m.name)}</option>`).join('')
    : '';

  let body;
  if (hasSelection) {
    body = html(`
      <div class="form" id="saveSearchForm" style="max-width:720px">
        <div class="row">
          <label for="presetName">Preset name</label>
          <div class="controls">
            <input id="presetName" name="preset_name" class="input" placeholder="e.g. ‘Shortlist — RMNs’" />
          </div>
        </div>

        <div class="row">
          <label>Mode</label>
          <div class="controls" style="display:flex;flex-direction:column;gap:8px;min-width:0">
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
              <label class="inline"><input type="radio" name="mode" value="new" checked> <span>Save selection as new</span></label>
              <label class="inline">
                <input type="radio" name="mode" value="append" ${hasOwned ? '' : 'disabled'}>
                <span>Append to existing selection</span>
              </label>
            </div>
            <div id="appendWrap" style="display:none; width:100%; max-width:100%">
              <div class="hint" style="margin:2px 0 4px">${hasOwned ? 'Choose selection to append to' : 'You don’t own any selections to append'}</div>
              <select id="appendPresetId" class="select" style="width:100%; max-width:100%">${optionsHtml}</select>
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
  } else {
    body = html(`
      <div class="form" id="saveSearchForm" style="max-width:720px">
        <div class="row">
          <label for="presetName">Preset name</label>
          <div class="controls">
            <input id="presetName" name="preset_name" class="input" placeholder="e.g. ‘PAYE RMNs’" />
          </div>
        </div>

        <div class="row">
          <label>Visibility</label>
          <div class="controls">
            <label class="inline"><input id="presetShared" type="checkbox"> <span>Visible to all users</span></label>
          </div>
        </div>
      </div>
    `);
  }

  showModal(
    hasSelection ? 'Save selection' : 'Save search',
    [{ key: 'form', label: 'Details' }],
    () => body,
    async () => {
      const name  = String(document.getElementById('presetName')?.value || '').trim();
      const share = !!document.getElementById('presetShared')?.checked;
      if (!name && !hasSelection) { alert('Please enter a name'); return false; }

      // Recompute selection now
      const curSel = window.__selection[section];
      const hasSelectionNow = !!curSel && curSel.ids && curSel.ids.size>0;

      if (hasSelectionNow) {
        const modeInput = document.querySelector('#saveSearchForm input[name="mode"]:checked');
        const mode = (modeInput?.value || 'new').toLowerCase();
        if (mode === 'append') {
          if (!hasOwned) { alert('You don’t own any selections to append'); return false; }
          const targetId = (document.getElementById('appendPresetId')?.value) || '';
          if (!targetId) { alert('Select a selection to append to'); return false; }

          const target = (await listReportPresets({ section, kind:'search', include_shared:false }).catch(()=>[])).find(p => String(p.id) === String(targetId));
          const targetSel = target?.selection || target?.selection_json || null;
          const merged = mergeSelectionSnapshots(section,
            { section, fingerprint: targetSel?.fingerprint || '', ids: Array.from(new Set((targetSel?.ids||[]).map(String))) },
            { section, fingerprint: curSel.fingerprint || '',  ids: Array.from(curSel.ids || []) }
          );
          await updateReportPreset({ id: targetId, name: target?.name, section, kind:'search', selection: merged, is_shared: target?.is_shared });
        } else {
          const payload = {
            section, kind:'search', name, is_shared: share,
            selection: {
              fingerprint: curSel.fingerprint || '',
              ids: Array.from(curSel.ids || [])
            }
          };
          await createReportPreset(payload);
        }
      } else {
        const payload = { section, kind:'search', name, is_shared: share, filters: filters || {} };
        await createReportPreset(payload);
      }

      invalidatePresetCache(section, 'search');
      try { window.dispatchEvent(new Event('search-preset-updated')); } catch(_) {}
      return true;
    },
    false,
    undefined,
    { noParentGate: true, forceEdit: true, kind: hasSelection ? 'selection-save' : 'search-save' }
  );

  // Wire append toggling (only in selection mode)
  if (hasSelection) {
    setTimeout(() => {
      const formEl = document.getElementById('saveSearchForm');
      if (!formEl || formEl.dataset.wired === '1') return;
      formEl.dataset.wired = '1';
      const appendWrap = document.getElementById('appendWrap');
      formEl.querySelectorAll('input[name="mode"]').forEach(r =>
        r.addEventListener('change', () => {
          const isAppend = r.value === 'append' && r.checked;
          if (appendWrap) appendWrap.style.display = isAppend ? 'block' : 'none';
        })
      );
    }, 0);
  }
}

// === REPLACE: openLoadSearchModal (built-in sanitize; no globals required) ===
// FRONTEND — UPDATED
// openLoadSearchModal: emit event with filters (so parent re-applies after repaint),
// stage-delete UI kept; shows shared badge and (when present) creator.


// ======================================
// FRONTEND — openLoadSearchModal (UPDATED)
// Behaviour: list saved presets; double-click applies immediately & closes.
// - If preset has selection with explicit ids → show only those (applySelectionAsFilter).
// - If selection has allMatching=true → apply its filters instead.
// - If preset is a filters-only search → apply filters.
// ======================================

async function openLoadSearchModal(section){
  const sanitize = (typeof window !== 'undefined' && typeof window.sanitize === 'function')
    ? window.sanitize
    : (s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                           .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'));

  // Filters-only presets
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

  function wirePresetTable() {
    const tbl = document.getElementById('presetTable');
    if (!tbl || tbl.__wired) return;
    tbl.__wired = true;

    // Select row on click
    tbl.addEventListener('click', (e) => {
      const tr = e.target && e.target.closest('tr[data-id]');
      if (!tr) return;
      selectedId = tr.getAttribute('data-id');
      Array.from(tbl.querySelectorAll('tbody tr')).forEach(r => r.classList.toggle('selected', r === tr));
    });

    // Double-click: apply filters immediately and close + notify parent
    tbl.addEventListener('dblclick', async (e) => {
      const tr = e.target && e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.getAttribute('data-id');
      const chosen = (list || []).find(p => p.id === id);
      if (!chosen) return;

      const filters = chosen.filters || chosen.filters_json || chosen.filtersJson || {};

      window.__listState = window.__listState || {};
      const st = (window.__listState[section] ||= { page:1, pageSize:50, total:null, hasMore:false, filters:null });
      st.page = 1; st.filters = filters || {};
      const rows = await search(section, st.filters);
      renderSummary(rows);

      // notify parent advanced-search to re-populate its form
      try { window.__PENDING_ADV_PRESET = { section, filters: st.filters || {} }; } catch {}

      const closeBtn = document.getElementById('btnCloseModal');
      if (closeBtn) closeBtn.click();
    });

    // Delete handler
    tbl.addEventListener('click', async (e) => {
      const bin = e.target && e.target.closest('button.bin');
      if (!bin) return;
      const tr = e.target && e.target.closest('tr[data-id]');
      const id = tr && tr.getAttribute('data-id');
      const row = (list || []).find(p => p.id === id);
      if (!row) return;
      const myIdNow = currentUserId();
      if (String(row.user_id) !== String(myIdNow)) return;
      if (!confirm(`Delete saved preset “${row.name}”? This cannot be undone.`)) return;

      try { await deleteReportPreset(id); } catch (err) { alert(String(err?.message || err || 'Failed to delete preset')); return; }
      try { invalidatePresetCache(section, 'search'); } catch {}
      list = await listReportPresets({ section, kind:'search', include_shared:true }).catch(()=>[]);

      const body = document.getElementById('modalBody');
      if (body) {
        const markup = renderList();
        if (typeof markup === 'string') body.innerHTML = markup;
        else if (markup && typeof markup.nodeType === 'number') body.replaceChildren(markup);
        else body.innerHTML = String(markup ?? '');
        wirePresetTable();
      }
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
      window.__listState = window.__listState || {};
      const st = (window.__listState[section] ||= { page:1, pageSize:50, total:null, hasMore:false, filters:null });
      st.page = 1; st.filters = filters || {};
      const rows = await search(section, st.filters);
      renderSummary(rows);

      // notify parent advanced-search to re-populate its form
      try { window.__PENDING_ADV_PRESET = { section, filters: st.filters || {} }; } catch {}
      return true; // child closes; parent will onReturn and re-populate form
    },
    false,
    undefined,
    { noParentGate: true, forceEdit: true, kind: 'search-load' }
  );

  setTimeout(wirePresetTable, 0);
}



// ============================================================================
// Selection presets — wrappers to save/list/load selection presets via backend
// ============================================================================

/**
 * Save a selection preset.
 * By default uses kind: 'selection' to keep it distinct from pure filter presets,
 * but your backend can also store it under kind: 'search' with a `selection` block.
 */

/** List selection presets for a section (owned + shared if requested). */
async function listSelectionPresets(section, { include_shared = true } = {}) {
  if (typeof listReportPresets === 'function') {
    return await listReportPresets({ section, kind: 'selection', include_shared });
  }
  // Fallback, if needed:
  const qs = new URLSearchParams({ section, kind: 'selection', include_shared: include_shared ? 'true' : 'false' });
  const res = await authFetch(API(`/api/report-presets?${qs}`));
  return res?.ok ? res.json().catch(()=>[]) : [];
}

/**
 * Load a selection preset by ID or name. Returns the preset object (or null).
 * Note: this does not apply it — use applySelectionSnapshot() or mergeSelectionSnapshots().
 */
async function loadSelectionPreset(section, idOrName) {
  const all = await listSelectionPresets(section, { include_shared: true }) || [];
  if (!idOrName) return null;
  const match = all.find(p => String(p.id) === String(idOrName)) ||
                all.find(p => String(p.name || '').toLowerCase() === String(idOrName).toLowerCase());
  return match || null;
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
// ======================================
// FRONTEND — openSearchModal (UPDATED)
// Branches: if there's a selection in the summary → go straight to Save Selection.
// Otherwise, open the Advanced Search (filters) modal as usual.
// ======================================
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

  showModal(
    'Advanced Search',
    [{ key: 'filter', title: 'Filters' }],
    () => formHtml,
    async () => {
      window.__listState = window.__listState || {};
      const st = (window.__listState[currentSection] ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });
      st.page = 1;

      // Reset selection for the new dataset (IDs-only)
      window.__selection = window.__selection || {};
      const sel = (window.__selection[currentSection] ||= { fingerprint:'', ids:new Set() });
      const filters = extractFiltersFromForm('#searchForm');
      sel.fingerprint = JSON.stringify({ section: currentSection, filters });
      sel.ids.clear();

      const rows = await search(currentSection, filters);
      if (rows) renderSummary(rows);
      return true; // showModal will close this advanced-search frame on success
    },
    false,
    () => {
      // Apply pending preset (if a child "Load search" just set it)
      const pending = (typeof window !== 'undefined') ? window.__PENDING_ADV_PRESET : null;
      if (pending && pending.section) {
        try { window.dispatchEvent(new CustomEvent('adv-search-apply-preset', { detail: pending })); } catch {}
      }
      if (typeof window !== 'undefined') delete window.__PENDING_ADV_PRESET;

      try { wireAdvancedSearch(); } catch {}

      // Prefill from current filters immediately on mount
      try {
        window.__listState = window.__listState || {};
        const st = (window.__listState[currentSection] ||= { page:1, pageSize:50, total:null, hasMore:false, filters:null });
        populateSearchFormFromFilters(st.filters || {}, '#searchForm');
      } catch {}
    },
    { noParentGate: true, forceEdit: true, kind: 'advanced-search' }
  );

  setTimeout(wireAdvancedSearch, 0);
}


// ======================================
// FRONTEND — wireAdvancedSearch (UPDATED only to call the updated save/load modals)
// ======================================


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

  // listen once for preset apply events (filters only — selection is handled in the load modal)
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

  // NEW: Immediately populate from current filters when the modal mounts/re-renders
  try {
    window.__listState = window.__listState || {};
    const st = (window.__listState[currentSection] ||= { page:1, pageSize:50, total:null, hasMore:false, filters:null });
    populateSearchFormFromFilters(st.filters || {}, '#searchForm');
  } catch {}
}

// -----------------------------
// UPDATED: renderTools()
// - Keep Search…, add “Saved searches…” shortcut that opens Search modal pre-focused on loading presets
// -----------------------------
function renderTools(){
  const el = byId('toolButtons');
  const canCreate = ['candidates','clients','umbrellas'].includes(currentSection);

  el.innerHTML = '';
  const addBtn = (txt, cb) => {
    const b = document.createElement('button');
    b.textContent = txt;
    b.onclick = cb;
    el.appendChild(b);
    return b;
  };

  const btnCreate = addBtn('Create New Record', () => openCreate());
  addBtn('Show all records', () => showAllRecords(currentSection));
  addBtn('Search…', () => openSearchModal()); // left toolbar search

  if (!canCreate) btnCreate.disabled = true;
}
async function showAllRecords(section = currentSection){
  // Reset paging & clear all filters
  window.__listState = window.__listState || {};
  const st = (window.__listState[section] ||= {
    page: 1, pageSize: 50, total: null, hasMore: false, filters: null,
  });
  st.page = 1;
  st.filters = null;

  // Forget any focused shortlist (IDs selection)
  const sel = ensureSelection(section);
  sel.ids.clear();
  sel.fingerprint = ''; // optional: allow renderSummary to recompute

  // Reload full list for the section and render
  const rows = await loadSection();
  renderSummary(rows);
}
// Optional alias if other code calls clearFilters()
function clearFilters(section = currentSection){
  return showAllRecords(section);
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
// 🔧 CHANGE: truly global roles list (de-duplicated across ALL clients), with a short TTL cache.
// Works even when there is no active client in context (e.g., Candidate create).
async function loadGlobalRoleOptions(){
  const now = Date.now();
  const TTL_MS = 60_000;

  // Prefer our global cache
  if (Array.isArray(window.__GLOBAL_ROLE_CODES_ALL__) &&
      (now - (window.__GLOBAL_ROLE_CODES_ALL_TS__ || 0) < TTL_MS)) {
    return window.__GLOBAL_ROLE_CODES_ALL__;
  }

  // Fallback to legacy '__fallback__' if it’s fresh
  if (window.__GLOBAL_ROLE_CODES_CACHE__ &&
      window.__GLOBAL_ROLE_CODES_CACHE__['__fallback__'] &&
      (now - (window.__GLOBAL_ROLE_CODES_CACHE_TS__?.['__fallback__'] || 0) < TTL_MS)) {
    const arr = window.__GLOBAL_ROLE_CODES_CACHE__['__fallback__'];
    window.__GLOBAL_ROLE_CODES_ALL__ = arr.slice();
    window.__GLOBAL_ROLE_CODES_ALL_TS__ = now;
    return arr;
  }

  // Aggregate roles across all clients (enabled client-default windows only)
  const roles = new Set();
  try {
    const clients = await listClientsBasic();
    for (const c of (clients || [])) {
      try {
        const rows = await listClientRates(c.id, { only_enabled: true });
        for (const r of (rows || [])) {
          if (r && r.role) roles.add(String(r.role));
        }
      } catch { /* ignore per-client errors */ }
    }
  } catch { /* ignore listClientsBasic error */ }

  const arr = [...roles].sort((a,b)=> a.localeCompare(b));

  // Save to both the new global cache AND the legacy fallback keys so existing invalidation hooks still help
  window.__GLOBAL_ROLE_CODES_ALL__ = arr;
  window.__GLOBAL_ROLE_CODES_ALL_TS__ = now;

  window.__GLOBAL_ROLE_CODES_CACHE__    = window.__GLOBAL_ROLE_CODES_CACHE__    || Object.create(null);
  window.__GLOBAL_ROLE_CODES_CACHE_TS__ = window.__GLOBAL_ROLE_CODES_CACHE_TS__ || Object.create(null);
  window.__GLOBAL_ROLE_CODES_CACHE__['__fallback__']    = arr;
  window.__GLOBAL_ROLE_CODES_CACHE_TS__['__fallback__'] = now;

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

  // Bounds (YYYY-MM-DD or null) — consumers can set inputEl._minIso / _maxIso at runtime
  const getMinIso = () => inputEl._minIso || null;
  const getMaxIso = () => inputEl._maxIso || null;

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
    if (!portal) return;
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
    if (t.matches('.nav-prev')) { e.preventDefault(); navMonth(-1); return; }
    if (t.matches('.nav-next')) { e.preventDefault(); navMonth(+1); return; }
    const dayBtn = t.closest('button.day');
    if (dayBtn && !dayBtn.disabled) {
      const y = Number(dayBtn.dataset.y), m = Number(dayBtn.dataset.m), d = Number(dayBtn.dataset.d);
      const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      inputEl.value = formatIsoToUk(iso);
      closePicker();
      inputEl.dispatchEvent(new Event('change'));
    }
  }

  function dateAllowed(iso){
    const minIso = getMinIso(), maxIso = getMaxIso();
    if (minIso && iso < minIso) return false;
    if (maxIso && iso > maxIso) return false;
    return true;
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
      const allowed = dateAllowed(iso);
      grid += `<button type="button" class="day${isSel?' selected':''}" data-y="${year}" data-m="${month0}" data-d="${d}"` +
              ` style="width:2em;height:2em;border:1px solid #ddd;border-radius:4px;${allowed?'background:#fff':'background:#f4f4f4;color:#aaa'}" ${allowed?'':'disabled'}>${d}</button>`;
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
async function listCandidates(){
  window.__listState = window.__listState || {};
  const st = (window.__listState['candidates'] ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });
  const ps = st.pageSize, pg = st.page;
  const qs = new URLSearchParams();
  if (ps !== 'ALL') { qs.set('page', String(pg || 1)); qs.set('page_size', String(ps || 50)); }
  else { qs.set('page', '1'); } // page_size omitted; ALL handled by loader
  const url = qs.toString() ? `/api/candidates?${qs}` : '/api/candidates';
  const r = await authFetch(API(url));
  const rows = toList(r);
  if (ps !== 'ALL') st.hasMore = Array.isArray(rows) && rows.length === Number(ps || 50);
  return rows;
}

async function listClients(){
  window.__listState = window.__listState || {};
  const st = (window.__listState['clients'] ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });
  const ps = st.pageSize, pg = st.page;
  const qs = new URLSearchParams();
  if (ps !== 'ALL') { qs.set('page', String(pg || 1)); qs.set('page_size', String(ps || 50)); }
  else { qs.set('page', '1'); }
  const url = qs.toString() ? `/api/clients?${qs}` : '/api/clients';
  const r = await authFetch(API(url));
  const rows = toList(r);
  if (ps !== 'ALL') st.hasMore = Array.isArray(rows) && rows.length === Number(ps || 50);
  return rows;
}

async function listUmbrellas(){
  window.__listState = window.__listState || {};
  const st = (window.__listState['umbrellas'] ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });
  const ps = st.pageSize, pg = st.page;
  const qs = new URLSearchParams();
  if (ps !== 'ALL') { qs.set('page', String(pg || 1)); qs.set('page_size', String(ps || 50)); }
  else { qs.set('page', '1'); }
  const url = qs.toString() ? `/api/umbrellas?${qs}` : '/api/umbrellas';
  const r = await authFetch(API(url));
  const rows = toList(r);
  if (ps !== 'ALL') st.hasMore = Array.isArray(rows) && rows.length === Number(ps || 50);
  return rows;
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

  // Try to parse a full client row from the response
  try {
    const data = await r.json();
    if (APILOG) console.log('[upsertClient] parsed', data);
    let obj = null;
    if (Array.isArray(data)) obj = data[0] || null;
    else if (data && data.client) obj = data.client;
    else if (data && typeof data === 'object') obj = data;
    if (obj) return obj;
  } catch (_) { /* fall through to Location/GET fallback */ }

  // Fallbacks: try to extract id from Location, then GET the full row (to get cli_ref/name/etc.)
  let clientId = id || null;
  try {
    const loc = r.headers && r.headers.get('Location');
    if (!clientId && loc) {
      const m = loc.match(/\/api\/clients\/([^/?#]+)/i) || loc.match(/\/clients\/([^/?#]+)/i);
      if (m) clientId = m[1];
    }
  } catch (_) {}

  if (clientId) {
    try {
      const rr = await authFetch(API(`/api/clients/${encodeURIComponent(clientId)}`));
      if (rr.ok) {
        const dd = await rr.json().catch(()=> ({}));
        const obj = (dd && dd.client) ? dd.client : dd;
        if (obj && typeof obj === 'object') {
          if (APILOG) console.log('[upsertClient] GET backfill', obj);
          return obj;
        }
      }
    } catch (_) {}
  }

  // Last resort: return what we know
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
// ===== Section loaders =====
async function loadSection(){
  // unified paging entry point
  window.__listState = window.__listState || {};
  const st = (window.__listState[currentSection] ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });

  // choose which loader to use (search vs plain list)
  const useSearch = !!st.filters && (Object.keys(st.filters).length > 0);

  // helper to fetch one page
  const fetchOne = async (section, page, pageSize) => {
    // temporarily push paging into state so builders pick it up
    window.__listState[section].page = page;
    window.__listState[section].pageSize = pageSize;
    if (useSearch) {
      return await search(section, window.__listState[section].filters || {});
    } else {
      switch(section){
        case 'candidates': return await listCandidates();
        case 'clients':    return await listClients();
        case 'umbrellas':  return await listUmbrellas();
        case 'settings':   return await getSettings();
        case 'audit':      return await listOutbox();
        default:           return [];
      }
    }
  };

  // handle ALL with sequential paging (append until exhausted)
  if (st.pageSize === 'ALL') {
    const acc = [];
    let p = 1;
    const chunk = 200; // internal chunk size for ALL
    let gotMore = true;
    while (gotMore) {
      const rows = await fetchOne(currentSection, p, chunk);
      acc.push(...(rows || []));
      gotMore = Array.isArray(rows) && rows.length === chunk;
      p += 1;
      if (!gotMore) break;
    }
    // finalise state for render
    window.__listState[currentSection].page = 1;
    window.__listState[currentSection].hasMore = false;
    window.__listState[currentSection].total = acc.length;
    return acc;
  }

  // normal one-page load
  const page = Number(st.page || 1);
  const ps   = Number(st.pageSize || 50);
  const rows = await fetchOne(currentSection, page, ps);
  const hasMore = Array.isArray(rows) && rows.length === ps;
  window.__listState[currentSection].hasMore = hasMore;
  // total unknown unless backend returns it elsewhere; leave as-is
  return rows;
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
        if (LOG) console.debug('[HTTP] raw body (≤2KB):', raw.slice(0, 2048)); // optional peek
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

  // 3) Render modal
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
      const hasId = !!window.modalCtx.data?.id;
      const same = hasId ? (fs.__forId === window.modalCtx.data.id)
                         : (fs.__forId === window.modalCtx.openToken || fs.__forId == null);
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

      // ===== Validate staged overrides (unchanged logic) =====
      const O = window.modalCtx.overrides || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };

      async function getCoveringDefault(client_id, role, band, date_from) {
        try {
          if (!client_id || !role || !date_from) return null;
          const list = await listClientRates(client_id, { active_on: date_from, only_enabled: true });
          const rows = Array.isArray(list) ? list.filter(w => !w.disabled_at_utc && String(w.role) === String(role)) : [];
          let win = rows.find(w => (w.band ?? null) === (band ?? null));
          if (!win && (band == null)) win = rows.find(w => w.band == null);
          return win || null;
        } catch { return null; }
      }
      const bucketLabel = { day:'Day', night:'Night', sat:'Sat', sun:'Sun', bh:'BH' };
      const erniMult = await (async ()=>{ if (typeof window.__ERNI_MULT__ === 'number') return window.__ERNI_MULT__; try { if (typeof getSettingsCached === 'function') { const s = await getSettingsCached(); let p = s?.erni_pct ?? s?.employers_ni_percent ?? 0; p = Number(p)||0; if (p>1) p=p/100; window.__ERNI_MULT__ = 1 + p; return window.__ERNI_MULT__; } } catch{} window.__ERNI_MULT__ = 1; return 1; })();

      // Validate EDITS
      for (const [editId, patchRaw] of Object.entries(O.stagedEdits || {})) {
        const original = (O.existing || []).find(x => String(x.id) === String(editId));
        if (!original) { alert('Cannot locate original override to validate'); return { ok:false }; }

        const eff = {
          client_id: patchRaw.client_id ?? original.client_id,
          role     : patchRaw.role      ?? original.role,
          band     : (patchRaw.hasOwnProperty('band') ? patchRaw.band : original.band),
          date_from: patchRaw.date_from ?? original.date_from,
          date_to  : patchRaw.hasOwnProperty('date_to') ? patchRaw.date_to : original.date_to,
          rate_type: (patchRaw.rate_type ?? original.rate_type ?? '').toUpperCase(),

          pay_day  : patchRaw.hasOwnProperty('pay_day')   ? patchRaw.pay_day   : original.pay_day,
          pay_night: patchRaw.hasOwnProperty('pay_night') ? patchRaw.pay_night : original.pay_night,
          pay_sat  : patchRaw.hasOwnProperty('pay_sat')   ? patchRaw.pay_sat   : original.pay_sat,
          pay_sun  : patchRaw.hasOwnProperty('pay_sun')   ? patchRaw.pay_sun   : original.pay_sun,
          pay_bh   : patchRaw.hasOwnProperty('pay_bh')    ? patchRaw.pay_bh    : original.pay_bh
        };

        const win = await getCoveringDefault(eff.client_id, eff.role, eff.band, eff.date_from);
        if (!win) { alert(`No active client default covers ${eff.role}${eff.band?` / ${eff.band}`:''} on ${formatIsoToUk(eff.date_from)}.`); return { ok:false }; }
        if (eff.date_to && win.date_to && eff.date_to > win.date_to) { alert(`Client rate ends on ${formatIsoToUk(win.date_to)} — override must end on or before this date.`); return { ok:false }; }

        for (const b of ['day','night','sat','sun','bh']) {
          const pay = eff[`pay_${b}`];
          const chg = win[`charge_${b}`];
          if (pay != null && chg == null) { alert(`No client charge for ${bucketLabel[b]} on ${formatIsoToUk(eff.date_from)}.`); return { ok:false }; }
          if (pay != null && chg != null) {
            const margin = (eff.rate_type==='PAYE') ? (chg - (pay * erniMult)) : (chg - pay);
            if (margin < 0) { alert(`Margin would be negative for ${bucketLabel[b]}.`); return { ok:false }; }
          }
        }
      }

      // Validate NEW rows
      for (const nv of (O.stagedNew || [])) {
        const win = await getCoveringDefault(nv.client_id, nv.role, nv.band ?? null, nv.date_from);
        if (!win) { alert(`No active client default covers ${nv.role}${nv.band?` / ${nv.band}`:''} on ${formatIsoToUk(nv.date_from)}.`); return { ok:false }; }
        if (nv.date_to && win.date_to && nv.date_to > win.date_to) { alert(`Client rate ends on ${formatIsoToUk(win.date_to)} — override must end on or before this date.`); return { ok:false }; }
        for (const b of ['day','night','sat','sun','bh']) {
          const pay = nv[`pay_${b}`]; const chg = win[`charge_${b}`];
          if (pay != null && chg == null) { alert(`No client charge for ${bucketLabel[b]} on ${formatIsoToUk(nv.date_from)}.`); return { ok:false }; }
          if (pay != null && chg != null) {
            const margin = (String(nv.rate_type).toUpperCase()==='PAYE') ? (chg - (pay * erniMult)) : (chg - pay);
            if (margin < 0) { alert(`Margin would be negative for ${bucketLabel[b]}.`); return { ok:false }; }
          }
        }
      }

      // ===== Persist staged overrides (DELETE uses routed path with candidate_id) =====
      const OX = window.modalCtx.overrides || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };
      L('[onSave] overrides', { deletes: Array.from(OX.stagedDeletes||[]), edits: Object.keys(OX.stagedEdits||{}), newCount: (OX.stagedNew||[]).length });

      // Deletes — preferred by id; fallback to legacy filter keys
      for (const delId of OX.stagedDeletes || []) {
        const row = (OX.existing || []).find(r => String(r.id) === String(delId));
        if (!row) continue;

        const q = new URLSearchParams();
        if (row.id) q.set('id', String(row.id));
        else {
          if (row.client_id) q.set('client_id', String(row.client_id));
          if (row.role != null) q.set('role', String(row.role));
          q.set('band', (row.band == null || row.band === '') ? '' : String(row.band)); // backend treats '' as NULL
          if (row.rate_type) q.set('rate_type', String(row.rate_type).toUpperCase());
          if (row.date_from) q.set('date_from', String(row.date_from));
        }

        const url = API(`/api/rates/candidate-overrides/${encodeURIComponent(candidateId)}?${q.toString()}`);
        L('[onSave][DELETE override]', url);
        const res = await authFetch(url, { method: 'DELETE' });
        if (!res.ok) {
          const msg = await res.text().catch(()=> 'Delete override failed');
          alert(msg);
          return { ok:false };
        }
      }

      // Edits — PATCH candidate_id in path + ORIGINAL keys in query, updates in body
      for (const [editId, patchRaw] of Object.entries(OX.stagedEdits || {})) {
        const original = (OX.existing || []).find(x => String(x.id) === String(editId));
        if (!original) { alert('Cannot locate original override to patch'); return { ok:false }; }

        const q = new URLSearchParams();
        if (original.client_id) q.set('client_id', original.client_id);
        if (original.role != null) q.set('role', String(original.role));
        q.set('band', (original.band == null || original.band === '') ? '' : String(original.band));
        if (original.rate_type) q.set('rate_type', String(original.rate_type).toUpperCase());

        const body = {};
        for (const [k,v] of Object.entries(patchRaw || {})) {
          if (v === '' || v === undefined) continue;
          body[k] = v;
        }
        body.candidate_id = candidateId;

        const url = API(`/api/rates/candidate-overrides/${encodeURIComponent(candidateId)}?${q.toString()}`);
        L('[onSave][PATCH override]', { url, body });
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

      // Creates
      for (const nv of (OX.stagedNew || [])) {
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
          window.modalCtx.overrides.stagedNew = [];   // ← keep as array
          if (window.modalCtx.overrides.stagedDeletes?.clear) window.modalCtx.overrides.stagedDeletes.clear();
          // Render rates ONLY if the Rates tab is active
          const fr1 = window.__getModalFrame?.();
          if (fr1 && fr1.entity === 'candidates' && fr1.currentTabKey === 'rates') {
            await renderCandidateRatesTable();
          }
        }
      } catch (e) {
        W('post-save rates refresh failed', e);
      }

      // Keep open; flip to view mode via showModal logic
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
        // Render rates ONLY if the Rates tab is active
        const fr2 = window.__getModalFrame?.();
        if (fr2 && fr2.entity === 'candidates' && fr2.currentTabKey === 'rates') {
          await renderCandidateRatesTable();
        }
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


async function renderCandidateRatesTable() {
  const LOG = !!window.__LOG_RATES;

  // Safety net: auto-create #ratesTable if missing
  let div = byId('ratesTable');
  if (!div) {
    const host = byId('modalBody');
    if (host) {
      div = document.createElement('div');
      div.id = 'ratesTable';
      host.appendChild(div);
      if (LOG) console.warn('[RATES][TABLE] created missing #ratesTable');
    } else {
      if (LOG) console.warn('[RATES][TABLE] no #ratesTable and no #modalBody; abort');
      return;
    }
  }

  const frame = _currentFrame();
  const parentEditable = frame && (frame.mode === 'edit' || frame.mode === 'create');
  if (LOG) console.log('[RATES][TABLE] parentEditable?', parentEditable, 'mode:', frame?.mode);

  // Resolve client names
  let clientsById = {};
  try {
    const clients = await listClientsBasic();
    clientsById = Object.fromEntries((clients || []).map(c => [c.id, c.name]));
  } catch (e) { console.error('[RATES][TABLE] load clients failed', e); }

  const O = (window.modalCtx.overrides ||= { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });

  if (LOG) console.log('[RATES][TABLE snapshot]', {
    existing: (O.existing||[]).length,
    stagedNew: (O.stagedNew||[]).length,
    stagedEdits: Object.keys(O.stagedEdits||{}).length,
    stagedDeletes: (O.stagedDeletes && O.stagedDeletes.size) || 0,
    peekExisting: (O.existing||[])[0],
    peekNew: (O.stagedNew||[])[0]
  });

  // Merge view
  const pendingDeleteIds = (O.stagedDeletes instanceof Set) ? O.stagedDeletes : new Set();

  const rows = [];
  for (const ex of (O.existing || [])) {
    const isPendingDelete = !!(pendingDeleteIds && ex && pendingDeleteIds.has(ex.id));
    rows.push({
      ...ex,
      ...(O.stagedEdits?.[ex.id] || {}),
      _edited: !!O.stagedEdits?.[ex.id],
      _pendingDelete: isPendingDelete
    });
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
    const addBtn = byId('btnAddRate'); if (addBtn && parentEditable) addBtn.onclick = () => openCandidateRateModal(window.modalCtx.data?.id);
    if (LOG) console.log('[RATES][TABLE] rendered empty view');
    return;
  }

  const fmt = v => (v==null || Number.isNaN(v)) ? '—' : (Math.round(v*100)/100).toFixed(2);
  const mult = await (async ()=>{ if (typeof window.__ERNI_MULT__ === 'number') return window.__ERNI_MULT__; try { if (typeof getSettingsCached === 'function') { const s = await getSettingsCached(); let p = s?.erni_pct ?? s?.employers_ni_percent ?? 0; p = Number(p)||0; if (p>1) p=p/100; window.__ERNI_MULT__ = 1 + p; return window.__ERNI_MULT__; } } catch{} window.__ERNI_MULT__ = 1; return 1; })();

  const keyOf = r => [r.client_id, r.role || '', (r.band==null?'':String(r.band)), r.date_from || ''].join('|');
  const uniqueKeys = Array.from(new Set(rows.map(keyOf)));
  const chargeMap = Object.create(null);

  async function loadChargesForKey(key){
    const [client_id, role, bandKey, date_from] = key.split('|');
    const band = (bandKey === '' ? null : bandKey);
    if (!client_id || !role || !date_from) return null;
    try {
      const list = await listClientRates(client_id, { active_on: date_from, only_enabled: true });
      const filtered = Array.isArray(list) ? list.filter(w=>!w.disabled_at_utc && w.role===role) : [];
      let win = filtered.find(w => (w.band ?? null) === (band ?? null));
      if (!win && (band == null)) win = filtered.find(w => w.band == null);
      return win ? { day: win.charge_day ?? null, night: win.charge_night ?? null, sat: win.charge_sat ?? null, sun: win.charge_sun ?? null, bh: win.charge_bh ?? null } : null;
    } catch(e){ return null; }
  }
  await Promise.all(uniqueKeys.map(async k => { chargeMap[k] = await loadChargesForKey(k); }));

  // === NEW: check whether a covering client default exists TODAY (Europe/London), per (client,role,band)
  const todayIso = (() => {
    try {
      const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
      const [dd, mm, yyyy] = s.split('/');
      return `${yyyy}-${mm}-${dd}`;
    } catch { // fallback
      const d = new Date(); const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${day}`;
    }
  })();
  const todayKeyOf = r => [r.client_id, r.role || '', (r.band==null?'':String(r.band))].join('|');
  const todayKeys = Array.from(new Set(rows.map(todayKeyOf)));
  const coverTodayMap = Object.create(null);
  async function loadCoverTodayForKey(key){
    const [client_id, role, bandKey] = key.split('|');
    const band = (bandKey === '' ? null : bandKey);
    if (!client_id || !role) return false;
    try {
      const list = await listClientRates(client_id, { active_on: todayIso, only_enabled: true });
      const filtered = Array.isArray(list) ? list.filter(w=>!w.disabled_at_utc && w.role===role) : [];
      let win = filtered.find(w => (w.band ?? null) === (band ?? null));
      if (!win && (band == null)) win = filtered.find(w => w.band == null);
      return !!win;
    } catch(e){ return false; }
  }
  await Promise.all(todayKeys.map(async k => { coverTodayMap[k] = await loadCoverTodayForKey(k); }));

  const cols    = ['client','role','band','rate_type','pay_day','pay_night','pay_sat','pay_sun','pay_bh','margin_day','margin_night','margin_sat','margin_sun','margin_bh','date_from','date_to','_state'];
  const headers = ['Client','Role','Band','Type','Pay Day','Pay Night','Pay Sat','Pay Sun','Pay BH','Margin Day','Margin Night','Margin Sat','Margin Sun','Margin BH','From','To','Status'];

  const tbl = document.createElement('table'); tbl.className = 'grid';
  const thead = document.createElement('thead'); const trh = document.createElement('tr');
  headers.forEach(h => { const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); });
  thead.appendChild(trh); tbl.appendChild(thead);

  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    if (parentEditable) tr.ondblclick = () => openCandidateRateModal(window.modalCtx.data?.id, r);

    const charges = chargeMap[keyOf(r)] || null;
    const isPAYE = String(r.rate_type || '').toUpperCase() === 'PAYE';

    const margin = {};
    ['day','night','sat','sun','bh'].forEach(b=>{
      const pay = r[`pay_${b}`]; const chg = charges ? charges[b] : null;
      margin[b] = (chg!=null && pay!=null) ? (isPAYE ? (chg - (pay * mult)) : (chg - pay)) : null;
    });

    let status =
      r._pendingDelete ? 'Pending delete (save to confirm)' :
      r._isNew        ? 'Staged (new)' :
      r._edited       ? 'Staged (edited)' : '';

    // Determine stale/orphan: (a) no covering client rate at override start OR (b) no covering client rate today
    const hasCoverAtStart = !!charges;
    const hasCoverToday = !!coverTodayMap[todayKeyOf(r)];
    const isStaleOrphan = (!hasCoverAtStart) || (!hasCoverToday);
    if (isStaleOrphan) status = 'Client rate no longer exists';

    // pay columns to 2dp
    const to2 = (v) => (v==null ? '—' : fmt(Number(v)));

    const pretty = {
      client: clientsById[r.client_id] || '', role: r.role || '', band: r.band ?? '', rate_type: r.rate_type || '',
      pay_day: to2(r.pay_day), pay_night: to2(r.pay_night), pay_sat: to2(r.pay_sat), pay_sun: to2(r.pay_sun), pay_bh: to2(r.pay_bh),
      margin_day: fmt(margin.day), margin_night: fmt(margin.night), margin_sat: fmt(margin.sat), margin_sun: fmt(margin.sun), margin_bh: fmt(margin.bh),
      date_from: formatDisplayValue('date_from', r.date_from), date_to: formatDisplayValue('date_to', r.date_to),
      _state   : status
    };

    cols.forEach(c => { const td=document.createElement('td'); td.textContent=String(pretty[c] ?? ''); tr.appendChild(td); });

    // Shade & disable open if stale/orphan
    if (isStaleOrphan) {
      tr.style.opacity = '.55';
      tr.style.cursor = 'not-allowed';
      tr.ondblclick = null;
    }

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

  if (LOG) console.log('[RATES][TABLE rendered]', { rows: rows.length, firstState: rows[0]?._state || '(none)' });
}




// Replaces your current function
// =================== renderCandidateRatesTable (FIXED) ===================
// =================== CANDIDATE RATES TABLE (UPDATED) ===================
// ✅ UPDATED — renders from modalCtx.overrides (existing ⊕ staged edits/new ⊖ staged deletes)

// ==================================
// 2) renderCandidateRatesTable(...)
// ==================================
// Now computes margins for each override row by resolving client charges at date_from (memoized per render)



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
        <!-- IMPORTANT: leave value empty so clicking shows ALL options.
             The little UX hook below clears any residual value on focus/click to avoid filtered lists. -->
        <input id="umbrella_name"
               list="umbList"
               placeholder="Type to search umbrellas…"
               value=""
               autocomplete="off"
               onclick="if (this.value) { this.dataset.prev=this.value; this.value=''; this.dispatchEvent(new Event('input',{bubbles:true})); }"
               onfocus="if (this.value) { this.dataset.prev=this.value; this.value=''; this.dispatchEvent(new Event('input',{bubbles:true})); }" />
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

// === UPDATED: Candidate Rate Override modal (Client→Role gated; bands; UK dates; date_to) ===
// ====================== openCandidateRateModal (FIXED) ======================
// =================== CANDIDATE OVERRIDE MODAL (UPDATED) ===================
// ==== CHILD MODAL (CANDIDATE RATE) — throw on errors; return true on success ====
// ✅ UPDATED — Apply (stage), gate against client defaults active at date_from,
//    auto-truncate incumbent of same rate_type at N−1 (staged), NO persistence here
async function mountCandidateRatesTab() {
  const LOG = !!window.__LOG_RATES;
  const token = window.modalCtx.openToken;
  const id    = window.modalCtx.data?.id || null;
  if (LOG) console.log('[RATES][mountCandidateRatesTab] ENTRY', { token, id });

  // Ensure a host exists (only on Rates tab; this function is called from showModal setTab('rates'))
  const host = byId('modalBody');
  if (host && !byId('ratesTable')) {
    const c = document.createElement('div');
    c.id = 'ratesTable';
    host.appendChild(c);
    if (LOG) console.log('[RATES][mountCandidateRatesTab] injected #ratesTable host');
  }

  // CREATE flow
  if (!id) {
    window.modalCtx.overrides = window.modalCtx.overrides || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };
    await renderCandidateRatesTable();
    if (LOG) console.log('[RATES][mountCandidateRatesTab] create-flow render (no id)');

    const btn = byId('btnAddRate');
    const frame = _currentFrame();
    if (btn && frame && (frame.mode === 'edit' || frame.mode === 'create')) btn.onclick = () => openCandidateRateModal(window.modalCtx.data?.id);
    return;
  }

  // EDIT flow — refresh ONLY existing; preserve stagedNew/Edits/Deletes
  const rates = await listCandidateRates(id);
  if (token !== window.modalCtx.openToken || window.modalCtx.data?.id !== id) {
    if (LOG) console.warn('[RATES][mountCandidateRatesTab] token/id changed mid-flight');
    return;
  }

  const O = window.modalCtx.overrides || (window.modalCtx.overrides = { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });
  if (Array.isArray(rates)) O.existing = rates.slice();

  await renderCandidateRatesTable();
  if (LOG) console.log('[RATES][mountCandidateRatesTab] renderCandidateRatesTable() called');

  const btn = byId('btnAddRate');
  const frame = _currentFrame();
  if (btn && frame && (frame.mode === 'edit' || frame.mode === 'create')) btn.onclick = () => openCandidateRateModal(window.modalCtx.data?.id);
}

// ==============================
// 1) openCandidateRateModal(...)
// ==============================
// ========== CANDIDATE OVERRIDES ==========
// ========== CHILD MODAL (CANDIDATE OVERRIDE) WITH HEAVY LOGGING ==========


// ========== PARENT TABLE RENDER (WITH LOUD LOGS + SAFETY NET) ==========

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

async function openCandidateRateModal(candidate_id, existing) {
  const LOG = !!window.__LOG_RATES;
  const LOG_APPLY = (typeof window.__LOG_APPLY === 'boolean') ? window.__LOG_APPLY : LOG;
  const L  = (...a)=> { if (LOG) console.log('[RATES][openCandidateRateModal]', ...a); };
  const LG = (label, obj)=> { if (LOG) { console.groupCollapsed(`[RATES][openCandidateRateModal] ${label}`); console.log(obj); console.groupEnd(); } };

  L('ENTRY', { candidate_id, hasExisting: !!existing });

  const parentFrame   = _currentFrame();
  const parentEditable= parentFrame && (parentFrame.mode === 'edit' || parentFrame.mode === 'create');
  L('parent frame', { editable: !!parentEditable, mode: parentFrame?.mode });

  // ===== load clients =====
  const clients = await listClientsBasic().catch(e=>{ L('listClientsBasic failed', e); return []; });
  L('clients loaded', clients?.length || 0);
  const clientOptions = (clients||[]).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const initialClientId = existing?.client_id || '';

  const defaultRateType = existing?.rate_type
    ? String(existing.rate_type).toUpperCase()
    : String(window.modalCtx?.data?.pay_method || 'PAYE').toUpperCase();

  const bucketLabel = { day:'Day', night:'Night', sat:'Sat', sun:'Sun', bh:'BH' };

  // ===== FORM =====
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

      <div class="row" id="cr_band_row">
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
        <div class="hint field-hint err" id="cr_date_to_err" style="display:none"></div>
      </div>

      ${['day','night','sat','sun','bh'].map(b => `
        <div class="row" data-bucket="${b}">
          <label>Pay (${b.toUpperCase()})</label>
          <div class="slot" id="slot_${b}">
            <div class="slot-input" id="slot_input_${b}" style="display:none">
              <input type="number" step="0.01" name="pay_${b}" id="pay_${b}"/>
            </div>
            <div class="slot-ph" id="slot_ph_${b}" style="opacity:.75">Not in client rate</div>
          </div>
        </div>`).join('')}

      <div class="row" style="grid-column:1 / -1; margin-top:10px">
        <table class="grid" id="cr_margins_tbl" style="width:100%">
          <thead><tr><th>Bucket</th><th>Margin</th><th class="hint">Uses client charge at start date</th></tr></thead>
          <tbody>
            ${['day','night','sat','sun','bh'].map(b=>`
              <tr><td>${b.toUpperCase()}</td><td><span id="cr_m_${b}">—</span></td><td></td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div id="cr_err_panel" style="grid-column:1/-1; margin-top:10px; display:none; border:1px solid #7f1d1d; background:rgba(239,68,68,.08); color:#fecaca; padding:10px; border-radius:8px"></div>
    </div>
  `);

  // ===== helpers =====
  async function _erniMultiplier(){
    if (typeof window.__ERNI_MULT__ === 'number') return window.__ERNI_MULT__;
    try {
      if (typeof getSettingsCached === 'function') {
        const s = await getSettingsCached();
        let p = s?.erni_pct ?? s?.employers_ni_percent ?? 0;
        p = Number(p) || 0;
        if (p > 1) p = p / 100;
        window.__ERNI_MULT__ = 1 + p;
        return window.__ERNI_MULT__;
      }
    } catch {}
    window.__ERNI_MULT__ = 1;
    return 1;
  }
  function numOrNull(v){ if (v===undefined||v===null) return null; if (typeof v === 'string' && v.trim()==='') return null; const n=Number(v); return Number.isFinite(n) ? n : null; }
  const fmt = v => (v==null || Number.isNaN(v)) ? '—' : (Math.round(v*100)/100).toFixed(2);
  function showInlineError(html){ const p = byId('cr_err_panel'); if (!p) return; if (html && String(html).trim() !== '') { p.innerHTML = html; p.style.display = ''; } else { p.innerHTML = ''; p.style.display = 'none'; } }
  function setFieldError(bucket,msg){
    const rowInput = document.querySelector(`#candRateForm input[name="pay_${bucket}"]`);
    if (!rowInput) return;
    let hint = rowInput.parentElement?.querySelector?.(`.field-hint.err[data-bucket="${bucket}"]`);
    if (msg) {
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'hint field-hint err';
        hint.setAttribute('data-bucket', bucket);
        rowInput.parentElement.appendChild(hint);
      }
      hint.textContent = msg;
    } else if (hint) hint.remove();
  }
  function setDateToError(msg){ const el = byId('cr_date_to_err'); if (!el) return; if (msg) { el.textContent = msg; el.style.display = ''; } else { el.textContent = ''; el.style.display = 'none'; } }
  function clearAllFieldErrors(){ document.querySelectorAll('#candRateForm .field-hint.err').forEach(el=>el.remove()); setDateToError(''); }

  async function resolveCoveringWindow(client_id, role, band, active_on){
    try {
      const list = await listClientRates(client_id, { active_on, only_enabled: true });
      const rows = Array.isArray(list) ? list.filter(w => !w.disabled_at_utc && w.role === role) : [];
      let win = rows.find(w => (w.band ?? null) === (band ?? null));
      if (!win && (band == null)) win = rows.find(w => w.band == null);
      return win ? {
        charges: { day:win.charge_day??null, night:win.charge_night??null, sat:win.charge_sat??null, sun:win.charge_sun??null, bh:win.charge_bh??null },
        capIso: win.date_to || null
      } : null;
    } catch(e){ L('resolveCoveringWindow err', e); return null; }
  }

  let lastApplyState = null;
  function setApplyEnabled(enabled, reasonSummary){
    try {
      const btn = document.querySelector('#btnSave, #modal .actions .primary, #modal .btn-save, .modal .btn-save');
      if (btn) { btn.disabled = !enabled; btn.classList.toggle('disabled', !enabled); }
    } catch {}
    if (LOG_APPLY && lastApplyState !== enabled) {
      console.log('[RATES][APPLY] state →', enabled ? 'ENABLED' : 'DISABLED', reasonSummary || '');
      lastApplyState = enabled;
    }
    try { window.dispatchEvent(new CustomEvent('modal-apply-enabled', { detail:{ enabled } })); } catch {}
  }

  // ===== driver: recompute state (validations + overlap + preview) =====
  async function recomputeOverrideState(){
    const clientId = byId('cr_client_id')?.value || '';
       const role     = byId('cr_role')?.value || '';
    const bandSel  = byId('cr_band')?.value ?? '';
    const band     = (bandSel === '' ? null : bandSel);
    const isoFrom  = parseUkDateToIso(byId('cr_date_from')?.value || '');
    const isoTo    = parseUkDateToIso(byId('cr_date_to')?.value || '');
    const rateType = String(byId('cr_rate_type')?.value || '').toUpperCase();

    const buckets = ['day','night','sat','sun','bh'];
    const inputEl = (b)=> document.querySelector(`#candRateForm input[name="pay_${b}"]`);
    const slotIn  = (b)=> byId(`slot_input_${b}`);
    const slotPh  = (b)=> byId(`slot_ph_${b}`);

    showInlineError(''); clearAllFieldErrors();
    let canApply = true;

    const need = [];
    if (!clientId) need.push('clientId');
    if (!rateType) need.push('rateType');
    if (!role)     need.push('role');
    if (!isoFrom)  need.push('date_from');
    if (need.length) {
      buckets.forEach(b => {
        const inp = inputEl(b);
        if (inp) { inp.disabled = true; }
        if (slotIn(b)) slotIn(b).style.display = 'none';
        if (slotPh(b)) slotPh(b).style.display = '';
        const sp = byId(`cr_m_${b}`); if (sp) sp.textContent = '—';
      });
      setApplyEnabled(false, 'not_ready');
      return;
    }

    const win = await resolveCoveringWindow(clientId, role, band, isoFrom);
    if (!win) {
      buckets.forEach(b => {
        const inp = inputEl(b);
        if (inp) { inp.disabled = true; }
        if (slotIn(b)) slotIn(b).style.display = 'none';
        if (slotPh(b)) slotPh(b).style.display = '';
        const sp = byId(`cr_m_${b}`); if (sp) sp.textContent = '—';
      });
      showInlineError(`No active client default for <b>${escapeHtml(role)}</b>${band?` / <b>${escapeHtml(band)}</b>`:''} on <b>${formatIsoToUk(isoFrom)}</b>.`);
      setApplyEnabled(false, 'no_cover');
      return;
    }

    buckets.forEach(b => {
      const hasCharge = (win.charges[b] != null);
      const inp = inputEl(b);
      if (hasCharge) {
        if (slotPh(b)) slotPh(b).style.display = 'none';
        if (slotIn(b)) slotIn(b).style.display = '';
        if (inp) inp.disabled = false;
      } else {
        if (slotIn(b)) slotIn(b).style.display = 'none';
        if (slotPh(b)) slotPh(b).style.display = '';
        if (inp) { inp.value = ''; inp.disabled = true; }
      }
    });

    const mult = await _erniMultiplier();

    const invalid = [];
    buckets.forEach(b => {
      const el  = inputEl(b), chg = win.charges[b];
      if (!el || el.disabled) return;
      const pay = numOrNull(el.value);
      if (pay != null && chg == null) { invalid.push(b); setFieldError(b, `No client charge for ${bucketLabel[b]}.`); }
    });
    if (invalid.length) canApply = false;

    const neg = [];
    buckets.forEach(b => {
      const el  = inputEl(b), chg = win.charges[b];
      if (!el || el.disabled) return;
      const pay = numOrNull(el.value);
      if (pay == null || chg == null) return;
      const m = (rateType === 'PAYE') ? (chg - (pay * mult)) : (chg - pay);
      if (m < 0) { neg.push(b); setFieldError(b, `Margin would be negative for ${bucketLabel[b]}.`); }
    });
    if (neg.length) canApply = false;

    setDateToError('');
    if (isoTo && win.capIso && isoTo > win.capIso) {
      setDateToError(`Client rate ends on ${formatIsoToUk(win.capIso)} — override must end on/before this date.`);
      canApply = false;
    }

    const O = window.modalCtx.overrides || { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() };
    const deletedIds = O.stagedDeletes || new Set();
    const unify = [];
    (O.existing||[]).forEach(ex => { if (!deletedIds.has(ex.id)) unify.push({ ...(ex||{}), ...(O.stagedEdits?.[ex.id]||{}) }); });
    (O.stagedNew||[]).forEach(n => unify.push({ ...(n||{}) }));

    const sameKey = (o) =>
      String(o.client_id||'') === clientId &&
      String(o.role||'')      === role &&
      String((o.rate_type||'').toUpperCase()) === rateType &&
      String(o.band??'')      === String(band??'');

    const isSelf = (o) => {
      if (!existing) return false;
      if (existing.id && o.id) return String(o.id) === String(existing.id);
      if (existing._tmpId && o._tmpId) return String(o._tmpId) === String(existing._tmpId);
      return false;
    };

    const conflicts = unify.filter(o => sameKey(o) && !isSelf(o) &&
      !((o.date_to||'9999-12-31') < (isoFrom||'0000-01-01') || (isoTo||'9999-12-31') < (o.date_from||'0000-01-01')));

    if (conflicts.length) {
      canApply = false;
      const ov = conflicts[0];
      const cutThis  = (()=>{ const d=new Date((ov.date_from||'')+'T00:00:00Z'); if(!isNaN(d)) d.setUTCDate(d.getUTCDate()-1); return isNaN(d)?null:`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; })();
      const cutOther = (()=>{ const d=new Date((isoFrom||'')+'T00:00:00Z'); if(!isNaN(d)) d.setUTCDate(d.getUTCDate()-1); return isNaN(d)?null:`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; })();

      let fixButtons = '';
      if (cutThis)  fixButtons += `<button id="cr_fix_this"  class="btn" style="margin-right:8px">Fix: Shorten <b>THIS</b> to ${formatIsoToUk(cutThis)}</button>`;
      if (cutOther) fixButtons += `<button id="cr_fix_other" class="btn">Fix: Shorten <b>OTHER</b> to ${formatIsoToUk(cutOther)}</button>`;

      showInlineError(`
        <div style="font-weight:700;margin-bottom:6px">Overlap detected</div>
        <div style="margin-bottom:8px">Another rate card exists in this category.<br/><span class="hint">Use Fix or adjust dates.</span></div>
        <div>${fixButtons || '<i>No safe automatic fix available.</i>'}</div>
      `);

      setTimeout(()=> {
        const inTo = byId('cr_date_to');
        const fixThis = byId('cr_fix_this');
        if (fixThis && cutThis) fixThis.onclick = ()=> { inTo.value = formatIsoToUk(cutThis); recomputeOverrideState(); };
        const fixOther = byId('cr_fix_other');
        if (fixOther && cutOther) fixOther.onclick = ()=> {
          try {
            const target = conflicts[0];
            if (target.id) {
              O.stagedEdits[target.id] = { ...(O.stagedEdits[target.id]||{}), date_to: cutOther };
            } else if (target._tmpId) {
              const ix = (O.stagedNew||[]).findIndex(r=>r._tmpId===target._tmpId);
              if (ix>=0) O.stagedNew[ix] = { ...O.stagedNew[ix], date_to: cutOther };
            }
            renderCandidateRatesTable();
            recomputeOverrideState();
          } catch(e){ L('fixOther failed', e); }
        };
      }, 0);
    }

    // Preview margins (never NaN)
    buckets.forEach(b => {
      const sp  = byId(`cr_m_${b}`), el = inputEl(b), chg = win.charges[b];
      const pay = (el && !el.disabled) ? numOrNull(el.value) : null;
      const m   = (chg != null && pay != null) ? ((rateType === 'PAYE') ? (chg - (pay * mult)) : (chg - pay)) : null;
      if (sp) sp.textContent = (m==null ? '—' : fmt(m));
    });

    if (LOG_APPLY) console.log('[RATES][APPLY] canApply?', canApply, { clientId, role, band, isoFrom, isoTo, rateType });
    setApplyEnabled(canApply, canApply ? 'ok' : 'violations');
  }

  showModal(
    existing ? 'Edit Candidate Rate Override' : 'Add Candidate Rate Override',
    [{ key:'form', label:'Form' }],
    () => formHtml,
    async () => {
      await recomputeOverrideState();
      if (lastApplyState === false) { L('Apply blocked by recompute'); return false; }

      const raw = collectForm('#candRateForm');
      LG('Apply collected form', raw);

      const client_id = (raw.client_id || '').trim();
      const role      = (raw.role || '').trim();
      const band      = (raw.band || '').trim() || null;
      const rate_type = String(raw.rate_type || '').toUpperCase();

      const date_from = parseUkDateToIso(raw.date_from);
      const date_to   = raw.date_to ? parseUkDateToIso(raw.date_to) : null;

      const mapPay = (k) => (Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== '' ? Number(raw[k]) : null);

      const stagedAll = {
        id: existing?.id,
        candidate_id,
        client_id,
        role, band, rate_type,
        date_from, date_to,
        pay_day   : mapPay('pay_day'),
        pay_night : mapPay('pay_night'),
        pay_sat   : mapPay('pay_sat'),
        pay_sun   : mapPay('pay_sun'),
        pay_bh    : mapPay('pay_bh')
      };

      const O = (window.modalCtx.overrides ||= { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });
      LG('STAGING before', { existing: (O.existing||[]).length, stagedNew:(O.stagedNew||[]).length, stagedEdits:Object.keys(O.stagedEdits||{}).length, stagedDeletes: O.stagedDeletes?.size || 0 });

      if (existing?.id) {
        O.stagedEdits[existing.id] = { ...(O.stagedEdits[existing.id]||{}), ...stagedAll };
      } else if (existing && !existing.id) {
        const tmpId = existing._tmpId || null;
        const idx   = tmpId ? (O.stagedNew||[]).findIndex(r => r._tmpId === tmpId) : -1;
        if (idx >= 0) O.stagedNew[idx] = { ...O.stagedNew[idx], ...stagedAll, _tmpId: tmpId };
        else          O.stagedNew.push({ ...stagedAll, _tmpId: tmpId || `tmp_${Date.now()}` });
      } else {
        O.stagedNew.push({ ...stagedAll, _tmpId: `tmp_${Date.now()}` });
      }

      LG('STAGING after', {
        existing: (O.existing||[]).length,
        stagedNew:(O.stagedNew||[]).length,
        stagedEdits:Object.keys(O.stagedEdits||{}).length,
        stagedDeletes: O.stagedDeletes?.size || 0,
        peekNew: (O.stagedNew||[])[(O.stagedNew||[]).length-1]
      });

      try { await renderCandidateRatesTable(); } catch {}
      try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
      return true;
    },
    false,
    () => {
      const parent = _currentFrame();
      if (parent) { parent.currentTabKey = 'rates'; parent.setTab('rates'); }
    },
    { kind: 'candidate-override' }
  );

  // ===== prefill & wire =====
  const selClient = byId('cr_client_id');
  const selRateT  = byId('cr_rate_type');
  const selRole   = byId('cr_role');
  const selBand   = byId('cr_band');
  const inFrom    = byId('cr_date_from');
  const inTo      = byId('cr_date_to');

  if (initialClientId) selClient.value = initialClientId;
  if (existing?.date_from) inFrom.value = formatIsoToUk(existing.date_from);
  if (existing?.date_to)   inTo.value   = formatIsoToUk(existing.date_to);

  // Prefill ALL buckets that have values (2dp)
  ['day','night','sat','sun','bh'].forEach(b=>{
    const val = (existing && Number.isFinite(existing[`pay_${b}`])) ? existing[`pay_${b}`] : null;
    const el  = document.querySelector(`#candRateForm input[name="pay_${b}"]`);
    if (el && val != null) {
      const num = Number(val);
      el.value = Number.isFinite(num) ? (Math.round(num*100)/100).toFixed(2) : String(val);
    }
  });

  attachUkDatePicker(inFrom); attachUkDatePicker(inTo);

  async function refreshClientRoles(clientId) {
    selRole.innerHTML = `<option value="">Select role…</option>`; selRole.disabled = true;
    selBand.innerHTML = `<option value=""></option>`;             selBand.disabled  = true;

    if (!clientId) { setApplyEnabled(false, 'no_client'); return; }

    const active_on = parseUkDateToIso(inFrom.value || '') || null;
    const list  = await listClientRates(clientId, { active_on, only_enabled: true }).catch(_=>[]);
    const wins  = (Array.isArray(list) ? list.filter(w => !w.disabled_at_utc) : []);
    const roles = new Set(); const bandsByRole = {};
    wins.forEach(w => { if (!w.role) return; roles.add(w.role); (bandsByRole[w.role] ||= new Set()).add(w.band==null ? '' : String(w.band)); });

    const allowed = [...roles].sort((a,b)=> a.localeCompare(b));
    selRole.innerHTML = `<option value="">Select role…</option>` + allowed.map(code => `<option value="${code}">${code}</option>`).join('');
    selRole.disabled = !parentEditable;

    if (existing?.role) {
      selRole.value = existing.role;
      const bandSet = [...(bandsByRole[existing.role] || new Set())];
      const hasNull = bandSet.includes('');
      selBand.innerHTML =
        (hasNull ? `<option value="">(none)</option>` : '') +
        bandSet.filter(b=>b!=='').sort((a,b)=> String(a).localeCompare(String(b)))
               .map(b => `<option value="${b}">${b}</option>`).join('');
      selBand.disabled = !parentEditable;
      if (existing?.band != null) selBand.value = String(existing.band);
    } else {
      selBand.innerHTML = `<option value=""></option>`;
      selBand.disabled  = true;
    }

    await recomputeOverrideState();
  }

  selClient.addEventListener('change', async () => { L('[EVENT] client change'); if (parentEditable) await refreshClientRoles(selClient.value); });
  selRateT .addEventListener('change',        () => { L('[EVENT] rate_type change'); if (parentEditable) recomputeOverrideState(); });
  inFrom   .addEventListener('change',  async () => { L('[EVENT] date_from change'); if (parentEditable) await refreshClientRoles(selClient.value); });
  selRole  .addEventListener('change',  async () => { L('[EVENT] role change'); if (parentEditable) await recomputeOverrideState(); });
  selBand  .addEventListener('change',        () => { L('[EVENT] band change'); if (parentEditable) recomputeOverrideState(); });
  ['pay_day','pay_night','pay_sat','pay_sun','pay_bh'].forEach(n=>{
    const el = document.querySelector(`#candRateForm input[name="${n}"]`);
    if (el) el.addEventListener('input', () => { if (LOG_APPLY) console.log('[RATES][EVENT] pay change', n, el.value); recomputeOverrideState(); });
  });

  await recomputeOverrideState();
  if (initialClientId) { await refreshClientRoles(initialClientId); }

  (function wireDeleteButton(){
    const delBtn = byId('btnDelete');
    if (!delBtn) return;
    if (!existing || !existing.id) { delBtn.style.display='none'; return; }
    delBtn.style.display = '';
    delBtn.disabled = false;
    delBtn.onclick = () => {
      try {
        const O = (window.modalCtx.overrides ||= { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });
        (O.stagedDeletes ||= new Set()).add(existing.id);
        L('staged delete', { id: existing.id, size: O.stagedDeletes.size });
        try { renderCandidateRatesTable(); } catch {}
        try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
        const closeBtn = byId('btnCloseModal'); if (closeBtn) closeBtn.click();
      } catch (e) { L('stage delete failed', e); }
    };
  })();
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

// =================== CLIENT RATES TABLE (UPDATED) ===================
// ✅ UPDATED — unified table view, dbl-click opens unified modal
// ============================================================================
// RENDER CLIENT RATES TABLE (adds "Status" col; shows disabled who/when)
// ============================================================================



// Now shows derived PAYE & Umbrella margins per bucket in the table
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
  let settingsSeed = null;
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

  // 2) Seed modal context
  const fullKeys = Object.keys(full || {});
  L('seeding window.modalCtx', { entity: 'clients', fullId: full?.id, fullKeys });

  window.modalCtx = {
    entity: 'clients',
    data: deep(full),
    formState: { __forId: full?.id || null, main: {} },
    ratesState: [],
    ratesBaseline: [],
    hospitalsState: { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() },
    clientSettingsState: settingsSeed ? deep(settingsSeed) : {},
    openToken: ((full?.id) || 'new') + ':' + Date.now(),
    // NEW: persistent set for staged client-rate deletes (survives refresh/merge)
    ratesStagedDeletes: (window.modalCtx && window.modalCtx.ratesStagedDeletes instanceof Set)
      ? window.modalCtx.ratesStagedDeletes
      : new Set()
  };

  L('window.modalCtx seeded', {
    entity: window.modalCtx.entity,
    dataId: window.modalCtx.data?.id,
    dataKeys: Object.keys(window.modalCtx.data||{}),
    formStateForId: window.modalCtx.formState?.__forId,
    openToken: window.modalCtx.openToken,
    preseededSettings: Object.keys(window.modalCtx.clientSettingsState||{})
  });

  // 3) Render modal
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
      const isNew = !window.modalCtx?.data?.id; // ← declared here (keep)

      // Collect "main" form
      const fs = window.modalCtx.formState || { __forId: null, main:{} };
      const hasId = !!window.modalCtx.data?.id;
      const same = hasId ? (fs.__forId === window.modalCtx.data.id)
                         : (fs.__forId === window.modalCtx.openToken || fs.__forId == null);

      const stagedMain = same ? (fs.main || {}) : {};
      const liveMain   = byId('tab-main') ? collectForm('#tab-main') : {};
      const payload    = { ...stagedMain, ...liveMain };

      L('[onSave] collected', { same, stagedKeys: Object.keys(stagedMain||{}), liveKeys: Object.keys(liveMain||{}) });

      delete payload.but_let_cli_ref;
      if (!payload.name && full?.name) payload.name = full.name;
      if (!payload.name) { alert('Please enter a Client name.'); return { ok:false }; }

      // Settings normalization (unchanged)
      const baseline = window.modalCtx.clientSettingsState || {};
      const hasFormMounted = !!byId('clientSettingsForm');
      const hasFullBaseline = ['day_start','day_end','night_start','night_end'].every(k => typeof baseline[k] === 'string' && baseline[k] !== '');
      const shouldValidateSettings = hasFormMounted || hasFullBaseline;

      let pendingSettings = null;
      if (shouldValidateSettings) {
        let csMerged = { ...(baseline || {}) };
        if (hasFormMounted) {
          const liveSettings = collectForm('#clientSettingsForm', false);
          ['day_start','day_end','night_start','night_end'].forEach(k=>{
            const v = _toHHMM(liveSettings[k]); if (v) csMerged[k] = v;
          });
          if (typeof liveSettings.timezone_id === 'string' && liveSettings.timezone_id.trim() !== '') {
            csMerged.timezone_id = liveSettings.timezone_id.trim();
          }
        }
        const { cleaned: csClean, invalid: csInvalid } = normalizeClientSettingsForSave(csMerged);
        if (APILOG) console.log('[OPEN_CLIENT] client_settings (merged→clean)', { csMerged, csClean, csInvalid, hasFormMounted, hasFullBaseline });
        if (csInvalid) { alert('Times must be HH:MM (24-hour).'); return { ok:false }; }
        if (Object.keys(csClean).length) pendingSettings = csClean;
      }

      // 3) Upsert client
      const idForUpdate = window.modalCtx?.data?.id || full?.id || null;
      if (APILOG) console.log('[OPEN_CLIENT] upsertClient → request', { idForUpdate, payload });
      delete payload.client_settings;

      const clientResp  = await upsertClient(payload, idForUpdate).catch(err => { E('upsertClient failed', err); return null; });
      const clientId    = idForUpdate || (clientResp && clientResp.id);
      if (APILOG) console.log('[OPEN_CLIENT] upsertClient ← response', { ok: !!clientResp, clientId });
      if (!clientId) { alert('Failed to save client'); return { ok:false }; }

      const savedClient = clientResp && typeof clientResp === 'object' ? clientResp : { id: clientId, ...payload };
      window.modalCtx.data = { ...(window.modalCtx.data || {}), ...savedClient, id: clientId };

      // 4) Save Client settings (after client exists)
      try {
        if (pendingSettings && Object.keys(pendingSettings).length) {
          if (APILOG) console.log('[OPEN_CLIENT] upsertClient (settings) → PUT /api/clients/:id', { clientId, pendingSettings });
          const upd = await upsertClient({ client_settings: pendingSettings }, clientId);
          if (!upd) throw new Error('Settings update failed');
          if (upd && typeof upd === 'object') window.modalCtx.data = { ...window.modalCtx.data, ...upd, id: clientId };
        }
      } catch (err) {
        alert(`Failed to save Client settings: ${String(err?.message || err)}`);
        return { ok:false };
      }

      // 5) Hospitals CRUD (typed-safe; skip when no staged changes)
      try {
        const hsRaw = window.modalCtx.hospitalsState || {};
        const hs = {
          existing     : Array.isArray(hsRaw.existing) ? hsRaw.existing : [],
          stagedNew    : Array.isArray(hsRaw.stagedNew) ? hsRaw.stagedNew : [],
          stagedEdits  : (hsRaw.stagedEdits && typeof hsRaw.stagedEdits === 'object') ? hsRaw.stagedEdits : {},
          stagedDeletes: (hsRaw.stagedDeletes instanceof Set)
            ? hsRaw.stagedDeletes
            : new Set(Array.isArray(hsRaw.stagedDeletes) ? hsRaw.stagedDeletes : Object.keys(hsRaw.stagedDeletes || {}))
        };

        const hasDel   = hs.stagedDeletes.size > 0;
        const hasEdits = Object.keys(hs.stagedEdits).length > 0;
        const hasNew   = hs.stagedNew.length > 0;

        if (hasDel || hasEdits || hasNew) {
          if (hasDel) {
            for (const hid of hs.stagedDeletes) {
              const url = API(`/api/clients/${encodeURIComponent(clientId)}/hospitals/${encodeURIComponent(hid)}`);
              if (APILOG) console.log('[OPEN_CLIENT] DELETE hospital →', url);
              const res = await authFetch(url, { method: 'DELETE' });
              if (!res.ok) throw new Error(await res.text());
            }
          }

          if (hasEdits) {
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
              if (Object.keys(patch).length === 0) continue;
              const url = API(`/api/clients/${encodeURIComponent(clientId)}/hospitals/${encodeURIComponent(hid)}`);
              if (APILOG) console.log('[OPEN_CLIENT] PATCH hospital →', url, patch);
              const res = await authFetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
              if (!res.ok) throw new Error(await res.text());
            }
          }

          if (hasNew) {
            for (const n of hs.stagedNew) {
              const body = { hospital_name_norm: String(n?.hospital_name_norm || '').trim(), ward_hint: (String(n?.ward_hint ?? '').trim() || null) };
              if (!body.hospital_name_norm) throw new Error('Hospital name cannot be blank.');
              const url = API(`/api/clients/${encodeURIComponent(clientId)}/hospitals`);
              if (APILOG) console.log('[OPEN_CLIENT] POST hospital →', url, body);
              const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
              if (!res.ok) throw new Error(await res.text());
            }
          }

          // ⬇️ Cleanup (type-agnostic)
          window.modalCtx.hospitalsState.stagedDeletes = new Set();
          window.modalCtx.hospitalsState.stagedEdits   = {};
          window.modalCtx.hospitalsState.stagedNew     = [];

          // Refresh visible list
          try {
            const fresh = await listClientHospitals(clientId);
            window.modalCtx.hospitalsState.existing = Array.isArray(fresh) ? fresh : [];
            try { renderClientHospitalsTable(); } catch {}
          } catch (e) {
            W('[OPEN_CLIENT] hospitals refresh failed', e);
          }
        }
      } catch (err) {
        alert(`Failed to save Hospitals & wards: ${String(err?.message || err)}`);
        return { ok:false };
      }

      // 6) DELETE staged client windows BEFORE toggles/edits/inserts
      try {
        const allWindows = Array.isArray(window.modalCtx.ratesState) ? window.modalCtx.ratesState : [];
        L('[onSave] delete phase', { windows: allWindows.length, stagedDeleteSet: window.modalCtx.ratesStagedDeletes?.size || 0 });
        // Union of flags and Set
        const setIds = (window.modalCtx.ratesStagedDeletes instanceof Set) ? new Set([...window.modalCtx.ratesStagedDeletes]) : new Set();
        for (const w of allWindows) if (w && w.id && w.__delete === true) setIds.add(String(w.id));

        if (setIds.size) {
          if (APILOG) console.log('[OPEN_CLIENT] deleting staged client windows', [...setIds]);
          for (const id of setIds) {
            const url = API(`/api/rates/client-defaults/${encodeURIComponent(id)}`);
            const res = await authFetch(url, { method: 'DELETE' });
            if (res.status === 404) continue;
            if (!res.ok) {
              const body = await res.text().catch(()=> '');
              if (res.status === 409) alert(`Delete blocked: ${body || 'Associated data prevents deletion.'}`);
              else alert(`Failed to delete client rate window: ${body || res.status}`);
              return { ok:false };
            }
          }
          window.modalCtx.ratesState    = allWindows.filter(w => !(w && w.id && setIds.has(String(w.id))));
          window.modalCtx.ratesBaseline = (Array.isArray(window.modalCtx.ratesBaseline) ? window.modalCtx.ratesBaseline : [])
                                          .filter(b => !(b && b.id && setIds.has(String(b.id))));
          if (window.modalCtx.ratesStagedDeletes instanceof Set) {
            for (const id of setIds) window.modalCtx.ratesStagedDeletes.delete(id);
          }
        }
      } catch (errDel) {
        alert(`Failed to process deletions: ${String(errDel?.message || errDel || '')}`);
        return { ok:false };
      }

      // 7) Apply status toggles
      const baselineRates = Array.isArray(window.modalCtx.ratesBaseline) ? window.modalCtx.ratesBaseline : [];
      const prevById = new Map(baselineRates.filter(r => r && r.id).map(r => [String(r.id), r]));
      let windows = Array.isArray(window.modalCtx.ratesState) ? window.modalCtx.ratesState.slice() : [];

      const toggles = [];
      for (const w of windows) {
        if (!w?.id) continue;
        const prev = prevById.get(String(w.id));
        if (!prev) continue;
        if (!!prev.disabled_at_utc !== !!w.disabled_at_utc) toggles.push({ id: w.id, disabled: !!w.disabled_at_utc });
      }
      L('[onSave] toggle phase', { togglesCount: toggles.length, windows: windows.length, baseline: baselineRates.length });
      if (toggles.length) {
        if (APILOG) console.log('[OPEN_CLIENT] applying toggles', toggles);
        for (const t of toggles) {
          try { await patchClientDefault(t.id, { disabled: t.disabled }); }
          catch (e) {
            const msg = String(e?.message || e || '');
            if (msg.includes('duplicate')) alert('Cannot enable this window: another enabled window already starts on the same date for the same role/band.');
            else alert(`Failed to update status: ${msg}`);
            return { ok:false };
          }
        }
      }

      // 8) Final negative-margin guard (skip disabled)
      const erniMult = (async ()=> {
        if (typeof window.__ERNI_MULT__ === 'number') return window.__ERNI_MULT__;
        try {
          if (typeof getSettingsCached === 'function') {
            const s = await getSettingsCached();
            let p = s?.erni_pct ?? s?.employers_ni_percent ?? 0;
            p = Number(p) || 0; if (p > 1) p = p/100;
            window.__ERNI_MULT__ = 1 + p; return window.__ERNI_MULT__;
          }
        } catch {}
        return 1;
      })();
      const mult = await erniMult;
      for (const w of windows) {
        if (w.disabled_at_utc) continue;
        for (const b of ['day','night','sat','sun','bh']) {
          const chg  = w[`charge_${b}`], paye = w[`paye_${b}`], umb = w[`umb_${b}`];
          if (chg != null && paye != null && (chg - (paye * mult)) < 0) { alert(`PAYE margin would be negative for ${w.role}${w.band?` / ${w.band}`:''} (${b.toUpperCase()}). Fix before saving.`); return { ok:false }; }
          if (chg != null && umb  != null && (chg - umb) < 0)            { alert(`Umbrella margin would be negative for ${w.role}${w.band?` / ${w.band}`:''} (${b.toUpperCase()}). Fix before saving.`); return { ok:false }; }
        }
      }

      // 9) UPDATE existing, POST new (skip disabled)
      const toUpdate = windows.filter(w => w.id && !w.disabled_at_utc);
      const toCreate = windows.filter(w => !w.id && !w.disabled_at_utc);
      L('[onSave] upsert phase', { toUpdate: toUpdate.length, toCreate: toCreate.length });

      const buildBody = (w) => ({
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

      // PUT updates
      for (const w of toUpdate) {
        if (!w.id) continue;
        try {
          const url = API(`/api/rates/client-defaults/${encodeURIComponent(w.id)}`);
          if (APILOG) console.log('[OPEN_CLIENT] PUT client-default window →', w.id);
          const res = await authFetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody(w))
          });
          if (!res.ok) {
            const body = await res.text().catch(()=> '');
            alert(`Failed to update client rate window: ${body || res.status}`);
            return { ok:false };
          }
        } catch (e) {
          alert(`Failed to update a client rate window: ${String(e?.message || e)}`); return { ok:false };
        }
      }

      // POST creates
      for (const w of toCreate) {
        try {
          if (APILOG) console.log('[OPEN_CLIENT] POST client-default window →', w);
          await upsertClientRate(buildBody(w));
        } catch (e) {
          E('Upsert client default window failed', w, e);
          alert('Failed to create a client rate window. See console for details.');
          return { ok:false };
        }
      }

      // 10) Refresh & rebuild baseline
      try {
        const refreshed = await listClientRates(clientId /* all incl. disabled */);
        const stagedDelIds = (window.modalCtx.ratesStagedDeletes instanceof Set) ? window.modalCtx.ratesStagedDeletes : new Set();
        window.modalCtx.ratesState = (Array.isArray(refreshed) ? refreshed.map(x => ({ ...x })) : []).map(x => {
          if (stagedDelIds.has(String(x.id))) x.__delete = true;
          return x;
        });
        window.modalCtx.ratesBaseline = JSON.parse(JSON.stringify(window.modalCtx.ratesState));
        L('[onSave] post-refresh', { refreshed: window.modalCtx.ratesState.length });
        try { renderClientRatesTable(); } catch {}
      } catch (e) {
        W('[openClient] post-save refresh failed', e);
      }

      window.modalCtx.formState = { __forId: clientId, main:{} };
      // ⬇️ FIX: reuse existing isNew; do not redeclare
      if (isNew) window.__pendingFocus = { section: 'clients', id: clientId };
      L('[onSave] EXIT ok=true');
      return { ok: true, saved: window.modalCtx.data };
    },
    full?.id
  );

  // 4) Post-paint async loads (merge metadata; preserve delete flags)
  if (full?.id) {
    const token = window.modalCtx.openToken;
    const id    = full.id;
    try {
      const unified = await listClientRates(id);
      if (token === window.modalCtx.openToken && window.modalCtx.data?.id === id) {
        const stagedDelIds = (window.modalCtx.ratesStagedDeletes instanceof Set) ? window.modalCtx.ratesStagedDeletes : new Set();
        const hasStaged = Array.isArray(window.modalCtx.ratesState) && window.modalCtx.ratesState.length > 0;
        if (!hasStaged) {
          window.modalCtx.ratesState = (Array.isArray(unified) ? unified.map(r => ({ ...r })) : []).map(r => {
            if (stagedDelIds.has(String(r.id))) r.__delete = true;
            return r;
          });
          window.modalCtx.ratesBaseline = JSON.parse(JSON.stringify(window.modalCtx.ratesState));
        } else {
          const staged = Array.isArray(window.modalCtx.ratesState) ? window.modalCtx.ratesState.slice() : [];
          const stagedById = new Map(staged.map(r => [String(r.id), r]));
          (Array.isArray(unified) ? unified : []).forEach(srv => {
            const s = stagedById.get(String(srv.id));
            if (s) {
              s.disabled_at_utc  = srv.disabled_at_utc ?? null;
              s.disabled_by_name = srv.disabled_by_name ?? null;
              if (stagedDelIds.has(String(srv.id))) s.__delete = true;
            } else {
              const row = { ...srv };
              if (stagedDelIds.has(String(row.id))) row.__delete = true;
              staged.push(row);
            }
          });
          window.modalCtx.ratesState = staged;
        }
        L('[POST-PAINT] rates merged', { count: window.modalCtx.ratesState.length });
        try { renderClientRatesTable(); } catch {}
      }
    } catch (e) { W('openClient POST-PAINT rates error', e); }

    try {
      const freshHosp = await listClientHospitals(id);
      if (token === window.modalCtx.openToken && window.modalCtx.data?.id === id) {
        window.modalCtx.hospitalsState.existing = Array.isArray(freshHosp) ? freshHosp : [];
        try { renderClientHospitalsTable(); } catch {}
      }
    } catch (e) { W('openClient POST-PAINT hospitals error', e); }

  } else {
    L('skip companion loads (no full.id)');
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
// ========== PAY TAB (just extra logs; logic unchanged) ==========
async function mountCandidatePayTab(){
  const LOG = !!window.__LOG_PAYTAB;
  const fr = (window.__modalStack || [])[ (window.__modalStack || []).length - 1 ] || null;
  const mode = fr ? fr.mode : 'view';
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
    const umbInput = document.getElementById('umbrella_name'); if (umbInput) umbInput.disabled = false;
    try { window.__BANK_FIELDS_DISABLED__ = !!disabled; } catch {}
    if (LOG) console.log('[PAYTAB] setBankDisabled', disabled);
  }

  const unwrapList = (data) => {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && Array.isArray(data.rows))  return data.rows;
    if (data && Array.isArray(data.data))  return data.data;
    return [];
  };
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
  const normaliseSort = (v) => { if (!v) return ''; const digits = String(v).replace(/\D+/g, '').slice(0,6); if (digits.length !== 6) return v; return digits.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3'); };

  function fillFromCandidate() {
    const d = window.modalCtx?.data || {};
    if (accHolder) accHolder.value = d.account_holder || '';
    if (bankName)  bankName.value  = d.bank_name || '';
    if (sortCode)  sortCode.value  = normaliseSort(d.sort_code || '');
    if (accNum)    accNum.value    = d.account_number || '';
    if (LOG) console.log('[PAYTAB] fillFromCandidate', { account_holder: accHolder?.value, bank_name: bankName?.value, sort_code: sortCode?.value, account_number: accNum?.value });
  }

  async function fetchUmbrellaById(id) {
    try {
      const res = await authFetch(API(`/api/umbrellas/${encodeURIComponent(id)}`));
      if (!res || !res.ok) return null;
      const json = await res.json().catch(() => null);
      const row = json && (json.umbrella || unwrapSingle(json));
      return row || null;
    } catch (_) { return null; }
  }
  function prefillUmbrellaBankFields(umb) {
    if (!umb) return;
    try {
      if (window.__LAST_UMB_PREFILL_ID__ && String(window.__LAST_UMB_PREFILL_ID__) === String(umb.id || '')) return;
      window.__LAST_UMB_PREFILL_ID__ = umb.id || null;
    } catch {}
    const bank = umb.bank_name || umb.bank || umb.bankName || '';
    const sc   = umb.sort_code || umb.bank_sort_code || umb.sortCode || '';
    const an   = umb.account_number || umb.bank_account_number || umb.accountNumber || '';
    const ah   = umb.name || umb.account_holder || umb.bank_account_name || umb.accountHolder || '';
    if (bankName)  bankName.value  = bank;
    if (sortCode)  sortCode.value  = normaliseSort(sc);
    if (accNum)    accNum.value    = an;
    if (accHolder) accHolder.value = ah;
    if (nameInput && !nameInput.value) nameInput.placeholder = umb.name || nameInput.placeholder || '';
    if (LOG) console.log('[PAYTAB] prefillUmbrellaBankFields', { umb_id: umb.id, name: umb.name, bank, sc, an, ah });
  }
  async function fetchAndPrefill(id) {
    if (!id) return;
    const umb = await fetchUmbrellaById(id);
    if (umb) { if (idHidden) idHidden.value = umb.id || idHidden.value || ''; prefillUmbrellaBankFields(umb); }
    else if (LOG) console.warn('[PAYTAB] fetchAndPrefill: umbrella not found', id);
  }

  if (payMethod === 'UMBRELLA') {
    if (umbRow) umbRow.style.display = '';
    setBankDisabled(true);

    let umbrellas = [];
    try {
      const res = await authFetch(API('/api/umbrellas'));
      if (res && res.ok) { const j = await res.json().catch(()=>[]); umbrellas = unwrapList(j); }
    } catch (_) { umbrellas = []; }
    if (LOG) console.log('[PAYTAB] umbrellas list loaded', umbrellas.length);

    if (listEl) {
      listEl.innerHTML = (umbrellas || []).map(u => {
        const label = u.name || u.remittance_email || u.id;
        return `<option data-id="${u.id}" value="${label}"></option>`;
      }).join('');
    }

    if (currentUmbId) { if (LOG) console.log('[PAYTAB] prefill by currentUmbId', currentUmbId); await fetchAndPrefill(currentUmbId); }
    else {
      const typed = nameInput && nameInput.value ? nameInput.value.trim() : '';
      if (typed && umbrellas.length) {
        const hit = umbrellas.find(u => (u.name || '').trim() === typed);
        if (hit) await fetchAndPrefill(hit.id);
      }
    }

    function syncUmbrellaSelection() {
      const val = (nameInput && nameInput.value) ? nameInput.value.trim() : '';
      if (!val) { if (idHidden) idHidden.value = ''; if (LOG) console.log('[PAYTAB] selection cleared'); return; }
      const allOpts = Array.from((listEl && listEl.options) ? listEl.options : []);
      const hitOpt = allOpts.find(o => o.value === val);
      const id = hitOpt && hitOpt.getAttribute('data-id');
      if (id) { if (LOG) console.log('[PAYTAB] selected umbrella', { label: val, id }); if (idHidden) idHidden.value = id; fetchAndPrefill(id); }
      else {
        if (LOG) console.warn('[PAYTAB] no exact label match; clearing id & bank fields');
        if (idHidden) idHidden.value = '';
        if (bankName) bankName.value = '';
        if (sortCode) sortCode.value = '';
        if (accNum)   accNum.value = '';
      }
    }

    if (nameInput) {
      nameInput.disabled = !isEdit;
      nameInput.oninput = syncUmbrellaSelection;
      nameInput.onchange = syncUmbrellaSelection;
    }
    if (idHidden) idHidden.addEventListener('change', () => fetchAndPrefill(idHidden.value));

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
  const LOG_RATES = !!window.__LOG_RATES;
  const DBG = (...a)=> { if (LOG_RATES) console.log('[RATES][mountClientRatesTab]', ...a); };

  const ctx = window.modalCtx; // use canonical context
  DBG('ENTRY', { ctxEntity: ctx?.entity, ctxId: ctx?.data?.id });

  // render uses ctx.ratesState directly; no args needed
  try { await renderClientRatesTable(); DBG('renderClientRatesTable done'); } catch (e) { DBG('renderClientRatesTable error', e); }

  // Always resolve a real client id before opening the modal
  const btn = byId('btnAddClientRate');
  if (btn) {
    btn.onclick = () => {
      const cid = (ctx && ctx.data && (ctx.data.id || ctx.data.client_id)) || null;
      DBG('openClientRateModal from button', { cid });
      return openClientRateModal(cid);
    };
    DBG('wired btnAddClientRate');
  } else {
    DBG('btnAddClientRate not present');
  }
}



// =================== MOUNT HOSPITALS TAB (unchanged glue) ===================
function mountClientHospitalsTab() {
  const ctx = window.modalCtx; // 🔧 use canonical context
  const H = ctx.hospitalsState || (ctx.hospitalsState = { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });

  // ⬇️ Key change: normalise stagedDeletes as a Set on mount (handles JSON-cloned arrays)
  if (!(H.stagedDeletes instanceof Set)) {
    H.stagedDeletes = new Set(Array.isArray(H.stagedDeletes) ? H.stagedDeletes : Object.keys(H.stagedDeletes || {}));
  }

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

      // ⬇️ Ensure Set semantics before use
      if (!(H.stagedDeletes instanceof Set)) {
        H.stagedDeletes = new Set(Array.isArray(H.stagedDeletes) ? H.stagedDeletes : Object.keys(H.stagedDeletes || {}));
      }
      H.stagedDeletes.add(String(hid));

      try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
      renderClientHospitalsTable();
    }, true);
    wrap.__wiredDelete = true;
  }
}


async function openClientRateModal(client_id, existing) {
  const parentFrame = _currentFrame();
  const parentEditable = parentFrame && (parentFrame.mode === 'edit' || parentFrame.mode === 'create');
  const APILOG = (typeof window !== 'undefined' && !!window.__LOG_API) || (typeof __LOG_API !== 'undefined' && !!__LOG_API);
  const LOG_RATES = !!window.__LOG_RATES;
  const DBG = (...a)=> { if (LOG_RATES) console.log('[RATES][openClientRateModal]', ...a); };

  const ctx = window.modalCtx || {};
  const resolvedClientId =
    client_id ||
    (existing && existing.client_id) ||
    (ctx && ctx.data && (ctx.data.id || ctx.data.client_id)) ||
    null;

  if (APILOG) console.log('[openClientRateModal] resolvedClientId', resolvedClientId, { passed: client_id, existing });
  DBG('ENTRY', { parentEditable, hasExisting: !!existing, resolvedClientId, ctxEntity: ctx?.entity, ctxId: ctx?.data?.id });

  const globalRoles = await loadGlobalRoleOptions();
  const roleOptions = globalRoles.map(r => `<option value="${r}">${r}</option>`).join('') + `<option value="__OTHER__">+ Add new role…</option>`;
  DBG('loaded role options', { count: globalRoles.length });

  const ex  = existing || {};
  const who = ex.disabled_by_name || '';
  const when = ex.disabled_at_utc ? formatIsoToUk(String(ex.disabled_at_utc).slice(0,10)) : '';
  const isDisabled = !!ex.disabled_at_utc;
  DBG('existing status', { isDisabled, who, when, id: ex.id });

  const statusBlock = `
    <div class="row" id="cl_status_row" style="align-items:center; gap:8px;">
      <div>
        ${isDisabled ? `
          <span class="pill tag-fail" id="cl_status_pill">❌ Disabled</span>
          <div class="hint" id="cl_status_meta">${who ? `by ${escapeHtml(who)}` : ''} ${when ? `on ${escapeHtml(when)}` : ''}</div>`
      : `
          <span class="pill tag-ok" id="cl_status_pill">✓ Active</span>
          <div class="hint" id="cl_status_meta">&nbsp;</div>`}
      </div>
      ${parentEditable && ex.id ? `<div><button id="cl_toggle_btn" class="btn btn-outline btn-sm">${isDisabled ? 'Enable' : 'Disable'}</button></div>` : ''}
    </div>`;

  function sameRow(a, b) {
    const eq = !!(a && b && ((a === b) || (a.id && b.id && String(a.id) === String(b.id)) || (a.__localKey && b.__localKey && String(a.__localKey) === String(b.__localKey))));
    if (LOG_RATES) console.log('[RATES][sameRow]', { aId:a?.id, bId:b?.id, aKey:a?.__localKey, bKey:b?.__localKey, eq });
    return eq;
  }

  // INLINE panel for client-rate warnings/fixes
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
      <div class="row"><label>VBR5809: Band (optional)</label>
        <input type="text" name="band" id="cl_band" value="${ex.band ?? ''}" ${parentEditable ? '' : 'disabled'} />
      </div>
      <div class="row"><label>Effective from (DD/MM/YYYY)</label>
        <input type="text" name="date_from" id="cl_date_from" placeholder="DD/MM/YYYY" ${parentEditable ? '' : 'disabled'} />
      </div>
      <div class="row"><label>Effective to (optional, DD/MM/YYYY)</label>
        <input type="text" name="date_to" id="cl_date_to" placeholder="DD/MM/YYYY" ${parentEditable ? '' : 'disabled'} />
      </div>
      <div class="row" style="grid-column: 1 / -1">
        <table class="grid" style="width:100%;border-collapse:collapse">
          <thead><tr><th>Bucket</th><th>PAYE pay</th><th>Umbrella pay</th><th>Charge</th></tr></thead>
          <tbody>
            ${['day','night','sat','sun','bh'].map(b => `
              <tr>
                <td style="white-space:nowrap">${b.toUpperCase()}</td>
                <td><input type="number" step="0.01" name="paye_${b}" ${parentEditable ? '' : 'disabled'} /></td>
                <td><input type="number" step="0.01" name="umb_${b}"  ${parentEditable ? '' : 'disabled'} /></td>
                <td><input type="number" step="0.01" name="charge_${b}" ${parentEditable ? '' : 'disabled'} /></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="row" style="grid-column:1 / -1; margin-top:10px">
        <table class="grid" id="cl_margins_tbl" style="width:100%">
          <thead><tr><th>Bucket</th><th>PAYE margin</th><th>Umbrella margin</th></tr></thead>
          <tbody>
            ${['day','night','sat','sun','bh'].map(b=>`
              <tr><td>${b.toUpperCase()}</td><td><span id="m_paye_${b}">—</span></td><td><span id="m_umb_${b}">—</span></td></tr>`).join('')}
          </tbody>
        </table>
        <div class="hint" id="cl_delete_hint" style="display:none;margin-top:6px"></div>
      </div>

      <div id="cl_err_panel" style="grid-column:1/-1; margin-top:10px; display:none; border:1px solid #7f1d1d; background:rgba(239,68,68,.08); color:#fecaca; padding:10px; border-radius:8px"></div>
    </div>
  `);

  // ERNI
  async function _erniMultiplier(){
    if (typeof window.__ERNI_MULT__ === 'number') return window.__ERNI_MULT__;
    try {
      if (typeof getSettingsCached === 'function') {
        const s = await getSettingsCached();
        let p = s?.erni_pct ?? s?.employers_ni_percent ?? 0;
        p = Number(p) || 0; if (p > 1) p = p/100;
        window.__ERNI_MULT__ = 1 + p;
        return window.__ERNI_MULT__;
      }
    } catch {}
    window.__ERNI_MULT__ = 1;
    return 1;
  }

  function setApplyEnabled(enabled){
    if (LOG_RATES) console.log('[RATES][setApplyEnabled]', { enabled });
    try {
      const btn = document.querySelector('#modal .btn-save, #modal .actions .primary, #modal .actions .btn-primary, .modal .btn-save');
      if (btn) { btn.disabled = !enabled; btn.classList.toggle('disabled', !enabled); }
    } catch (e) { if (LOG_RATES) console.warn('[RATES][setApplyEnabled] button toggle failed', e); }
    // Inform parent showModal so child Save can proceed
    try { window.dispatchEvent(new CustomEvent('modal-apply-enabled', { detail: { enabled } })); } catch (e) { if (LOG_RATES) console.warn('[RATES][setApplyEnabled] dispatch failed', e); }
  }
  const numOrNull = v => { if (v===undefined||v===null) return null; if (typeof v === 'string' && v.trim()==='') return null; const n=Number(v); return Number.isFinite(n) ? n : null; };
  const fmt = v => (v==null || Number.isNaN(v)) ? '—' : (Math.round(v*100)/100).toFixed(2);

  function showClientInlineError(html){
    const p = byId('cl_err_panel');
    if (!p) return;
    if (html && String(html).trim() !== '') {
      p.innerHTML = html;
      p.style.display = '';
    } else {
      p.innerHTML = '';
      p.style.display = 'none';
    }
  }
  function isoMinusOneDay(iso){
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth()+1).padStart(2,'0');
    const dd= String(d.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  function rangesOverlap(a0,a1,b0,b1){
    const A0 = a0 || '0000-01-01', A1 = a1 || '9999-12-31';
    const B0 = b0 || '0000-01-01', B1 = b1 || '9999-12-31';
    return !(A1 < B0 || B1 < A0);
  }

  // Gate inputs + margins + Apply + overlap inline fixes
  async function recomputeClientState(){
    const mult = await _erniMultiplier();
    const roleVal = (byId('cl_role')?.value || '').trim();
    const fromIso = parseUkDateToIso(byId('cl_date_from')?.value || '');
    const toIso   = parseUkDateToIso(byId('cl_date_to')?.value || '');

    DBG('recomputeClientState: ENTRY', { roleVal, fromIso, toIso, exId: ex?.id });

    const getIn = sel => document.querySelector(sel);
    const payeInputs = ['day','night','sat','sun','bh'].map(b => getIn(`#clientRateForm input[name="paye_${b}"]`));
    const umbInputs  = ['day','night','sat','sun','bh'].map(b => getIn(`#clientRateForm input[name="umb_${b}"]`));
    const chgInputs  = ['day','night','sat','sun','bh'].map(b => getIn(`#clientRateForm input[name="charge_${b}"]`));
    const allInputs  = [...payeInputs, ...umbInputs, ...chgInputs].filter(Boolean);

    let canApply = true;
    showClientInlineError('');

    if (!roleVal || !fromIso) {
      DBG('recomputeClientState: NOT_READY', { roleVal, fromIso });
      allInputs.forEach(inp => { inp.disabled = true; });
      // clear preview
      ['day','night','sat','sun','bh'].forEach(b=>{
        const spP = byId(`m_paye_${b}`), spU = byId(`m_umb_${b}`);
        if (spP) spP.textContent = '—';
        if (spU) spU.textContent = '—';
      });
      setApplyEnabled(false);
      return;
    }

    // keep inputs enabled
    allInputs.forEach(inp => { inp.disabled = true === false; });

    // Compute & render margins preview (2dp), while validating
    let hasNegative = false;
    const fmt2 = (v) => (v==null || Number.isNaN(v)) ? '—' : (Math.round(v*100)/100).toFixed(2);

    ['day','night','sat','sun','bh'].forEach(bucket=>{
      const paye = numOrNull(getIn(`#clientRateForm input[name="paye_${bucket}"]`)?.value);
      const umb  = numOrNull(getIn(`#clientRateForm input[name="umb_${bucket}"]`)?.value);
      const chg  = numOrNull(getIn(`#clientRateForm input[name="charge_${bucket}"]`)?.value);

      const payeMargin = (paye!=null && chg!=null) ? (chg - (paye * mult)) : null;
      const umbMargin  = (umb!=null  && chg!=null) ? (chg - umb)          : null;

      const spP = byId(`m_paye_${bucket}`), spU = byId(`m_umb_${bucket}`);
      if (spP) spP.textContent = fmt2(payeMargin);
      if (spU) spU.textContent = fmt2(umbMargin);

      if ((payeMargin != null && payeMargin < 0) || (umbMargin != null && umbMargin < 0)) hasNegative = true;
    });

    if (hasNegative) { canApply = false; showClientInlineError('One or more buckets would have a negative margin. Adjust pay/charge.'); }

    // Overlap detection + Fix buttons
    const staged = Array.isArray(ctx.ratesState) ? ctx.ratesState.slice() : [];
    const sameCat  = r => String(r.role||'') === roleVal && String(r.band??'') === String((byId('cl_band')?.value||'').trim()||'');
    const isSelf   = r => existing ? sameRow(r, existing) : false;

    const conflicts = staged
      .filter(r => !r.disabled_at_utc && sameCat(r) && !isSelf(r))
      .filter(r => rangesOverlap(r.date_from||null, r.date_to||null, fromIso, toIso||null));

    if (conflicts.length) {
      canApply = false;
      const ov = conflicts[0];
      const overlapStart = (fromIso > (ov.date_from||'0000-01-01')) ? fromIso : (ov.date_from||'');
      const overlapEnd   = ((toIso||'9999-12-31') < (ov.date_to||'9999-12-31')) ? (toIso||'') : (ov.date_to||'');
      const cutThis      = isoMinusOneDay(ov.date_from||'');
      const cutOther     = isoMinusOneDay(fromIso);

      let fixButtons = '';
      if (cutThis && (!fromIso || cutThis >= fromIso)) {
        fixButtons += `<button id="cl_fix_this" class="btn" style="margin-right:8px">Fix: Shorten <b>THIS</b> to ${formatIsoToUk(cutThis)}</button>`;
      }
      if (cutOther && (!ov.date_from || cutOther >= (ov.date_from))) {
        fixButtons += `<button id="cl_fix_other" class="btn">Fix: Shorten <b>OTHER</b> to ${formatIsoToUk(cutOther)}</button>`;
      }

      const msg = `
        <div style="font-weight:700;margin-bottom:6px">Overlap detected</div>
        <div style="margin-bottom:6px">
          Another client-default window exists for <b>${escapeHtml(roleVal)}</b>${(byId('cl_band')?.value||'').trim()?` / <b>${escapeHtml((byId('cl_band')?.value||'').trim())}</b>`:''}.<br/>
          <span class="hint" style="color:#fecaca">Overlap span:</span> <b>${formatIsoToUk(overlapStart)} – ${formatIsoToUk(overlapEnd)}</b>.
        </div>
        <div style="margin-bottom:8px">To proceed, adjust dates, or use a Fix:</div>
        <div>${fixButtons || '<i>No safe automatic fix available. Please adjust dates.</i>'}</div>
      `;
      showClientInlineError(msg);

      setTimeout(() => {
        const fromEl = byId('cl_date_from');
        const toEl   = byId('cl_date_to');
        const fixThis = byId('cl_fix_this');
        if (fixThis && cutThis) fixThis.onclick = () => {
          try { toEl.value = formatIsoToUk(cutThis); recomputeClientState(); } catch {}
        };
        const fixOther = byId('cl_fix_other');
        if (fixOther && cutOther) fixOther.onclick = () => {
          try {
            // stage OTHER truncate (stays staged until parent Save)
            if (ov.id) {
              const idx = staged.findIndex(r => r.id === ov.id);
              if (idx >= 0) ctx.ratesState[idx] = { ...ctx.ratesState[idx], date_to: cutOther };
            } else if (ov.__localKey) {
              const idx = staged.findIndex(r => r.__localKey === ov.__localKey);
              if (idx >= 0) ctx.ratesState[idx] = { ...ctx.ratesState[idx], date_to: cutOther };
            }
            try { renderClientRatesTable(); } catch {}
            recomputeClientState();
          } catch {}
        };
      }, 0);
    }

    DBG('recomputeClientState: EXIT', { canApply });
    setApplyEnabled(canApply);
  }

  const formTabLabel = `Form — ${isDisabled ? 'Inactive' : 'Active'}`;

  // showModal (child) — persist staged edits only; no popups for errors
  showModal(
    existing ? 'Edit Client Default Window' : 'Add/Upsert Client Default Window',
    [{ key:'form', label: formTabLabel }],
    () => formHtml,
    async () => {
      const stack = window.__modalStack || [];
      const pf = stack.length > 1 ? stack[stack.length - 2] : null;
      DBG('onSave ENTRY', { stackLen: stack.length, hasParent: !!pf, parentMode: pf?.mode });

      if (!pf || (pf.mode !== 'edit' && pf.mode !== 'create')) {
        DBG('onSave BLOCKED: parent not editable');
        return false;
      }

      // Re-validate live state; rely on validation result (do not read DOM disabled state)
      await recomputeClientState();
      DBG('onSave proceeding after recompute');

      const raw = collectForm('#clientRateForm');
      DBG('onSave collected', { raw });

      let role = (raw.role || '').trim();
      const newRole = (document.getElementById('cl_role_new')?.value || '').trim();
      if (role === '__OTHER__') {
        if (!newRole) { showClientInlineError('Enter a new role code.'); setApplyEnabled(false); DBG('onSave BLOCKED: newRole missing'); return false; }
        role = newRole.toUpperCase();
        if (typeof invalidateGlobalRoleOptionsCache === 'function') {
          try { invalidateGlobalRoleOptionsCache(); window.dispatchEvent(new CustomEvent('global-roles-updated')); } catch {}
        }
      }
      if (!role) { showClientInlineError('Role is required.'); setApplyEnabled(false); DBG('onSave BLOCKED: role missing'); return false; }

      const isoFrom = parseUkDateToIso(raw.date_from);
      if (!isoFrom) { showClientInlineError('Invalid “Effective from” date.'); setApplyEnabled(false); DBG('onSave BLOCKED: date_from invalid'); return false; }
      let isoTo = null;
      if (raw.date_to) {
        isoTo = parseUkDateToIso(raw.date_to);
        if (!isoTo) { showClientInlineError('Invalid “Effective to” date.'); setApplyEnabled(false); DBG('onSave BLOCKED: date_to invalid'); return false; }
        if (isoTo < isoFrom) { showClientInlineError('“Effective to” cannot be before “Effective from”.'); setApplyEnabled(false); DBG('onSave BLOCKED: date order invalid'); return false; }
      }

      const staged = {
        id: existing?.id || undefined,
        client_id: resolvedClientId,
        role,
        band: (raw.band || '').trim() || null,
        date_from: isoFrom,
        date_to:   isoTo,

        charge_day  : raw['charge_day']  !== '' ? Number(raw['charge_day'])  : null,
        charge_night: raw['charge_night']!== '' ? Number(raw['charge_night']) : null,
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

        // carry through disabled status + pending toggle marker (for UI/meta)
        disabled_at_utc : ex.disabled_at_utc ?? null,
        disabled_by_name: ex.disabled_by_name ?? null,
        __toggle        : ex.__toggle || undefined,
        __localKey      : existing?.__localKey || undefined,
        __delete        : existing?.__delete || false
      };

      if (ex.__toggle === 'enable') {
        staged.disabled_at_utc = null;
      } else if (ex.__toggle === 'disable') {
        staged.disabled_at_utc = staged.disabled_at_utc || new Date().toISOString().slice(0,10);
      }

      // Stage only (persist on parent Save)
      const before = { len: Array.isArray(ctx.ratesState) ? ctx.ratesState.length : 0 };
      ctx.ratesState = Array.isArray(ctx.ratesState) ? ctx.ratesState : [];
      if (existing) {
        const idx = ctx.ratesState.findIndex(r => sameRow(r, existing));
        if (idx >= 0) ctx.ratesState[idx] = staged; else ctx.ratesState.push(staged);
      } else {
        const already = ctx.ratesState.findIndex(r => sameRow(r, staged));
        if (already >= 0) ctx.ratesState[already] = staged; else ctx.ratesState.push(staged);
      }
      const after = { len: ctx.ratesState.length };
      DBG('onSave STAGED', { before, after, stagedId: staged.id, stagedRole: staged.role, toggle: staged.__toggle });

      try { const parent = _currentFrame(); if (parent && typeof parent.setTab === 'function') { parent.currentTabKey = 'rates'; parent.setTab('rates'); DBG('onSave: parent.setTab(rates)'); } } catch{}
      try { window.dispatchEvent(new CustomEvent('modal-dirty')); DBG('onSave: dispatched modal-dirty'); } catch {}
      try { await renderClientRatesTable(); DBG('onSave: renderClientRatesTable done'); } catch (e) { DBG('onSave: renderClientRatesTable error', e); }

      DBG('onSave EXIT ok=true');
      return true;
    },
    false,
    () => {
      const parent = _currentFrame();
      if (parent) { parent.currentTabKey = 'rates'; parent.setTab('rates'); DBG('onReturn: parent.setTab(rates)'); }
    },
    { kind: 'client-rate' }
  );

  // Hydrate & wire listeners
  const roleSel   = byId('cl_role');
  const roleNew   = byId('cl_role_new');
  const roleNewRow= byId('cl_role_new_row');
  const bandEl    = byId('cl_band');
  const fromEl    = byId('cl_date_from');
  const toEl      = byId('cl_date_to');

  attachUkDatePicker(fromEl); attachUkDatePicker(toEl);
  if (existing?.date_from) fromEl.value = formatIsoToUk(existing.date_from);
  if (existing?.date_to)   toEl.value   = formatIsoToUk(existing.date_to);

  if (existing?.role) {
    if (globalRoles.includes(existing.role)) {
      roleSel.value = existing.role;
      roleNewRow.style.display = 'none';
      roleNew.value = '';
    } else {
      roleSel.value = '__OTHER__';
      roleNewRow.style.display = '';
      roleNew.value = existing.role;
    }
  } else {
    roleNewRow.style.display = 'none';
  }

  // ===== Prefill with two-decimal rendering (no other changes) =====
  ['day','night','sat','sun','bh'].forEach(b=>{
    const set = (name, val) => {
      const el = document.querySelector(`#clientRateForm input[name="${name}_${b}"]`);
      if (el && typeof val !== 'undefined' && val !== null) {
        const num = Number(val);
        el.value = Number.isFinite(num) ? (Math.round(num*100)/100).toFixed(2) : String(val);
      }
    };
    set('paye',   existing?.[`paye_${b}`]);
    set('umb',    existing?.[`umb_${b}`]);
    set('charge', existing?.[`charge_${b}`]);
  });

  // Recompute once on mount
  DBG('mount: recomputeClientState');
  await recomputeClientState();

  roleSel.addEventListener('change', async ()=>{
    DBG('EVENT: role change', { value: roleSel.value });
    if (roleSel.value === '__OTHER__') { roleNewRow.style.display = ''; }
    else { roleNewRow.style.display = 'none'; roleNew.value=''; }
    await recomputeClientState();
  });
  bandEl.addEventListener('input',  () => { DBG('EVENT: band input', { value: bandEl.value }); recomputeClientState(); });
  fromEl.addEventListener('change', () => { DBG('EVENT: date_from change', { value: fromEl.value }); recomputeClientState(); });
  toEl.addEventListener('change',   () => { DBG('EVENT: date_to change', { value: toEl.value }); recomputeClientState(); });
  ['day','night','sat','sun','bh'].forEach(b=>{
    ['paye','umb','charge'].forEach(kind=>{
      const el = document.querySelector(`#clientRateForm input[name="${kind}_${b}"]`);
      if (el) el.addEventListener('input', () => { DBG('EVENT: pay input', { kind, bucket: b, value: el.value }); recomputeClientState(); });
    });
  });

  // Wire the Active/Inactive toggle button
  (function wireToggleButton(){
    const btn = byId('cl_toggle_btn');
    if (!btn || !parentEditable || !ex || !ex.id) return;
    DBG('wireToggleButton: ready', { id: ex.id, disabled: !!ex.disabled_at_utc });
    btn.onclick = () => {
      const pill = byId('cl_status_pill');
      const meta = byId('cl_status_meta');
      const currentlyDisabled = !!ex.disabled_at_utc;

      if (currentlyDisabled) {
        ex.__toggle = 'enable';
        ex.disabled_at_utc = null;
        if (pill) { pill.textContent = '✓ Active'; pill.className = 'pill tag-ok'; }
        if (meta) meta.innerHTML = '&nbsp;';
        btn.textContent = 'Disable';
      } else {
        ex.__toggle = 'disable';
        ex.disabled_at_utc = new Date().toISOString().slice(0,10);
        if (pill) { pill.textContent = '❌ Disabled'; pill.className = 'pill tag-fail'; }
        if (meta) meta.textContent = 'pending save';
        btn.textContent = 'Enable';
      }
      DBG('toggle clicked', { newToggle: ex.__toggle, newDisabledAt: ex.disabled_at_utc });
      setApplyEnabled(true);
    };
  })();

  // DELETE button logic (unchanged; staged delete until parent Save)
  (async function wireDeleteButton(){
    const delBtn = byId('btnDelete');
    if (!delBtn) return;
    if (!existing || !existing.id) { delBtn.style.display='none'; return; }

    const today = new Date(); const yyyy = today.getFullYear(); const mm = String(today.getMonth()+1).padStart(2,'0'); const dd = String(today.getDate()).padStart(2,'0');
    const todayIso = `${yyyy}-${mm}-${dd}`;
    const isFutureOrToday = !!existing.date_from && String(existing.date_from) >= todayIso;

    let deletable = isFutureOrToday;
    let reason = '';
    if (!deletable) {
      deletable = true; // allow delete in UI; real guard happens on Save server-side
      reason = '';
    }

    delBtn.style.display = '';
    delBtn.disabled = false;
    delBtn.onclick = () => {
      try {
        existing.__delete = true;
        DBG('delete staged', { id: existing.id });
        if (window.modalCtx && window.modalCtx.ratesStagedDeletes instanceof Set && existing.id) {
          window.modalCtx.ratesStagedDeletes.add(String(existing.id));
        }
        try { renderClientRatesTable(); } catch {}
        try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
        const closeBtn = byId('btnCloseModal'); if (closeBtn) closeBtn.click();
      } catch (e) { DBG('delete stage failed', e); }
    };
  })();
}


// === UPDATED: Client Default Rate modal (Role dropdown + new-role option; UK dates; date_to) ===
// ======================== openClientRateModal (FIXED) ========================
// =================== CLIENT DEFAULT RATE MODAL (UPDATED) ===================
// ✅ UPDATED — unified 3×5 grid (PAYE | Umbrella | Charge), date prefill, staged N−1 truncation of incumbent window

// ============================================================================
// CLIENT RATE MODAL (child) — adds status block + enable/disable button;
// overlap/rollback logic now IGNORES disabled rows
// ============================================================================

// ========== CLIENT DEFAULT RATES ==========

async function renderClientRatesTable() {
  const LOG_RATES = !!window.__LOG_RATES;
  const DBG = (...a)=> { if (LOG_RATES) console.log('[RATES][renderClientRatesTable]', ...a); };

  const div = byId('clientRates'); if (!div) { DBG('no #clientRates host, bail'); return; }

  const ctx = window.modalCtx;
  const staged = Array.isArray(ctx.ratesState) ? ctx.ratesState : [];
  const frame = _currentFrame();
  const parentEditable = frame && (frame.mode === 'edit' || frame.mode === 'create');

  DBG('ENTRY', { stagedLen: staged.length, parentEditable, ctxEntity: ctx?.entity });

  async function _erniMultiplier(){
    if (typeof window.__ERNI_MULT__ === 'number') return window.__ERNI_MULT__;
    try {
      if (typeof getSettingsCached === 'function') {
        const s = await getSettingsCached();
        let p = s?.erni_pct ?? s?.employers_ni_percent ?? 0;
        p = Number(p) || 0; if (p > 1) p = p/100;
        window.__ERNI_MULT__ = 1 + p;
        return window.__ERNI_MULT__;
      }
    } catch {}
    window.__ERNI_MULT__ = 1;
    return 1;
  }
  const mult = await _erniMultiplier();
  const fmt = v => (v==null || Number.isNaN(v)) ? '—' : (Math.round(v*100)/100).toFixed(2);

  div.innerHTML = '';

  if (!staged.length) {
    DBG('no staged rows → show empty state');
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

  // Build a quick baseline lookup (used only for the new last-column status)
  const baseline = Array.isArray(ctx.ratesBaseline) ? ctx.ratesBaseline : [];
  const baselineById = new Map(baseline.filter(b => b && b.id).map(b => [String(b.id), b]));
  const stagedDelSet = (ctx.ratesStagedDeletes instanceof Set) ? ctx.ratesStagedDeletes : new Set();

  const cols = [
    'status',
    'role','band',
    'paye_day','paye_night','paye_sat','paye_sun','paye_bh',
    'umb_day','umb_night','umb_sat','umb_sun','umb_bh',
    'charge_day','charge_night','charge_sat','charge_sun','charge_bh',
    'paye_margin_day','paye_margin_night','paye_margin_sat','paye_margin_sun','paye_margin_bh',
    'umb_margin_day','umb_margin_night','umb_margin_sat','umb_margin_sun','umb_margin_bh',
    'date_from','date_to',
    // NEW: final column to reflect staged change status
    'change_status'
  ];
  const headers = [
    'Status',
    'Role','Band',
    'PAYE Day','PAYE Night','PAYE Sat','PAYE Sun','PAYE BH',
    'UMB Day','UMB Night','UMB Sat','UMB Sun','UMB BH',
    'Charge Day','Charge Night','Charge Sat','Charge Sun','Charge BH',
    'PAYE M Day','PAYE M Night','PAYE M Sat','PAYE M Sun','PAYE M BH',
    'UMB M Day','UMB M Night','UMB M Sat','UMB M Sun','UMB M BH',
    'From','To',
    // NEW header aligned with the final column
    'Change'
  ];

  const tbl   = document.createElement('table'); tbl.className='grid';
  const thead = document.createElement('thead');
  const trh   = document.createElement('tr');
  headers.forEach(h => { const th=document.createElement('th'); th.textContent = h; trh.appendChild(th); });
  thead.appendChild(trh);
  tbl.appendChild(thead);

  const tb = document.createElement('tbody');

  // Helper to detect field differences against baseline
  const DIFF_FIELDS = [
    'role','band','date_from','date_to',
    'charge_day','charge_night','charge_sat','charge_sun','charge_bh',
    'paye_day','paye_night','paye_sat','paye_sun','paye_bh',
    'umb_day','umb_night','umb_sat','umb_sun','umb_bh'
  ];
  const differsFromBaseline = (row) => {
    if (!row || !row.id) return false; // creations are handled separately
    const base = baselineById.get(String(row.id));
    if (!base) return true; // no baseline match means it's effectively different
    for (const f of DIFF_FIELDS) {
      const a = row[f]; const b = base[f];
      const na = (a === '' || a == null) ? null : a;
      const nb = (b === '' || b == null) ? null : b;
      if (String(na) !== String(nb)) return true;
    }
    return false;
  };

  // 2dp formatter for numeric cells that aren’t margins
  const to2 = v => (v==null || v==='') ? '—' : fmt(Number(v));

  staged.forEach((r, idx) => {
    const tr = document.createElement('tr');
    if (r.disabled_at_utc) tr.classList.add('row-disabled');
    if (r.__delete) tr.classList.add('row-delete-pending');

    if (parentEditable) tr.ondblclick = () => {
      const cid = (ctx && ctx.data && (ctx.data.id || ctx.data.client_id)) || r.client_id || null;
      return openClientRateModal(cid, r);
    };

    cols.forEach(c => {
      const td = document.createElement('td');

      if (c === 'status') {
        if (r.__delete) {
          td.innerHTML = `<span class="pill tag-fail" aria-label="Pending delete">🗑 Pending delete (save to confirm)</span>`;
        } else if (r.disabled_at_utc) {
          const pending = r.__toggle ? ' (pending save)' : '';
          td.innerHTML = `<span class="pill tag-fail" aria-label="Disabled">❌ Disabled${pending}</span>`;
        } else {
          const pending = r.__toggle ? ' (pending save)' : '';
          td.innerHTML = `<span class="pill tag-ok" aria-label="Active">✓ Active${pending}</span>`;
        }

      } else if (c.startsWith('paye_margin_') || c.startsWith('umb_margin_')) {
        const bucket = c.split('_').pop();
        const charge = r[`charge_${bucket}`];
        const paye   = r[`paye_${bucket}`];
        const umb    = r[`umb_${bucket}`];
        let val = null;
        if (c.startsWith('paye_margin_')) val = (charge!=null && paye!=null) ? (charge - (paye * mult)) : null;
        else                               val = (charge!=null && umb!=null)  ? (charge - umb)          : null;
        td.textContent = fmt(val);

      } else if (
        c.startsWith('charge_') ||
        c.startsWith('paye_')   ||
        c.startsWith('umb_')
      ) {
        // NEW: 2dp formatting for charge_* and paye_*/umb_* columns
        td.textContent = to2(r[c]);

      } else if (c === 'change_status') {
        let label = '';
        if (r.__delete || (r.id && stagedDelSet.has(String(r.id)))) {
          label = 'Pending delete (save to confirm)';
        } else if (r && r.__toggle === 'enable') {
          label = 'Pending enable';
        } else if (r && r.__toggle === 'disable') {
          label = 'Pending disable';
        } else if (!r.id) {
          label = 'Pending create';
        } else if (differsFromBaseline(r)) {
          label = 'Pending update';
        } else {
          label = '';
        }
        td.textContent = label;

      } else {
        td.textContent = formatDisplayValue(c, r[c]);
      }

      tr.appendChild(td);
    });

    tb.appendChild(tr);
    if (idx === 0) DBG('first row preview', r);
  });

  tbl.appendChild(tb);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button id="btnAddClientRate"${parentEditable ? '' : ' disabled'}>Add / Upsert client window</button>
    ${parentEditable ? '' : '<span class="hint">Read-only. Click “Edit” in the main dialog to add/modify windows.</span>'}
  `;

  div.appendChild(tbl);
  div.appendChild(actions);
  DBG('EXIT render', { stagedLen: staged.length });
}


function showModal(title, tabs, renderTab, onSave, hasId, onReturn, options) {
  // ===== Logging =====
  const LOG = (typeof window.__LOG_MODAL === 'boolean') ? window.__LOG_MODAL : false;
  const L  = (...a)=> { if (LOG) console.log('[MODAL]', ...a); };
  const GC = (label)=> { if (LOG) console.groupCollapsed('[MODAL]', label); };
  const GE = ()=> { if (LOG) console.groupEnd(); };

  // ===== helpers =====
  const stack = () => (window.__modalStack ||= []);
  const currentFrame = () => stack()[stack().length - 1] || null;
  const parentFrame  = () => (stack().length > 1 ? stack()[stack().length - 2] : null);
  const deep = (o) => JSON.parse(JSON.stringify(o));

  // Back-compat options shift
  let opts = options || {};
  if (onReturn && typeof onReturn === 'object' && options === undefined) { opts = onReturn; onReturn = undefined; }

  const stripEmpty = (obj) => { const out={}; for (const [k,v] of Object.entries(obj||{})) { if (v===''||v==null) continue; out[k]=v; } return out; };

  function setFormReadOnly(root, ro) {
    if (!root) return;
    root.querySelectorAll('input, select, textarea, button').forEach((el) => {
      const isDisplayOnly = el.id === 'tms_ref_display' || el.id === 'cli_ref_display';
      if (el.type === 'button') {
        const allow = new Set(['btnCloseModal','btnDelete','btnEditModal','btnSave','btnRelated']);
        if (!allow.has(el.id)) el.disabled = !!ro;
        return;
      }
      if (isDisplayOnly) { el.setAttribute('disabled','true'); el.setAttribute('readonly','true'); return; }
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
    document.onmousemove = null; document.onmouseup = null;
  }

  const modalEl = byId('modal');
  if (modalEl) {
    modalEl.style.position = ''; modalEl.style.left = ''; modalEl.style.top = '';
    modalEl.style.right = '';    modalEl.style.bottom = '';
    modalEl.style.transform = ''; modalEl.classList.remove('dragging');
  }

  // ===== frame =====
  const frame = {
    _token: `f:${Date.now()}:${Math.random().toString(36).slice(2)}`,

    title,
    tabs: Array.isArray(tabs) ? tabs.slice() : [],
    renderTab,
    onSave,
    onReturn,
    hasId: !!hasId,
    entity: (window.modalCtx && window.modalCtx.entity) || null,

    noParentGate: !!opts.noParentGate,
    forceEdit:    !!opts.forceEdit,
    kind:         opts.kind || null,

    currentTabKey: (Array.isArray(tabs) && tabs.length ? tabs[0].key : null),

    mode: (opts.forceEdit ? 'edit' : (hasId ? 'view' : 'create')),
    isDirty:false, _snapshot:null, _detachDirty:null, _detachGlobal:null, _hasMountedOnce:false, _wired:false, _closing:false, _saving:false, _confirmingDiscard:false,
    _applyDesired:null,

    persistCurrentTabState() {
      if (!window.modalCtx || this.mode === 'view') { L('persist(skip)', { reason:'mode=view or no modalCtx', mode:this.mode }); return; }
      const sentinel = window.modalCtx?.openToken || null;
      const initial  = (window.modalCtx.data?.id ?? sentinel);
      const fs = window.modalCtx.formState || { __forId: initial, main:{}, pay:{} };
      if (fs.__forId == null) fs.__forId = initial;

      if (this.currentTabKey === 'main' && byId('tab-main')) {
        const c = collectForm('#tab-main'); fs.main = { ...(fs.main||{}), ...stripEmpty(c) };
      }
      if (this.currentTabKey === 'pay'  && byId('tab-pay'))  {
        const c = collectForm('#tab-pay');  fs.pay  = { ...(fs.pay ||{}), ...stripEmpty(c) };
      }
      window.modalCtx.formState = fs;
    },

    mergedRowForTab(k) {
      const base = { ...(window.modalCtx?.data || {}) };
      const fs   = (window.modalCtx?.formState || {});
      const rid  = window.modalCtx?.data?.id ?? null;
      const fid  = fs.__forId ?? null;
      const sentinel = window.modalCtx?.openToken ?? null;
      const same = (fid===rid) || (rid==null && (fid===sentinel || fid==null));
      const staged = same ? ((k==='main')?(fs.main||{}):(k==='pay')?(fs.pay||{}):{}) : {};
      return { ...base, ...stripEmpty(staged) };
    },

    _attachDirtyTracker() {
      if (this._detachDirty) { try { this._detachDirty(); } catch {} this._detachDirty = null; }
      const root = byId('modalBody'); if (!root) return;
      const onDirty = (ev) => {
        if (ev && !ev.isTrusted) return;
        const isChild = (stack().length > 1);
        if (isChild) {
          const p = parentFrame(); if (p && (p.mode==='edit' || p.mode==='create')) { p.isDirty = true; p._updateButtons && p._updateButtons(); }
        } else {
          if (this.mode==='edit' || this.mode==='create') { this.isDirty = true; this._updateButtons && this._updateButtons(); }
        }
        try { const t=currentFrame(); if (t && t.entity==='candidates' && t.currentTabKey==='rates') { renderCandidateRatesTable?.(); } } catch {}
      };
      root.addEventListener('input', onDirty, true);
      root.addEventListener('change',onDirty, true);
      this._detachDirty = ()=>{ root.removeEventListener('input',onDirty,true); root.removeEventListener('change',onDirty,true); };
    },

    setTab(k) {
      GC(`setTab(${k})`);
      const persist = this._hasMountedOnce; if (persist) this.persistCurrentTabState();

      byId('modalBody').innerHTML = this.renderTab(k, this.mergedRowForTab(k)) || '';

      if (this.entity==='candidates' && k==='rates') { mountCandidateRatesTab?.(); }
      if (this.entity==='candidates' && k==='pay')   { mountCandidatePayTab?.(); }

      if (this.entity==='candidates' && k==='main') {
        const pmSel = document.querySelector('#pay-method');
        if (pmSel) {
          const stagedPm   = window.modalCtx?.formState?.main?.pay_method;
          const preferred  = (window.modalCtx?.payMethodState || stagedPm || pmSel.value);
          pmSel.value = preferred;
          pmSel.addEventListener('change', () => {
            window.modalCtx.payMethodState = pmSel.value;
            try { window.dispatchEvent(new CustomEvent('pay-method-changed')); }
            catch { window.dispatchEvent(new Event('pay-method-changed')); }
          });
          window.modalCtx.payMethodState = pmSel.value;
        }

        const rolesHost = document.querySelector('#rolesEditor');
        if (rolesHost) {
          (async () => {
            try {
              const roleOptions = await loadGlobalRoleOptions();
              renderRolesEditor(rolesHost, window.modalCtx.rolesState || [], roleOptions);
            } catch (e) {
              console.error('[MODAL] roles mount failed', e);
            }
          })();
        }
      }

      if (this.entity==='clients'    && k==='rates')     { mountClientRatesTab?.(); }
      if (this.entity==='clients'    && k==='hospitals') { mountClientHospitalsTab?.(); }
      if (this.entity==='clients'    && k==='settings')  { renderClientSettingsUI?.(window.modalCtx.clientSettingsState||{}); }

      this.currentTabKey = k;
      this._attachDirtyTracker();

      const isChild = (stack().length > 1);
      if (this.noParentGate) setFormReadOnly(byId('modalBody'), (this.mode==='view'||this.mode==='saving'));
      else if (isChild)      { const p=parentFrame(); setFormReadOnly(byId('modalBody'), !(p && (p.mode==='edit'||p.mode==='create'))); }
      else                   setFormReadOnly(byId('modalBody'), (this.mode==='view'||this.mode==='saving'));

      this._hasMountedOnce = true; GE();
    }
  };

  function setFrameMode(frameObj, mode) {
    const prev = frameObj.mode; frameObj.mode = mode;
    const isChild = (stack().length > 1);
    if (frameObj.noParentGate) setFormReadOnly(byId('modalBody'), (mode==='view'||mode==='saving'));
    else if (isChild)          { const p=parentFrame(); setFormReadOnly(byId('modalBody'), !(p && (p.mode==='edit'||p.mode==='create'))); }
    else                       setFormReadOnly(byId('modalBody'), (mode==='view'||mode==='saving'));

    if (typeof frameObj._updateButtons === 'function') frameObj._updateButtons();

    try { const idx=stack().indexOf(frameObj); window.dispatchEvent(new CustomEvent('modal-frame-mode-changed',{detail:{frameIndex:idx,mode}})); } catch {}

    const repaint = !!(frameObj._hasMountedOnce && frameObj.currentTabKey);
    L('setFrameMode', { prevMode:prev, nextMode:mode, _hasMountedOnce:frameObj._hasMountedOnce, willRepaint:repaint });
    if (repaint) frameObj.setTab(frameObj.currentTabKey);
  }

  // push + paint
  stack().push(frame);
  byId('modalBack').style.display = 'flex';

  function renderTop() {
    GC('renderTop()');
    const isChild = (stack().length > 1);
    const top     = currentFrame();
    const parent  = parentFrame();

    if (typeof top._detachGlobal === 'function') { try { top._detachGlobal(); } catch {} top._wired = false; }

    byId('modalTitle').textContent = top.title;

    const tabsEl = byId('modalTabs'); tabsEl.innerHTML='';
    (top.tabs||[]).forEach((t,i)=>{
      const b=document.createElement('button'); b.textContent = t.label||t.title||t.key;
      if (i===0 && !top.currentTabKey) top.currentTabKey = t.key;
      if (t.key===top.currentTabKey || (i===0 && !top.currentTabKey)) b.classList.add('active');
      b.onclick = ()=>{ if (top.mode==='saving') return; tabsEl.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); top.setTab(t.key); };
      tabsEl.appendChild(b);
    });

    if (top.currentTabKey) top.setTab(top.currentTabKey);
    else if (top.tabs && top.tabs[0]) top.setTab(top.tabs[0].key);
    else byId('modalBody').innerHTML = top.renderTab('form',{})||'';

    const btnSave  = byId('btnSave');
    const btnClose = byId('btnCloseModal');
    const btnDel   = byId('btnDelete');
    const header   = byId('modalDrag');
    const modalNode= byId('modal');

    const showChildDelete = isChild && (top.kind==='client-rate' || top.kind==='candidate-override') && top.hasId;
    btnDel.style.display = showChildDelete ? '' : 'none'; btnDel.onclick = null;

    let btnEdit = byId('btnEditModal');
    if (!btnEdit) {
      btnEdit=document.createElement('button');
      btnEdit.id='btnEditModal'; btnEdit.type='button'; btnEdit.className='btn btn-outline btn-sm'; btnEdit.textContent='Edit';
      const bar = btnSave?.parentElement || btnClose?.parentElement; if (bar) bar.insertBefore(btnEdit, btnSave);
    }

    (function dragWire(){
      if(!header||!modalNode) return;
      const onDown = e=>{
        if ((e.button!==0 && e.type==='mousedown') || e.target.closest('button')) return;
        const R=modalNode.getBoundingClientRect();
        modalNode.style.position='fixed'; modalNode.style.left=R.left+'px'; modalNode.style.top=R.top+'px';
        modalNode.style.right='auto'; modalNode.style.bottom='auto'; modalNode.style.transform='none'; modalNode.classList.add('dragging');
        const ox=e.clientX-R.left, oy=e.clientY-R.top;
        document.onmousemove = ev=>{ let l=ev.clientX-ox, t=ev.clientY-oy; const ml=Math.max(0,window.innerWidth-R.width), mt=Math.max(0,window.innerHeight-R.height); if(l<0)l=0; if(t<0)t=0; if(l>ml)l=ml; if(t>mt)t=mt; modalNode.style.left=l+'px'; modalNode.style.top=t+'px'; };
        document.onmouseup   = ()=>{ modalNode.classList.remove('dragging'); document.onmousemove=null; document.onmouseup=null; };
        e.preventDefault();
      };
      const onDbl = e=>{ if(!e.target.closest('button')) sanitizeModalGeometry(); };
      header.addEventListener('mousedown', onDown);
      header.addEventListener('dblclick',  onDbl);
      const prev=top._detachGlobal;
      top._detachGlobal = ()=>{ try{header.removeEventListener('mousedown',onDown);}catch{} try{header.removeEventListener('dblclick',onDbl);}catch{} document.onmousemove=null; document.onmouseup=null; if(typeof prev==='function'){ try{prev();}catch{} } };
    })();

    const defaultPrimary = (top.kind==='advanced-search') ? 'Search' : (top.noParentGate ? 'Apply' : (isChild ? 'Apply' : 'Save'));
    btnSave.textContent = defaultPrimary; btnSave.setAttribute('aria-label', defaultPrimary);

    const setCloseLabel = ()=>{
      const label = (top.kind==='advanced-search') ? 'Close'
                 : ((isChild || top.mode==='edit' || top.mode==='create') ? (top.isDirty ? 'Discard' : 'Cancel') : 'Close');
      btnClose.textContent = label; btnClose.setAttribute('aria-label',label); btnClose.setAttribute('title',label);
    };

    top._updateButtons = ()=>{
      const parentEditable = top.noParentGate ? true : (parent ? (parent.mode==='edit' || parent.mode==='create') : true);
      const relatedBtn = byId('btnRelated');

      if (top.kind==='advanced-search') {
        btnEdit.style.display='none'; btnSave.style.display=''; btnSave.disabled=!!top._saving; if (relatedBtn) relatedBtn.disabled=true;
      } else if (isChild && !top.noParentGate) {
        btnSave.style.display = parentEditable ? '' : 'none';
        const wantApply = (top._applyDesired===true);
        btnSave.disabled = (!parentEditable) || top._saving || !wantApply;
        btnEdit.style.display='none'; if (relatedBtn) relatedBtn.disabled=true;
        if (LOG) console.log('[MODAL] child _updateButtons()', { parentEditable, wantApply, disabled: btnSave.disabled });
      } else {
        btnEdit.style.display = (top.mode==='view' && top.hasId) ? '' : 'none';
        if (relatedBtn) relatedBtn.disabled = !(top.mode==='view' && top.hasId);
        if (top.mode==='view') { btnSave.style.display = top.noParentGate ? '' : 'none'; btnSave.disabled = top._saving; }
        else { btnSave.style.display=''; btnSave.disabled = top._saving; }
      }
      setCloseLabel();
    };

    top._updateButtons();

    btnEdit.onclick = ()=>{
      const isChildNow = (stack().length > 1);
      if (isChildNow || top.noParentGate || top.kind==='advanced-search') return;
      if (top.mode==='view') {
        top._snapshot = {
          data               : deep(window.modalCtx?.data||null),
          formState          : deep(window.modalCtx?.formState||null),
          rolesState         : deep(window.modalCtx?.rolesState||null),
          ratesState         : deep(window.modalCtx?.ratesState||null),
          hospitalsState     : deep(window.modalCtx?.hospitalsState||null),
          clientSettingsState: deep(window.modalCtx?.clientSettingsState||null),
          overrides          : deep(window.modalCtx?.overrides || { existing:[], stagedNew:[], stagedEdits:{}, stagedDeletes:[] })
        };
        top.isDirty=false; setFrameMode(top,'edit');
      }
    };

    const handleSecondary = ()=>{
      if (top._confirmingDiscard || top._closing) return;

      if (top.kind==='advanced-search') {
        top._closing=true;
        document.onmousemove=null; document.onmouseup=null; byId('modal')?.classList.remove('dragging'); sanitizeModalGeometry();
        const closing=stack().pop(); if (closing?._detachDirty){ try{closing._detachDirty();}catch{} closing._detachDirty=null; }
        if (closing?._detachGlobal){ try{closing._detachGlobal();}catch{} closing._detachGlobal=null; } top._wired=false;
        if (stack().length>0) { const p=currentFrame(); renderTop(); try{ p.onReturn && p.onReturn(); } catch{} }
        else { discardAllModalsAndState(); if (window.__pendingFocus) { try{ renderAll(); } catch(e){ console.error('refresh after modal close failed',e); } } }
        return;
      }

      const isChildNow = (stack().length > 1);
      if (!isChildNow && !top.noParentGate && top.mode==='edit') {
        if (!top.isDirty) {
          if (top._snapshot && window.modalCtx) {
            window.modalCtx.data                = deep(top._snapshot.data);
            window.modalCtx.formState           = deep(top._snapshot.formState);
            window.modalCtx.rolesState          = deep(top._snapshot.rolesState);
            window.modalCtx.ratesState          = deep(top._snapshot.ratesState);
            window.modalCtx.hospitalsState      = deep(top._snapshot.hospitalsState);
            window.modalCtx.clientSettingsState = deep(top._snapshot.clientSettingsState);
            if (top._snapshot.overrides) window.modalCtx.overrides = deep(top._snapshot.overrides);
            try { renderCandidateRatesTable?.(); } catch {}
          }
          top.isDirty=false; setFrameMode(top,'view'); top._snapshot=null;
          try{ window.__toast?.('No changes'); }catch{}; return;
        } else {
          let ok=false; try{ top._confirmingDiscard=true; btnClose.disabled=true; ok=window.confirm('Discard changes and return to view?'); } finally { top._confirmingDiscard=false; btnClose.disabled=false; }
          if (!ok) return;
          if (top._snapshot && window.modalCtx) {
            window.modalCtx.data                = deep(top._snapshot.data);
            window.modalCtx.formState           = deep(top._snapshot.formState);
            window.modalCtx.rolesState          = deep(top._snapshot.rolesState);
            window.modalCtx.ratesState          = deep(top._snapshot.ratesState);
            window.modalCtx.hospitalsState      = deep(top._snapshot.hospitalsState);
            window.modalCtx.clientSettingsState = deep(top._snapshot.clientSettingsState);
            if (top._snapshot.overrides) window.modalCtx.overrides = deep(top._snapshot.overrides);
            try { renderCandidateRatesTable?.(); } catch {}
          }
          top.isDirty=false; top._snapshot=null; setFrameMode(top,'view'); return;
        }
      }

      if (top._closing) return;
      top._closing=true;
      document.onmousemove=null; document.onmouseup=null; byId('modal')?.classList.remove('dragging');

      if (!isChildNow && !top.noParentGate && top.mode==='create' && top.isDirty) {
        let ok=false; try{ top._confirmingDiscard=true; btnClose.disabled=true; ok=window.confirm('You have unsaved changes. Discard them and close?'); } finally { top._confirmingDiscard=false; btnClose.disabled=false; }
        if (!ok) { top._closing=false; return; }
      }

      sanitizeModalGeometry();
      const closing=stack().pop(); if (closing?._detachDirty){ try{closing._detachDirty();}catch{} closing._detachDirty=null; }
      if (closing?._detachGlobal){ try{closing._detachGlobal();}catch{} closing._detachGlobal=null; } top._wired=false;
      if (stack().length>0) { const p=currentFrame(); renderTop(); try{ p.onReturn && p.onReturn(); }catch{} }
      else { discardAllModalsAndState(); if (window.__pendingFocus) { try{ renderAll(); } catch(e) { console.error('refresh after modal close failed', e); } } }
    };
    byId('btnCloseModal').onclick = handleSecondary;

    const hasStagedClientDeletes = ()=> {
      try {
        const anyFlag = Array.isArray(window.modalCtx?.ratesState) && window.modalCtx.ratesState.some(w => w && w.__delete === true);
        const anySet  = (window.modalCtx?.ratesStagedDeletes instanceof Set) && window.modalCtx.ratesStagedDeletes.size > 0;
        const ovDel   = (window.modalCtx?.overrides?.stagedDeletes instanceof Set) && window.modalCtx.overrides.stagedDeletes.size > 0;
        return !!(anyFlag || anySet || ovDel);
      } catch { return false; }
    };

    async function saveForFrame(fr) {
      if (!fr || fr._saving) return;
      const onlyDel   = hasStagedClientDeletes();
      const allowApply= (fr.kind==='candidate-override' || fr.kind==='client-rate') && fr._applyDesired===true;

      L('saveForFrame ENTER', { kind: fr.kind, mode: fr.mode, noParentGate: fr.noParentGate, isDirty: fr.isDirty, onlyDel, allowApply });

      if (fr.kind!=='advanced-search' && !fr.noParentGate && fr.mode!=='view' && !fr.isDirty && !onlyDel && !allowApply) {
        L('saveForFrame GUARD: no-op (no changes and apply not allowed)');
        const isChildNow=(stack().length>1);
        if (isChildNow) {
          sanitizeModalGeometry(); stack().pop();
          if (stack().length>0) { const p=currentFrame(); renderTop(); try{ p.onReturn && p.onReturn(); }catch{} }
          else { discardAllModalsAndState(); }
        } else {
          fr.isDirty=false; fr._snapshot=null; setFrameMode(fr,'view'); fr._updateButtons&&fr._updateButtons();
        }
        try{ window.__toast?.('No changes'); }catch{}; return;
      }

      fr.persistCurrentTabState();
      const isChildNow=(stack().length>1);
      if (isChildNow && !fr.noParentGate && fr.kind!=='advanced-search') { const p=parentFrame(); if (!p || !(p.mode==='edit'||p.mode==='create')) { L('saveForFrame GUARD: parent not editable'); return; } }
      fr._saving=true; fr._updateButtons&&fr._updateButtons();

      let ok=false, saved=null;
      if (typeof fr.onSave==='function') {
        try { const res=await fr.onSave(); ok = (res===true) || (res && res.ok===true); if (res&&res.saved) saved=res.saved; }
        catch (e) { L('saveForFrame onSave threw', e); ok=false; }
      }
      fr._saving=false; if (!ok) { L('saveForFrame RESULT not ok'); fr._updateButtons&&fr._updateButtons(); return; }

      // >>> Special-case: Advanced Search closes on success instead of flipping to view
      if (fr.kind === 'advanced-search') {
        sanitizeModalGeometry();
        const closing = stack().pop();
        if (closing?._detachDirty){ try{closing._detachDirty();}catch{} closing._detachDirty=null; }
        if (closing?._detachGlobal){ try{closing._detachGlobal();}catch{} closing._detachGlobal=null; } fr._wired=false;

        if (stack().length>0) {
          const p=currentFrame(); renderTop(); try{ p.onReturn && p.onReturn(); }catch{}
        } else {
          discardAllModalsAndState();
        }
        L('saveForFrame EXIT (advanced-search closed)');
        return;
      }
      // <<< End special-case

      if (isChildNow) {
        try { window.dispatchEvent(new CustomEvent('modal-dirty')); } catch {}
        sanitizeModalGeometry(); stack().pop();
        if (stack().length>0) {
          const p=currentFrame(); p.isDirty=true; p._updateButtons&&p._updateButtons(); renderTop(); try{ p.onReturn && p.onReturn(); }catch{}
        } else {
          discardAllModalsAndState();
        }
        L('saveForFrame EXIT (child)');
      } else {
        if (saved && window.modalCtx) { window.modalCtx.data = { ...(window.modalCtx.data||{}), ...saved }; fr.hasId = !!window.modalCtx.data?.id; }
        fr.isDirty=false; fr._snapshot=null; setFrameMode(fr,'view');
        L('saveForFrame EXIT (parent)');
      }
    }

    const onSaveClick = async (ev)=>{
      const btn=ev?.currentTarget || byId('btnSave');
      const topNow=currentFrame(); const bound=btn?.dataset?.ownerToken;
      if (LOG) console.log('[MODAL] click #btnSave', {boundToken:bound, topToken:topNow?._token, topKind:topNow?.kind, topTitle:topNow?.title});
      if(!topNow) return; if(bound!==topNow._token){ if(LOG) console.warn('[MODAL] token mismatch; using top frame'); }
      await saveForFrame(topNow);
    };

    const bindSave = (btn,fr)=>{ if(!btn||!fr) return; btn.dataset.ownerToken = fr._token; btn.onclick = onSaveClick; if(LOG) console.log('[MODAL] bind #btnSave →',{ownerToken:fr._token,kind:fr.kind||'(parent)',title:fr.title,mode:fr.mode}); };
    bindSave(btnSave, top);

    const onDirtyEvt = ()=>{
      const isChildNow=(stack().length>1);
      if(isChildNow){ const p=parentFrame(); if(p && (p.mode==='edit'||p.mode==='create')){ p.isDirty=true; p._updateButtons&&p._updateButtons(); } }
      else if(top.mode==='edit'||top.mode==='create'){ top.isDirty=true; top._updateButtons&&top._updateButtons(); }
      try{ const t=currentFrame(); if(t && t.entity==='candidates' && t.currentTabKey==='rates'){ renderCandidateRatesTable?.(); } }catch{}
    };
    const onApplyEvt = ev=>{
      const isChildNow=(stack().length>1); if(!isChildNow) return;
      const t=currentFrame(); if(!(t && (t.kind==='client-rate'||t.kind==='candidate-override'))) return;
      const enabled=!!(ev && ev.detail && ev.detail.enabled); t._applyDesired=enabled; t._updateButtons&&t._updateButtons(); bindSave(byId('btnSave'), t);
      if(LOG) console.log('[MODAL] onApplyEvt → _applyDesired =', enabled,'rebound save to top frame');
    };
    const onModeChanged = ev=>{
      const isChildNow=(stack().length>1); if(!isChildNow) return;
      const parentIdx=stack().length-2, changed=ev?.detail?.frameIndex ?? -1;
      if(changed===parentIdx){ if(LOG) console.log('[MODAL] parent mode changed → child _updateButtons()'); const t=currentFrame(); t._updateButtons&&t._updateButtons(); bindSave(byId('btnSave'), t); }
    };

    if (!top._wired) {
      window.addEventListener('modal-dirty', onDirtyEvt);
      window.addEventListener('modal-apply-enabled', onApplyEvt);
      window.addEventListener('modal-frame-mode-changed', onModeChanged);
      const onEsc=e=>{ if(e.key==='Escape'){ if(top._confirmingDiscard||top._closing) return; e.preventDefault(); byId('btnCloseModal').click(); } };
      window.addEventListener('keydown', onEsc);
      const onOverlayClick=e=>{ if(top._confirmingDiscard||top._closing) return; if(e.target===byId('modalBack')) byId('btnCloseModal').click(); };
      byId('modalBack').addEventListener('click', onOverlayClick, true);
      top._detachGlobal = ()=>{ try{window.removeEventListener('modal-dirty',onDirtyEvt);}catch{} try{window.removeEventListener('modal-apply-enabled',onApplyEvt);}catch{} try{window.removeEventListener('modal-frame-mode-changed',onModeChanged);}catch{} try{window.removeEventListener('keydown',onEsc);}catch{} try{byId('modalBack').removeEventListener('click', onOverlayClick, true);}catch{}; };
      top._wired = true;
    }

    const parentEditable = parent && (parent.mode==='edit' || parent.mode==='create');
    const isChildNow = (stack().length > 1);
    if (isChildNow && !top.noParentGate) setFormReadOnly(byId('modalBody'), !parentEditable);
    else                                 setFrameMode(top, top.mode);

    GE();
  }

  byId('modalBack').style.display='flex';
  window.__getModalFrame = currentFrame;
  renderTop();
}

// Selection state helpers — simplified to explicit IDs only

// ──────────────────────────────────────────────────────────────────────────────
// IDs-only selection helpers (single source of truth: Set of selected IDs)
// ──────────────────────────────────────────────────────────────────────────────


function ensureSelection(section) {
  window.__selection = window.__selection || {};
  if (!window.__selection[section]) {
    window.__selection[section] = {
      fingerprint: '',
      ids: new Set(),
    };
  }
  return window.__selection[section];
}

function getSelectionSnapshot(section) {
  const sel = ensureSelection(section);
  return {
    fingerprint: sel.fingerprint || '',
    ids: Array.from(sel.ids || []),
    section,
  };
}
function applySelectionSnapshot(section, snapshot) {
  if (!snapshot || (snapshot.section && snapshot.section !== section)) {
    return getSelectionSnapshot(section);
  }
  const sel = ensureSelection(section);
  sel.fingerprint = String(snapshot.fingerprint || sel.fingerprint || '');
  sel.ids = new Set((snapshot.ids || []).map(String));
  return getSelectionSnapshot(section);
}

function isRowSelected(section, id) {
  if (!id) return false;
  return ensureSelection(section).ids.has(String(id));
}

function setRowSelected(section, id, selected) {
  if (!id) return getSelectionSnapshot(section);
  const sel = ensureSelection(section);
  const key = String(id);
  if (selected) sel.ids.add(key);
  else sel.ids.delete(key);
  return getSelectionSnapshot(section);
}


async function applyShortlistFilter(section, { ids }) {
  const cleanIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  if (!cleanIds.length) {
    alert('No records selected to focus.');
    return;
  }

  // Reset paging & REPLACE existing filters with IDs-only
  window.__listState = window.__listState || {};
  const st = (window.__listState[section] ||= {
    page: 1, pageSize: 50, total: null, hasMore: false, filters: null,
  });
  st.page = 1;
  st.filters = { ids: cleanIds }; // ← replace, don't merge

  // Mirror into selection for checkbox sync
  const sel = ensureSelection(section);
  sel.fingerprint = JSON.stringify({ section, filters: st.filters || {} });
  sel.ids = new Set(cleanIds);

  // Reload with the focused shortlist
  const rows = await search(section, st.filters);
  renderSummary(rows);
}


// Convenience: focus current selection by applying its IDs as a filter
async function focusCurrentSelection(section) {
  const sel = ensureSelection(section);
  const ids = Array.from(sel.ids || []);
  if (!ids.length) {
    alert('No records selected to focus.');
    return;
  }
  await applyShortlistFilter(section, { ids });
}

// Apply IDs-only selection as a filter and reload
// Apply IDs-only selection as a filter and reload
async function applySelectionAsFilter(section, selectionSnapshot) {
  const ids = Array.isArray(selectionSnapshot?.ids)
    ? selectionSnapshot.ids.map(String).filter(Boolean)
    : [];

  if (!ids.length) {
    alert('No records selected to focus.');
    return;
  }

  // Reset paging & REPLACE existing filters with IDs-only
  window.__listState = window.__listState || {};
  const st = (window.__listState[section] ||= {
    page: 1, pageSize: 50, total: null, hasMore: false, filters: null,
  });
  st.page = 1;
  st.filters = { ids }; // ← replace, don't merge

  // Mirror into selection for checkbox sync
  const sel = ensureSelection(section);
  sel.fingerprint = JSON.stringify({ section, filters: st.filters || {} });
  sel.ids = new Set(ids);

  // Reload data and re-render
  const rows = await search(section, st.filters);
  renderSummary(rows);
}





function clearSelection(section) {
  const sel = ensureSelection(section);
  sel.ids.clear();
  return getSelectionSnapshot(section);
}

function serializeSelection(section) {
  return getSelectionSnapshot(section);
}



function mergeSelectionSnapshots(section, baseSnapshot, addSnapshot) {
  const base = baseSnapshot || getSelectionSnapshot(section);
  const add  = addSnapshot  || {};
  const result = {
    fingerprint: base.fingerprint || add.fingerprint || '',
    ids: Array.from(new Set([
      ...(base.ids || []).map(String),
      ...(add.ids  || []).map(String),
    ])),
    section
  };
  return applySelectionSnapshot(section, result);
}

function dedupeIds(arr) {
  return Array.from(new Set((arr || []).map(String)));
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

  // ⬇️ Key change: pass noParentGate so the child save isn't blocked by the "not dirty" guard
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
      try { renderClientHospitalsTable(); } catch {}
      return true; // Apply closes child
    },
    false,
    () => {
      const parent = _currentFrame();
      if (parent) { parent.currentTabKey = 'hospitals'; parent.setTab('hospitals'); }
    },
    // ⬇️ Options: bypass parent-gate guard for this child modal only
    { noParentGate: true, forceEdit: true, kind: 'client-hospital' }
  );
}

function renderClientHospitalsTable() {
  const el = byId('clientHospitals'); if (!el) return;

  const frame = _currentFrame();
  // ✅ Allow create OR edit to add/edit hospitals
  const parentEditable = frame && (frame.mode === 'edit' || frame.mode === 'create');

  const ctx = window.modalCtx; // 🔧 use canonical context
  const H = ctx.hospitalsState || (ctx.hospitalsState = { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() });

  // ⬇️ Key change: normalise stagedDeletes back to a Set if it was JSON-cloned to an Array/object
  if (!(H.stagedDeletes instanceof Set)) {
    H.stagedDeletes = new Set(Array.isArray(H.stagedDeletes) ? H.stagedDeletes : Object.keys(H.stagedDeletes || {}));
  }
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


// =================== HOSPITALS TABLE (UPDATED: staged delete & edit) ===================



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

  // ── paging state (per section) ──────────────────────────────────────────────
  window.__listState = window.__listState || {};
  const st = (window.__listState[currentSection] ||= { page: 1, pageSize: 50, total: null, hasMore: false, filters: null });
  const page     = Number(st.page || 1);
  const pageSize = st.pageSize; // 50 | 100 | 200 | 'ALL'

  // ── selection state (per section) — explicit IDs only ──────────────────────
  window.__selection = window.__selection || {};
  const ensureSel = (section)=>{ const init = { fingerprint:'', ids:new Set() }; return (window.__selection[section] ||= init); };
  const sel = ensureSel(currentSection);

  const isRowSelected = (id)=> sel.ids.has(String(id||''));
  const setRowSelected = (id, selected)=>{
    id = String(id||''); if (!id) return;
    if (selected) sel.ids.add(id); else sel.ids.delete(id);
  };
  const clearSelection = ()=>{ sel.ids.clear(); };

  // Tie selection to dataset via fingerprint (filters + section)
  const computeFp = ()=> JSON.stringify({ section: currentSection, filters: st.filters || {} });
  const fp = computeFp();
  if (sel.fingerprint !== fp) { sel.fingerprint = fp; clearSelection(); }

  const cols = defaultColumnsFor(currentSection);
  byId('title').textContent = sections.find(s=>s.key===currentSection)?.label || '';
  const content = byId('content');

  // Preserve scroll position per section
  window.__scrollMemory = window.__scrollMemory || {};
  const memKey = `summary:${currentSection}`;
  const prevScrollY = content ? (window.__scrollMemory[memKey] ?? content.scrollTop ?? 0) : 0;

  content.innerHTML = '';

  if (currentSection === 'settings') return renderSettingsPanel(content);
  if (currentSection === 'audit')    return renderAuditTable(content, rows);

  if (currentSection === 'candidates') {
    rows.forEach(r => { r.role = (r && Array.isArray(r.roles)) ? formatRolesSummary(r.roles) : ''; });
  }

  // ── top controls (page size selector + selection summary) ───────────────────
  const topControls = document.createElement('div');
  topControls.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line)';
  const sizeLabel = document.createElement('span'); sizeLabel.className = 'mini'; sizeLabel.textContent = 'Page size:';
  const sizeSel = document.createElement('select'); sizeSel.id = 'summaryPageSize';
  ['50','100','200','ALL'].forEach(optVal => {
    const opt = document.createElement('option');
    opt.value = optVal; opt.textContent = (optVal === 'ALL') ? 'All' : `First ${optVal}`;
    if (String(pageSize) === optVal) opt.selected = true;
    sizeSel.appendChild(opt);
  });
  sizeSel.addEventListener('change', async () => {
    const val = sizeSel.value;
    window.__listState[currentSection].pageSize = (val === 'ALL') ? 'ALL' : Number(val);
    window.__listState[currentSection].page = 1;
    const data = await loadSection();
    renderSummary(data);
  });

  const selInfo = document.createElement('div'); selInfo.className = 'mini';
  const renderSelInfo = ()=>{ selInfo.textContent = (sel.ids.size > 0) ? `${sel.ids.size} selected.` : ''; };
  renderSelInfo();

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear selection';
  clearBtn.style.cssText = 'border:1px solid var(--line);background:#0b152a;color:var(--text);padding:4px 8px;border-radius:8px;cursor:pointer;display:none';
  clearBtn.onclick = ()=>{
    clearSelection(); renderSelInfo();
    Array.from(document.querySelectorAll('input.row-select')).forEach(cb=>{ cb.checked = false; });
    const hdr = byId('summarySelectAll'); if (hdr) { hdr.checked=false; hdr.indeterminate=false; }
    updateButtons(); // NEW
  };

  const spacerTop = document.createElement('div'); spacerTop.style.flex = '1';
  topControls.appendChild(sizeLabel);
  topControls.appendChild(sizeSel);
  topControls.appendChild(spacerTop);
  topControls.appendChild(selInfo);
  topControls.appendChild(clearBtn);
  content.appendChild(topControls);

  // ── data table ──────────────────────────────────────────────────────────────
  const tbl = document.createElement('table'); tbl.className='grid';
  const thead = document.createElement('thead'); const trh=document.createElement('tr');

  // We'll fill header after we define action buttons helper
  let btnFocus, btnSave; // defined later so handlers can update their disabled state

  // Helper to recompute header checkbox state & action buttons
  const computeHeaderState = ()=>{
    const idsVisible = rows.map(r => String(r.id || ''));
    const selectedOfVisible = idsVisible.filter(id => sel.ids.has(id)).length;
    const hdrCbEl = byId('summarySelectAll');
    if (hdrCbEl) {
      hdrCbEl.checked = (idsVisible.length > 0 && selectedOfVisible === idsVisible.length);
      hdrCbEl.indeterminate = (selectedOfVisible > 0 && selectedOfVisible < idsVisible.length);
    }
  };
  const updateButtons = ()=>{
    const any = sel.ids.size > 0;
    if (btnFocus) btnFocus.disabled = !any;
    if (btnSave)  btnSave .disabled = !any;
    clearBtn.style.display = any ? '' : 'none';
    renderSelInfo();
  };

  // Header checkbox: select/deselect **visible rows** only
  const thSel = document.createElement('th');
  const hdrCb = document.createElement('input'); hdrCb.type='checkbox'; hdrCb.id='summarySelectAll';
  hdrCb.addEventListener('click', (e)=>{
    e.stopPropagation();
    const idsVisible = rows.map(r => String(r.id || ''));
    const wantOn = !!hdrCb.checked;
    idsVisible.forEach(id => { if (wantOn) sel.ids.add(id); else sel.ids.delete(id); });
    Array.from(document.querySelectorAll('input.row-select')).forEach(cb=>{ cb.checked = wantOn; });
    computeHeaderState();
    updateButtons(); // NEW
  });
  thSel.appendChild(hdrCb); trh.appendChild(thSel);

  cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; trh.appendChild(th); });
  thead.appendChild(trh); tbl.appendChild(thead);

  const tb = document.createElement('tbody');

  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.dataset.id = (r && r.id) ? String(r.id) : ''; tr.dataset.section = currentSection;

    const tdSel = document.createElement('td');
    const cb = document.createElement('input'); cb.type='checkbox'; cb.className='row-select';
    cb.checked = isRowSelected(tr.dataset.id);
    cb.addEventListener('click', (e)=>{
      e.stopPropagation();
      const id = tr.dataset.id; setRowSelected(id, cb.checked);
      computeHeaderState();
      updateButtons(); // NEW
    });
    tdSel.appendChild(cb); tr.appendChild(tdSel);

    cols.forEach(c=>{ const td=document.createElement('td'); const v = r[c]; td.textContent = formatDisplayValue(c, v); tr.appendChild(td); });

    tb.appendChild(tr);
  });

  // Click / dblclick behaviour (unchanged)
  tb.addEventListener('click', (ev) => {
    const tr = ev.target && ev.target.closest('tr'); if (!tr) return;
    if (ev.target && ev.target.classList && ev.target.classList.contains('row-select')) return;
    tb.querySelectorAll('tr.selected').forEach(n => n.classList.remove('selected'));
    tr.classList.add('selected');
    const id = tr.dataset.id;
    currentSelection = currentRows.find(x => String(x.id) === id) || null;
  });

  tb.addEventListener('dblclick', (ev) => {
    const tr = ev.target && ev.target.closest('tr'); if (!tr) return;
    if (!confirmDiscardChangesIfDirty()) return;
    tb.querySelectorAll('tr.selected').forEach(n => n.classList.remove('selected'));
    tr.classList.add('selected');
    const id = tr.dataset.id;
    const row = currentRows.find(x => String(x.id) === id) || null;
    if (!row) return;
    const beforeDepth = (window.__modalStack && window.__modalStack.length) || 0;
    openDetails(row);
    setTimeout(() => {
      const afterDepth = (window.__modalStack && window.__modalStack.length) || 0;
      if (afterDepth > beforeDepth) tb.querySelectorAll('tr.selected').forEach(n => n.classList.remove('selected'));
    }, 0);
  });

  tbl.appendChild(tb);
  content.appendChild(tbl);

  // Footer/pager
  const pager = document.createElement('div');
  pager.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid var(--line);';
  const info = document.createElement('span'); info.className = 'mini';

  const mkBtn = (label, disabled, onClick) => {
    const b = document.createElement('button');
    b.textContent = label; b.disabled = !!disabled;
    b.style.cssText = 'border:1px solid var(--line);background:#0b152a;color:var(--text);padding:4px 8px;border-radius:8px;cursor:pointer';
    if (!disabled) b.addEventListener('click', onClick);
    return b;
  };

  const hasMore = !!st.hasMore;
  const totalKnown = (typeof st.total === 'number');
  const current = page;
  let maxPageToShow;
  if (totalKnown && pageSize !== 'ALL') maxPageToShow = Math.max(1, Math.ceil(st.total / Number(pageSize)));
  else if (pageSize === 'ALL') maxPageToShow = 1;
  else maxPageToShow = hasMore ? (current + 1) : current;

  const prevBtn = mkBtn('Prev', current <= 1, async () => {
    window.__listState[currentSection].page = Math.max(1, current - 1);
    const data = await loadSection();
    renderSummary(data);
  });
  pager.appendChild(prevBtn);

  const makePageLink = (n) => mkBtn(String(n), n === current, async () => {
    window.__listState[currentSection].page = n;
    const data = await loadSection();
    renderSummary(data);
  });

  const pages = [];
  if (maxPageToShow <= 7) { for (let n=1; n<=maxPageToShow; n++) pages.push(n); }
  else {
    pages.push(1);
    if (current > 3) pages.push('…');
    for (let n=Math.max(2, current-1); n<=Math.min(maxPageToShow-1, current+1); n++) pages.push(n);
    if (hasMore || current+1 < maxPageToShow) pages.push('…');
    pages.push(maxPageToShow);
  }
  pages.forEach(pn => {
    if (pn === '…') { const span = document.createElement('span'); span.textContent = '…'; span.className = 'mini'; pager.appendChild(span); }
    else pager.appendChild(makePageLink(pn));
  });

  const nextBtn = mkBtn('Next', (pageSize === 'ALL') || (!hasMore && (!totalKnown || current >= maxPageToShow)), async () => {
    window.__listState[currentSection].page = current + 1;
    const data = await loadSection();
    renderSummary(data);
  });
  pager.appendChild(nextBtn);

  if (pageSize === 'ALL') info.textContent = `Showing all ${rows.length} ${currentSection}.`;
  else if (totalKnown) {
    const ps = Number(pageSize);
    const start = (current-1)*ps + 1;
    const end = Math.min(start + rows.length - 1, st.total || start - 1);
    info.textContent = `Showing ${start}–${end}${st.total!=null ? ` of ${st.total}` : ''}`;
  } else {
    const ps = Number(pageSize);
    const start = (current-1)*ps + 1;
    const end = start + rows.length - 1;
    info.textContent = `Showing ${start}–${end}${hasMore ? '+' : ''}`;
  }
  const spacer = document.createElement('div'); spacer.style.flex = '1';
  pager.appendChild(spacer); pager.appendChild(info);
  content.appendChild(pager);

  // ── Selection toolbar (right-aligned under pager) ───────────────────────────
  const selBar = document.createElement('div');
  selBar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:6px 10px;border-top:1px dashed var(--line)';
  btnFocus = document.createElement('button');
  btnFocus.title = 'Focus on records';
  btnFocus.textContent = '🔍 Focus';
  btnFocus.style.cssText = 'border:1px solid var(--line);background:#0b152a;color:var(--text);padding:4px 8px;border-radius:8px;cursor:pointer';

  btnSave = document.createElement('button');
  btnSave.title = 'Save selection';
  btnSave.textContent = '🔍 Save';
  btnSave.style.cssText = btnFocus.style.cssText;

  const btnLoad = document.createElement('button');
  btnLoad.title = 'Load selection';
  btnLoad.textContent = '🔍 Load';
  btnLoad.style.cssText = btnFocus.style.cssText;

  btnFocus.addEventListener('click', async () => {
    if (sel.ids.size === 0) return;
    const ids = Array.from(sel.ids);
    try {
      if (typeof applySelectionAsFilter === 'function') {
        await applySelectionAsFilter(currentSection, { ids });
      } else {
        window.__listState = window.__listState || {};
        const st2 = (window.__listState[currentSection] ||= { page:1, pageSize:50, total:null, hasMore:false, filters:null });
        st2.page = 1; st2.filters = { ...(st2.filters||{}), ids };
        const rows2 = await search(currentSection, st2.filters);
        renderSummary(rows2);
      }
    } catch (e) { console.error('Focus failed', e); }
  });

  btnSave.addEventListener('click', async () => {
    if (sel.ids.size === 0) return;
    try { await openSaveSelectionModal ? openSaveSelectionModal(currentSection) : null; } catch {}
  });

  btnLoad.addEventListener('click', async () => {
    try {
      if (typeof openLoadSelectionModal === 'function') await openLoadSelectionModal(currentSection);
    } catch {}
  });

  selBar.appendChild(btnFocus);
  selBar.appendChild(btnSave);
  selBar.appendChild(btnLoad);
  content.appendChild(selBar);

  // Restore scroll + keep memory updated
  try {
    content.__activeMemKey = memKey;
    content.scrollTop = prevScrollY;
    if (!content.__scrollMemHooked) {
      content.addEventListener('scroll', () => {
        const k = content.__activeMemKey || memKey;
        window.__scrollMemory[k] = content.scrollTop || 0;
      });
      content.__scrollMemHooked = true;
    }
  } catch {}

  // Initial states
  computeHeaderState();
  updateButtons();

  // Focus highlight logic unchanged…
  if (window.__pendingFocus) {
    const pf = window.__pendingFocus;
    const pfSection = pf.section || (pf.entity ? (pf.entity + 's') : null);
    if (pfSection && pfSection === currentSection && pf.id != null) {
      const targetId = String(pf.id);
      const selq = `tr[data-id="${CSS.escape ? CSS.escape(targetId) : targetId}"]`;
      let tr = tb.querySelector(selq);
      if (!tr) {
        if (!pf._retried) {
          pf._retried = true;
          try { if (typeof clearFilters === 'function') clearFilters(); } catch (_){}
          try { renderAll(); } catch (e) { console.error('auto-refresh after filter clear failed', e); }
          return;
        }
        return;
      }
      currentSelection = currentRows.find(x => String(x.id) === targetId) || null;
      try { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { tr.scrollIntoView(); }
      tb.querySelectorAll('tr.selected').forEach(n => n.classList.remove('selected'));
      tr.classList.add('selected');
      const oldOutline = tr.style.outline;
      tr.style.outline = '2px solid #ffbf00';
      setTimeout(() => { tr.style.outline = oldOutline || ''; }, 2000);
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
  // seed defaults for first login / first visit to section
  window.__listState = window.__listState || {};
  if (!window.__listState[currentSection]) {
    window.__listState[currentSection] = { page: 1, pageSize: 50, total: null, hasMore: false, filters: null };
  }
  renderTopNav(); renderTools();
  const data = await loadSection();
  renderSummary(data);
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
