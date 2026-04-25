// ============================================================
// POWER UP PROMPTS — Extension Popup Controller
// ============================================================

const API_BASE         = 'https://power-up-prompts-api.onrender.com';
const PAYMENT_MONTHLY  = 'https://book.libreacademy.ph/payment-link/69d2829ca6c96e61a845fca1';
const PAYMENT_YEARLY   = 'https://book.libreacademy.ph/payment-link/69d24806a6c96e61a845fc6a';
const FREE_LIMIT       = 5;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const headerSubtitle      = document.getElementById('headerSubtitle');
const signOutBtn          = document.getElementById('signOutBtn');
const adminBtn            = document.getElementById('adminBtn');

const viewEmail           = document.getElementById('viewEmail');
const emailInput          = document.getElementById('emailInput');
const continueBtn         = document.getElementById('continueBtn');
const continueLabel       = document.getElementById('continueLabel');
const continueSpinner     = document.getElementById('continueSpinner');
const emailError          = document.getElementById('emailError');

const viewSetup           = document.getElementById('viewSetup');
const setupEmailDisplay   = document.getElementById('setupEmailDisplay');
const setupPassword       = document.getElementById('setupPassword');
const setupConfirm        = document.getElementById('setupConfirm');
const setupPin            = document.getElementById('setupPin');
const setupRemember       = document.getElementById('setupRemember');
const setupError          = document.getElementById('setupError');
const createAccountBtn    = document.getElementById('createAccountBtn');
const createAccountLabel  = document.getElementById('createAccountLabel');
const createAccountSpinner= document.getElementById('createAccountSpinner');

const viewLogin           = document.getElementById('viewLogin');
const loginEmailDisplay   = document.getElementById('loginEmailDisplay');
const loginPassword       = document.getElementById('loginPassword');
const loginRemember       = document.getElementById('loginRemember');
const loginError          = document.getElementById('loginError');
const signInBtn           = document.getElementById('signInBtn');
const signInLabel         = document.getElementById('signInLabel');
const signInSpinner       = document.getElementById('signInSpinner');

const viewVerifyPin       = document.getElementById('viewVerifyPin');
const pinEmailDisplay     = document.getElementById('pinEmailDisplay');
const pinInput            = document.getElementById('pinInput');
const pinError            = document.getElementById('pinError');
const verifyPinBtn        = document.getElementById('verifyPinBtn');
const verifyPinLabel      = document.getElementById('verifyPinLabel');
const verifyPinSpinner    = document.getElementById('verifyPinSpinner');

const viewNewPassword     = document.getElementById('viewNewPassword');
const newPassword         = document.getElementById('newPassword');
const newPasswordConfirm  = document.getElementById('newPasswordConfirm');
const newPasswordError    = document.getElementById('newPasswordError');
const setPasswordBtn      = document.getElementById('setPasswordBtn');
const setPasswordLabel    = document.getElementById('setPasswordLabel');
const setPasswordSpinner  = document.getElementById('setPasswordSpinner');

const viewMain            = document.getElementById('viewMain');
const promptInput         = document.getElementById('promptInput');
const charCount           = document.getElementById('charCount');
const enhanceBtn          = document.getElementById('enhanceBtn');
const enhanceBtnIcon      = document.getElementById('enhanceBtnIcon');
const enhanceLabel        = document.getElementById('enhanceLabel');
const enhanceSpinner      = document.getElementById('enhanceSpinner');
const enhanceError        = document.getElementById('enhanceError');
const powerupStatus       = document.getElementById('powerupStatus');
const powerupDots         = document.getElementById('powerupDots');
const powerupText         = document.getElementById('powerupText');
const outputSection       = document.getElementById('outputSection');
const jsonOutput          = document.getElementById('jsonOutput');
const copyBtn             = document.getElementById('copyBtn');
const copyConfirm         = document.getElementById('copyConfirm');

const viewAdmin           = document.getElementById('viewAdmin');
const adminTotal          = document.getElementById('adminTotal');
const adminEmail          = document.getElementById('adminEmail');
const adminAddBtn         = document.getElementById('adminAddBtn');
const adminAddLabel       = document.getElementById('adminAddLabel');
const adminAddSpinner     = document.getElementById('adminAddSpinner');
const adminAddError       = document.getElementById('adminAddError');
const adminUserList       = document.getElementById('adminUserList');

