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

// ---------------------------------------------------------------------------
// Bouton flottant sur les vidéos (monde isolé, Shadow DOM fermé) :
// apparaît en transparence au survol d'une vidéo -> Picture-in-Picture,
// et « Télécharger » quand la vidéo est un fichier direct (mp4/webm…).
try {
  const page = String(globalThis.location?.href || '');
  if (/^https?:/i.test(page) && globalThis.document && 'pictureInPictureEnabled' in document) {
    let host = null, root = null, current = null, hideTimer = null, frame = 0, lastX = -1, lastY = -1;
    const ICON_PIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="11.5" y="11" width="8" height="6" rx="1.2" fill="currentColor"/></svg>';
    const ICON_DL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const build = () => {
      host = document.createElement('dgb-video-tools');
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;display:none;pointer-events:auto';
      root = host.attachShadow({mode: 'closed'});
      root.innerHTML = '<style>' +
        ':host{all:initial}.bar{display:flex;gap:6px;opacity:.55;transition:opacity .15s ease}.bar:hover{opacity:1}' +
        'button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:9px;cursor:pointer;' +
        'background:rgba(10,12,28,.62);color:#fff;font:600 12px/1 Inter,"Segoe UI",Arial,sans-serif;border:1px solid rgba(255,255,255,.22);' +
        'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.35)}' +
        'button:hover{background:rgba(70,90,255,.85);border-color:rgba(255,255,255,.45)}svg{width:16px;height:16px}.hidden{display:none}</style>' +
        '<div class="bar"><button class="pip" title="Picture-in-Picture : vidéo flottante au-dessus de tes fenêtres">' + ICON_PIP + '<span>PiP</span></button>' +
        '<button class="dl hidden" title="Télécharger cette vidéo">' + ICON_DL + '</button></div>';
      const stop = e => { e.stopPropagation(); };
      for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick']) root.addEventListener(ev, stop);
      root.querySelector('.pip').addEventListener('click', async e => {
        e.preventDefault(); e.stopPropagation();
        const v = current; if (!v) return;
        try {
          if (document.pictureInPictureElement === v) { await document.exitPictureInPicture(); return; }
          try { v.disablePictureInPicture = false; v.removeAttribute('disablepictureinpicture'); } catch {}
          await v.requestPictureInPicture();
          if (v.paused) v.play().catch(() => {});
        } catch {}
        hide();
      });
      root.querySelector('.dl').addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const src = directSource(current); if (src) ipcRenderer.send('dgb-video:download', src);
      });
      host.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    };
    const directSource = v => {
      if (!v) return '';
      const src = String(v.currentSrc || v.src || '');
      return /^https?:\/\//i.test(src) && !/\.m3u8(?:$|\?)|\.mpd(?:$|\?)/i.test(src) ? src : '';
    };
    const mount = () => {
      if (!host) build();
      const parent = document.fullscreenElement && document.fullscreenElement.tagName !== 'VIDEO' ? document.fullscreenElement : document.documentElement;
      if (host.parentNode !== parent) parent.appendChild(host);
    };
    const hide = () => { clearTimeout(hideTimer); if (host) host.style.display = 'none'; current = null; };
    const place = v => {
      const r = v.getBoundingClientRect();
      if (r.width < 180 || r.height < 100 || (document.fullscreenElement && document.fullscreenElement.tagName === 'VIDEO')) { hide(); return; }
      mount(); current = v;
      root.querySelector('.dl').classList.toggle('hidden', !directSource(v));
      root.querySelector('.pip span').textContent = document.pictureInPictureElement === v ? 'Quitter PiP' : 'PiP';
      host.style.display = 'block';
      const w = host.offsetWidth || 90;
      host.style.left = Math.max(r.left + 8, Math.min(r.right - w - 10, innerWidth - w - 6)) + 'px';
      host.style.top = Math.max(r.top + 10, 6) + 'px';
      clearTimeout(hideTimer); hideTimer = setTimeout(hide, 2600);
    };
    const check = () => {
      frame = 0;
      if (host && host.matches(':hover')) return;
      let found = null;
      for (const v of document.querySelectorAll('video')) {
        const r = v.getBoundingClientRect();
        if (lastX >= r.left && lastX <= r.right && lastY >= r.top && lastY <= r.bottom && v.readyState > 0) { found = v; break; }
      }
      if (found) place(found); else if (current) hide();
    };
    document.addEventListener('mousemove', e => { lastX = e.clientX; lastY = e.clientY; if (!frame) frame = requestAnimationFrame(check); }, {capture: true, passive: true});
    document.addEventListener('mouseleave', () => { if (!host || !host.matches(':hover')) hide(); }, true);
    document.addEventListener('fullscreenchange', hide, true);
    addEventListener('scroll', () => { if (current) place(current); }, {capture: true, passive: true});
  }
} catch {}

