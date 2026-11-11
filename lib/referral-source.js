'use strict';
// Parrainage automatique au premier lancement (v1.16).
// Le lien d'invitation https://hempreur.github.io/DevGitBrowser/?ref=CODE mène au
// téléchargement de l'installateur. Le code est retrouvé, dans l'ordre :
//  1. dans la « marque du web » (flux NTFS Zone.Identifier) de l'installateur : Windows y note
//     l'adresse de la page d'origine (ReferrerUrl) — l'installateur indique son chemin au
//     navigateur (registre HKCU\Software\DevGitBrowser\InstallerPath) ;
//  2. dans celle du dernier DevGitBrowser-Setup-*.exe du dossier Téléchargements ;
//  3. dans le presse-papiers, uniquement au format exact copié par le site
//     (« DevGitBrowser ref:CODE ») ou un lien d'invitation complet.
// Rien n'est envoyé tant qu'un code n'a pas été trouvé ; lecture unique au premier lancement.
const fs = require('node:fs');
const path = require('node:path');

const CODE = '[A-HJ-NP-Z2-9]{8}';
const URL_REF = new RegExp(`hempreur\\.github\\.io/DevGitBrowser/?[^\\s]*[?&]ref=(${CODE})(?![A-Za-z0-9])`, 'i');
const CLIP_REF = new RegExp(`^\\s*DevGitBrowser ref:(${CODE})\\s*$`);

function codeFromZoneIdentifier(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(ReferrerUrl|HostUrl)\s*=\s*(.+)$/i);
    if (!m) continue;
    const hit = m[2].match(URL_REF);
    if (hit) return hit[1].toUpperCase();
  }
  return null;
}
function codeFromClipboard(text) {
  const s = String(text || '').slice(0, 500);
  const a = s.match(CLIP_REF); if (a) return a[1];
  const trimmed = s.trim();
  if (/^https:\/\/\S+$/.test(trimmed)) { const b = trimmed.match(URL_REF); if (b) return b[1].toUpperCase(); }
  return null;
}
function readZone(file, readFile = fs.readFileSync) {
  try { return readFile(file + ':Zone.Identifier', 'utf8'); } catch { return ''; }
}
function installerCandidates(downloadsDir, {readdir = fs.readdirSync, stat = fs.statSync} = {}) {
  try {
    return readdir(downloadsDir)
      .filter(n => /^DevGitBrowser[-_ ]?Setup.*\.exe$/i.test(n))
      .map(n => { const f = path.join(downloadsDir, n); let t = 0; try { t = stat(f).mtimeMs; } catch {} return {f, t}; })
      .sort((a, b) => b.t - a.t).slice(0, 5).map(x => x.f);
  } catch { return []; }
}
function findReferralCode({installerPath = '', downloadsDir = '', clipboardText = () => '', readFile, readdir, stat} = {}) {
  const files = [];
  if (installerPath && /\.exe$/i.test(installerPath)) files.push(installerPath);
  if (downloadsDir) for (const f of installerCandidates(downloadsDir, {readdir, stat})) if (!files.includes(f)) files.push(f);
  for (const f of files) {
    const code = codeFromZoneIdentifier(readZone(f, readFile));
    if (code) return {code, source: 'download'};
  }
  let clip = ''; try { clip = clipboardText(); } catch {}
  const code = codeFromClipboard(clip);
  return code ? {code, source: 'clipboard'} : null;
}
module.exports = {findReferralCode, codeFromZoneIdentifier, codeFromClipboard, installerCandidates};