// ── State ─────────────────────────────────────────────────────────────────────
let token        = '';
let userEmail    = '';
let isAdmin      = false;
let powerupsUsed = 0;
let isSubscribed = false;
let subExpiresAt = null;
let limitReached = false;
let resetToken   = '';   // Short-lived JWT returned after PIN verification
let allUsers     = [];   // Full user list for client-side search/filter

// ── Fetch with retry ──────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const attempt = () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 55000);
    return fetch(`${API_BASE}${path}`, { ...options, signal: ctrl.signal })
      .finally(() => clearTimeout(t));
  };
  try {
    return await attempt();
  } catch {
    // Retry once after a brief pause (covers transient network blips)
    await new Promise(r => setTimeout(r, 2000));
    return await attempt();
  }
}

// ── View management ───────────────────────────────────────────────────────────
const ALL_VIEWS = {
  viewEmail, viewSetup, viewLogin,
  viewVerifyPin, viewNewPassword,
  viewMain, viewAdmin
};

function showView(name) {
  Object.values(ALL_VIEWS).forEach(v => v.classList.add('hidden'));
  ALL_VIEWS[name].classList.remove('hidden');

  const isApp = name === 'viewMain' || name === 'viewAdmin';
  signOutBtn.classList.toggle('hidden', !isApp);
  adminBtn.classList.toggle('hidden', !isApp || !isAdmin);

  const subtitles = {
    viewEmail:       'Sign in or create an account',
    viewSetup:       'Create your password',
    viewLogin:       'Welcome back',
    viewVerifyPin:   'Verify your identity',
    viewNewPassword: 'Set new password',
    viewMain:        userEmail,
    viewAdmin:       'Manage Users'
  };
  headerSubtitle.textContent = subtitles[name] || '';

  if (name === 'viewEmail')       emailInput.focus();
  if (name === 'viewSetup')       setupPassword.focus();
  if (name === 'viewLogin')       loginPassword.focus();
  if (name === 'viewVerifyPin')   pinInput.focus();
  if (name === 'viewNewPassword') newPassword.focus();
  if (name === 'viewMain')        { updatePowerupUI(); promptInput.focus(); }
  if (name === 'viewAdmin')       { loadAdminUsers(); adminEmail.focus(); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function clearError(el)     { el.textContent = '';  el.classList.add('hidden'); }
function setLoading(btn, lbl, spin, on) {
  btn.disabled = on;
  lbl.classList.toggle('hidden', on);
  spin.classList.toggle('hidden', !on);
}
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function highlightEmail(email, term) {
  if (!term) return esc(email);
  const lo  = email.toLowerCase();
  const idx = lo.indexOf(term.toLowerCase());
  if (idx === -1) return esc(email);
  return esc(email.slice(0, idx)) +
    `<mark class="email-highlight">${esc(email.slice(idx, idx + term.length))}</mark>` +
    esc(email.slice(idx + term.length));
}

// ── Powerup UI ────────────────────────────────────────────────────────────────
function updatePowerupUI() {
  const subStatus = document.getElementById('subStatus');
  if (isAdmin) {
    powerupStatus.classList.add('hidden');
    subStatus.classList.add('hidden');
    setEnhanceMode('normal');
    return;
  }
  if (isSubscribed) {
    powerupStatus.classList.add('hidden');
    if (subExpiresAt) {
      const exp = new Date(subExpiresAt);
      const opts = { year: 'numeric', month: 'short', day: 'numeric' };
      subStatus.textContent = `Subscription renews on ${exp.toLocaleDateString('en-US', opts)}`;
      subStatus.classList.remove('hidden');
    } else {
      subStatus.classList.add('hidden');
    }
    setEnhanceMode('normal');
    return;
  }
  subStatus.classList.add('hidden');
  powerupStatus.classList.remove('hidden');
  const dots = powerupDots.querySelectorAll('.dot');
  dots.forEach((dot, i) => dot.classList.toggle('dot-used', i < powerupsUsed));
  const remaining = FREE_LIMIT - powerupsUsed;
  if (powerupsUsed >= FREE_LIMIT) {
    powerupText.textContent = 'Free powerups used up';
    setEnhanceMode('subscribe');
  } else {
    powerupText.textContent = remaining === 1
      ? '1 free powerup remaining'
      : `${remaining} free powerups remaining`;
    setEnhanceMode('normal');
  }
}

function setEnhanceMode(mode) {
  const pricingOptions = document.getElementById('pricingOptions');
  limitReached = mode === 'subscribe';
  if (mode === 'subscribe') {
    enhanceBtn.classList.add('hidden');
    pricingOptions.classList.remove('hidden');
  } else {
    enhanceBtn.classList.remove('hidden');
    enhanceBtn.className = 'btn-primary';
    enhanceBtnIcon.textContent = '⚡';
    enhanceLabel.textContent   = 'Power Up Prompt';
    pricingOptions.classList.add('hidden');
  }
}

// ── Token storage ─────────────────────────────────────────────────────────────
function saveSession(data) {
  chrome.storage.local.set({
    token:        data.token,
    email:        data.email,
    isAdmin:      data.is_admin      || false,
    powerupsUsed: data.powerups_used || 0,
    isSubscribed: data.is_subscribed || false
  });
}
function clearSession() {
  chrome.storage.local.remove(['token','email','isAdmin','powerupsUsed','isSubscribed']);
}
async function loadSession() {
  return new Promise(resolve =>
    chrome.storage.local.get(['token','email','isAdmin','powerupsUsed','isSubscribed','subExpiresAt'], resolve)
  );
}

// ── Password eye toggles ──────────────────────────────────────────────────────
document.querySelectorAll('.btn-eye').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const s = await loadSession();
  if (s.token) {
    token        = s.token;
    userEmail    = s.email    || '';
    isAdmin      = s.isAdmin  || false;
    powerupsUsed = s.powerupsUsed || 0;
    isSubscribed = s.isSubscribed || false;
    subExpiresAt = s.subExpiresAt || null;
    showView('viewMain');

    // Refresh status from server (catches subscription changes from payments)
    try {
      const res = await apiFetch('/api/auth/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        isAdmin      = data.is_admin      || false;
        powerupsUsed = data.powerups_used || 0;
        isSubscribed = data.is_subscribed || false;
        subExpiresAt = data.subscription_expires_at || null;
        saveSession({ token, email: data.email, is_admin: isAdmin, powerups_used: powerupsUsed, is_subscribed: isSubscribed });
        chrome.storage.local.set({ subExpiresAt });
        updatePowerupUI();
      } else if (res.status === 401) {
        clearSession();
        showView('viewEmail');
      }
    } catch {}
  } else {
    showView('viewEmail');
  }
}

// ── Step 1: Email check ───────────────────────────────────────────────────────
continueBtn.addEventListener('click', checkEmail);
emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') checkEmail(); });

async function checkEmail() {
  clearError(emailError);
  const email = emailInput.value.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    showError(emailError, 'Please enter a valid email address.'); return;
  }
  setLoading(continueBtn, continueLabel, continueSpinner, true);
  try {
    const res  = await apiFetch('/api/auth/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) { showError(emailError, data.error || 'Something went wrong.'); return; }
    userEmail = email;
    if (data.status === 'ready') {
      loginEmailDisplay.textContent = email;
      loginPassword.value = '';
      clearError(loginError);
      showView('viewLogin');
    } else {
      setupEmailDisplay.textContent = email;
      setupPassword.value = ''; setupConfirm.value = ''; setupPin.value = '';
      clearError(setupError);
      showView('viewSetup');
    }
  } catch {
    showError(emailError, 'Could not reach the server. Check your connection.');
  } finally {
    setLoading(continueBtn, continueLabel, continueSpinner, false);
  }
}

// ── Step 2a: Create account (with PIN) ────────────────────────────────────────
createAccountBtn.addEventListener('click', createAccount);
setupConfirm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setupPin.focus(); }});
setupPin.addEventListener('keydown', e => { if (e.key === 'Enter') createAccount(); });

