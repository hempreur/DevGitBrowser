'use strict';
// « Qui me piste ? » — correspondance domaine → entreprise et catégorie.
// Base locale volontairement compacte (principaux acteurs de la publicité et
// de la mesure d'audience) ; les domaines inconnus restent affichés tels quels.
const CATEGORIES = Object.freeze({
  ads: 'Publicité', analytics: 'Mesure d’audience', social: 'Réseau social', fingerprint: 'Empreinte / identification',
  session: 'Enregistrement de session', cdn: 'Contenu tiers', other: 'Autre pisteur'
});
const COMPANIES = [
  ['Google', 'ads', ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'googletagservices.com', '2mdn.net', 'admob.com', 'app-measurement.com']],
  ['Google', 'analytics', ['google-analytics.com', 'googletagmanager.com', 'analytics.google.com']],
  ['Meta (Facebook)', 'social', ['facebook.net', 'facebook.com', 'fbcdn.net', 'instagram.com', 'connect.facebook.net']],
  ['Amazon', 'ads', ['amazon-adsystem.com', 'assoc-amazon.com', 'aax.amazon-adsystem.com']],
  ['Microsoft', 'ads', ['bat.bing.com', 'ads.microsoft.com', 'clarity.ms', 'adnxs.com', 'adnxs-simple.com', 'xandr.com']],
  ['TikTok (ByteDance)', 'social', ['analytics.tiktok.com', 'tiktokw.us', 'byteoversea.com', 'ads.tiktok.com']],
  ['X (Twitter)', 'social', ['ads-twitter.com', 'analytics.twitter.com', 'static.ads-twitter.com', 't.co']],
  ['LinkedIn', 'social', ['ads.linkedin.com', 'px.ads.linkedin.com', 'snap.licdn.com']],
  ['Snap', 'social', ['sc-static.net', 'tr.snapchat.com']],
  ['Pinterest', 'social', ['ct.pinterest.com', 'pinimg.com']],
  ['Reddit', 'social', ['redditstatic.com', 'events.redditmedia.com']],
  ['Criteo', 'ads', ['criteo.com', 'criteo.net']],
  ['Taboola', 'ads', ['taboola.com', 'taboolasyndication.com']],
  ['Outbrain', 'ads', ['outbrain.com', 'outbrainimg.com']],
  ['The Trade Desk', 'ads', ['adsrvr.org']],
  ['Magnite (Rubicon)', 'ads', ['rubiconproject.com']],
  ['PubMatic', 'ads', ['pubmatic.com']],
  ['OpenX', 'ads', ['openx.net']],
  ['Index Exchange', 'ads', ['casalemedia.com', 'indexww.com']],
  ['Smart AdServer (Equativ)', 'ads', ['smartadserver.com', 'sascdn.com']],
  ['Teads', 'ads', ['teads.tv']],
  ['Quantcast', 'ads', ['quantserve.com', 'quantcount.com', 'quantcast.com']],
  ['Yahoo', 'ads', ['ads.yahoo.com', 'analytics.yahoo.com', 'yimg.com']],
  ['Adform', 'ads', ['adform.net', 'adformdsp.net']],
  ['Sovrn', 'ads', ['lijit.com', 'sovrn.com']],
  ['Media.net', 'ads', ['media.net']],
  ['Yandex', 'analytics', ['mc.yandex.ru', 'yandex.ru', 'yastatic.net']],
  ['Adobe', 'analytics', ['omtrdc.net', '2o7.net', 'demdex.net', 'everesttech.net']],
  ['Oracle (BlueKai)', 'ads', ['bluekai.com', 'addthis.com', 'moatads.com']],
  ['Salesforce', 'analytics', ['krxd.net', 'exacttarget.com']],
  ['comScore', 'analytics', ['scorecardresearch.com']],
  ['Nielsen', 'analytics', ['imrworldwide.com', 'exelator.com']],
  ['AT Internet (Piano)', 'analytics', ['xiti.com', 'aticdn.net', 'ati-host.net']],
  ['Médiamétrie', 'analytics', ['estat.com', 'mediametrie-estat.com']],
  ['Hotjar', 'session', ['hotjar.com', 'hotjar.io']],
  ['Contentsquare', 'session', ['contentsquare.net', 'contentsquare.com']],
  ['FullStory', 'session', ['fullstory.com']],
  ['Mouseflow', 'session', ['mouseflow.com']],
  ['Mixpanel', 'analytics', ['mixpanel.com']],
  ['Segment', 'analytics', ['segment.com', 'segment.io']],
  ['Amplitude', 'analytics', ['amplitude.com']],
  ['New Relic', 'analytics', ['nr-data.net', 'newrelic.com']],
  ['HubSpot', 'analytics', ['hs-analytics.net', 'hs-scripts.com', 'hubspot.com']],
  ['Chartbeat', 'analytics', ['chartbeat.com', 'chartbeat.net']],
  ['LiveRamp', 'fingerprint', ['rlcdn.com', 'pippio.com']],
  ['ID5', 'fingerprint', ['id5-sync.com']],
  ['Lotame', 'fingerprint', ['crwdcntrl.net']],
  ['Tapad', 'fingerprint', ['tapad.com']],
  ['FingerprintJS', 'fingerprint', ['fpjs.io', 'fingerprint.com']],
  ['Didomi', 'other', ['privacy-center.org']],
  ['Sizmek / Amazon', 'ads', ['serving-sys.com']],
  ['Integral Ad Science', 'ads', ['adsafeprotected.com']],
  ['DoubleVerify', 'ads', ['doubleverify.com']],
  ['Bidswitch', 'ads', ['bidswitch.net']],
  ['33Across', 'ads', ['33across.com']],
  ['Seedtag', 'ads', ['seedtag.com']],
  ['Ezoic', 'ads', ['ezoic.net', 'ezojs.com']]
];
const BY_DOMAIN = new Map();
for (const [company, category, domains] of COMPANIES) for (const d of domains) BY_DOMAIN.set(d, {company, category});

function lookup(host) {
  let h = String(host || '').toLowerCase().replace(/^\.+|\.+$/g, '');
  while (h) {
    const hit = BY_DOMAIN.get(h);
    if (hit) return {...hit, domain: h};
    const dot = h.indexOf('.');
    if (dot < 0) break;
    h = h.slice(dot + 1);
    if (!h.includes('.')) break; // ne remonte pas jusqu'au TLD seul
  }
  return null;
}
// Domaine « enregistrable » approximatif (2 derniers labels, 3 pour co.uk & co).
function baseDomain(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const two = parts.slice(-2).join('.');
  return /^(co|com|net|org|gov|ac)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join('.') : two;
}
// Agrège {domaine: nombre} en rapport par entreprise, trié.
function report(counts) {
  const byCompany = new Map();
  for (const [host, n] of counts) {
    const hit = lookup(host);
    const key = hit ? hit.company : baseDomain(host);
    const row = byCompany.get(key) || {company: key, known: Boolean(hit), category: hit ? hit.category : 'other', categories: new Set(), domains: new Set(), count: 0};
    row.count += n; row.domains.add(hit ? hit.domain : baseDomain(host)); row.categories.add(hit ? hit.category : 'other');
    byCompany.set(key, row);
  }
  return [...byCompany.values()].map(r => ({...r, categories: [...r.categories], label: [...r.categories].map(c => CATEGORIES[c]).join(' · '), domains: [...r.domains].slice(0, 6)}))
    .sort((a, b) => (b.known - a.known) || b.count - a.count || a.company.localeCompare(b.company));
}
module.exports = {lookup, baseDomain, report, CATEGORIES, COMPANIES};
