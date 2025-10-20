<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>CloudTMS</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    :root{
      --bg:#0f172a; --panel:#111827; --muted:#1f2937; --text:#f8fafc; --sub:#cbd5e1; --brand:#4f46e5;
      --ok:#16a34a; --warn:#f59e0b; --fail:#ef4444; --line:#334155; --chip:#0ea5e9;
      --hover: rgba(79,70,229,.12);
      --radius:12px;
      --shadow: 0 6px 20px rgba(0,0,0,.25);
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{margin:0;background:linear-gradient(180deg,#0b1221,#0a1020 60%);color:var(--text);font:14px/1.5 system-ui,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}
    a{color:inherit}

    /* ===== App chrome ===== */
    .topbar{
      position:sticky;top:0;z-index:9;
      display:flex;align-items:center;gap:10px;
      padding:10px 14px;background:rgba(14,18,34,.72);backdrop-filter:saturate(140%) blur(8px); border-bottom:1px solid var(--line);
    }
    .brand{display:flex;align-items:center;gap:10px;margin-right:8px;font-weight:700}
    .brand .dot{width:10px;height:10px;border-radius:50%;background:var(--brand);box-shadow:0 0 12px var(--brand)}
    .nav{display:flex;gap:6px;flex-wrap:wrap}
    .nav button{
      display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:#0b1221;color:var(--text);
      padding:8px 10px;border-radius:10px;cursor:pointer;transition:.15s; box-shadow: inset 0 -1px 0 rgba(255,255,255,.03)
    }
    .nav button:hover{background:var(--hover)}
    .nav button.active{outline:2px solid var(--brand);background:rgba(79,70,229,.18)}
    .nav .ico{width:18px;height:18px;opacity:.9}

    .userbox{margin-left:auto;display:flex;align-items:center;gap:10px;color:var(--sub)}
    .userbox .chip{background:#0a1427;border:1px solid var(--line);padding:4px 8px;border-radius:20px}
    .userbox button{background:transparent;color:var(--sub);border:1px solid var(--line);padding:6px 10px;border-radius:10px;cursor:pointer}
    .layout{display:grid;grid-template-columns:260px 1fr;gap:16px;padding:16px;min-height:calc(100vh - 58px)}
    .panel{background:linear-gradient(180deg,#0b1221,#0a1326);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
    .tools{padding:12px;position:sticky;top:76px;height:fit-content}
    .tools h3{margin:6px 0 10px;font-size:12px;font-weight:600;color:var(--sub);text-transform:uppercase;letter-spacing:.06em}
    .tools .group{border-top:1px dashed var(--line);padding-top:10px;margin-top:8px}
    .tools button,.tools .btn{
      width:100%; text-align:left; display:flex;align-items:center;gap:10px;
      background:#0c152a;border:1px solid var(--line);color:var(--text);padding:8px 10px;border-radius:10px;margin:6px 0;cursor:pointer
    }
    .tools button:hover{background:var(--hover)}
    .tools .note{font-size:12px;color:var(--sub)}

    /* ===== Summary table ===== */
    .main{padding:0}
    .toolbar{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid var(--line)}
    .toolbar .title{font-weight:700}
    .spacer{flex:1}
    .toolbar input[type="text"]{background:#0b1427;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px;min-width:260px}
    .toolbar .mini{font-size:12px;color:var(--sub)}
    .grid{width:100%; border-collapse:collapse}
    .grid th,.grid td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
    .grid th{position:sticky;top:58px;background:#0b1221;border-bottom:1px solid var(--line);text-align:left}
    .grid tr:hover{background:rgba(255,255,255,.02)}
    .pill{font-size:12px;border:1px solid var(--line);padding:2px 6px;border-radius:999px;background:#0e1a34;color:var(--sub)}
    .tag-ok{background:rgba(22,163,74,.15);color:#bbf7d0;border-color:rgba(16,185,129,.35)}
    .tag-warn{background:rgba(245,158,11,.15);color:#fde68a;border-color:rgba(251,191,36,.35)}
    .tag-fail{background:rgba(239,68,68,.15);color:#fecaca;border-color:rgba(248,113,113,.35)}

    /* ===== Modal (draggable) ===== */
    .modal-back{position:fixed;inset:0;background:rgba(2,6,23,.6);display:none;align-items:center;justify-content:center;z-index:99}
    .modal{width:min(1100px,95vw);max-height:90vh;display:flex;flex-direction:column;background:#0b1221;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
    .modal.dragging{opacity:.95}
    .modal-h{display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid var(--line);cursor:move;background:linear-gradient(180deg,#0d1427,#0b1221)}
    .modal-h .ttl{font-weight:700}
    .modal-h .spacer{flex:1}
    .modal-h button{border:1px solid var(--line);background:#0c172d;color:var(--sub);padding:6px 10px;border-radius:10px}
    .modal-b{padding:0;overflow:auto}
    .tabs{display:flex;gap:6px;border-bottom:1px solid var(--line);padding:8px}
    .tabs button{background:#0c172d;border:1px solid var(--line);border-bottom:none;padding:8px 10px;border-top-left-radius:10px;border-top-right-radius:10px;color:var(--sub);cursor:pointer}
    .tabs button.active{background:rgba(79,70,229,.18);color:var(--text);outline:2px solid var(--brand)}
    .tabc{padding:14px}
    .form{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:10px}
    .form .row{display:flex;flex-direction:column;gap:6px}
    .form input, .form select, .form textarea{
      background:#0b1427;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px;width:100%
    }
    .form textarea{min-height:90px}
    .form .row.inline{display:flex;flex-direction:row;gap:10px}
    .actions{padding:10px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end;background:#0c172d}
    .actions button{border:1px solid var(--line);background:#0b152a;color:var(--text);padding:8px 12px;border-radius:10px;cursor:pointer}
    .actions .primary{background:linear-gradient(180deg,#5146e5,#4038cc);border-color:#3730a3}
    .hint{color:var(--sub);font-size:12px}

    /* ===== Calendar ===== */
    .calendar{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    .month{border:1px solid var(--line);border-radius:10px;overflow:hidden}
    .month h4{margin:0;padding:8px 10px;background:#0c172d;border-bottom:1px solid var(--line)}
    .days{display:grid;grid-template-columns:repeat(7,1fr)}
    .d{padding:6px 6px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);min-height:32px}
    .d.mark-a{background:rgba(245,158,11,.2)}
    .d.mark-i{background:rgba(59,130,246,.2)}
    .d.mark-p{background:rgba(34,197,94,.25)}
    .legend{display:flex;gap:8px;margin-top:8px}
    .legend .lg{display:flex;align-items:center;gap:6px}
    .sq{width:10px;height:10px;border-radius:2px}
    .sq.a{background:rgba(245,158,11,.7)} .sq.i{background:rgba(59,130,246,.7)} .sq.p{background:rgba(34,197,94,.7)}

    /* ===== Auth overlays ===== */
    .auth-overlay{position:fixed;inset:0;display:none;place-items:center;background:radial-gradient(800px 400px at 20% 0%,rgba(79,70,229,.2),transparent),rgba(2,6,23,.8);z-index:100}
    .auth-card{width:min(520px,92vw);padding:16px;border-radius:16px;border:1px solid var(--line);background:linear-gradient(180deg,#0e1428,#0b1221);box-shadow:var(--shadow)}
    .auth-h{display:flex;align-items:center;gap:10px;margin:2px 0 10px}
    .auth-h .ttl{font-weight:800;font-size:18px}
    .auth-f .row{display:flex;flex-direction:column;gap:6px;margin:8px 0}
    .auth-f label{font-size:12px;color:var(--sub)}
    .auth-f input{background:#0b1427;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:10px}
    .auth-f .actions{display:flex;justify-content:space-between;align-items:center;border-top:none;background:transparent;padding:8px 0}
    .link{color:#93c5fd;cursor:pointer}
    .error{color:#fecaca;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);padding:8px;border-radius:8px}
    .success{color:#bbf7d0;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.3);padding:8px;border-radius:8px}
    .split{display:flex;gap:10px}
    .eye{cursor:pointer;font-size:12px;color:var(--sub)}
  </style>
</head>
<body>
  <div class="topbar">
    <div class="brand"><span class="dot"></span> CloudTMS</div>
    <div class="nav" id="nav"></div>
    <div class="userbox">
      <span class="chip" id="userChip">Signed out</span>
      <button id="btnLogout">Logout</button>
    </div>
  </div>

  <div class="layout">
    <aside class="panel tools" id="tools">
      <h3>Tools</h3>
      <div id="toolButtons"></div>
      <div class="group">
        <div class="note">Tip: Double‑click a row to view & edit full details.</div>
      </div>
    </aside>
    <main class="panel main">
      <div class="toolbar">
        <div class="title" id="title">Loading…</div>
        <div class="spacer"></div>
        <input type="text" id="quickSearch" placeholder="Quick search…"/>
        <button id="btnColumns">Columns</button>
      </div>
      <div id="content"></div>
    </main>
  </div>

  <!-- ===== Draggable modal ===== -->
  <div class="modal-back" id="modalBack">
    <div class="modal" id="modal">
      <div class="modal-h" id="modalDrag">
        <div class="ttl" id="modalTitle">Details</div>
        <div class="spacer"></div>
        <button id="btnRelated">Related…</button>
        <button id="btnCloseModal">Close</button>
      </div>
      <div class="modal-b">
        <div class="tabs" id="modalTabs"></div>
        <div class="tabc" id="modalBody"></div>
      </div>
      <div class="actions" id="modalActions">
        <span class="hint" id="modalHint"></span>
        <div class="spacer"></div>
        <button id="btnDelete" class="danger" style="display:none">Delete</button>
        <button id="btnSave" class="primary">Save</button>
      </div>
    </div>
  </div>

  <!-- ===== Auth overlays (login / forgot / reset) ===== -->
  <div class="auth-overlay" id="loginOverlay" aria-hidden="true">
    <div class="auth-card">
      <div class="auth-h"><div class="ttl">Sign in</div></div>
      <form class="auth-f" id="loginForm">
        <div id="loginError" class="error" style="display:none"></div>
        <div class="row">
          <label>Email</label>
          <input id="loginEmail" type="email" autocomplete="username" required />
        </div>
        <div class="row">
          <label>Password</label>
          <div class="split">
            <input id="loginPassword" type="password" autocomplete="current-password" required />
            <span class="eye" id="toggleLoginPw">show</span>
          </div>
        </div>
        <div class="row">
          <label><input type="checkbox" id="rememberMe"/> Keep me signed in</label>
        </div>
        <div class="actions">
          <span class="link" id="linkForgot">Forgot password?</span>
          <button type="submit" class="primary">Sign in</button>
        </div>
      </form>
    </div>
  </div>

  <div class="auth-overlay" id="forgotOverlay" aria-hidden="true">
    <div class="auth-card">
      <div class="auth-h"><div class="ttl">Password reset</div></div>
      <form class="auth-f" id="forgotForm">
        <div id="forgotMsg" class="success" style="display:none"></div>
        <div id="forgotError" class="error" style="display:none"></div>
        <div class="row">
          <label>Enter your account email</label>
          <input id="forgotEmail" type="email" required />
        </div>
        <div class="actions">
          <span class="link" id="linkBackToLogin">Back to login</span>
          <button type="submit">Send reset email</button>
        </div>
      </form>
    </div>
  </div>

  <div class="auth-overlay" id="resetOverlay" aria-hidden="true">
    <div class="auth-card">
      <div class="auth-h"><div class="ttl">Set a new password</div></div>
      <form class="auth-f" id="resetForm">
        <div id="resetMsg" class="success" style="display:none"></div>
        <div id="resetError" class="error" style="display:none"></div>
        <div class="row">
          <label>New password</label>
          <div class="split">
            <input id="resetPw1" type="password" required minlength="8" />
            <span class="eye" id="toggleResetPw1">show</span>
          </div>
        </div>
        <div class="row">
          <label>Confirm new password</label>
          <div class="split">
            <input id="resetPw2" type="password" required minlength="8" />
            <span class="eye" id="toggleResetPw2">show</span>
          </div>
        </div>
        <div class="actions">
          <span class="link" id="linkResetToLogin">Back to login</span>
          <button type="submit" class="primary">Update password</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    /***** ─────────────────────────────────────────────────────────────────
     *  Auth + API utilities (polished login + forgot + reset)
     *  Bases on your existing drop‑in but fixes edge cases and UX.
     *  Worker base URL from your handover. :contentReference[oaicite:1]{index=1}
     *  Forgot/reset/login endpoints exist on the broker. :contentReference[oaicite:2]{index=2}
     * ───────────────────────────────────────────────────────────────── ******/
    window.BROKER_BASE_URL = window.BROKER_BASE_URL || 'https://cloudtms.kier-88a.workers.dev';
     const BROKER_BASE_URL = window.BROKER_BASE_URL;
    const API = (path)=> `${BROKER_BASE_URL}${path}`;
    let SESSION = null;  // {accessToken, user, exp}
    let refreshTimer = 0;

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
    async function apiLogin(email, password){
  const res = await fetch(API('/auth/login'), {
    method:'POST',
    headers:{'content-type':'application/json'},
    credentials: 'include',                // <-- REQUIRED
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
    const byId = (id)=>document.getElementById(id);
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

      // If URL has a reset token (k=...), open reset overlay immediately (matches your earlier front‑end). :contentReference[oaicite:3]{index=3}
      const url = new URL(location.href);
      if (url.searchParams.get('k') || url.searchParams.get('token')) openReset();
    }

    /***** ────────────────────────────────────────────────────────────────
     * App state + rendering
     * Sections required by your brief: Candidates, Clients, Timesheets,
     * Healthroster, Invoices, Umbrellas, Settings, Audit.
     * Data shapes: candidates/clients/umbrellas/rates/settings/outbox. :contentReference[oaicite:4]{index=4} :contentReference[oaicite:5]{index=5}
     * DB columns for candidates incl. bank + pay_method + umbrella_id. :contentReference[oaicite:6]{index=6}
     * Rates tables used by tabs: client defaults + candidate overrides. :contentReference[oaicite:7]{index=7}
     * Related counts & lists via /api/related/{entity}/{id}/... (Broker). (OpenAPI you supplied in chat)
     * ──────────────────────────────────────────────────────────────── ******/
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

    function renderTopNav(){
      const nav = byId('nav'); nav.innerHTML = '';
      sections.forEach(s=>{
        const b = document.createElement('button');
        b.innerHTML = `<span class="ico">${s.icon}</span> ${s.label}`;
        if (s.key === currentSection) b.classList.add('active');
        b.onclick = ()=>{ currentSection = s.key; currentSelection=null; renderAll(); };
        nav.appendChild(b);
      });
    }

    function renderTools(){
      const el = byId('toolButtons');
      const canCreate = ['candidates','clients','umbrellas'].includes(currentSection);
      const canEdit = ['candidates','clients','umbrellas','settings'].includes(currentSection);
      const canDelete = ['candidates','clients','umbrellas'].includes(currentSection); // soft‑delete or disable when supported

      el.innerHTML = '';
      const addBtn = (txt, cb)=>{ const b=document.createElement('button'); b.textContent = txt; b.onclick=cb; el.appendChild(b); };

      addBtn('Create New Record', ()=> openCreate());
      addBtn('Edit Record', ()=> openEdit());
      addBtn('Delete Record', ()=> openDelete());
      addBtn('Search…', ()=> openSearch());

      if (!canCreate) el.children[0].classList.add('btn'); // still show for placeholders
      if (!canEdit) el.children[1].classList.add('btn');
      if (!canDelete) el.children[2].classList.add('btn');
    }

    function defaultColumnsFor(section){
      // User can customise; these are just the defaults requested
      const ls = localStorage.getItem('cloudtms.cols.'+section);
      if (ls) try { return JSON.parse(ls); } catch{}
      switch(section){
        case 'candidates': return ['last_name','first_name','phone','role','postcode','email']; // role/postcode may be blank
        case 'clients': return ['name','primary_invoice_email','invoice_address','postcode','ap_phone']; // postcode may be blank
        case 'umbrellas': return ['name','vat_chargeable','bank_name','sort_code','account_number','enabled'];
        case 'audit': return ['type','to','subject','status','created_at_utc','last_error'];
        default: return ['id'];
      }
    }
    function pick(obj, keys){ const o={}; keys.forEach(k=> o[k]=obj?.[k] ?? ''); return o; }
    function headersFromRows(rows){
      if (!rows.length) return [];
      const keys = new Set(Object.keys(rows[0]));
      rows.forEach(r=> Object.keys(r).forEach(k=> keys.add(k)));
      return [...keys];
    }

    function renderSummary(rows){
      currentRows = rows;
      const cols = defaultColumnsFor(currentSection);
      byId('title').textContent = sections.find(s=>s.key===currentSection)?.label || '';
      const content = byId('content'); content.innerHTML = '';

      if (currentSection === 'settings') return renderSettingsPanel(content);
      if (currentSection === 'audit') return renderAuditTable(content, rows);

      const tbl = document.createElement('table'); tbl.className='grid';
      const thead = document.createElement('thead'); const trh=document.createElement('tr');
      cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; trh.appendChild(th); });
      thead.appendChild(trh); tbl.appendChild(thead);
      const tb = document.createElement('tbody');
      rows.forEach(r=>{
        const tr=document.createElement('tr');
        tr.ondblclick = ()=> openDetails(r);
        cols.forEach(c=>{ const td=document.createElement('td'); let v = r[c];
          if (c==='vat_chargeable' || c==='enabled' || typeof v === 'boolean') v = v ? 'Yes' : 'No';
          td.textContent = (v ?? '') === '' ? '—' : v; tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb); content.appendChild(tbl);
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
        cols.forEach(c=>{ const td=document.createElement('td');
          let v=r[c]; if (c==='status') td.innerHTML = `<span class="pill ${v==='SENT'?'tag-ok':v==='FAILED'?'tag-fail':'tag-warn'}">${v}</span>`;
          else td.textContent = (v ?? '')===''?'—':v;
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

    // ===== Data fetchers (Broker API) =====
    async function listCandidates(){
      const r = await authFetch(API('/api/candidates')); if (!r.ok) throw new Error('Fetch candidates failed'); return r.json();
    }
    async function listClients(){
      const r = await authFetch(API('/api/clients')); if (!r.ok) throw new Error('Fetch clients failed'); return r.json();
    }
    async function listUmbrellas(){
      const r = await authFetch(API('/api/umbrellas')); if (!r.ok) throw new Error('Fetch umbrellas failed'); return r.json();
    }
    async function getSettings(){
      const r = await authFetch(API('/api/settings/defaults')); if (!r.ok) throw new Error('Fetch settings failed'); return r.json();
    }
    async function saveSettings(payload){
      const r = await authFetch(API('/api/settings/defaults'), {method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(payload)}); 
      if (!r.ok) throw new Error('Save failed'); 
      return true;
    }
    async function listOutbox(){
      const r = await authFetch(API('/api/email/outbox')); if (!r.ok) throw new Error('Fetch outbox failed'); return r.json();
    }
    async function retryOutbox(id){
      const r = await authFetch(API(`/api/email/outbox/${id}/retry`), {method:'POST'}); return r.ok;
    }
    async function fetchRelated(entity, id, type){
      const r = await authFetch(API(`/api/related/${entity}/${id}/${type}`)); if (!r.ok) return [];
      return r.json();
    }
    async function fetchRelatedCounts(entity, id){
      const r = await authFetch(API(`/api/related/${entity}/${id}/counts`)); if (!r.ok) return {};
      return r.json();
    }
    async function search(section, q){
      const map = {candidates:'/api/search/candidates', clients:'/api/search/clients', umbrellas:'/api/search/umbrellas', timesheets:'/api/search/timesheets', invoices:'/api/search/invoices'};
      const p = map[section]; if (!p) return null;
      const r = await authFetch(API(`${p}?q=${encodeURIComponent(q)}`)); if (!r.ok) return null; return r.json();
    }
    async function upsertCandidate(payload, id){
      const url = id ? `/api/candidates/${id}` : '/api/candidates';
      const method = id ? 'PUT' : 'POST';
      const r = await authFetch(API(url), {method, headers:{'content-type':'application/json'}, body: JSON.stringify(payload)});
      if (!r.ok) throw new Error('Save failed'); return id ? (await r.json()) : (await r.json());
    }
    async function upsertClient(payload, id){
      const url = id ? `/api/clients/${id}` : '/api/clients';
      const method = id ? 'PUT' : 'POST';
      const r = await authFetch(API(url), {method, headers:{'content-type':'application/json'}, body: JSON.stringify(payload)});
      if (!r.ok) throw new Error('Save failed'); return true;
    }
    async function upsertUmbrella(payload, id){
      const url = id ? `/api/umbrellas/${id}` : '/api/umbrellas';
      const method = id ? 'PUT' : 'POST';
      const r = await authFetch(API(url), {method, headers:{'content-type':'application/json'}, body: JSON.stringify(payload)});
      if (!r.ok) throw new Error('Save failed'); return true;
    }
    async function listCandidateRates(candidate_id){
      const r = await authFetch(API(`/api/rates/candidate-overrides?candidate_id=${encodeURIComponent(candidate_id)}`)); if (!r.ok) return [];
      return r.json();
    }
    async function addCandidateRate(payload){
      const r = await authFetch(API('/api/rates/candidate-overrides'), {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload)});
      return r.ok;
    }
    async function deleteCandidateRatesFor(candidate_id){
      const r = await authFetch(API(`/api/rates/candidate-overrides/${candidate_id}`), {method:'DELETE'}); return r.ok;
    }
    async function listClientRates(){
      const r = await authFetch(API('/api/rates/client-defaults')); if (!r.ok) return [];
      return r.json();
    }
    async function upsertClientRate(payload){
      const r = await authFetch(API('/api/rates/client-defaults'), {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload)});
      return r.ok;
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
    let modalCtx = {entity:null, data:null};
    function openDetails(row){
      currentSelection = row;
      if (currentSection==='candidates') openCandidate(row);
      else if (currentSection==='clients') openClient(row);
      else if (currentSection==='umbrellas') openUmbrella(row);
      else if (currentSection==='audit') openAuditItem(row);
    }

    function openCreate(){
      if (currentSection==='candidates') openCandidate({});
      else if (currentSection==='clients') openClient({});
      else if (currentSection==='umbrellas') openUmbrella({});
      else alert('Create not supported for this section yet.');
    }
    function openEdit(){
      if (!currentSelection) return alert('Select by double‑clicking a row first.');
      openDetails(currentSelection);
    }
    async function openDelete(){
      if (!currentSelection) return alert('Select by double‑clicking a row first.');
      if (!confirm('Delete (or disable) this record?')) return;
      // Soft delete where possible:
      if (currentSection==='candidates'){
        await upsertCandidate({...currentSelection, active:false}, currentSelection.id);
        await renderAll();
      } else if (currentSection==='umbrellas'){
        await upsertUmbrella({...currentSelection, enabled:false}, currentSelection.id);
        await renderAll();
      } else {
        alert('Delete is not available for this section.');
      }
    }

    // ---- Candidate modal
    async function openCandidate(row){
      modalCtx = {entity:'candidates', data: row};
      showModal('Candidate', [
        {key:'main',label:'Main Details'},
        {key:'rates',label:'Rates'},
        {key:'pay',label:'Payment details'},
        {key:'bookings',label:'Bookings'}
      ], renderCandidateTab, async ()=>{
        // Save (create/update)
        const payload = collectForm('#tab-main');
        if (!payload.first_name && !payload.last_name) return alert('Enter at least a first or last name.');
        // pay_method + umbrella wiring (see DB columns). :contentReference[oaicite:8]{index=8}
        if (!payload.pay_method) payload.pay_method = 'PAYE';
        if (payload.pay_method==='PAYE') payload.umbrella_id = null;
        const saved = await upsertCandidate(payload, row?.id);
        closeModal(); renderAll();
      }, row?.id);

      // Prime dropdowns in Payment tab
      // Umbrellas list is used to show bank autofill when UMBRELLA. :contentReference[oaicite:9]{index=9}
      const umb = await listUmbrellas();
      const sel = document.querySelector('#tab-pay select[name="umbrella_id"]'); if (sel){
        sel.innerHTML = `<option value="">— Select —</option>` + umb.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
        if (row?.umbrella_id) sel.value = row.umbrella_id;
        sel.onchange = ()=>{
          if (sel.value) document.querySelector('#pay-method').value = 'UMBRELLA';
        };
      }

      // Load candidate rates
      if (row?.id) {
        const rates = await listCandidateRates(row.id);
        renderCandidateRatesTable(rates);
      }
      // Calendar from related timesheets (status colouring by fields available). States ref: VALIDATION/INVOICE/PAID. :contentReference[oaicite:10]{index=10}
      if (row?.id) {
        const ts = await fetchRelated('candidates', row.id, 'timesheets'); // depends on broker payload
        renderCalendar(ts || []);
      }
    }
    function renderCandidateTab(key, row={}){
      if (key==='main') return html(`
        <div class="form" id="tab-main">
          ${input('first_name','First name', row.first_name)}
          ${input('last_name','Last name', row.last_name)}
          ${input('email','Email', row.email, 'email')}
          ${input('phone','Telephone', row.phone)}
          ${select('pay_method','Pay method', row.pay_method || 'PAYE', ['PAYE','UMBRELLA'], {id:'pay-method'})}
          ${input('tms_ref','Unique Candidate Ref (TMS…)', row.tms_ref)}
          ${input('display_name','Display name', row.display_name)}
          <div class="row"><label>Notes</label><textarea name="notes" placeholder="Free text…">${row.notes || ''}</textarea></div>
        </div>
      `);
      if (key==='rates') return html(`
        <div id="tab-rates">
          <div class="actions"><button id="btnAddRate">Add rate override</button></div>
          <div id="ratesTable"></div>
        </div>
      `);
      if (key==='pay') return html(`
        <div class="form" id="tab-pay">
          <div class="row"><label class="hint">PAYE bank fields are editable. Umbrella bank comes from the umbrella company record.</label></div>
          ${input('account_holder','Account holder', row.account_holder)}
          ${input('bank_name','Bank name', row.bank_name)}
          ${input('sort_code','Sort code', row.sort_code)}
          ${input('account_number','Account number', row.account_number)}
          ${select('umbrella_id','Umbrella company', row.umbrella_id || '', [], {})}
        </div>
      `);
      if (key==='bookings') return html(`
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
    function renderCandidateRatesTable(rates){
      const div = byId('ratesTable'); if (!div) return;
      if (!rates.length) { div.innerHTML = '<div class="hint">No candidate‑specific rates. Client defaults will apply.</div>'; return; }
      const cols = ['client_id','role','band','pay_day','pay_night','pay_sat','pay_sun','pay_bh','date_from','date_to'];
      const tbl = document.createElement('table'); tbl.className='grid';
      const thead = document.createElement('thead'); const trh=document.createElement('tr');
      cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; trh.appendChild(th); });
      thead.appendChild(trh); tbl.appendChild(thead);
      const tb = document.createElement('tbody');
      rates.forEach(r=>{
        const tr=document.createElement('tr');
        cols.forEach(c=>{ const td=document.createElement('td'); td.textContent = r[c] ?? '—'; tr.appendChild(td);});
        tb.appendChild(tr);
      })
      tbl.appendChild(tb); div.innerHTML=''; div.appendChild(tbl);

      const btn = byId('btnAddRate');
      if (btn) btn.onclick = async ()=>{
        const payload = promptRateOverride(modalCtx.data?.id);
        if (!payload) return;
        await addCandidateRate(payload);
        const newRates = await listCandidateRates(modalCtx.data.id);
        renderCandidateRatesTable(newRates);
      };
    }
    function promptRateOverride(candidate_id){
      const role = prompt('Role (e.g. HCA, RMN)');
      if (!role) return null;
      const band = prompt('Band (optional)') || null;
      const date_from = prompt('Date from (YYYY-MM-DD)') || new Date().toISOString().slice(0,10);
      const pay_day = prompt('Pay (Day) e.g. 13.50') || null;
      const pay_night = prompt('Pay (Night)') || null;
      const pay_sat = prompt('Pay (Sat)') || null;
      const pay_sun = prompt('Pay (Sun)') || null;
      const pay_bh = prompt('Pay (BH)') || null;
      return { candidate_id, role, band, date_from, pay_day, pay_night, pay_sat, pay_sun, pay_bh };
    }

    function renderCalendar(timesheets){
      const wrap = byId('calendar'); if (!wrap) return;
      // Build map date -> status
      const map = new Map();
      (timesheets || []).forEach(t=>{
        // derive a date key; prefer worked_start or week/day on record
        const d = (t.worked_start_iso || t.worked_start || t.date || t.week_ending_date);
        if (!d) return;
        const key = (d+'').slice(0,10);
        // heuristics: paid/invoiced/authorised from available fields
        const paid = t.paid_at_utc;
        const invoiced = t.locked_by_invoice_id || (t.invoice_id);
        const auth = t.authorised_at_server || (t.validation_status==='VALIDATION_OK');
        let mark = 'a';
        if (invoiced) mark = 'i';
        if (paid) mark = 'p';
        map.set(key, mark);
      });
      // Render 12 months starting Jan current year
      const now = new Date();
      const yr = now.getFullYear();
      wrap.innerHTML = '';
      for (let m=0;m<12;m++){
        const first = new Date(yr, m, 1);
        const monthBox = document.createElement('div'); monthBox.className='month';
        monthBox.innerHTML = `<h4>${first.toLocaleString(undefined,{month:'long'})} ${yr}</h4>`;
        const days = document.createElement('div'); days.className='days';
        // padding blanks
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
        monthBox.appendChild(days); wrap.appendChild(monthBox);
      }
    }

    // ---- Client modal
    async function openClient(row){
      modalCtx = {entity:'clients', data: row};
      showModal('Client', [
        {key:'main',label:'Main'},
        {key:'rates',label:'Rates'},
        {key:'settings',label:'Client settings'},
        {key:'hospitals',label:'Hospitals & wards'}
      ], renderClientTab, async ()=>{
        const payload = collectForm('#tab-main');
        if (!payload.name) return alert('Client name is required.');
        await upsertClient(payload, row?.id);
        closeModal(); renderAll();
      }, row?.id);

      if (row?.id){
        // rates list
        const rates = (await listClientRates()).filter(r=>r.client_id===row.id);
        renderClientRatesTable(rates);
        // hospitals
        renderHospitalsUI(row.id);
        // client settings
        renderClientSettingsUI(row);
      }
    }
    function renderClientTab(key, row={}){
      if (key==='main') return html(`
        <div class="form" id="tab-main">
          ${input('name','Client name', row.name)}
          ${input('cli_ref','Client Ref (CLI-…)', row.cli_ref)}
          <div class="row" style="grid-column:1/-1"><label>Invoice address</label><textarea name="invoice_address">${row.invoice_address || ''}</textarea></div>
          ${input('primary_invoice_email','Primary invoice email', row.primary_invoice_email,'email')}
          ${input('ap_phone','A/P phone', row.ap_phone)}
          ${select('vat_chargeable','VAT chargeable', row.vat_chargeable? 'Yes' : 'No', ['Yes','No'])}
          ${input('payment_terms_days','Payment terms (days)', row.payment_terms_days || 30, 'number')}
        </div>
      `);
      if (key==='rates') return html(`<div id="clientRates"></div> <div class="actions"><button id="btnAddClientRate">Add/Upsert client rate</button></div>`);
      if (key==='settings') return html(`<div id="clientSettings"></div>`);
      if (key==='hospitals') return html(`<div id="clientHospitals"></div>`);
    }
    function renderClientRatesTable(rates){
      const div = byId('clientRates'); if (!div) return;
      const cols = ['role','band','charge_day','charge_night','charge_sat','charge_sun','charge_bh','pay_day','pay_night','pay_sat','pay_sun','pay_bh','date_from','date_to'];
      const tbl = document.createElement('table'); tbl.className='grid';
      const trh=document.createElement('tr'); cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; trh.appendChild(th); }); 
      const thead=document.createElement('thead'); thead.appendChild(trh); tbl.appendChild(thead);
      const tb=document.createElement('tbody');
      rates.forEach(r=>{ const tr=document.createElement('tr'); cols.forEach(c=>{ const td=document.createElement('td'); td.textContent=r[c] ?? '—'; tr.appendChild(td);}); tb.appendChild(tr);});
      tbl.appendChild(tb); div.innerHTML=''; div.appendChild(tbl);

      const btn = byId('btnAddClientRate');
      if (btn) btn.onclick = async ()=>{
        const payload = promptClientRate(modalCtx.data.id);
        if (!payload) return;
        await upsertClientRate(payload);
        const fresh = (await listClientRates()).filter(r=>r.client_id===modalCtx.data.id);
        renderClientRatesTable(fresh);
      };
    }
    function promptClientRate(client_id){
      const role = prompt('Role (e.g. HCA, RMN)'); if (!role) return null;
      const band = prompt('Band (optional)') || null;
      const date_from = prompt('Date from (YYYY-MM-DD)') || new Date().toISOString().slice(0,10);
      const charge_day = prompt('Charge (Day)') || null;
      const charge_night = prompt('Charge (Night)') || null;
      const charge_sat = prompt('Charge (Sat)') || null;
      const charge_sun = prompt('Charge (Sun)') || null;
      const charge_bh = prompt('Charge (BH)') || null;
      const pay_day = prompt('Default Pay (Day) optional') || null;
      const pay_night = prompt('Default Pay (Night) optional') || null;
      const pay_sat = prompt('Default Pay (Sat) optional') || null;
      const pay_sun = prompt('Default Pay (Sun) optional') || null;
      const pay_bh = prompt('Default Pay (BH) optional') || null;
      return { client_id, role, band, date_from, charge_day, charge_night, charge_sat, charge_sun, charge_bh, pay_day, pay_night, pay_sat, pay_sun, pay_bh };
    }
    async function renderHospitalsUI(client_id){
      // List/load using new client hospitals endpoints (OpenAPI in your broker). 
      // GET /api/clients/{client_id}/hospitals   POST/PUT per your spec in chat.
      const el = byId('clientHospitals'); if (!el) return;
      const r = await authFetch(API(`/api/clients/${client_id}/hospitals`));
      const rows = r.ok ? await r.json() : [];
      const tbl = document.createElement('table'); tbl.className='grid';
      const cols=['hospital_name_norm','ward_hint','created_at'];
      const trh=document.createElement('tr'); cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; trh.appendChild(th);});
      const thead=document.createElement('thead'); thead.appendChild(trh); tbl.appendChild(thead);
      const tb=document.createElement('tbody');
      rows.forEach(x=>{ const tr=document.createElement('tr');
        cols.forEach(c=>{ const td=document.createElement('td'); td.textContent=x[c] ?? '—'; tr.appendChild(td);}); tb.appendChild(tr);
      }); tbl.appendChild(tb); el.innerHTML=''; el.appendChild(tbl);
      const add = document.createElement('div'); add.className='actions';
      const btn=document.createElement('button'); btn.textContent='Add Hospital / Ward hint';
      btn.onclick= async ()=>{
        const hospital_name_norm = prompt('Hospital / Trust name (normalised)');
        if (!hospital_name_norm) return;
        const ward_hint = prompt('Ward hint (optional)') || null;
        const res = await authFetch(API(`/api/clients/${client_id}/hospitals`), {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ client_id, hospital_name_norm, ward_hint })});
        if (res.ok) renderHospitalsUI(client_id); else alert('Add failed');
      };
      add.appendChild(btn); el.appendChild(add);
    }
    async function renderClientSettingsUI(row){
      const div = byId('clientSettings'); if (!div) return;
      // Client settings are separate object in DB; fetch by related endpoint if you have one; otherwise display a helper message.
      div.innerHTML = `<div class="hint">Client‑level settings override system defaults (classification windows, VAT/holiday/ERNI). Configure via API when available. Global defaults can be edited in the Settings section.</div>`;
    }

    // ---- Umbrella modal
    async function openUmbrella(row){
      modalCtx = {entity:'umbrellas', data: row};
      showModal('Umbrella', [{key:'main',label:'Main'}], (key)=> html(`
        <div class="form" id="tab-main">
          ${input('name','Name', row.name)}
          ${input('remittance_email','Remittance email', row.remittance_email, 'email')}
          ${input('bank_name','Bank', row.bank_name)}
          ${input('sort_code','Sort code', row.sort_code)}
          ${input('account_number','Account number', row.account_number)}
          ${select('vat_chargeable','VAT chargeable', row.vat_chargeable? 'Yes' : 'No', ['Yes','No'])}
          ${select('enabled','Enabled', (row.enabled===false)?'No':'Yes', ['Yes','No'])}
        </div>
      `), async ()=>{
        const payload = collectForm('#tab-main');
        payload.vat_chargeable = payload.vat_chargeable==='Yes';
        payload.enabled = payload.enabled!=='No';
        await upsertUmbrella(payload, row?.id);
        closeModal(); renderAll();
      }, row?.id);
    }

    // ---- Audit item (Outbox)
    function openAuditItem(row){
      // Quick viewer with retry
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

    // ---- Settings panel (global defaults)
    async function renderSettingsPanel(content){
      const s = await getSettings(); // shapes match table columns in your brief. :contentReference[oaicite:11]{index=11}
      content.innerHTML = `
        <div class="tabc">
          <div class="form" id="settingsForm">
            ${input('timezone_id','Timezone', s.timezone_id || 'Europe/London')}
            ${input('day_start','Day start', s.day_start || '06:00')}
            ${input('day_end','Day end', s.day_end || '20:00')}
            ${input('night_start','Night start', s.night_start || '20:00')}
            ${input('night_end','Night end', s.night_end || '06:00')}
            ${select('bh_source','Bank Holidays source', s.bh_source || 'MANUAL', ['MANUAL','FEED'])}
            <div class="row" style="grid-column:1/-1"><label>Bank Holidays list (JSON dates)</label><textarea name="bh_list">${JSON.stringify(s.bh_list || [], null, 2)}</textarea></div>
            ${input('bh_feed_url','BH feed URL', s.bh_feed_url || '')}
            ${input('vat_rate_pct','VAT %', s.vat_rate_pct ?? 20)}
            ${input('holiday_pay_pct','Holiday pay %', s.holiday_pay_pct ?? 0)}
            ${input('erni_pct','ERNI %', s.erni_pct ?? 0)}
            ${select('apply_holiday_to','Apply holiday to', s.apply_holiday_to || 'PAYE_ONLY', ['PAYE_ONLY','ALL','NONE'])}
            ${select('apply_erni_to','Apply ERNI to', s.apply_erni_to || 'PAYE_ONLY', ['PAYE_ONLY','ALL','NONE'])}
            <div class="row" style="grid-column:1/-1"><label>Margin includes (JSON)</label><textarea name="margin_includes">${JSON.stringify(s.margin_includes || {}, null, 2)}</textarea></div>
            ${input('effective_from','Effective from (YYYY-MM-DD)', s.effective_from || new Date().toISOString().slice(0,10))}
          </div>
          <div class="actions">
            <div class="spacer"></div>
            <button id="btnSaveSettings" class="primary">Save defaults</button>
          </div>
        </div>
      `;
      byId('btnSaveSettings').onclick = async ()=>{
        const payload = collectForm('#settingsForm', true);
        try{
          await saveSettings(payload);
          alert('Saved.');
        }catch{ alert('Save failed'); }
      };
    }

    // ===== Generic modal plumbing =====
    function showModal(title, tabs, renderTab, onSave, hasId){
      byId('modalTitle').textContent = title;
      const tabsEl = byId('modalTabs'); tabsEl.innerHTML='';
      tabs.forEach((t,i)=>{
        const b=document.createElement('button'); b.textContent=t.label; if(i===0)b.classList.add('active');
        b.onclick = ()=>{ tabsEl.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); setTab(t.key); };
        tabsEl.appendChild(b);
      });
      function setTab(k){ byId('modalBody').innerHTML = renderTab(k, modalCtx.data) || ''; }
      setTab(tabs[0].key);

      byId('btnDelete').style.display = hasId ? '' : 'none';
      byId('btnDelete').onclick = openDelete;
      byId('btnSave').onclick = onSave;

      // related button
      byId('btnRelated').onclick = async ()=>{
        const ent = modalCtx.entity; const id = modalCtx.data?.id;
        const data = await fetchRelatedCounts(ent, id);
        if (!data || !Object.keys(data).length) return alert('No related records found.');
        const pick = prompt('Related counts:\n'+Object.entries(data).map(([k,v])=>`${k}: ${v}`).join('\n')+'\n\nEnter a type to open (e.g. timesheets, invoices):');
        if (!pick) return;
        const rows = await fetchRelated(ent, id, pick);
        if (!rows) return;
        currentSection = (pick==='timesheets'?'timesheets':(pick==='invoices'?'invoices':currentSection));
        renderSummary(rows);
        closeModal();
      };

      // drag
      const back = byId('modalBack'); back.style.display='flex';
      const modal = byId('modal'); const drag = byId('modalDrag');
      let offX=0, offY=0, dragging=false;
      drag.onmousedown = (e)=>{ dragging=true; modal.classList.add('dragging'); offX=e.offsetX; offY=e.offsetY; document.onmousemove=mm; document.onmouseup=mu; };
      function mm(e){ if(!dragging) return; modal.style.position='absolute'; modal.style.left=(e.clientX-offX)+'px'; modal.style.top=(e.clientY-offY)+'px'; }
      function mu(){ dragging=false; modal.classList.remove('dragging'); document.onmousemove=null; document.onmouseup=null; }
      byId('btnCloseModal').onclick = closeModal;
    }
    function closeModal(){ byId('modalBack').style.display='none'; }

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
      const root = document.querySelector(sel); const out={};
      root.querySelectorAll('input,select,textarea').forEach(el=>{
        const k = el.name; if (!k) return;
        let v = el.value;
        if (el.type==='number') v = Number(v); 
        if (el.tagName==='SELECT' && (v==='Yes'||v==='No')) v = (v==='Yes');
        if (jsonTry && (k==='bh_list' || k==='margin_includes')) { try{ v = JSON.parse(v || (k==='bh_list'?'[]':'{}')); }catch{} }
        out[k]=v;
      }); return out;
    }

    // ===== Quick search
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

    // ===== Boot
    async function renderAll(){
      renderTopNav(); renderTools();
      const data = await loadSection();
      if (currentSection==='settings') renderSummary(data); // panel renders itself
      else if (currentSection==='audit') renderSummary(data);
      else renderSummary(Array.isArray(data) ? data : []);
    }
    async function bootstrapApp(){
      renderTopNav(); renderTools(); await renderAll();
    }

    // Initialize
    initAuthUI();
    if (loadSession()) { scheduleRefresh(); bootstrapApp(); }
    else openLogin();
  </script>
</body>
</html>