async function createAccount() {
  clearError(setupError);
  const password = setupPassword.value;
  const confirm  = setupConfirm.value;
  const pin      = setupPin.value.trim();
  if (password.length < 8) { showError(setupError, 'Password must be at least 8 characters.'); return; }
  if (password !== confirm)  { showError(setupError, 'Passwords do not match.'); return; }
  if (pin.length !== 6 || !/^\d{6}$/.test(pin)) { showError(setupError, 'Recovery PIN must be exactly 6 digits.'); return; }
  setLoading(createAccountBtn, createAccountLabel, createAccountSpinner, true);
  try {
    const res  = await apiFetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail, password, pin, remember: setupRemember.checked })
    });
    const data = await res.json();
    if (!res.ok) { showError(setupError, data.error || 'Account creation failed.'); return; }
    applySession(data);
    if (setupRemember.checked) saveSession(data);
    showView('viewMain');
  } catch {
    showError(setupError, 'Could not reach the server.');
  } finally {
    setLoading(createAccountBtn, createAccountLabel, createAccountSpinner, false);
  }
}

// ── Step 2b: Sign in ──────────────────────────────────────────────────────────
signInBtn.addEventListener('click', signIn);
loginPassword.addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });

async function signIn() {
  clearError(loginError);
  loginError.style.color = ''; loginError.style.background = ''; loginError.style.borderColor = '';
  const password = loginPassword.value;
  if (!password) { showError(loginError, 'Please enter your password.'); return; }
  setLoading(signInBtn, signInLabel, signInSpinner, true);
  try {
    const res  = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail, password, remember: loginRemember.checked })
    });
    const data = await res.json();
    if (!res.ok) { showError(loginError, data.error || 'Sign in failed.'); return; }
    applySession(data);
    if (loginRemember.checked) saveSession(data);
    showView('viewMain');
  } catch {
    showError(loginError, 'Could not reach the server.');
  } finally {
    setLoading(signInBtn, signInLabel, signInSpinner, false);
  }
}

