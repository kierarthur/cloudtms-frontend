// ================= BROKER AUTH MODULE (drop-in) =================

// ===== CONFIG =====
const BROKER_BASE_URL = 'https://cloudtms.kier-88a.workers.dev'; // your Worker hostname
const ROUTES = {
  LOGIN:   '/auth/login',
  FORGOT:  '/auth/forgot',
  RESET:   '/auth/reset',
  REFRESH: '/auth/refresh',
  LOGOUT:  '/auth/logout'
};

// ===== Local storage keys (parity with your old module) =====
const SAVED_IDENTITY_KEY = 'rota_broker_identity_v1';   // stores { user_id, email } only (no tokens)
const LAST_EMAIL_KEY     = 'rota_last_login_email_v1';

// ===== In-memory session (never persisted) =====
let session = {
  accessToken: null,
  expiresAt: 0,        // epoch ms
  user: null,          // { id, email, roles, ... }
  refreshTimer: null
};
let AUTH_DENIED = false;

// ================ Small helpers ================
function nowMs() { return Date.now(); }
function secondsFromNow(s){ return nowMs() + (s * 1000); }
function rememberEmailLocal(email){ try{ localStorage.setItem(LAST_EMAIL_KEY, email || ''); }catch{} }
function getRememberedEmail(){ try { return localStorage.getItem(LAST_EMAIL_KEY) || '' } catch { return '' } }
function saveIdentity({ user_id, email }){ try { localStorage.setItem(SAVED_IDENTITY_KEY, JSON.stringify({ user_id, email })) } catch{} }
function loadSavedIdentity(){ try{ const raw=localStorage.getItem(SAVED_IDENTITY_KEY); return raw?JSON.parse(raw):{} }catch{ return {} } }
function clearSavedIdentity(){ try{ localStorage.removeItem(SAVED_IDENTITY_KEY) } catch{} }

// ================ API (broker) ================
async function brokerPOST(path, body, { includeCreds=false } = {}) {
  const res = await fetch(BROKER_BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: includeCreds ? 'include' : 'omit', // refresh/login carry cookies
    body: body ? JSON.stringify(body) : '{}'
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text) } catch {}
  return { res, json, text };
}

async function apiLogin(email, password) {
  // include credentials so the broker can set refresh cookie
  return brokerPOST(ROUTES.LOGIN, { email, password }, { includeCreds:true });
}
async function apiForgot(email) {
  return brokerPOST(ROUTES.FORGOT, { email }, { includeCreds:true });
}
async function apiReset(token, newPassword) {
  return brokerPOST(ROUTES.RESET, { token, new_password:newPassword }, { includeCreds:true });
}
async function apiRefresh() {
  // uses refresh cookie; returns new access token
  return brokerPOST(ROUTES.REFRESH, {}, { includeCreds:true });
}
async function apiLogout() {
  return brokerPOST(ROUTES.LOGOUT, {}, { includeCreds:true });
}

// ================ Session manager ================
function setSession({ access_token, expires_in, user }) {
  session.accessToken = access_token || null;
  session.expiresAt   = access_token ? secondsFromNow(Math.max(60, (expires_in|0))) : 0; // min 60s
  session.user        = user || null;
  scheduleRefresh();
  // Save a tiny identity for UX only
  if (user && user.id) saveIdentity({ user_id: user.id, email: user.email || '' });
}

function clearSession() {
  session.accessToken = null;
  session.expiresAt   = 0;
  session.user        = null;
  if (session.refreshTimer) { clearTimeout(session.refreshTimer); session.refreshTimer = null; }
}

function scheduleRefresh() {
  if (!session.accessToken || !session.expiresAt) return;
  if (session.refreshTimer) { clearTimeout(session.refreshTimer); session.refreshTimer = null; }
  // refresh 30s before expiry (never less than 15s)
  const msUntil = Math.max(15_000, session.expiresAt - nowMs() - 30_000);
  session.refreshTimer = setTimeout(async () => {
    try {
      const ok = await tryRefreshOnce();
      if (!ok) { // refresh failed → force re-login
        clearSession(); openLoginOverlay();
      }
    } catch { clearSession(); openLoginOverlay(); }
  }, msUntil);
}

async function tryRefreshOnce() {
  try {
    const { res, json } = await apiRefresh();
    if (!res.ok || !json || json.ok === false || !json.access_token) return false;
    setSession({ access_token: json.access_token, expires_in: json.expires_in || 900, user: json.user || session.user });
    return true;
  } catch { return false; }
}

