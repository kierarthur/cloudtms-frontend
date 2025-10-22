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



function renderTools(){
  const el = byId('toolButtons');
  const canCreate = ['candidates','clients','umbrellas'].includes(currentSection);
  const canEdit = ['candidates','clients','umbrellas','settings'].includes(currentSection);
  const canDelete = ['candidates','clients','umbrellas'].includes(currentSection);

  el.innerHTML = '';
  const addBtn = (txt, cb)=>{ const b=document.createElement('button'); b.textContent = txt; b.onclick=cb; el.appendChild(b); };

  addBtn('Create New Record', ()=> openCreate());
  addBtn('Edit Record', ()=> openEdit());
  addBtn('Delete Record', ()=> openDelete());
  addBtn('Search…', ()=> openSearchModal());   // <— now opens the modal


  if (!canCreate) el.children[0].classList.add('btn');
  if (!canEdit) el.children[1].classList.add('btn');
  if (!canDelete) el.children[2].classList.add('btn');
}

// NEW: advanced, section-aware search modal
// === UPDATED: Advanced Search — add Roles (any) multi-select, use UK date pickers ===
async function openSearchModal(){
  const TIMESHEET_STATUS = ['ERROR','RECEIVED','REVOKED','SHEETS_PARTIAL','SHEETS_PENDING','SHEETS_SYNCED','STORED'];
  const INVOICE_STATUS   = ['DRAFT','ISSUED','ON_HOLD','PAID'];

  function boolSelect(name, label){
    return `
      <div class="row">
        <label>${label}</label>
        <select name="${name}">
          <option value="">Any</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </div>`;
  }
  function datesUk(nameFrom, labelFrom, nameTo, labelTo){
    // text inputs + we will attach UK date pickers after mount
    return `
      <div class="row"><label>${labelFrom}</label><input type="text" placeholder="DD/MM/YYYY" name="${nameFrom}" /></div>
      <div class="row"><label>${labelTo}</label><input type="text" placeholder="DD/MM/YYYY" name="${nameTo}" /></div>`;
  }
  function multi(name, label, values){
    const opts = values.map(v=>`<option value="${v}">${v}</option>`).join('');
    return `
      <div class="row">
        <label>${label}</label>
        <select name="${name}" multiple size="6">${opts}</select>
      </div>`;
  }

  let form = '';
  if (currentSection === 'candidates'){
    const roles = await loadGlobalRoleOptions();
    const roleOpts = roles.map(r=>`<option value="${r}">${r}</option>`).join('');
    form = `
      <div class="form" id="searchForm">
        ${input('first_name','First name','')}
        ${input('last_name','Last name','')}
        ${input('email','Email','')}
        ${input('phone','Telephone','')}
        <div class="row"><label>Pay method</label>
          <select name="pay_method">
            <option value="">Any</option>
            <option value="PAYE">PAYE</option>
            <option value="UMBRELLA">UMBRELLA</option>
          </select>
        </div>
        <div class="row">
          <label>Roles (any)</label>
          <select name="roles_any" multiple size="6">${roleOpts}</select>
        </div>
        ${boolSelect('active','Active')}
        ${datesUk('created_from','Created from','created_to','Created to')}
      </div>`;
  } else if (currentSection === 'clients'){
    form = `
      <div class="form" id="searchForm">
        ${input('name','Client name','')}
        ${input('cli_ref','Client Ref','')}
        ${input('primary_invoice_email','Primary invoice email','')}
        ${input('ap_phone','A/P phone','')}
        ${boolSelect('vat_chargeable','VAT chargeable')}
        ${datesUk('created_from','Created from','created_to','Created to')}
      </div>`;
  } else if (currentSection === 'umbrellas'){
    form = `
      <div class="form" id="searchForm">
        ${input('name','Name','')}
        ${input('bank_name','Bank','')}
        ${input('sort_code','Sort code','')}
        ${input('account_number','Account number','')}
        ${boolSelect('vat_chargeable','VAT chargeable')}
        ${boolSelect('enabled','Enabled')}
        ${datesUk('created_from','Created from','created_to','Created to')}
      </div>`;
  } else if (currentSection === 'timesheets'){
    form = `
      <div class="form" id="searchForm">
        ${input('booking_id','Booking ID','')}
        ${input('occupant_key_norm','Occupant key','')}
        ${input('hospital_norm','Hospital','')}
        ${datesUk('worked_from','Worked from (date)','worked_to','Worked to (date)')}
        ${datesUk('week_ending_from','Week ending from','week_ending_to','Week ending to')}
        ${multi('status','Status (multi-select)', TIMESHEET_STATUS)}
        ${datesUk('created_from','Created from','created_to','Created to')}
      </div>`;
  } else if (currentSection === 'invoices'){
    form = `
      <div class="form" id="searchForm">
        ${input('invoice_no','Invoice number','')}
        ${input('client_id','Client ID (UUID)','')}
        ${multi('status','Status (multi-select)', INVOICE_STATUS)}
        ${datesUk('issued_from','Issued from','issued_to','Issued to')}
        ${datesUk('due_from','Due from','due_to','Due to')}
        ${datesUk('created_from','Created from','created_to','Created to')}
      </div>`;
  } else {
    form = `<div class="tabc">No advanced search for this section.</div>`;
  }

  showModal('Advanced Search', [{key:'filter',label:'Filters'}], ()=> form, async ()=>{
    const raw = collectForm('#searchForm', false);

    // Convert select[multiple] to array and booleans from "true"/"false"
    Object.keys(raw).forEach(k=>{
      const el = document.querySelector(`#searchForm [name="${k}"]`);
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

    // Convert any UK date inputs to ISO for the filters
    ['created_from','created_to','worked_from','worked_to','week_ending_from','week_ending_to','issued_from','issued_to','due_from','due_to']
      .forEach(f => {
        if (raw[f]) {
          const iso = parseUkDateToIso(raw[f]);
          if (iso) raw[f] = iso;
        }
      });

    // Call existing search
    const rows = await search(currentSection, JSON.stringify(raw));
    if (rows) renderSummary(rows);
    closeModal();
  }, false);

  // After mount: attach UK date pickers
  document.querySelectorAll('#searchForm input[placeholder="DD/MM/YYYY"]').forEach(attachUkDatePicker);
}

// ===================== NEW HELPERS (UI + data) =====================

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
  const list = await listClientRates(); // no client_id → all
  const set = new Set();
  (list || []).forEach(r => { if (r.role) set.add(r.role); });
  const arr = [...set].sort((a,b)=> a.localeCompare(b));
  __GLOBAL_ROLE_CODES_CACHE__ = arr;
  __GLOBAL_ROLE_CODES_CACHE_TS__ = now;
  return arr;
}

// Render roles editor into a container; updates modalCtx.rolesState
function renderRolesEditor(container, rolesState, allRoleOptions){
  // Use a local mutable copy so the updater can refresh options
  let roleOptions = Array.isArray(allRoleOptions) ? allRoleOptions.slice() : [];

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

  function availableOptions(){
    const picked = new Set((rolesState||[]).map(x => x.code));
    return roleOptions.filter(code => !picked.has(code));
  }

  function refreshAddSelect(){
    const opts = ['<option value="">Add role…</option>'].concat(
      availableOptions().map(code => `<option value="${code}">${code}</option>`)
    ).join('');
    sel.innerHTML = opts;
  }

  function renderList(){
    ul.innerHTML = '';
    const arr = (rolesState||[]).slice().sort((a,b)=> a.rank - b.rank);

    arr.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'role-item';
      li.draggable = true;                 // drag starts on the whole LI
      li.dataset.index = String(idx);      // source-of-truth index for this render

      li.innerHTML = `
        <span class="drag" title="Drag to reorder" style="cursor:grab">⋮⋮</span>
        <span class="rank">${item.rank}.</span>
        <span class="code">${item.code}</span>
        <input class="label" type="text" placeholder="Optional label…" value="${item.label || ''}" />
        <button class="remove" type="button" title="Remove">✕</button>
      `;

      // Remove
      li.querySelector('.remove').onclick = () => {
        rolesState = rolesState.filter((_, i) => i !== idx);
        rolesState = normaliseRolesForSave(rolesState);
        modalCtx.rolesState = rolesState;
        renderList(); refreshAddSelect();
      };

      // Label change
      li.querySelector('.label').oninput = (e) => {
        rolesState[idx].label = e.target.value;
        modalCtx.rolesState = rolesState;
      };

      // Set the drag payload on dragstart (use a custom type and plain text for safety)
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

  // === Delegated DnD handlers on the UL (works even if you drop on inner elements) ===
  ul.addEventListener('dragover', (e) => {
    e.preventDefault(); // allow drop
    const overLi = e.target && e.target.closest('li.role-item');
    ul.querySelectorAll('.over').forEach(n => n.classList.remove('over'));
    if (overLi) overLi.classList.add('over');
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });

  ul.addEventListener('drop', (e) => {
    e.preventDefault();
    const toLi = e.target && e.target.closest('li.role-item');
    if (!toLi) return;

    // Read source index from payload (supports both custom and plain)
    let from = NaN;
    try { from = parseInt(e.dataTransfer.getData('text/x-role-index'), 10); } catch {}
    if (isNaN(from)) {
      try { from = parseInt(e.dataTransfer.getData('text/plain'), 10); } catch {}
    }
    const to = parseInt(toLi.dataset.index, 10);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;

    // Reorder against the CURRENT rank-sorted view
    const view = (rolesState||[]).slice().sort((a,b)=> a.rank - b.rank);
    const [moved] = view.splice(from, 1);
    view.splice(to, 0, moved);

    // Normalise (sets rank 1..N and returns sorted array)
    rolesState = normaliseRolesForSave(view);
    modalCtx.rolesState = rolesState;

    // Re-render list & add-select
    renderList();
    refreshAddSelect();
  });

  // Add button
  btn.onclick = () => {
    const code = sel.value;
    if (!code) return;
    if ((rolesState||[]).some(r => r.code === code)) return; // no duplicates
    const nextRank = ((rolesState||[]).length || 0) + 1;
    rolesState = [...(rolesState||[]), { code, rank: nextRank }];
    rolesState = normaliseRolesForSave(rolesState);
    modalCtx.rolesState = rolesState;
    renderList(); refreshAddSelect();
  };

  // Expose a tiny API on the container to refresh options in-place
  container.__rolesEditor = {
    updateOptions(newOptions){
      roleOptions = Array.isArray(newOptions) ? newOptions.slice() : [];
      refreshAddSelect();
    }
  };

  // Initial render
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
async function listClientRates(clientId, opts = {}) {
  const qp = new URLSearchParams();
  if (clientId) qp.set('client_id', clientId);
  if (opts.rate_type) qp.set('rate_type', String(opts.rate_type).toUpperCase());
  if (opts.role) qp.set('role', opts.role);
  if (opts.band !== undefined && opts.band !== null && opts.band !== '') qp.set('band', opts.band);
  if (opts.active_on) qp.set('active_on', opts.active_on); // YYYY-MM-DD
  const qs = qp.toString() ? `?${qp.toString()}` : '';
  const r = await authFetch(API(`/api/rates/client-defaults${qs}`));
  return toList(r);
}

// POST /api/rates/client-defaults — requires rate_type = 'PAYE' | 'UMBRELLA'
async function upsertClientRate(payload) {
  const rt = String(payload?.rate_type || '').toUpperCase();
  if (rt !== 'PAYE' && rt !== 'UMBRELLA') throw new Error("rate_type must be 'PAYE' or 'UMBRELLA'");
  const r = await authFetch(API('/api/rates/client-defaults'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, rate_type: rt })
  });
  return r.ok;
}

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
async function findBestChargeFor({ client_id, role, band, active_on }) {
  const rows = await listClientRates(client_id, { role, band, active_on });
  if (!Array.isArray(rows) || !rows.length) return null;
  // rows are already ordered server-side (specificity + date_from.desc); just take first
  const r = rows[0] || null;
  return r ? {
    charge_day: r.charge_day ?? null,
    charge_night: r.charge_night ?? null,
    charge_sat: r.charge_sat ?? null,
    charge_sun: r.charge_sun ?? null,
    charge_bh: r.charge_bh ?? null
  } : null;
}

// Small helper: per-bucket margin
function calcMargin(charge, pay, rate_type, erni_pct = 0) {
  if (charge == null || pay == null) return null;
  const rt = String(rate_type || '').toUpperCase();
  if (rt === 'PAYE') {
    const denom = 1 + (Number.isFinite(erni_pct) ? erni_pct : 0);
    return +(charge - (pay / denom)).toFixed(2);
  }
  return +(charge - pay).toFixed(2); // Umbrella
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

async function search(section, q){
  const map = {
    candidates:'/api/search/candidates',
    clients:'/api/search/clients',
    umbrellas:'/api/search/umbrellas',
    timesheets:'/api/search/timesheets',
    invoices:'/api/search/invoices'
  };
  const p = map[section]; if (!p) return [];
  const r = await authFetch(API(`${p}?q=${encodeURIComponent(q)}`));
  return toList(r);
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
async function openCandidate(row) {
  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));
  const seedId = row?.id || null;

  modalCtx = {
    entity: 'candidates',
    data: deep(row),
    formState: { __forId: seedId, main: {}, pay: {} },
    rolesState: Array.isArray(row?.roles) ? normaliseRolesForSave(row.roles) : [],
    ratesState: null,
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
      if (isNew && !payload.first_name && !payload.last_name) { alert('Enter at least a first or last name.'); return; }
      if (payload.pay_method === 'PAYE') payload.umbrella_id = null;
      else {
        if (!payload.umbrella_id || payload.umbrella_id === '') { alert('Select an umbrella company for UMBRELLA pay.'); return; }
      }
      if (payload.umbrella_id === '') payload.umbrella_id = null;

      for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];

      const idForUpdate = modalCtx?.data?.id || row?.id || null;
      await upsertCandidate(payload, idForUpdate);

      modalCtx.formState = { __forId: idForUpdate || null, main: {}, pay: {} };
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

  if (row?.id) {
    const token = modalCtx.openToken;
    const id    = row.id;

    try {
      const rates = await listCandidateRates(id);
      if (token === modalCtx.openToken && modalCtx.data?.id === id) {
        await renderCandidateRatesTable(rates);
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
async function renderCandidateRatesTable(rates) {
  const token   = modalCtx.openToken;
  const idActive= modalCtx.data?.id || null;

  const div = byId('ratesTable');
  if (!div) return;

  // Build a lookup of client_id -> client name
  let clientsById = {};
  try {
    const clients = await listClientsBasic(); // [{id,name}]
    if (token !== modalCtx.openToken || modalCtx.data?.id !== idActive) return; // stale
    clientsById = Object.fromEntries((clients || []).map(c => [c.id, c.name]));
  } catch (e) {
    console.error('Failed to load clients for candidate rates table', e);
  }

  if (!rates || !rates.length) {
    if (token !== modalCtx.openToken || modalCtx.data?.id !== idActive) return;
    div.innerHTML = `
      <div class="hint" style="margin-bottom:8px">No candidate-specific rates. Client defaults will apply.</div>
      <div class="actions"><button id="btnAddRate">Add rate override</button></div>
    `;
    const addBtn = byId('btnAddRate');
    if (addBtn) addBtn.onclick = () => openCandidateRateModal(modalCtx.data?.id);
    return;
  }

  // Now includes rate_type
  const cols    = ['client','role','band','rate_type','pay_day','pay_night','pay_sat','pay_sun','pay_bh','date_from','date_to'];
  const headers = ['Client','Role','Band','Type','Pay Day','Pay Night','Pay Sat','Pay Sun','Pay BH','Date from','Date to'];

  const rows = (rates || []).map(r => ({ ...r, client: clientsById[r.client_id] || '' }));

  if (token !== modalCtx.openToken || modalCtx.data?.id !== idActive) return;

  const tbl   = document.createElement('table'); tbl.className = 'grid';
  const thead = document.createElement('thead');
  const trh   = document.createElement('tr');
  headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
  thead.appendChild(trh); tbl.appendChild(thead);

  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.ondblclick = () => openCandidateRateModal(modalCtx.data?.id, r);
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
  actions.innerHTML = `<button id="btnAddRate">Add rate override</button>`;

  if (token !== modalCtx.openToken || modalCtx.data?.id !== idActive) return;
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

  if (key === 'rates') return html(`
    <div id="tab-rates">
      <div class="actions"><button id="btnAddRate">Add rate override</button></div>
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
async function openCandidateRateModal(candidate_id, existing) {
  const parentToken  = modalCtx.openToken;
  const parentEntity = modalCtx.entity;
  const parentId     = modalCtx.data?.id || null;

  const clients = await listClientsBasic();
  const clientOptions = clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const initialClientId = existing?.client_id || (clients[0]?.id || '');

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

      <!-- Live margin preview (read-only) -->
      <div class="row" style="grid-column:1/-1">
        <div id="cr_margin_box" class="hint" style="padding:8px;border:1px dashed #ddd;border-radius:8px">
          Enter pay and select rate type to preview margin (per bucket) using current client charge and Employers NI%.
        </div>
      </div>
    </div>
  `);

  const title = existing ? 'Edit Candidate Rate Override' : 'Add Candidate Rate Override';

  let cache = { roles: [], bandsByRole: {} };
  let lastCharge = null; // {charge_day,...}
  let erniPct = 0;

  showModal(title, [{ key:'form', label:'Form' }], () => formHtml, async () => {
    if (parentToken !== modalCtx.openToken || parentEntity !== 'candidates' || modalCtx.data?.id !== candidate_id) {
      alert('This rate form is no longer current. Please reopen it.');
      return;
    }
    const raw = collectForm('#candRateForm');

    if (!raw.client_id) { alert('Client is required'); return; }
    if (!raw.rate_type) { alert('Rate type is required'); return; }
    if (!raw.role)      { alert('Role is required'); return; }
    if (!raw.date_from) { alert('Effective from is required'); return; }

    const isoFrom = parseUkDateToIso(raw.date_from);
    if (!isoFrom) { alert('Invalid Effective from date'); return; }
    let isoTo = null;
    if (raw.date_to) {
      isoTo = parseUkDateToIso(raw.date_to);
      if (!isoTo) { alert('Invalid Effective to date'); return; }
      if (isoTo < isoFrom) { alert('Effective to cannot be before Effective from'); return; }
    }

    // Overlap guard: for same client+role+(band||null) and SAME rate_type, disallow overlapping
    try {
      const all = await listCandidateRates(candidate_id);
      const sameType = (all || []).filter(x =>
        String(x.client_id) === String(raw.client_id) &&
        String(x.role || '') === String(raw.role || '') &&
        (String(x.band || '') === String(raw.band || '')) &&
        String(x.rate_type || '').toUpperCase() === String(raw.rate_type || '').toUpperCase() &&
        (!existing || x.id !== existing.id)
      );
      const overlap = sameType.some(x => rangesOverlap(isoFrom, isoTo, x.date_from || null, x.date_to || null));
      if (overlap) {
        alert('Date range overlaps an existing override for the same client/role/band and rate type.');
        return;
      }
    } catch (e) {
      console.warn('Overlap check failed (continuing with save):', e);
    }

    const payload = {
      candidate_id,
      client_id: raw.client_id,
      role: raw.role,
      band: raw.band || null,
      rate_type: String(raw.rate_type).toUpperCase(),
      date_from: isoFrom,
      date_to: isoTo,
      pay_day:   raw.pay_day   !== '' ? Number(raw.pay_day)   : null,
      pay_night: raw.pay_night !== '' ? Number(raw.pay_night) : null,
      pay_sat:   raw.pay_sat   !== '' ? Number(raw.pay_sat)   : null,
      pay_sun:   raw.pay_sun   !== '' ? Number(raw.pay_sun)   : null,
      pay_bh:    raw.pay_bh    !== '' ? Number(raw.pay_bh)    : null,
    };

    let ok = false;
   if (existing) {
  // Build WHERE-side filters; pass 'null' literal for NULL band so the backend uses is.null
  const q = new URLSearchParams();
  q.set('rate_type', payload.rate_type);
  q.set('client_id', payload.client_id || 'null');
  q.set('role',      payload.role      || 'null');
  q.set('band',      (payload.band ?? 'null'));
  const url = `/api/rates/candidate-overrides/${candidate_id}?${q.toString()}`;

  const resp = await authFetch(API(url), {
    method:'PATCH',
    headers:{'content-type':'application/json'},
    body: JSON.stringify(payload)
  });
      if (!resp.ok) {
        const msg = await resp.text().catch(()=> 'Save failed');
        alert(msg || 'Save failed'); return;
      }
      ok = true;
    } else {
      try {
        ok = await addCandidateRate(payload);
      } catch (e) {
        alert(e.message || 'Save failed'); return;
      }
      if (!ok) { alert('Save failed'); return; }
    }

    await mountCandidateRatesTab();
    closeModal();
  }, false);

  // After mount
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
    selRole.disabled = true; bandRow.style.display = 'none'; selBand.innerHTML = '';
    if (!clientId) return;

    const activeOn = parseUkDateToIso(inFrom.value || '') || null;
    const rt = String(selRateT.value || '').toUpperCase() || undefined;
    const list = await listClientRates(clientId, { rate_type: rt, active_on: activeOn });

    if (parentToken !== modalCtx.openToken || modalCtx.entity !== 'candidates' || modalCtx.data?.id !== parentId) return;

    const roles = new Set(); const bandsByRole = {};
    (list || []).forEach(r => {
      if (r.role) {
        roles.add(r.role);
        if (r.band) {
          if (!bandsByRole[r.role]) bandsByRole[r.role] = new Set();
          bandsByRole[r.role].add(r.band);
        }
      }
    });

    // Gate by candidate's allowed roles
    const liveRoles = Array.isArray(modalCtx?.rolesState) && modalCtx.rolesState.length
      ? modalCtx.rolesState : (Array.isArray(modalCtx?.data?.roles) ? modalCtx.data.roles : []);
    const candRoleCodes = liveRoles.map(x => x.code);
    const allowed = [...roles].filter(code => candRoleCodes.includes(code));

    if (!allowed.length) {
      selRole.innerHTML = `<option value="">Select role…</option>`;
      selRole.disabled = true;
      alert("This candidate has no matching roles for this client / type. Add the role to the candidate or add a Client Default Rate first.");
      return;
    }

    allowed.sort((a,b)=> a.localeCompare(b));
    selRole.innerHTML = `<option value="">Select role…</option>` + allowed.map(code => `<option value="${code}">${code}</option>`).join('');
    selRole.disabled = false;

    cache.roles = allowed;
    cache.bandsByRole = Object.fromEntries(Object.entries(bandsByRole).map(([k,v]) => [k, [...v]]));

    // Pre-select existing role/band for edit
    if (existing?.role) {
      selRole.value = existing.role;
      selRole.dispatchEvent(new Event('change'));
      if (existing?.band) selBand.value = existing.band;
    }
  }

  function onRoleChanged() {
    const role = selRole.value;
    const bands = cache.bandsByRole[role] || [];
    if (bands.length) {
      bands.sort((a,b)=> String(a).localeCompare(String(b)));
      selBand.innerHTML = `<option value="">(none)</option>` + bands.map(b => `<option value="${b}">${b}</option>`).join('');
      bandRow.style.display = '';
    } else {
      selBand.innerHTML = '';
      bandRow.style.display = 'none';
    }
    refreshMargin();
  }

  async function refreshMargin() {
    // fetch settings (erni)
    const s = await getSettingsCached();
    // Robust ERNI% normalization (handles numbers, strings, and "15%")
const erniPct = (() => {
  const v = s?.erni_pct;
  if (v == null) return 0;

  if (typeof v === 'string') {
    const m = v.trim();
    if (!m) return 0;
    if (m.endsWith('%')) {
      const n = parseFloat(m.slice(0, -1));
      return Number.isFinite(n) ? Math.max(0, n / 100) : 0;
    }
    const n = parseFloat(m);
    return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : 0;
  }

  const n = Number(v);
  return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : 0;
})();

    const role = selRole.value || null;
    const band = selBand.value || null;
    const rt   = String(selRateT.value || '').toUpperCase();
    const client_id = selClient.value || null;
    const active_on = parseUkDateToIso(inFrom.value || '') || null;

    // fetch shared charge for the chosen window
    lastCharge = client_id && role ? (await findBestChargeFor({ client_id, role, band, active_on })) : null;

    // Collect pay inputs
    const raw = collectForm('#candRateForm');
    const pays = {
      day:   raw.pay_day   === '' ? null : Number(raw.pay_day),
      night: raw.pay_night === '' ? null : Number(raw.pay_night),
      sat:   raw.pay_sat   === '' ? null : Number(raw.pay_sat),
      sun:   raw.pay_sun   === '' ? null : Number(raw.pay_sun),
      bh:    raw.pay_bh    === '' ? null : Number(raw.pay_bh)
    };
    const chg = lastCharge || {};

    function line(lbl, bucket) {
      const charge = chg[`charge_${bucket}`];
      const pay    = pays[bucket];
      const m = calcMargin(charge, pay, rt, erniPct);
      const v = (charge==null || pay==null) ? '—' : `£${m.toFixed(2)}`;
      return `<div>${lbl}: <strong>${v}</strong></div>`;
    }

    const expl = (rt === 'PAYE')
      ? `PAYE margin uses Employers NI ${(erniPct*100).toFixed(2)}%: margin = charge − (pay / (1 + NI)).`
      : `Umbrella margin: margin = charge − pay.`;

    box.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
        ${line('Day','day')}${line('Night','night')}${line('Sat','sat')}
        ${line('Sun','sun')}${line('BH','bh')}<div></div>
      </div>
      <div class="hint" style="margin-top:6px">${expl}</div>
    `;
  }

  // Bind events
  selClient.addEventListener('change', () => { refreshClientRoles(selClient.value); refreshMargin(); });
  selRateT .addEventListener('change', () => { refreshClientRoles(selClient.value); refreshMargin(); });
  document.querySelectorAll('#candRateForm input[type="number"]').forEach(el => el.addEventListener('input', refreshMargin));
  inFrom.addEventListener('change', () => { refreshClientRoles(selClient.value); refreshMargin(); });
  selRole.addEventListener('change', onRoleChanged);
  selBand.addEventListener('change', refreshMargin);

  // Initial hydrate
  selClient.value = initialClientId;
  await refreshClientRoles(initialClientId);
  attachUkDatePicker(inFrom); attachUkDatePicker(inTo);
  if (existing?.role) {
    selRole.value = existing.role;
    selRole.dispatchEvent(new Event('change'));
    if (existing?.band) selBand.value = existing.band;
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
async function openClient(row) {
  const deep = (o)=> JSON.parse(JSON.stringify(o || {}));
  const seedId = row?.id || null;

  modalCtx = {
    entity: 'clients',
    data: deep(row),
    formState: { __forId: seedId, main: {} },
    ratesState: [],
    // Hospitals staged model
    hospitalsState: { existing: [], stagedNew: [], stagedEdits: {}, stagedDeletes: new Set() },
    clientSettingsState: {},
    openToken: (seedId || 'new') + ':' + Date.now()
  };

  if (seedId) {
    const token = modalCtx.openToken;
    try {
      const rates = await listClientRates(seedId);
      if (token === modalCtx.openToken && modalCtx.data?.id === seedId) {
        // Ensure rate_type is present (UMBRELLA default if missing)
        modalCtx.ratesState = (rates || []).map(r => ({ ...r, rate_type: String(r.rate_type || 'UMBRELLA').toUpperCase() }));
      }
    } catch (e) { console.error('openClient preload rates error', e); }

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

      // === Commit staged RATES (with overlap validation per (role,band,rate_type))
      if (clientId && Array.isArray(modalCtx.ratesState)) {
        // Validate overlaps in the staged set first (client-side assurance)
        const rates = modalCtx.ratesState.slice();
        for (let i=0;i<rates.length;i++){
          for (let j=i+1;j<rates.length;j++){
            const A = rates[i], B = rates[j];
            if (String(A.role||'')===String(B.role||'') &&
                String(A.band||'')===String(B.band||'') &&
                String(String(A.rate_type||'').toUpperCase())===String(String(B.rate_type||'').toUpperCase()) &&
                rangesOverlap(A.date_from||null, A.date_to||null, B.date_from||null, B.date_to||null)) {
              alert(`Client default rates overlap for role=${A.role} band=${A.band||'(none)'} type=${A.rate_type}. Please fix before saving.`);
              return;
            }
          }
        }

        for (const rate of rates) {
          try {
            await upsertClientRate({
              client_id: clientId,
              role: rate.role || '',
              band: rate.band || null,
              date_from: rate.date_from || null,
              date_to:   rate.date_to   || null,
              rate_type: String(rate.rate_type || 'UMBRELLA').toUpperCase(),
              charge_day:   rate.charge_day   ?? null,
              charge_night: rate.charge_night ?? null,
              charge_sat:   rate.charge_sat   ?? null,
              charge_sun:   rate.charge_sun   ?? null,
              charge_bh:    rate.charge_bh    ?? null,
              pay_day:      rate.pay_day      ?? null,
              pay_night:    rate.pay_night    ?? null,
              pay_sat:      rate.pay_sat      ?? null,
              pay_sun:      rate.pay_sun      ?? null,
              pay_bh:       rate.pay_bh       ?? null,
            });
          } catch (e) {
            console.error('Upsert client rate failed', rate, e);
          }
        }
      }

      // === Commit staged HOSPITALS — three-phase (create, update, delete)
      if (clientId && modalCtx.hospitalsState && typeof modalCtx.hospitalsState === 'object') {
        const H = modalCtx.hospitalsState;

        // Validate dedupe (by name_norm) and blanks
        const existingAlive = (H.existing || []).filter(x => !H.stagedDeletes.has(x.id));
        const names = new Set(existingAlive.map(x => String(x.hospital_name_norm||'').trim().toUpperCase()).filter(Boolean));

        for (const n of H.stagedNew) {
          const nm = String(n.hospital_name_norm||'').trim();
          if (!nm) { alert('Hospital / Trust is required'); return; }
          const norm = nm.toUpperCase();
          if (names.has(norm)) { alert(`Duplicate hospital: ${nm}`); return; }
          names.add(norm);
        }
        for (const [id, patch] of Object.entries(H.stagedEdits)) {
          if (H.stagedDeletes.has(id)) continue;
          if (patch.hospital_name_norm !== undefined) {
            const nm = String(patch.hospital_name_norm||'').trim();
            if (!nm) { alert('Hospital / Trust is required'); return; }
            const norm = nm.toUpperCase();
            // Allow keeping the same value (check by comparing against the row being edited)
            const orig = (H.existing || []).find(x => String(x.id)===String(id));
            const currentNorm = String(orig?.hospital_name_norm||'').trim().toUpperCase();
            if (norm !== currentNorm && names.has(norm)) { alert(`Duplicate hospital: ${nm}`); return; }
            names.add(norm);
          }
        }

        // 1) Creates
        for (const h of (H.stagedNew || [])) {
          const res = await authFetch(API(`/api/clients/${clientId}/hospitals`), {
            method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({
              hospital_name_norm: (h.hospital_name_norm||'').trim(),
              ward_hint: h.ward_hint ?? null
            })
          });
          if (!res.ok) {
            const msg = await res.text().catch(()=> ''); alert(`Create hospital failed: ${msg}`); return;
          }
        }

        // 2) Updates (skip deletions)
        for (const [hid, patch] of Object.entries(H.stagedEdits || {})) {
          if (H.stagedDeletes.has(hid)) continue;
          const res = await authFetch(API(`/api/clients/${clientId}/hospitals/${encodeURIComponent(hid)}`), {
            method:'PATCH', headers:{'content-type':'application/json'},
            body: JSON.stringify(patch)
          });
          if (!res.ok) {
            const msg = await res.text().catch(()=> ''); alert(`Update hospital failed: ${msg}`); return;
          }
        }

        // 3) Deletes
        for (const hid of (H.stagedDeletes || new Set())) {
          const res = await authFetch(API(`/api/clients/${clientId}/hospitals/${encodeURIComponent(hid)}`), { method:'DELETE' });
          if (!res.ok && res.status !== 404) {
            const msg = await res.text().catch(()=> ''); alert(`Delete hospital failed: ${msg}`); return;
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
function renderClientRatesTable(rates) {
  const div = byId('clientRates'); if (!div) return;
  const staged = Array.isArray(modalCtx.ratesState) ? modalCtx.ratesState : [];
  div.innerHTML = '';

  if (!staged.length) {
    div.innerHTML = `
      <div class="hint" style="margin-bottom:8px">No client default rates yet.</div>
      <div class="actions"><button id="btnAddClientRate">Add/Upsert client rate</button></div>
    `;
    const addBtn = byId('btnAddClientRate');
    if (addBtn) addBtn.onclick = () => openClientRateModal(modalCtx.data?.id);
    return;
  }

  // Now includes rate_type column
  const cols = [
    'role','band','rate_type',
    'charge_day','charge_night','charge_sat','charge_sun','charge_bh',
    'pay_day','pay_night','pay_sat','pay_sun','pay_bh',
    'date_from','date_to'
  ];

  const tbl   = document.createElement('table'); tbl.className='grid';
  const thead = document.createElement('thead');
  const trh   = document.createElement('tr');
  cols.forEach(c => { const th = document.createElement('th'); th.textContent = c; trh.appendChild(th); });
  thead.appendChild(trh); tbl.appendChild(thead);

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
  actions.innerHTML = `<button id="btnAddClientRate">Add/Upsert client rate</button>`;

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
  renderClientRatesTable(modalCtx.ratesState || []);
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
async function openClientRateModal(client_id, existing) {
  const parentToken  = modalCtx.openToken;
  const parentEntity = modalCtx.entity;
  const parentId     = modalCtx.data?.id || null;

  const globalRoles = await loadGlobalRoleOptions();
  const roleOptions = globalRoles.map(r => `<option value="${r}">${r}</option>`).join('')
                    + `<option value="__OTHER__">+ Add new role…</option>`;

  const defaultRateType = existing?.rate_type ? String(existing.rate_type).toUpperCase() : 'UMBRELLA';

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
        <input type="text" name="band" id="cl_band" value="${existing?.band || ''}"/>
      </div>

      <div class="row">
        <label>Rate type (required)</label>
        <select name="rate_type" id="cl_rate_type" required>
          <option ${defaultRateType==='PAYE'?'selected':''}>PAYE</option>
          <option ${defaultRateType==='UMBRELLA'?'selected':''}>UMBRELLA</option>
        </select>
      </div>

      <div class="row">
        <label>Effective from (DD/MM/YYYY)</label>
        <input type="text" name="date_from" id="cl_date_from" placeholder="DD/MM/YYYY" />
      </div>
      <div class="row">
        <label>Effective to (optional, DD/MM/YYYY)</label>
        <input type="text" name="date_to" id="cl_date_to" placeholder="DD/MM/YYYY" />
      </div>

      ${input('charge_day','Charge (Day)',     existing?.charge_day     ?? '', 'number')}
      ${input('charge_night','Charge (Night)', existing?.charge_night   ?? '', 'number')}
      ${input('charge_sat','Charge (Sat)',     existing?.charge_sat     ?? '', 'number')}
      ${input('charge_sun','Charge (Sun)',     existing?.charge_sun     ?? '', 'number')}
      ${input('charge_bh','Charge (BH)',       existing?.charge_bh       ?? '', 'number')}

      <div class="row"><label class="hint">Optional default pay (used if no candidate-specific override at compute time):</label></div>
      ${input('pay_day','Pay (Day)',     existing?.pay_day     ?? '', 'number')}
      ${input('pay_night','Pay (Night)', existing?.pay_night   ?? '', 'number')}
      ${input('pay_sat','Pay (Sat)',     existing?.pay_sat     ?? '', 'number')}
      ${input('pay_sun','Pay (Sun)',     existing?.pay_sun     ?? '', 'number')}
      ${input('pay_bh','Pay (BH)',       existing?.pay_bh       ?? '', 'number')}

      <!-- Live margin preview (read-only) -->
      <div class="row" style="grid-column:1/-1">
        <div id="cl_margin_box" class="hint" style="padding:8px;border:1px dashed #ddd;border-radius:8px">
          Enter charge/pay and select rate type to preview margin (per bucket) using Employers NI%.
        </div>
      </div>
    </div>
  `);

  const title = existing ? 'Edit Client Default Rate' : 'Add/Upsert Client Default Rate';

  showModal(title, [{ key:'form', label:'Form' }], () => formHtml, async () => {
    // stale-guard
    if (parentToken !== modalCtx.openToken || parentEntity !== 'clients' || modalCtx.data?.id !== client_id) {
      alert('This rate form is no longer current. Please reopen it.');
      return;
    }

    const raw = collectForm('#clientRateForm');

    // Resolve role/new role
    let role = raw.role;
    const newRole = (document.getElementById('cl_role_new')?.value || '').trim();
    if (role === '__OTHER__') {
      if (!newRole) { alert('Enter a new role code'); return; }
      role = newRole.toUpperCase();
      invalidateGlobalRoleOptionsCache && invalidateGlobalRoleOptionsCache();
      try { window.dispatchEvent(new CustomEvent('global-roles-updated')); } catch {}
    }
    if (!role) { alert('Role is required'); return; }
    if (!raw.rate_type) { alert('Rate type is required'); return; }
    if (!raw.date_from) { alert('Effective from is required'); return; }

    const isoFrom = parseUkDateToIso(raw.date_from);
    if (!isoFrom) { alert('Invalid Effective from date'); return; }
    let isoTo = null;
    if (raw.date_to) {
      isoTo = parseUkDateToIso(raw.date_to);
      if (!isoTo) { alert('Invalid Effective to date'); return; }
      if (isoTo < isoFrom) { alert('Effective to cannot be before Effective from'); return; }
    }

    // Build staged row (uniqueness: client_id, role, band, date_from, rate_type)
    const staged = {
      client_id,
      role,
      band: raw.band || null,
      rate_type: String(raw.rate_type).toUpperCase(),
      date_from: isoFrom,
      date_to: isoTo,
      charge_day:   raw.charge_day   !== '' ? Number(raw.charge_day)   : null,
      charge_night: raw.charge_night !== '' ? Number(raw.charge_night) : null,
      charge_sat:   raw.charge_sat   !== '' ? Number(raw.charge_sat)   : null,
      charge_sun:   raw.charge_sun   !== '' ? Number(raw.charge_sun)   : null,
      charge_bh:    raw.charge_bh    !== '' ? Number(raw.charge_bh)    : null,
      pay_day:      raw.pay_day      !== '' ? Number(raw.pay_day)      : null,
      pay_night:    raw.pay_night    !== '' ? Number(raw.pay_night)    : null,
      pay_sat:      raw.pay_sat      !== '' ? Number(raw.pay_sat)      : null,
      pay_sun:      raw.pay_sun      !== '' ? Number(raw.pay_sun)      : null,
      pay_bh:       raw.pay_bh       !== '' ? Number(raw.pay_bh)       : null,
    };

    // Overlap guard (same role/band AND same rate_type)
    const list = Array.isArray(modalCtx.ratesState) ? modalCtx.ratesState.slice() : [];
    const isSame = (r) =>
      String(r.role || '') === String(staged.role || '') &&
      String(r.band || '') === String(staged.band || '') &&
      String(String(r.rate_type || '').toUpperCase()) === staged.rate_type;
    const others = existing ? list.filter(r => r !== existing && isSame(r)) : list.filter(r => isSame(r));
    const hasOverlap = others.some(r => rangesOverlap(staged.date_from, staged.date_to, r.date_from || null, r.date_to || null));
    if (hasOverlap) {
      alert('Date range overlaps an existing client default for the same role/band and rate type.');
      return;
    }

    // Stage into parent state (edit in place or push new)
    modalCtx.ratesState = Array.isArray(modalCtx.ratesState) ? modalCtx.ratesState : [];
    if (existing) {
      const idx = modalCtx.ratesState.findIndex(r => r === existing);
      if (idx >= 0) modalCtx.ratesState[idx] = staged; else modalCtx.ratesState.push(staged);
    } else {
      modalCtx.ratesState.push(staged);
    }

    // === NEW: confirm + auto-mirror SHARED charge across the other rate_type ===
    (function mirrorSharedChargeWithConfirm() {
      const src = staged;
      const otherType = src.rate_type === 'PAYE' ? 'UMBRELLA' : 'PAYE';

      // detect if any charge is set
      const hasAnyCharge =
        src.charge_day != null || src.charge_night != null ||
        src.charge_sat != null || src.charge_sun != null || src.charge_bh != null;

      // detect if charges changed (for edit) — only then prompt
      const chargesChanged = existing
        ? (
            (existing.charge_day   ?? null) !== (src.charge_day   ?? null) ||
            (existing.charge_night ?? null) !== (src.charge_night ?? null) ||
            (existing.charge_sat   ?? null) !== (src.charge_sat   ?? null) ||
            (existing.charge_sun   ?? null) !== (src.charge_sun   ?? null) ||
            (existing.charge_bh    ?? null) !== (src.charge_bh    ?? null)
          )
        : hasAnyCharge;

      if (!hasAnyCharge || !chargesChanged) return;

      const rows = Array.isArray(modalCtx.ratesState) ? modalCtx.ratesState : [];
      const idx = rows.findIndex(r =>
        String(r.role || '')      === String(src.role || '') &&
        String(r.band || '')      === String(src.band || '') &&
        String(r.date_from || '') === String(src.date_from || '') &&
        String(r.date_to || '')   === String(src.date_to || '') &&
        String((r.rate_type || '').toUpperCase()) === otherType
      );

      // Determine whether mirroring will create or update
      const willCreateOther = (idx < 0);
      const willUpdateOther = (idx >= 0) && (
        (rows[idx].charge_day   ?? null) !== (src.charge_day   ?? null) ||
        (rows[idx].charge_night ?? null) !== (src.charge_night ?? null) ||
        (rows[idx].charge_sat   ?? null) !== (src.charge_sat   ?? null) ||
        (rows[idx].charge_sun   ?? null) !== (src.charge_sun   ?? null) ||
        (rows[idx].charge_bh    ?? null) !== (src.charge_bh    ?? null)
      );

      if (!willCreateOther && !willUpdateOther) return; // nothing to mirror

      const otherLabel = (otherType === 'PAYE') ? 'PAYE charge rates' : 'Umbrella charge rates';
      const message =
        `This will automatically update the ${otherLabel} for the same Role/Band and Date window to match ` +
        `the charges you’ve entered here. Do you want to continue?`;

      if (!window.confirm(message)) {
        // User opted out — keep current row, do not mirror
        return;
      }

      if (idx >= 0) {
        // Update the counterpart's CHARGE only (leave its PAY as-is)
        const tgt = { ...rows[idx] };
        tgt.charge_day   = src.charge_day;
        tgt.charge_night = src.charge_night;
        tgt.charge_sat   = src.charge_sat;
        tgt.charge_sun   = src.charge_sun;
        tgt.charge_bh    = src.charge_bh;
        rows[idx] = tgt;
      } else {
        // Create a twin row with same charge; PAY remains nulls
        rows.push({
          client_id: src.client_id,
          role: src.role,
          band: src.band ?? null,
          date_from: src.date_from ?? null,
          date_to: src.date_to ?? null,
          rate_type: otherType,
          charge_day:   src.charge_day   ?? null,
          charge_night: src.charge_night ?? null,
          charge_sat:   src.charge_sat   ?? null,
          charge_sun:   src.charge_sun   ?? null,
          charge_bh:    src.charge_bh    ?? null,
          pay_day: null, pay_night: null, pay_sat: null, pay_sun: null, pay_bh: null,
        });
      }
    })();

    // child closes via Apply; parent handles persistence
  }, false, () => {
    const parent = window.__modalStack && window.__modalStack[window.__modalStack.length-1];
    if (parent) { parent.currentTabKey = 'rates'; parent.setTab('rates'); }
  });

  // After mount: wire extras
  const selRole   = document.getElementById('cl_role');
  const rowNew    = document.getElementById('cl_role_new_row');
  const inFrom    = document.getElementById('cl_date_from');
  const inTo      = document.getElementById('cl_date_to');
  const selType   = document.getElementById('cl_rate_type');
  const box       = document.getElementById('cl_margin_box');

  if (existing?.role) selRole.value = globalRoles.includes(existing.role) ? existing.role : '__OTHER__';
  if (selRole.value === '__OTHER__') {
    rowNew.style.display = '';
    const nr = document.getElementById('cl_role_new'); nr.value = existing?.role || '';
  }
  selRole.addEventListener('change', () => {
    if (selRole.value === '__OTHER__') rowNew.style.display = '';
    else { rowNew.style.display = 'none'; const nr = document.getElementById('cl_role_new'); if (nr) nr.value = ''; }
  });

  attachUkDatePicker(inFrom); attachUkDatePicker(inTo);

  // Live margin preview inside this modal (uses local inputs only)
  async function refreshClientMargin() {
    const s = await getSettingsCached();
    // robust ERNI% conversion
    const erniPct = (() => {
      const v = s?.erni_pct;
      if (v == null) return 0;
      if (typeof v === 'string') {
        const m = v.trim();
        if (!m) return 0;
        if (m.endsWith('%')) {
          const n = parseFloat(m.slice(0, -1));
          return Number.isFinite(n) ? Math.max(0, n / 100) : 0;
        }
        const n = parseFloat(m);
        return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : 0;
      }
      const n = Number(v);
      return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : 0;
    })();

    const rt = String(selType.value || '').toUpperCase();

    const raw = collectForm('#clientRateForm');
    const charge = {
      day:   raw.charge_day   === '' ? null : Number(raw.charge_day),
      night: raw.charge_night === '' ? null : Number(raw.charge_night),
      sat:   raw.charge_sat   === '' ? null : Number(raw.charge_sat),
      sun:   raw.charge_sun   === '' ? null : Number(raw.charge_sun),
      bh:    raw.charge_bh    === '' ? null : Number(raw.charge_bh)
    };
    const pay = {
      day:   raw.pay_day   === '' ? null : Number(raw.pay_day),
      night: raw.pay_night === '' ? null : Number(raw.pay_night),
      sat:   raw.pay_sat   === '' ? null : Number(raw.pay_sat),
      sun:   raw.pay_sun   === '' ? null : Number(raw.pay_sun),
      bh:    raw.pay_bh    === '' ? null : Number(raw.pay_bh)
    };

    function line(lbl, k) {
      const m = calcMargin(charge[k], pay[k], rt, erniPct);
      const v = (charge[k]==null || pay[k]==null) ? '—' : `£${m.toFixed(2)}`;
      return `<div>${lbl}: <strong>${v}</strong></div>`;
    }

    const expl = (rt === 'PAYE')
      ? `PAYE margin uses Employers NI ${(erniPct*100).toFixed(2)}%: margin = charge − (pay / (1 + NI)).`
      : `Umbrella margin: margin = charge − pay.`;

    box.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
        ${line('Day','day')}${line('Night','night')}${line('Sat','sat')}
        ${line('Sun','sun')}${line('BH','bh')}<div></div>
      </div>
      <div class="hint" style="margin-top:6px">${expl}</div>
    `;
  }

  document.querySelectorAll('#clientRateForm input[type="number"]').forEach(el => el.addEventListener('input', refreshClientMargin));
  selType.addEventListener('change', refreshClientMargin);
  await refreshClientMargin();
}


// =================== ADD HOSPITAL MODAL (UPDATED: push into stagedNew) ===================
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
      const raw = collectForm('#hospitalForm');
      const name = String(raw.hospital_name_norm || '').trim();
      if (!name) { alert('Hospital / Trust is required'); return; }

      const H = modalCtx.hospitalsState || (modalCtx.hospitalsState = { existing: [], stagedNew: [], stagedEdits:{}, stagedDeletes: new Set() });
      H.stagedNew.push({ hospital_name_norm: name, ward_hint: (raw.ward_hint || '').trim() || null });

      // Apply only; parent Save will commit
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

  // local helper to sanitize geometry/handlers before any close/re-render
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
    _hasMountedOnce: false, // ← skip first persist on initial mount

    // Persist visible tab ONLY when overlay is visible (prevents reading hidden/stale DOM)
    persistCurrentTabState() {
      const back = byId('modalBack');
      const overlayVisible = back && getComputedStyle(back).display !== 'none';
      if (!overlayVisible) return; // ← critical guard

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

    // Guard the merge: only apply formState if it's for THIS record
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
        // do NOT call updateSecondaryLabel() here; it is scoped inside renderTop
        // let the toolbar listener flip the label:
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
      // Only persist if we've already mounted once (skip on initial mount)
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
      }

      if (this.entity === 'clients' && k === 'rates')     { mountClientRatesTab?.(); }
      if (this.entity === 'clients' && k === 'hospitals') { mountClientHospitalsTab?.(); }
      if (this.entity === 'clients' && k === 'settings')  { renderClientSettingsUI?.(modalCtx.clientSettingsState || {}); }

      this.currentTabKey = k;
      this._attachDirtyTracker();
      this._hasMountedOnce = true; // ← first mount complete; future tab switches may persist
      // do NOT call updateSecondaryLabel() here; it lives inside renderTop
    }
  };

  window.__modalStack.push(frame);
  byId('modalBack').style.display = 'flex';

  function renderTop() {
    const depth = window.__modalStack.length;
    const top = window.__modalStack[window.__modalStack.length - 1];
    const isChild = depth > 1;

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

    primaryBtn.textContent = isChild ? 'Apply' : 'Save';
    primaryBtn.setAttribute('aria-label', isChild ? 'Apply' : 'Save');

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

    // Listen for "modal-dirty" events to flip the label instantly on edits
    const onDirtyLabel = () => updateSecondaryLabel();
    window.addEventListener('modal-dirty', onDirtyLabel);

    // Secondary action (Close/Discard) shared logic
    const handleSecondary = () => {
      console.debug('[MODAL] discard/close click', { title: top.title, depth, closeToken, isDirty: top.isDirty });

      if (top.isDirty) {
        const ok = window.confirm('You have unsaved changes. Discard them and close?');
        if (!ok) return;
      }

      // Sanitize geometry before any close/re-render
      sanitizeModalGeometry();

      const closing = window.__modalStack.pop();
      // detach listeners owned by this frame
      if (closing && closing._detachDirty) { try { closing._detachDirty(); } catch(_){}; closing._detachDirty = null; }
      window.removeEventListener('modal-dirty', onDirtyLabel);

      if (window.__modalStack.length > 0) {
        // Re-render parent
        renderTop();
        const parent = window.__modalStack[window.__modalStack.length - 1];
        try { parent.onReturn && parent.onReturn(); } catch(_) {}
      } else {
        discardAllModalsAndState();
      }
    };

    primaryBtn.onclick = async () => {
      top.persistCurrentTabState();

      if (typeof top.onSave === 'function') {
        await top.onSave();
        top.isDirty = false;
        updateSecondaryLabel();
      }

      // If onSave already popped this frame, stop
      if (!window.__modalStack.length || window.__modalStack[window.__modalStack.length - 1] !== top) {
        console.debug('[MODAL] primary close handled by onSave');
        return;
      }

      // Sanitize geometry before any close/re-render
      sanitizeModalGeometry();

      if (isChild) {
        if (top._detachDirty) { try { top._detachDirty(); } catch(_){}; top._detachDirty = null; }
        window.removeEventListener('modal-dirty', onDirtyLabel);
        window.__modalStack.pop();
        if (window.__modalStack.length > 0) {
          const parent = window.__modalStack[window.__modalStack.length - 1];
          renderTop();
          try { parent.onReturn && parent.onReturn(); } catch(_) {}
        } else {
          discardAllModalsAndState();
        }
      } else {
        window.removeEventListener('modal-dirty', onDirtyLabel);
        discardAllModalsAndState();
      }
    };

    discardBtn.onclick = handleSecondary;

    // Close on overlay click (outside modal) – same dirty/clean rules
    const onOverlayClick = (e) => {
      if (e.target === backEl) handleSecondary();
    };
    backEl.addEventListener('click', onOverlayClick, { capture: true });

    // Close on ESC – same dirty/clean rules
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleSecondary();
      }
    };
    window.addEventListener('keydown', onEsc);

    // store global detach so we can remove when frame closes elsewhere
    top._detachGlobal = () => {
      window.removeEventListener('modal-dirty', onDirtyLabel);
      backEl.removeEventListener('click', onOverlayClick, { capture: true });
      window.removeEventListener('keydown', onEsc);
    };

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
byId('quickSearch').onkeydown = async (e)=>{
  if (e.key!=='Enter') return;
  const q = e.target.value.trim(); if (!q) return renderAll();
  const rows = await search(currentSection, q);
  if (rows) renderSummary(rows);
}
function openSearch(){
  const q = prompt('Search text:'); if (!q) return;
  byId('quickSearch').value = q; byId('quickSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));
}

// OPTIONAL: open ALT+F for fast search
document.addEventListener('keydown', (e)=>{
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