function applySession(data) {
  token        = data.token;
  userEmail    = data.email;
  isAdmin      = data.is_admin      || false;
  powerupsUsed = data.powerups_used || 0;
  isSubscribed = data.is_subscribed || false;
}

// ── Forgot password — PIN verification ────────────────────────────────────────

document.getElementById('forgotPasswordBtn').addEventListener('click', () => {
  pinEmailDisplay.textContent = userEmail;
  pinInput.value = '';
  clearError(pinError);
  showView('viewVerifyPin');
});

verifyPinBtn.addEventListener('click', verifyPin);
pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') verifyPin(); });

async function verifyPin() {
  clearError(pinError);
  const pin = pinInput.value.trim();
  if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    showError(pinError, 'Please enter your 6-digit recovery PIN.'); return;
  }
  setLoading(verifyPinBtn, verifyPinLabel, verifyPinSpinner, true);
  try {
    const res = await apiFetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail, pin })
    });
    const data = await res.json();
    if (!res.ok) { showError(pinError, data.error || 'Verification failed.'); return; }
    resetToken = data.reset_token;
    newPassword.value = ''; newPasswordConfirm.value = '';
    clearError(newPasswordError);
    showView('viewNewPassword');
  } catch {
    showError(pinError, 'Could not reach the server.');
  } finally {
    setLoading(verifyPinBtn, verifyPinLabel, verifyPinSpinner, false);
  }
}

// ── Set new password (after PIN verified) ─────────────────────────────────────
setPasswordBtn.addEventListener('click', setNewPassword);
newPasswordConfirm.addEventListener('keydown', e => { if (e.key === 'Enter') setNewPassword(); });

async function setNewPassword() {
  clearError(newPasswordError);
  const pw  = newPassword.value;
  const con = newPasswordConfirm.value;
  if (pw.length < 8) { showError(newPasswordError, 'Password must be at least 8 characters.'); return; }
  if (pw !== con)     { showError(newPasswordError, 'Passwords do not match.'); return; }
  setLoading(setPasswordBtn, setPasswordLabel, setPasswordSpinner, true);
  try {
    const res = await apiFetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset_token: resetToken, password: pw })
    });
    const data = await res.json();
    if (!res.ok) { showError(newPasswordError, data.error || 'Failed to set password.'); return; }
    resetToken = '';
    userEmail  = data.email || userEmail;
    loginEmailDisplay.textContent = userEmail;
    loginPassword.value = '';
    // Show success message in login view
    loginError.textContent = '✓ Password updated! Please sign in.';
    loginError.classList.remove('hidden');
    loginError.style.color = 'var(--success)';
    loginError.style.background = 'rgba(52,211,153,0.08)';
    loginError.style.borderColor = 'rgba(52,211,153,0.2)';
    showView('viewLogin');
  } catch {
    showError(newPasswordError, 'Could not reach the server.');
  } finally {
    setLoading(setPasswordBtn, setPasswordLabel, setPasswordSpinner, false);
  }
}

