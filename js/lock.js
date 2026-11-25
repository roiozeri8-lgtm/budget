// App lock: Face ID / Touch ID (WebAuthn platform authenticator) with a PIN as fallback.
// This is a privacy screen against someone holding the phone; the data itself stays unencrypted
// in the browser storage of this device. Lock settings are per device and never synced.
import { state, setSetting } from './store.js';
import { icon } from './icons.js';
import { confirmDialog } from './ui.js';

const RELOCK_AFTER_MS = 60 * 1000;
let hiddenAt = 0;
let unlocked = false;

const lockSettings = () => state.settings.lock || {};
export const lockEnabled = () => !!lockSettings().enabled;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return b64(await crypto.subtle.digest('SHA-256', data));
}

export async function biometricsAvailable() {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

// ---------- enabling / disabling (called from settings) ----------

export async function enableLock(pin) {
  const salt = b64(random(16));
  await setSetting('lock', { enabled: true, salt, pinHash: await hashPin(pin, salt), credId: null });
  unlocked = true;
}

export async function disableLock() {
  await setSetting('lock', { enabled: false });
}

/** Register Face ID / Touch ID for this device. Returns true on success. */
export async function addBiometrics() {
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'ניהול תקציב', id: location.hostname },
        user: { id: random(16), name: 'budget-app', displayName: 'ניהול תקציב' },
        challenge: random(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000,
      },
    });
    if (!cred) return false;
    await setSetting('lock', { ...lockSettings(), credId: b64(cred.rawId) });
    return true;
  } catch (err) {
    console.warn(err);
    return false;
  }
}

async function verifyBiometrics() {
  const { credId } = lockSettings();
  if (!credId) return false;
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: unb64(credId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!res;
  } catch { return false; }
}

// ---------- lock screen ----------

/** Show the lock screen if needed. Resolves once the app may be shown. */
export function ensureUnlocked() {
  if (!lockEnabled() || unlocked) return Promise.resolve();
  return new Promise((resolve) => showLockScreen(resolve));
}

function showLockScreen(onUnlock) {
  document.querySelector('.lock-screen')?.remove();
  const hasBio = !!lockSettings().credId;
  const el = document.createElement('div');
  el.className = 'lock-screen';
  el.innerHTML = `
    <div class="lock-box">
      <div class="lock-icon">${icon('lock', 30)}</div>
      <h1>ניהול תקציב</h1>
      <p class="muted">האפליקציה נעולה</p>
      ${hasBio ? `<button type="button" class="btn btn-primary btn-lg" data-bio>${icon('faceid', 20)} פתיחה עם Face ID</button>` : ''}
      <form data-pin-form>
        <input class="input pin-input" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="קוד" aria-label="קוד">
        <button class="btn ${hasBio ? 'btn-ghost' : 'btn-primary'}">פתיחה עם קוד</button>
      </form>
      <p class="form-error" data-lock-error role="alert"></p>
      <button type="button" class="link-btn" data-forgot>שכחתי את הקוד</button>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('is-locked');
  let attempts = 0;
  const err = el.querySelector('[data-lock-error]');

  const done = () => {
    unlocked = true;
    el.remove();
    document.body.classList.remove('is-locked');
    onUnlock();
  };

  el.querySelector('[data-bio]')?.addEventListener('click', async () => {
    if (await verifyBiometrics()) done();
    else err.textContent = 'הזיהוי לא הצליח. אפשר לנסות שוב או להשתמש בקוד.';
  });
  el.querySelector('[data-pin-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.elements.pin;
    if (attempts >= 5) { err.textContent = 'יותר מדי ניסיונות. נסו שוב בעוד 30 שניות.'; return; }
    const { salt, pinHash } = lockSettings();
    if (await hashPin(input.value, salt) === pinHash) { done(); return; }
    attempts++;
    input.value = '';
    err.textContent = 'קוד שגוי';
    if (attempts >= 5) setTimeout(() => { attempts = 0; err.textContent = ''; }, 30000);
  });
  el.querySelector('[data-forgot]').addEventListener('click', async () => {
    const ok = await confirmDialog(
      'בלי הקוד אי אפשר לפתוח את האפליקציה. הדרך היחידה היא <b>למחוק את כל הנתונים במכשיר הזה</b> ולשחזר אותם מקובץ גיבוי (הגדרות ← גיבוי וסנכרון ← שחזור מלא). למחוק?',
      { okText: 'מחיקת כל הנתונים', danger: true, title: 'שכחתי את הקוד' });
    if (!ok) return;
    indexedDB.deleteDatabase('budget-app');
    try { localStorage.clear(); } catch { /* ignore */ }
    location.reload();
  });
  if (!hasBio) el.querySelector('[name=pin]').focus();
}

/** Lock again when the app was in the background for more than a minute. */
export function watchVisibility(onRelock) {
  document.addEventListener('visibilitychange', () => {
    if (!lockEnabled()) return;
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) {
      unlocked = false;
      ensureUnlocked().then(onRelock);
    }
  });
}
