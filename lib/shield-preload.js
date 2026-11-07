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