// ── Back / Sign out ───────────────────────────────────────────────────────────
document.getElementById('backFromSetup').addEventListener('click', () => showView('viewEmail'));
document.getElementById('backFromLogin').addEventListener('click', () => showView('viewEmail'));
document.getElementById('backFromPin').addEventListener('click', () => {
  loginEmailDisplay.textContent = userEmail;
  clearError(loginError);
  loginError.style.color = ''; loginError.style.background = ''; loginError.style.borderColor = '';
  showView('viewLogin');
});

signOutBtn.addEventListener('click', () => {
  clearSession();
  token = ''; userEmail = ''; isAdmin = false;
  powerupsUsed = 0; isSubscribed = false; limitReached = false;
  resetToken = '';
  emailInput.value = '';
  outputSection.classList.add('hidden');
  clearError(enhanceError);
  showView('viewEmail');
});

// ── Admin toggle ──────────────────────────────────────────────────────────────
adminBtn.addEventListener('click', () => {
  viewAdmin.classList.contains('hidden') ? showView('viewAdmin') : showView('viewMain');
});

// ── Enhance / Subscribe ───────────────────────────────────────────────────────
promptInput.addEventListener('input', () => { charCount.textContent = promptInput.value.length; });
enhanceBtn.addEventListener('click', () => { runEnhance(); });

// Pricing card clicks
document.getElementById('planMonthly').addEventListener('click', () => {
  chrome.tabs.create({ url: PAYMENT_MONTHLY });
});
document.getElementById('planYearly').addEventListener('click', () => {
  chrome.tabs.create({ url: PAYMENT_YEARLY });
});
promptInput.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runEnhance(); }
});

let cooldownInterval = null;

function startCooldownTimer(msLeft) {
  enhanceBtn.disabled = true;
  enhanceBtnIcon.textContent = '⏳';
  clearInterval(cooldownInterval);

  const endTime = Date.now() + msLeft;

  function tick() {
    const remaining = endTime - Date.now();
    if (remaining <= 0) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
      enhanceBtn.disabled = false;
      enhanceBtnIcon.textContent = '⚡';
      enhanceLabel.textContent = 'Power Up Prompt';
      clearError(enhanceError);
      return;
    }
    const mins = Math.ceil(remaining / 60000);
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    enhanceLabel.textContent = hrs > 0 ? `Wait ${hrs}h ${m}m` : `Wait ${m}m`;
  }

  tick();
  cooldownInterval = setInterval(tick, 30000); // update every 30s
}

async function runEnhance() {
  clearError(enhanceError);
  const prompt = promptInput.value.trim();
  if (!prompt) { showError(enhanceError, 'Please enter a prompt first.'); return; }

  setLoading(enhanceBtn, enhanceLabel, enhanceSpinner, true);
  try {
    const res = await apiFetch('/api/enhance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ prompt })
    });

    if (res.status === 401) { clearSession(); showView('viewEmail'); return; }

    const data = await res.json();

    // Free user hit 5 total limit
    if (res.status === 402 || data.error === 'limit_reached') {
      powerupsUsed = FREE_LIMIT;
      isSubscribed = false;
      chrome.storage.local.set({ powerupsUsed: FREE_LIMIT, isSubscribed: false });
      updatePowerupUI();
      return;
    }

    // Subscribed user hit 50-per-4h window limit
    if (res.status === 429 && data.error === 'window_limit') {
      showError(enhanceError, data.message || 'Limit reached. Please wait before trying again.');
      startCooldownTimer(data.retry_after_ms);
      return;
    }

    if (res.status === 503) { showError(enhanceError, data.error || 'Enhancement service temporarily unavailable. Please try again.'); return; }
    if (!res.ok) { showError(enhanceError, data.error || 'Enhancement failed.'); return; }

    if (data.powerups_used !== null && data.powerups_used !== undefined) {
      powerupsUsed = data.powerups_used;
      chrome.storage.local.set({ powerupsUsed });
    }
    if (data.is_subscribed !== undefined) {
      isSubscribed = data.is_subscribed;
      chrome.storage.local.set({ isSubscribed });
    }

    // Show window usage for subscribed users
    if (data.window_powerups !== undefined && data.window_limit) {
      const remaining = data.window_limit - data.window_powerups;
      if (remaining <= 10 && !isAdmin) {
        powerupStatus.classList.remove('hidden');
        powerupText.textContent = `${remaining} powerup${remaining !== 1 ? 's' : ''} left this window`;
      }
    }

    updatePowerupUI();
    renderOutput(data.enhanced);

  } catch {
    showError(enhanceError, 'Could not reach the server. Check your connection.');
  } finally {
    setLoading(enhanceBtn, enhanceLabel, enhanceSpinner, false);
  }
}

