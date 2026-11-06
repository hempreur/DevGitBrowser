'use strict';
// Detection is advisory. Never silently launch MSHTML on an untrusted page.
// The code runs only in the website's Chromium renderer after a main-frame load.
const DETECTOR_SOURCE = `(() => {
  try {
    const hints = [];
    const scripts = [...document.querySelectorAll('script')].slice(0,150);
    if (document.querySelector('object[classid],embed[type*="x-oleobject"]')) hints.push('Contrôle ActiveX détecté');
    if (scripts.some(s => /vbscript/i.test((s.getAttribute('type')||'') + ' ' + (s.getAttribute('language')||'')))) hints.push('VBScript détecté');
    if (scripts.some(s => /ActiveXObject\\s*\\(|window\\.external\\b/i.test((s.textContent||'').slice(0,6000)))) hints.push('Script lié à Internet Explorer');
    const compat = document.querySelector('meta[http-equiv="X-UA-Compatible" i]');
    if (compat && /IE\\s*=\\s*(?:[5-9]\\b|10\\b|11\\b|EmulateIE)/i.test(compat.content||'')) hints.push('Mode de compatibilité IE déclaré');
    const doctype = document.doctype?.publicId || '';
    if (/HTML 4\\.0|HTML 4\\.01/i.test(doctype)) hints.push('Ancien type de document HTML');
    return { hints: hints.slice(0,5), likely: hints.some(h => /ActiveX|VBScript|Script lié/.test(h)) };
  } catch { return { hints:[], likely:false }; }
})()`;
function validateLegacyTarget(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Adresse legacy invalide.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new Error('L’accès legacy accepte uniquement les adresses HTTP et HTTPS sans identifiants embarqués.');
  return url.toString();
}
module.exports = {DETECTOR_SOURCE, validateLegacyTarget};