// ---------------------------------------------------------------------------
// Remplissage des coordonnées (clic droit → « Remplir mes coordonnées »).
// Les données viennent du coffre déverrouillé, uniquement à la demande de l'utilisateur.
try {
  const FIELD_RULES = [
    ['email', /e-?mail|courriel|mail/i, ['email']],
    ['tel', /t[ée]l[ée]?phone|portable|mobile|phone|\btel\b|gsm/i, ['tel', 'tel-national']],
    ['givenName', /pr[ée]nom|first.?name|given.?name|fname/i, ['given-name']],
    ['familyName', /\bnom\b|last.?name|family.?name|surname|lname|nom.?de.?famille/i, ['family-name']],
    ['organization', /soci[ée]t[ée]|entreprise|company|organi[sz]ation/i, ['organization']],
    ['postalCode', /code.?postal|postal|zip|\bcp\b/i, ['postal-code']],
    ['city', /ville|city|localit[ée]|commune|town/i, ['address-level2']],
    ['country', /pays|country/i, ['country', 'country-name']],
    ['street2', /compl[ée]ment|address.?2|address.?line.?2|appartement|b[aâ]timent/i, ['address-line2']],
    ['street', /adresse|address|rue|street|voie/i, ['street-address', 'address-line1']]
  ];
  const fullName = p => [p.givenName, p.familyName].filter(Boolean).join(' ');
  function describe(el) {
    const id = el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent || '') : '';
    return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), id, el.closest('label')?.textContent].filter(Boolean).join(' ');
  }
  function valueFor(el, p) {
    const ac = String(el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop();
    if (ac === 'name') return fullName(p);
    for (const [key, , tokens] of FIELD_RULES) if (tokens.includes(ac)) return p[key];
    if (el.type === 'email') return p.email;
    if (el.type === 'tel') return p.tel;
    const text = describe(el);
    if (/nom.?complet|full.?name|^name$|votre.?nom/i.test(text) && !/pr[ée]nom|first|last|famille/i.test(text)) return fullName(p);
    for (const [key, re] of FIELD_RULES) if (re.test(text)) return p[key];
    return '';
  }
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    if (el instanceof HTMLSelectElement) {
      const opt = [...el.options].find(o => o.value.toLowerCase() === value.toLowerCase() || o.textContent.trim().toLowerCase() === value.toLowerCase());
      if (!opt) return false; value = opt.value;
    }
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  }
  ipcRenderer.on('dgb-autofill:fill', (_event, profile) => {
    if (!profile || typeof profile !== 'object' || !/^https:$/.test(location.protocol)) return;
    const active = document.activeElement;
    const scope = active?.form || active?.closest?.('form') || document;
    let filled = 0;
    for (const el of scope.querySelectorAll('input, textarea, select')) {
      if (el.disabled || el.readOnly || el.type === 'hidden' || el.type === 'password' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'submit' || el.type === 'button') continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;   // champs invisibles : jamais remplis
      if (String(el.value || '').trim()) continue;                                               // ne pas écraser ce qui est saisi
      const v = String(valueFor(el, profile) || '');
      if (v && setValue(el, v)) filled++;
    }
    if (!filled && active && 'value' in active && !String(active.value).trim()) { const v = fullName(profile) || profile.email || ''; if (v) setValue(active, v); }
  });
} catch {}

// ---- Aperçu des liens (v1.12) : signale au processus principal le lien survolé
// (cadre principal uniquement). Aucune API n'est exposée à la page.
try {
  if (process.isMainFrame && /^https?:/i.test(String(globalThis.location?.href || ''))) {
    let link = null, shift = false;
    const send = (type, a) => {
      if (!a) { ipcRenderer.send('dgb-preview:hover', {type}); return; }
      const r = a.getBoundingClientRect();
      ipcRenderer.send('dgb-preview:hover', {type, url: String(a.href).slice(0, 2000), shift, rect: [r.left, r.top, r.width, r.height].map(Math.round)});
    };
    window.addEventListener('mouseover', e => {
      shift = e.shiftKey;
      const a = e.target?.closest?.('a[href]');
      const next = a && /^https?:/i.test(a.href) && !a.href.startsWith(location.href.split('#')[0] + '#') ? a : null;
      if (next === link) return;
      if (link) send('leave');
      link = next;
      if (link) send('enter', link);
    }, true);
    window.addEventListener('keydown', e => {
      if (e.key === 'Shift' && !shift) { shift = true; if (link) send('shift', link); }
      else if (e.key === 'Escape') send('close');
    }, true);
    window.addEventListener('keyup', e => { if (e.key === 'Shift') shift = false; }, true);
    let lastClose = 0;
    const closeSoon = () => { const now = Date.now(); if (now - lastClose > 500) { lastClose = now; send('close'); } };
    for (const ev of ['mousedown', 'wheel']) window.addEventListener(ev, closeSoon, {capture: true, passive: true});
  }
} catch {}