// ── Output ────────────────────────────────────────────────────────────────────
function syntaxHighlight(json) {
  json = json.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}[\],:])/g,
    m => {
      let c = 'num';
      if (/^"/.test(m)) c = /:$/.test(m) ? 'key' : 'str';
      else if (/true|false/.test(m)) c = 'bool';
      else if (/null/.test(m)) c = 'null';
      else if (/[{}[\],:]/.test(m)) c = 'punct';
      return `<span class="${c}">${m}</span>`;
    }
  );
}

function renderOutput(enhanced) {
  const formatted = JSON.stringify(enhanced, null, 2);
  jsonOutput.innerHTML = syntaxHighlight(formatted);
  jsonOutput.dataset.raw = formatted;
  outputSection.classList.remove('hidden');
  outputSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(jsonOutput.dataset.raw || jsonOutput.innerText).then(() => {
    copyBtn.textContent = 'Copied!';
    copyConfirm.classList.remove('hidden');
    setTimeout(() => { copyConfirm.classList.add('hidden'); copyBtn.textContent = 'Copy JSON'; }, 2000);
  });
});

// ── Admin: Load users ─────────────────────────────────────────────────────────
async function loadAdminUsers() {
  adminUserList.innerHTML = '<div class="admin-loading">Loading…</div>';
  try {
    const res = await apiFetch('/api/admin/whitelist', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) { adminUserList.innerHTML = '<div class="admin-loading">Failed to load users.</div>'; return; }
    const { users } = await res.json();
    allUsers = users;
    // Re-apply current filter (e.g. after adding a user mid-search)
    const term = adminEmail.value.trim().toLowerCase();
    const filtered = term ? allUsers.filter(u => u.email.includes(term)) : allUsers;
    renderAdminUsers(filtered, term);
  } catch {
    adminUserList.innerHTML = '<div class="admin-loading">Could not reach server.</div>';
  }
}