// Public helper for other API calls: attaches Authorization and retries once on 401 via refresh
async function authFetch(input, init={}) {
  const withAuth = (token) => {
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers, credentials: init.credentials || 'omit' });
  };

  // If we are within 20s of expiry, proactively refresh
  if (session.accessToken && (session.expiresAt - nowMs() < 20_000)) {
    await tryRefreshOnce();
  }
  let res = await withAuth(session.accessToken);
  if (res.status === 401) {
    const ok = await tryRefreshOnce();
    if (!ok) {
      clearSession();
      openLoginOverlay();
      throw new Error('Unauthorised; login required');
    }
    res = await withAuth(session.accessToken);
  }
  return res;
}

// ================ UI overlays & UX (same behaviour as before) ================
let _loadingCount = 0;
function ensureLoadingOverlay() {
  if (document.getElementById('loadingOverlay')) return;
  const style = document.createElement('style');
  style.textContent = `
    #loadingOverlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,12,16,.55);backdrop-filter:blur(2px);color:#e7ecf3;z-index:9999}
    #loadingOverlay.hidden{display:none}
    #loadingBox{display:inline-flex;gap:.6rem;align-items:center;border:1px solid #2a3446;background:#131926;color:#e7ecf3;padding:.75rem 1rem;border-radius:12px;font-weight:700}
    #authErrorOverlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(10,12,16,.85);backdrop-filter:blur(2px)}
    .sheet{max-width:480px;margin:10vh auto;background:#0f1624;color:#e7ecf3;border:1px solid #2a3446;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.4)}
    .sheet-header{display:flex;align-items:center;justify-content:space-between;padding:.9rem 1rem;border-bottom:1px solid #2a3446}
    .sheet-title{font-weight:800}
    .sheet-body{padding:1rem}
    .menu-item{background:#1b2331;border:1px solid #2a3446;color:#e7ecf3;border-radius:10px;padding:.5rem 1rem;font-weight:800}
    .muted{color:#9fb0c9}
    [id$="Overlay"]{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:9998}
    [id$="Overlay"].show{display:flex}
  `;
  document.head.appendChild(style);

  const load = document.createElement('div');
  load.id = 'loadingOverlay';
  load.className = 'hidden';
  load.innerHTML = `<div id="loadingBox"><div class="spinner"></div><div id="loadingText">Loading.</div></div>`;
  document.body.appendChild(load);

  const alertOverlay = document.createElement('div');
  alertOverlay.id = 'alertOverlay';
  alertOverlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Alert">
      <div class="sheet-header"><div class="sheet-title">Notice</div></div>
      <div id="alertBody" class="sheet-body"></div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;padding:.5rem .9rem 1rem;">
        <button id="alertOk" class="menu-item">OKAY</button>
      </div>
    </div>`;
  document.body.appendChild(alertOverlay);
}
function showLoading(msg='Loading.') {
  ensureLoadingOverlay();
  _loadingCount++; const ov=document.getElementById('loadingOverlay');
  ov.classList.remove('hidden'); const t=document.getElementById('loadingText'); if (t) t.textContent=msg;
}
function hideLoading() {
  _loadingCount=Math.max(0,_loadingCount-1);
  if (_loadingCount===0) { const ov=document.getElementById('loadingOverlay'); ov && ov.classList.add('hidden'); }
}
function showBlockingAlert(message, onOk) {
  ensureLoadingOverlay();
  const o=document.getElementById('alertOverlay'); const b=document.getElementById('alertBody');
  b.innerHTML = `<div class="muted">${message||''}</div>`;
  openOverlay('alertOverlay');
  const ok=document.getElementById('alertOk').cloneNode(true);
  document.getElementById('alertOk').replaceWith(ok);
  ok.addEventListener('click', ()=>{ closeOverlay('alertOverlay', true); if (typeof onOk==='function') onOk(); });
}

const OVERLAY_CONFIG = {
  loginOverlay:  { dismissible:false, blocking:true },
  forgotOverlay: { dismissible:true,  blocking:false },
  resetOverlay:  { dismissible:false, blocking:true },
  alertOverlay:  { dismissible:false, blocking:true },
  authErrorOverlay:{ dismissible:false, blocking:false }
};
function isBlockingOverlayOpen() {
  return ['loginOverlay','resetOverlay','alertOverlay'].some(id=>{
    const el=document.getElementById(id); return el && el.classList.contains('show');
  });
}
function openOverlay(id, focusSel) {
  ensureLoadingOverlay();
  const el=document.getElementById(id); if (!el) return;
  el.classList.add('show');
  (focusSel ? el.querySelector(focusSel) : el.querySelector('input,button'))?.focus?.();
}
function closeOverlay(id, force=false) {
  const el=document.getElementById(id); if (!el) return;
  const cfg=OVERLAY_CONFIG[id]||{dismissible:true}; if (!cfg.dismissible && !force) return;
  el.classList.remove('show');
}

function showAuthError(message='Not an authorised user') {
  if (AUTH_DENIED) return;
  AUTH_DENIED = true;
  try { const prev=document.getElementById('authErrorOverlay'); prev?.remove?.(); } catch {}
  const div=document.createElement('div');
  div.id='authErrorOverlay';
  div.innerHTML = `<div style="border:1px solid #2a3446;background:#131926;color:#e7ecf3;padding:1rem 1.2rem;border-radius:12px;font-weight:800;max-width:90vw;text-align:center;">${message}</div>`;
  document.body.appendChild(div);
}

function showToast(msg){
  let el=document.getElementById('toast');
  if(!el){ el=document.createElement('div'); el.id='toast';
    Object.assign(el.style,{position:'fixed',left:'50%',transform:'translateX(-50%)',bottom:'24px',
      background:'#131926',color:'#e7ecf3',border:'1px solid #2a3446',padding:'.6rem 1rem',borderRadius:'10px',zIndex:10000,fontWeight:800});
    document.body.appendChild(el);
  }
  el.textContent=String(msg||''); el.style.opacity='1'; setTimeout(()=>{el.style.opacity='0'},2500);
}

// ====== Auth overlays ======
function ensureAuthOverlays() {
  if (document.getElementById('loginOverlay')) return;

  const login = document.createElement('div');
  login.id='loginOverlay';
  login.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Sign in">
      <div class="sheet-header"><div class="sheet-title">Sign in</div></div>
      <div class="sheet-body">
        <form id="loginForm" autocomplete="on">
          <label for="loginEmail">Email</label>
          <input id="loginEmail" name="username" type="email" autocomplete="username" required />
          <label for="loginPassword" style="margin-top:.6rem">Password</label>
          <input id="loginPassword" name="password" type="password" autocomplete="current-password" required />
          <div style="display:flex;gap:.6rem;margin-top:.8rem;">
            <button id="loginSubmit" class="menu-item">Sign in</button>
            <button id="loginForgot" type="button" class="menu-item">Forgot password?</button>
          </div>
          <div id="loginErr" class="muted" role="alert" style="margin-top:.4rem;"></div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(login);

  const forgot = document.createElement('div');
  forgot.id='forgotOverlay';
  forgot.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Forgot password">
      <div class="sheet-header">
        <div class="sheet-title">Forgot password</div>
        <button id="forgotClose" class="menu-item" style="padding:.2rem .6rem">✕</button>
      </div>
      <div class="sheet-body">
        <form id="forgotForm" autocomplete="on">
          <label for="forgotEmail">Email</label>
          <input id="forgotEmail" name="username" type="email" autocomplete="username" required />
          <div style="display:flex;gap:.6rem;margin-top:.8rem;">
            <button id="forgotSubmit" type="submit" class="menu-item">Send reset link</button>
          </div>
          <div id="forgotMsg" class="muted" role="status" style="margin-top:.4rem;"></div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(forgot);

  const reset = document.createElement('div');
  reset.id='resetOverlay';
  reset.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Set new password">
      <div class="sheet-header"><div class="sheet-title">Set a new password</div></div>
      <div class="sheet-body">
        <form id="resetForm" autocomplete="on">
          <label for="resetPassword">New password</label>
          <input id="resetPassword" type="password" autocomplete="new-password" minlength="8" required />
          <div class="muted" style="margin:.2rem 0 .6rem">Use at least 8 characters with uppercase, lowercase, and a number.</div>
          <label for="resetConfirm">Confirm new password</label>
          <input id="resetConfirm" type="password" autocomplete="new-password" minlength="8" required />
          <div style="display:flex;gap:.6rem;margin-top:.8rem;">
            <button id="resetSubmit" class="menu-item">Update password</button>
          </div>
          <div id="resetErr" class="muted" role="alert" style="margin-top:.4rem;"></div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(reset);

  // Basic dismiss for Forgot
  document.getElementById('forgotOverlay').addEventListener('click', (e)=>{
    if (e.target.id==='forgotOverlay') closeOverlay('forgotOverlay');
  });
  document.getElementById('forgotClose').addEventListener('click', ()=> closeOverlay('forgotOverlay'));

  wireAuthForms();
}

function openLoginOverlay() {
  if (isBlockingOverlayOpen()) return;
  const email = getRememberedEmail();
  const le = document.getElementById('loginEmail'); const lerr = document.getElementById('loginErr');
  if (le) le.value = email;
  if (lerr) lerr.textContent = '';
  openOverlay('loginOverlay', email ? '#loginPassword' : '#loginEmail');
}
function openForgotOverlay() {
  if (isBlockingOverlayOpen()) return;
  const fe = document.getElementById('forgotEmail');
  const fmsg = document.getElementById('forgotMsg');
  if (fe) fe.value = getRememberedEmail();
  if (fmsg) fmsg.textContent = '';
  openOverlay('forgotOverlay', '#forgotEmail');
}
function openResetOverlay() {
  const rerr = document.getElementById('resetErr');
  const rp = document.getElementById('resetPassword');
  const rc = document.getElementById('resetConfirm');
  const rs = document.getElementById('resetSubmit');
  if (rerr) rerr.textContent=''; if (rp) rp.value=''; if (rc) rc.value=''; if (rs) rs.disabled=true;
  openOverlay('resetOverlay', '#resetPassword');
  const k = new URLSearchParams(location.search).get('k');
  if (!k) {
    closeOverlay('resetOverlay', true);
    showBlockingAlert('This reset link is invalid or missing.', ()=>{
      const clean = location.pathname + (location.hash || '');
      history.replaceState(null, '', clean);
      openLoginOverlay();
    });
  }
}

// ============ Form wiring (login/forgot/reset) ============
function wireAuthForms() {
  // Login
  const lf = document.getElementById('loginForm');
  const le = document.getElementById('loginEmail');
  const lp = document.getElementById('loginPassword');
  const ls = document.getElementById('loginSubmit');
  const lfg= document.getElementById('loginForgot');
  const lerr= document.getElementById('loginErr');

  lf?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (le?.value||'').trim().toLowerCase();
    const pw    = lp?.value || '';
    if (!email || !pw) return;

    try {
      if (ls) ls.disabled = true;
      showLoading('Signing in.');
      const { res, json } = await apiLogin(email, pw);
      if (!res.ok || !json || json.ok === false || !json.access_token) {
        if (lerr) lerr.textContent = 'Email or password is incorrect.';
        return;
      }

      setSession({ access_token: json.access_token, expires_in: json.expires_in || 900, user: json.user });
      rememberEmailLocal(email);
      await storeCredentialIfSupported(email, pw); // optional convenience

      AUTH_DENIED = false;
      if (lp) lp.value = '';
      closeOverlay('loginOverlay', true);

      // Clean any /#login|#forgot|#reset fragment
      try { if (/^#\/(login|forgot|reset)/.test(location.hash||'')) history.replaceState(null,'',location.pathname+(location.search||'')); } catch {}

      if (typeof loadFromServer === 'function') {
        await loadFromServer({ force:true });
      }
    } finally {
      hideLoading();
      if (ls) ls.disabled = false;
    }
  });

  lfg?.addEventListener('click', ()=>{
    closeOverlay('loginOverlay', true);
    openForgotOverlay();
  });

  // Forgot
  const ff = document.getElementById('forgotForm');
  const fe = document.getElementById('forgotEmail');
  const fs = document.getElementById('forgotSubmit');
  const fmsg = document.getElementById('forgotMsg');

  ff?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = (fe?.value||'').trim().toLowerCase();
    if (!email) { if (fmsg) fmsg.textContent = 'Please enter your email address.'; return; }
    try {
      if (fs) fs.disabled = true;
      showLoading('Sending reset link...');
      await apiForgot(email); // privacy-safe
      rememberEmailLocal(email);
      if (fmsg) fmsg.textContent = 'If this email exists, we’ve sent a reset link.';
      setTimeout(()=>{ closeOverlay('forgotOverlay'); openLoginOverlay(); }, 10_000);
    } finally { hideLoading(); if (fs) fs.disabled = false; }
  });

  // Reset
  const rf = document.getElementById('resetForm');
  const rp = document.getElementById('resetPassword');
  const rc = document.getElementById('resetConfirm');
  const rs = document.getElementById('resetSubmit');
  const rerr = document.getElementById('resetErr');

  function meetsPolicy(pw){ return !!(pw && pw.length>=8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)); }
  function validateReset() {
    const p = rp?.value || '', c = rc?.value || '';
    let ok = true, msg = '';
    if (!meetsPolicy(p)) { ok=false; msg='Use at least 8 chars with uppercase, lowercase, and a number.'; }
    else if (p !== c)    { ok=false; msg="Passwords don't match."; }
    if (rerr) rerr.textContent = msg;
    if (rs) rs.disabled = !ok;
    return ok;
  }
  rp?.addEventListener('input', validateReset);
  rc?.addEventListener('input', validateReset);

  rf?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const pOk = validateReset(); if (!pOk) return;
    const token = new URLSearchParams(location.search).get('k') || '';
    try {
      if (rs) rs.disabled = true;
      showLoading('Updating...');
      const { res, json } = await apiReset(token, rp?.value || '');
      if (!res.ok || !json || json.ok === false) {
        if (json && json.error === 'INVALID_OR_EXPIRED_RESET') {
          closeOverlay('resetOverlay', true);
          showBlockingAlert('This link has expired. Please request a new one.', ()=>{
            const clean = location.pathname + (location.hash || '');
            history.replaceState(null, '', clean);
            openLoginOverlay();
          });
        } else {
          if (rerr) rerr.textContent = (json && json.error) || 'Could not update password.';
        }
        return;
      }

      // Strip ?k and bounce to login
      const clean = location.pathname + (location.hash || '');
      history.replaceState(null,'',clean);
      closeOverlay('resetOverlay', true);
      showToast('Password updated. Please sign in.');
      openLoginOverlay();
      if (rp) rp.value=''; if (rc) rc.value=''; if (rs) rs.disabled=true;
    } finally { hideLoading(); if (rs) rs.disabled=false; }
  });
}

// ============ Credentials API (optional silent sign-in) ============
async function storeCredentialIfSupported(email, password) {
  try {
    if ('credentials' in navigator && 'PasswordCredential' in window) {
      const cred = new PasswordCredential({ id: email, password, name: email });
      await navigator.credentials.store(cred);
    }
  } catch {}
}
async function tryAutoLoginViaCredentialsAPI() {
  try {
    if (!('credentials' in navigator)) return false;
    if (session.accessToken) return true;
    const cred = await navigator.credentials.get({ password:true, mediation:'optional' });
    if (cred && cred.id && cred.password) {
      const { res, json } = await apiLogin(cred.id, cred.password);
      if (res.ok && json && json.ok && json.access_token) {
        setSession({ access_token: json.access_token, expires_in: json.expires_in || 900, user: json.user });
        rememberEmailLocal(cred.id);
        closeOverlay('loginOverlay', true);
        if (typeof loadFromServer === 'function') await loadFromServer({ force:true });
        return true;
      }
    }
  } catch {}
  return false;
}

// ============ Public logout ============
async function logoutAndShowLogin() {
  try { await apiLogout(); } catch {}
  clearSession();
  clearSavedIdentity();
  openLoginOverlay();
}

// ============ Boot ============
(function initAuth(){
  ensureLoadingOverlay();
  ensureAuthOverlays();

  // Try resume via refresh cookie first (zero-friction return visits)
  (async () => {
    try {
      const { res, json } = await apiRefresh();
      if (res.ok && json && json.access_token) {
        setSession({ access_token: json.access_token, expires_in: json.expires_in || 900, user: json.user });
        if (typeof loadFromServer === 'function') await loadFromServer({ force:true });
        return;
      }
    } catch {}
    // If URL has ?k= reset token, open Reset; else try Credentials API; else wait for data loader to prompt login.
    const hasK = !!(new URLSearchParams(location.search).get('k'));
    if (hasK) {
      openResetOverlay();
    } else {
      await tryAutoLoginViaCredentialsAPI();
    }
  })();

  // Optional: wire a header/menu logout button if present
  const miLogout = document.getElementById('miLogout');
  miLogout?.addEventListener('click', logoutAndShowLogin);
})();

// ============ Expose a tiny surface ============
window.openLoginOverlay = openLoginOverlay;
window.openForgotOverlay = openForgotOverlay;
window.openResetOverlay  = openResetOverlay;
window.showAuthError     = showAuthError;
window.logoutAuth        = logoutAndShowLogin;
window.authFetch         = authFetch;             // use for your broker APIs
window.getAccessToken    = () => session.accessToken;
window.getCurrentUser    = () => session.user;

// ================= END BROKER AUTH MODULE =================
