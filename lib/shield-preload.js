'use strict';
// DevGitShield — preload de session (cadre principal des pages web).
// N'expose AUCUNE API à la page : il récupère, avant tout script du site, les
// scriptlets anti-publicités applicables et les exécute dans le monde principal.
const {ipcRenderer, webFrame} = require('electron');
try {
  const href = String(globalThis.location?.href || '');
  if (/^https?:/i.test(href)) {
    const payload = ipcRenderer.sendSync('dgb-shield:early', href);
    if (payload && payload.enabled) {
      if (typeof payload.css === 'string' && payload.css) {
        try { webFrame.insertCSS(payload.css, {cssOrigin: 'user'}); } catch {}
      }
      for (const code of Array.isArray(payload.scripts) ? payload.scripts : []) {
        if (typeof code === 'string' && code) webFrame.executeJavaScript(code).catch(() => {});
      }
    }
  }
} catch {}

// ---------------------------------------------------------------------------
// Gestionnaire de mots de passe DevGitBrowser (monde isolé : la page n'a aucun
// accès à ce code). Capture d'un identifiant à la connexion et remplissage
// UNIQUEMENT sur demande de l'utilisateur (clé 🔑 dans la barre d'adresse).
try {
  const page = String(globalThis.location?.href || '');
  const eligible = /^https:/i.test(page) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(page);
  if (eligible && globalThis.document) {
    const visible = el => { try { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none'; } catch { return false; } };
    const passwordFields = root => [...(root || document).querySelectorAll('input[type="password"]')].filter(visible);
    const usernameFor = (pwd, root) => {
      const scope = root && root !== document ? root : (pwd.form || document);
      const inputs = [...scope.querySelectorAll('input')].filter(i => visible(i) && /^(?:text|email|tel|)$/i.test(i.type || 'text'));
      const before = inputs.filter(i => i.compareDocumentPosition(pwd) & Node.DOCUMENT_POSITION_FOLLOWING);
      const hinted = inputs.find(i => /user|login|mail|ident|pseudo|account/i.test((i.autocomplete || '') + ' ' + (i.name || '') + ' ' + (i.id || '')));
      return hinted || before.at(-1) || null;
    };
    let lastSent = '';
    const capture = root => {
      const pwds = passwordFields(root instanceof Element ? root : document).filter(p => p.value && p.value.length <= 1000);
      if (!pwds.length) return;
      // Sur un formulaire de changement de mot de passe, garder le nouveau.
      const pwd = pwds.find(p => /new/i.test(p.autocomplete || '')) || pwds[pwds.length - 1];
      const user = usernameFor(pwd, root instanceof Element ? root : null);
      const key = (user?.value || '') + '\u0000' + pwd.value;
      if (key === lastSent) return;
      lastSent = key;
      ipcRenderer.send('dgb-pw:submitted', {url: location.href, username: String(user?.value || '').slice(0, 200), password: pwd.value});
    };
    document.addEventListener('submit', e => capture(e.target), true);
    document.addEventListener('click', e => {
      const b = e.target instanceof Element ? e.target.closest('button,input[type="submit"],[role="button"],a') : null;
      if (!b) return;
      const scope = b.closest('form') || b.closest('[class*="login" i],[class*="signin" i],[class*="auth" i],[id*="login" i]') || document;
      if (passwordFields(scope).some(p => p.value)) capture(scope);
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'password' && e.target.value) capture(e.target.form || document); }, true);
    let announced = false, timer = null;
    const scan = () => { timer = null; if (!announced && passwordFields(document).length) { announced = true; ipcRenderer.send('dgb-pw:form', location.href); } };
    const watch = () => { scan(); try { new MutationObserver(() => { if (!announced && !timer) timer = setTimeout(scan, 800); }).observe(document.documentElement, {subtree: true, childList: true}); } catch {} };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, {once: true}); else watch();
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      input.focus(); setter.call(input, value);
      input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));
    };
    ipcRenderer.on('dgb-pw:fill', (_event, data) => {
      if (!data || data.origin !== location.origin) return;
      const pwd = passwordFields(document)[0];
      if (!pwd) return;
      const user = usernameFor(pwd, null);
      if (user && data.username) setValue(user, String(data.username));
      setValue(pwd, String(data.password || ''));
      lastSent = (data.username || '') + '\u0000' + data.password; // ne pas reproposer l'enregistrement
    });
  }
} catch {}