function renderAdminUsers(users, highlightTerm = '') {
  const totalCount  = allUsers.length;
  const isFiltering = highlightTerm && users.length !== totalCount;
  adminTotal.textContent = isFiltering
    ? `${users.length} of ${totalCount}`
    : `${totalCount} user${totalCount !== 1 ? 's' : ''}`;

  if (users.length === 0) {
    adminUserList.innerHTML = isFiltering
      ? `<div class="admin-no-match">No users match "${esc(highlightTerm)}"</div>`
      : '<div class="admin-loading">No users yet.</div>';
    return;
  }
  adminUserList.innerHTML = users.map(u => {
    const subValid     = u.is_subscribed;
    const powerupInfo  = u.is_admin ? 'unlimited' : `${u.powerups_used ?? 0}/${FREE_LIMIT}`;
    const emailDisplay = highlightEmail(u.email, highlightTerm);
    const isMatch      = !!(highlightTerm && u.email.includes(highlightTerm));
    return `
      <div class="admin-user-row${isMatch ? ' admin-user-row--match' : ''}">
        <div class="admin-user-meta">
          <div class="admin-user-top">
            <span class="admin-user-email">${emailDisplay}</span>
            ${u.is_admin ? '<span class="admin-badge">admin</span>' : ''}
            ${subValid ? '<span class="admin-badge sub-badge">subscribed</span>' : ''}
            ${u.email === userEmail ? '<span class="admin-you">you</span>' : ''}
          </div>
          <div class="admin-user-stats">⚡ ${powerupInfo} powerups</div>
        </div>
        <div class="admin-user-actions">
          ${u.email !== userEmail ? `
            ${subValid
              ? `<button class="btn-admin-action" data-action="unsub" data-email="${esc(u.email)}">Revoke</button>`
              : `<button class="btn-admin-action btn-grant" data-action="sub" data-email="${esc(u.email)}">Grant Sub</button>`
            }
            <button class="btn-admin-action" data-action="reset-pw" data-email="${esc(u.email)}" title="Clear password">🔑</button>
            <button class="btn-admin-action" data-action="reset-pin" data-email="${esc(u.email)}" title="Clear recovery PIN">🔢</button>
            <button class="btn-remove" data-email="${esc(u.email)}">✕</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  adminUserList.querySelectorAll('[data-action="sub"]').forEach(btn =>
    btn.addEventListener('click', () => grantSubscription(btn.dataset.email))
  );
  adminUserList.querySelectorAll('[data-action="unsub"]').forEach(btn =>
    btn.addEventListener('click', () => revokeSubscription(btn.dataset.email))
  );
  adminUserList.querySelectorAll('[data-action="reset-pw"]').forEach(btn =>
    btn.addEventListener('click', () => adminResetPassword(btn.dataset.email))
  );
  adminUserList.querySelectorAll('[data-action="reset-pin"]').forEach(btn =>
    btn.addEventListener('click', () => adminResetPin(btn.dataset.email))
  );
  adminUserList.querySelectorAll('.btn-remove').forEach(btn =>
    btn.addEventListener('click', () => removeUser(btn.dataset.email))
  );
}

// ── Admin: Live search / filter ───────────────────────────────────────────────
adminEmail.addEventListener('input', filterUsers);

function filterUsers() {
  const term = adminEmail.value.trim().toLowerCase();

  // Reset any "already exists" warning styling
  adminAddError.style.color = '';
  adminAddError.style.background = '';
  adminAddError.style.borderColor = '';

  if (!term) {
    clearError(adminAddError);
    renderAdminUsers(allUsers);
    return;
  }

  const filtered = allUsers.filter(u => u.email.includes(term));
  renderAdminUsers(filtered, term);

  // Show amber notice on exact match so admin knows not to re-add
  const exactMatch = allUsers.find(u => u.email === term);
  if (exactMatch) {
    adminAddError.textContent = '↓ This email already exists — manage it below';
    adminAddError.classList.remove('hidden');
    adminAddError.style.color        = '#f59e0b';
    adminAddError.style.background   = 'rgba(245,158,11,0.08)';
    adminAddError.style.borderColor  = 'rgba(245,158,11,0.2)';
  } else {
    clearError(adminAddError);
  }
}

// ── Admin: Add user ───────────────────────────────────────────────────────────
adminAddBtn.addEventListener('click', addUser);
adminEmail.addEventListener('keydown', e => { if (e.key === 'Enter') addUser(); });

async function addUser() {
  clearError(adminAddError);
  const email = adminEmail.value.trim().toLowerCase();
  if (!email || !email.includes('@')) { showError(adminAddError, 'Enter a valid email.'); return; }
  setLoading(adminAddBtn, adminAddLabel, adminAddSpinner, true);
  try {
    const res = await apiFetch('/api/admin/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) { showError(adminAddError, data.error || 'Failed to add.'); return; }
    adminEmail.value = '';
    loadAdminUsers();
  } catch {
    showError(adminAddError, 'Could not reach server.');
  } finally {
    setLoading(adminAddBtn, adminAddLabel, adminAddSpinner, false);
  }
}

async function grantSubscription(email) {
  try {
    await apiFetch(`/api/admin/subscribe/${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    loadAdminUsers();
  } catch { alert('Could not reach server.'); }
}

async function revokeSubscription(email) {
  if (!confirm(`Revoke subscription for ${email}?`)) return;
  try {
    await apiFetch(`/api/admin/subscribe/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    loadAdminUsers();
  } catch { alert('Could not reach server.'); }
}

async function adminResetPassword(email) {
  if (!confirm(`Clear password for ${email}?\n\nThey will need to set a new password on next login.`)) return;
  try {
    const res = await apiFetch(`/api/admin/reset-password/${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed.'); return; }
    alert(`Password cleared for ${email}.`);
  } catch { alert('Could not reach server.'); }
}

async function adminResetPin(email) {
  if (!confirm(`Clear recovery PIN for ${email}?\n\nThey will need to set a new PIN on next login.`)) return;
  try {
    const res = await apiFetch(`/api/admin/reset-pin/${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed.'); return; }
    alert(`Recovery PIN cleared for ${email}.`);
  } catch { alert('Could not reach server.'); }
}

async function removeUser(email) {
  if (!confirm(`Remove ${email}?`)) return;
  try {
    const res = await apiFetch(`/api/admin/whitelist/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed.'); return; }
    loadAdminUsers();
  } catch { alert('Could not reach server.'); }
}

// ── Bulk Upload ───────────────────────────────────────────────────────────────
const bulkEmails      