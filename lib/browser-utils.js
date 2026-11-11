'use strict';
// Fonctions pures partagées par le processus principal (testables sans Electron).

// Électron ajoute « Electron/x » et le nom de l'application au User-Agent :
// certains sites (connexion Google, YouTube, Twitch) dégradent alors leur
// service, et l'empreinte du navigateur devient très reconnaissable.
function cleanUserAgent(ua) {
  return String(ua || '')
    .replace(/\s+Electron\/[\d.]+/gi, '')
    .replace(/\s+devgitbrowser\/[\d.]+/gi, '')
    .replace(/\s+DevGitBrowser\/[\d.]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const SEARCH_ENGINES = Object.freeze({
  duckduckgo: {name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q='},
  google: {name: 'Google', url: 'https://www.google.com/search?q='},
  bing: {name: 'Bing', url: 'https://www.bing.com/search?q='},
  qwant: {name: 'Qwant', url: 'https://www.qwant.com/?q='},
  ecosia: {name: 'Ecosia', url: 'https://www.ecosia.org/search?q='},
  brave: {name: 'Brave Search', url: 'https://search.brave.com/search?q='}
});
function searchUrl(engine, query) {
  const def = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
  return def.url + encodeURIComponent(String(query || '').slice(0, 1500));
}

// Mode HTTPS prioritaire : toute navigation http:// vers un site public est
// d'abord tentée en https://. Les adresses locales restent en http.
const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[^.]+)$/i;
function httpsUpgrade(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' || LOCAL_HOST.test(u.hostname)) return null;
    u.protocol = 'https:';
    if (u.port === '80') u.port = '';
    return u.href;
  } catch { return null; }
}

// Les téléchargements de ce type peuvent exécuter du code sous Windows.
const DANGEROUS_EXT = new Set(['exe','msi','msix','msixbundle','appx','bat','cmd','com','scr','pif','ps1','psm1','vbs','vbe','js','jse','wsf','wsh','hta','cpl','lnk','reg','jar','dll','sys','gadget','inf','application','appref-ms','iso','img','vhd','vhdx','xll','docm','xlsm','pptm','chm','url','scf']);
function fileExtension(name) {
  const base = String(name || '').toLowerCase().split(/[\\/]/).pop();
  const at = base.lastIndexOf('.');
  return at > 0 ? base.slice(at + 1) : '';
}
function isDangerousFile(name) { return DANGEROUS_EXT.has(fileExtension(name)); }

// Protocoles externes qu'un site peut demander d'ouvrir après confirmation.
const EXTERNAL_PROTOCOLS = new Set(['mailto:','tel:','sms:','callto:','msteams:','zoommtg:','zoomus:','skype:','spotify:','steam:','magnet:','discord:','slack:','whatsapp:','tg:']);
function externalProtocolAllowed(url) {
  try { return EXTERNAL_PROTOCOLS.has(new URL(url).protocol); } catch { return false; }
}

// Ordre des onglets : les Map JavaScript conservent l'ordre d'insertion.
function insertInMap(map, key, value, index) {
  const entries = [...map.entries()].filter(([k]) => k !== key);
  const at = Number.isInteger(index) ? Math.max(0, Math.min(entries.length, index)) : entries.length;
  entries.splice(at, 0, [key, value]);
  map.clear();
  for (const [k, v] of entries) map.set(k, v);
  return map;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const NET_ERRORS = {
  '-2': 'Échec de la connexion.', '-7': 'Le site a mis trop de temps à répondre.', '-21': 'Le réseau a changé.',
  '-100': 'La connexion a été fermée.', '-101': 'La connexion a été réinitialisée.', '-102': 'Connexion refusée par le serveur.',
  '-104': 'Échec de la connexion.', '-105': 'Adresse introuvable (DNS).', '-106': 'Pas de connexion Internet.',
  '-107': 'Erreur de protocole SSL.', '-109': 'Adresse inaccessible.', '-118': 'Délai de connexion dépassé.',
  '-130': 'Le proxy ne répond pas.', '-137': 'Résolution DNS impossible.', '-200': 'Certificat invalide pour ce site.',
  '-201': 'Certificat expiré ou pas encore valide.', '-202': 'Certificat émis par une autorité non reconnue.',
  '-203': 'Certificat révoqué ou contenant des erreurs.', '-310': 'Trop de redirections.', '-324': 'Réponse vide du serveur.',
  '-501': 'Contenu non sécurisé refusé.', '-20': 'Accès bloqué.', '-27': 'Bloqué par le client (DevGitShield ou politique).'
};
function errorPage({url, code, description, httpFallback=''}) {
  const n = String(code);
  const certificate = Number(code) <= -200 && Number(code) > -300;
  const title = certificate ? 'Connexion non sécurisée' : 'Ce site est inaccessible';
  const reason = NET_ERRORS[n] || 'Une erreur réseau s’est produite.';
  const fallback = httpFallback ? `<a class="alt" href="${escapeHtml(httpFallback)}">Continuer en HTTP non chiffré</a>` : '';
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b22;color:#e8f2ff;font:15px 'Segoe UI',Arial,sans-serif}
main{max-width:620px;padding:40px}h1{font-size:28px;margin:12px 0}.ico{font-size:46px}p{color:#a9bce6;line-height:1.7}
code{background:#111a44;border:1px solid #2c3b84;padding:2px 7px;border-radius:6px;color:#9fe9ff;word-break:break-all}
.row{display:flex;gap:12px;margin-top:26px;flex-wrap:wrap}a{color:#fff;text-decoration:none;padding:11px 17px;border-radius:9px;background:linear-gradient(95deg,#267bfd,#a03ef0);font-weight:700}
a.alt{background:#1b1c4c;border:1px solid #6d4b4b;color:#ffcdcd}small{color:#7d8cb8}</style></head>
<body><main><div class="ico">${certificate ? '🔒' : '⚠️'}</div><h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(reason)}</p><p><code>${escapeHtml(url)}</code></p>
${certificate ? '<p>DevGitBrowser a interrompu le chargement : quelqu’un pourrait tenter d’intercepter tes données (mots de passe, messages, cartes bancaires).</p>' : ''}
<div class="row"><a href="${escapeHtml(url)}">Réessayer</a>${fallback}</div>
<p><small>Code d’erreur ${escapeHtml(n)} · ${escapeHtml(String(description || '').slice(0, 80))}</small></p></main></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(body);
}

// Liens internes des pages d'avertissement : interceptés par le navigateur,
// jamais envoyés sur le réseau (.invalid est réservé et ne se résout pas).
const INTERNAL_HOST = 'devgit.invalid';
function internalLink(action, target='') { return `https://${INTERNAL_HOST}/${action}${target ? '?to=' + encodeURIComponent(target) : ''}`; }
function warningPage({url, domain}) {
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Site dangereux bloqué</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#3a0710;color:#fff2f4;font:15px 'Segoe UI',Arial,sans-serif}
main{max-width:640px;padding:40px}h1{font-size:28px;margin:12px 0}.ico{font-size:50px}p{color:#ffc9d2;line-height:1.7}
code{background:#5a0f1c;border:1px solid #a33;padding:2px 7px;border-radius:6px;word-break:break-all}
.row{display:flex;gap:12px;margin-top:26px;flex-wrap:wrap}a{text-decoration:none;padding:11px 17px;border-radius:9px;font-weight:700}
a.safe{background:#fff;color:#7a0d1d}a.risk{color:#ffb3bf;border:1px solid #a33;font-weight:400}</style></head>
<body><main><div class="ico">⛔</div><h1>Site dangereux bloqué</h1>
<p>DevGitBrowser a empêché l’ouverture de <code>${escapeHtml(domain)}</code> : ce domaine figure dans les listes publiques de sites d’hameçonnage ou de logiciels malveillants.</p>
<p>Ces pages imitent souvent une banque, un bookmaker, une messagerie ou un service de livraison pour voler mots de passe et cartes bancaires.</p>
<div class="row"><a class="safe" href="${internalLink('back')}">Revenir en sécurité</a><a class="risk" href="${internalLink('proceed', url)}">Ignorer l’avertissement (déconseillé)</a></div>
</main></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(body);
}
function crashPage({url, reason}) {
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Onglet planté</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b22;color:#e8f2ff;font:15px 'Segoe UI',Arial,sans-serif}
main{max-width:600px;padding:40px}h1{font-size:26px}p{color:#a9bce6;line-height:1.7}a{display:inline-block;margin-top:18px;color:#fff;text-decoration:none;padding:11px 17px;border-radius:9px;background:linear-gradient(95deg,#267bfd,#a03ef0);font-weight:700}small{color:#7d8cb8}</style></head>
<body><main><div style="font-size:46px">💥</div><h1>Oups, cet onglet a planté</h1><p>Le reste du navigateur fonctionne normalement. La page a peut-être manqué de mémoire ou rencontré une erreur.</p>
<a href="${internalLink('reload', url)}">Recharger la page</a><p><small>${escapeHtml(String(reason || '').slice(0, 60))}</small></p></main></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(body);
}
const THEMES = Object.freeze([
  {id: 'neon', name: 'Néon (par défaut)', colors: ['#06091c', '#267bfd', '#a03ef0', '#45e6fa']},
  {id: 'noir', name: 'Noir', colors: ['#050505', '#1a1a1a', '#6b6b6b', '#f4f4f4']},
  {id: 'blanc', name: 'Blanc', colors: ['#ffffff', '#f3f3f1', '#c9c8c2', '#1f2937']},
  {id: 'nature', name: 'Nature', colors: ['#0d1511', '#1c2d23', '#8fc27c', '#d4b483']},
  {id: 'sable', name: 'Sable', colors: ['#f7f1e5', '#efe6d6', '#cdb894', '#b5643a']},
  {id: 'ocean', name: 'Océan', colors: ['#061821', '#123546', '#3fc1c9', '#5b8fd6']},
  {id: 'velours', name: 'Velours', colors: ['#140b10', '#2c1825', '#9b4d72', '#c9a46a']}
]);
// Anciens thèmes (filtres de couleur, jusqu'à la 1.9) -> nouveaux thèmes.
const LEGACY_THEMES = Object.freeze({graphite: 'noir', clair: 'blanc', emeraude: 'nature', solaire: 'sable', rubis: 'velours'});
// DNS sécurisé (DNS-over-HTTPS) : le fournisseur d'accès ne voit plus les sites
// consultés et ne peut plus les bloquer par DNS.
const DNS_PROVIDERS = Object.freeze({
  cloudflare: {name: 'Cloudflare (1.1.1.1)', url: 'https://cloudflare-dns.com/dns-query'},
  quad9: {name: 'Quad9 (bloque les domaines malveillants)', url: 'https://dns.quad9.net/dns-query'},
  adguard: {name: 'AdGuard DNS (bloque pubs et traqueurs)', url: 'https://dns.adguard-dns.com/dns-query'},
  google: {name: 'Google Public DNS', url: 'https://dns.google/dns-query'},
  mullvad: {name: 'Mullvad DNS', url: 'https://dns.mullvad.net/dns-query'}
});
module.exports = {INTERNAL_HOST, internalLink, warningPage, crashPage, THEMES, LEGACY_THEMES, DNS_PROVIDERS, cleanUserAgent, SEARCH_ENGINES, searchUrl, httpsUpgrade, isDangerousFile, fileExtension, externalProtocolAllowed, insertInMap, escapeHtml, errorPage, NET_ERRORS};
