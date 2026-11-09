'use strict';
// Lecteur radio DevGitBrowser — annuaire libre radio-browser.info (aucune clé).
const $ = id => document.getElementById(id);
const MIRRORS = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];
const audio = new Audio();
audio.preload = 'none';
let current = null, view = 'all', stations = [], searchTimer = null, requestId = 0;

const store = {
  get(key, fallback) { try { const v = JSON.parse(localStorage.getItem('dgb-radio-' + key)); return v ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('dgb-radio-' + key, JSON.stringify(value)); } catch {} }
};
let favorites = store.get('favorites', []);
let recent = store.get('recent', []);

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function flag(code) { return /^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '🌐'; }
function safeUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } }
function compact(s) {
  return {stationuuid: String(s.stationuuid || ''), name: String(s.name || '').trim().slice(0, 100) || 'Station sans nom', url: safeUrl(s.url_resolved || s.url),
    favicon: safeUrl(s.favicon), countrycode: String(s.countrycode || '').toUpperCase().slice(0, 2), country: String(s.country || '').slice(0, 60),
    tags: String(s.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 4), codec: String(s.codec || '').slice(0, 10), bitrate: Number(s.bitrate) || 0};
}
async function api(path) {
  let last;
  const start = Math.floor(Math.random() * MIRRORS.length);
  for (let i = 0; i < MIRRORS.length; i++) {
    const base = MIRRORS[(start + i) % MIRRORS.length];
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 9000);
      const res = await fetch(base + path, {signal: ctrl.signal, credentials: 'omit'});
      clearTimeout(t);
      if (res.ok) return await res.json();
      last = new Error('HTTP ' + res.status);
    } catch (e) { last = e; }
  }
  throw last || new Error('Annuaire radio indisponible');
}
function status(text) { $('status').textContent = text; }

async function loadCountries() {
  const select = $('country');
  const saved = store.get('country', 'FR');
  try {
    const list = (await api('/json/countries?hidebroken=true&order=stationcount&reverse=true')).filter(c => c.iso_3166_1 && c.stationcount >= 5);
    const names = new Intl.DisplayNames(['fr'], {type: 'region'});
    const label = c => { try { return names.of(c.iso_3166_1.toUpperCase()); } catch { return c.name; } };
    const sorted = list.map(c => ({code: c.iso_3166_1.toUpperCase(), name: label(c), count: c.stationcount})).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const top = ['FR', 'BE', 'CH', 'CA', 'US', 'GB', 'DE', 'ES', 'IT', 'MA', 'DZ', 'TN', 'SN', 'CI'];
    const options = [new Option('🌍 Tous les pays', '')];
    for (const code of top) { const c = sorted.find(x => x.code === code); if (c) options.push(new Option(`${flag(c.code)} ${c.name} (${c.count})`, c.code)); }
    options.push(Object.assign(new Option('──────────', '-'), {disabled: true}));
    for (const c of sorted) options.push(new Option(`${flag(c.code)} ${c.name} (${c.count})`, c.code));
    select.replaceChildren(...options);
  } catch {
    select.replaceChildren(new Option('🇫🇷 France', 'FR'), new Option('🌍 Tous les pays', ''));
  }
  select.value = [...select.options].some(o => o.value === saved) ? saved : 'FR';
}
async function loadTags() {
  try {
    const tags = await api('/json/tags?order=stationcount&reverse=true&limit=80&hidebroken=true');
    const names = {pop: 'Pop', rock: 'Rock', news: 'Actualités', music: 'Musique', talk: 'Débats', jazz: 'Jazz', classical: 'Classique', dance: 'Dance', electronic: 'Électro', 'hip hop': 'Hip-hop', rap: 'Rap', sports: 'Sport', country: 'Country', oldies: 'Rétro', ambient: 'Ambiance', chillout: 'Chill', reggae: 'Reggae', metal: 'Metal', latin: 'Latino', 'top 40': 'Top 40', '80s': 'Années 80', '90s': 'Années 90', '70s': 'Années 70', house: 'House', techno: 'Techno', blues: 'Blues', soul: 'Soul', folk: 'Folk', religious: 'Religion', kids: 'Enfants', hits: 'Hits', 'r&b': 'R&B', francais: 'Français', 'variété française': 'Variété française'};
    const options = tags.filter(t => t.name && t.name.length < 30).slice(0, 70).map(t => new Option(names[t.name] || t.name, t.name));
    $('tag').append(...options);
  } catch {}
}
async function loadStations() {
  if (view !== 'all') { render(); return; }
  const id = ++requestId;
  const params = new URLSearchParams({hidebroken: 'true', limit: '150', order: $('sort').value, reverse: $('sort').value === 'name' ? 'false' : 'true'});
  if ($('country').value && $('country').value !== '-') params.set('countrycode', $('country').value);
  if ($('tag').value) params.set('tag', $('tag').value);
  if ($('search').value.trim()) params.set('name', $('search').value.trim().slice(0, 80));
  $('list').replaceChildren(el('p', 'empty', 'Recherche des stations…'));
  try {
    const list = (await api('/json/stations/search?' + params)).map(compact).filter(s => s.url && s.stationuuid);
    if (id !== requestId) return;
    const seen = new Set();
    stations = list.filter(s => { const k = s.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    render();
    status(`${stations.length} station(s) · annuaire libre radio-browser.info`);
  } catch (e) {
    if (id !== requestId) return;
    $('list').replaceChildren(el('p', 'empty', 'Annuaire radio inaccessible. Vérifie ta connexion puis réessaie.'));
  }
}
function isFav(s) { return favorites.some(f => f.stationuuid === s.stationuuid); }
function toggleFav(s) {
  favorites = isFav(s) ? favorites.filter(f => f.stationuuid !== s.stationuuid) : [s, ...favorites].slice(0, 200);
  store.set('favorites', favorites);
  render(); updateNow();
}
function render() {
  const list = view === 'fav' ? favorites : view === 'recent' ? recent : stations;
  const q = view === 'all' ? '' : $('search').value.trim().toLowerCase();
  const items = list.filter(s => !q || s.name.toLowerCase().includes(q));
  if (!items.length) { $('list').replaceChildren(el('p', 'empty', view === 'fav' ? 'Aucun favori : clique sur ☆ à côté d’une station.' : view === 'recent' ? 'Aucune station écoutée récemment.' : 'Aucune station ne correspond.')); return; }
  $('list').replaceChildren(...items.map(s => {
    const row = el('button', 'station' + (current?.stationuuid === s.stationuuid ? ' playing' : ''));
    row.type = 'button';
    let icon;
    if (s.favicon) { icon = el('img'); icon.src = s.favicon; icon.alt = ''; icon.referrerPolicy = 'no-referrer'; icon.loading = 'lazy'; icon.addEventListener('error', () => icon.replaceWith(el('span', 'fallback', s.name[0] || '♪')), {once: true}); }
    else icon = el('span', 'fallback', s.name[0] || '♪');
    const info = el('span', 'info');
    info.append(el('b', '', s.name), el('small', '', [flag(s.countrycode) + ' ' + (s.country || s.countrycode), s.tags.slice(0, 3).join(', '), s.bitrate ? s.bitrate + ' kb/s' : s.codec].filter(Boolean).join(' · ')));
    const star = el('span', 'star' + (isFav(s) ? ' on' : ''), isFav(s) ? '★' : '☆');
    star.title = isFav(s) ? 'Retirer des favoris' : 'Ajouter aux favoris';
    star.addEventListener('click', ev => { ev.stopPropagation(); toggleFav(s); });
    row.append(icon, info, star);
    row.addEventListener('click', () => play(s));
    return row;
  }));
}
function updateNow() {
  $('now-name').textContent = current ? current.name : 'Choisis une station';
  $('now-country').textContent = current ? `${flag(current.countrycode)} ${current.country || 'Radio'}` : 'Radio DevGit';
  $('now-meta').textContent = current ? [current.tags.join(', '), current.bitrate ? current.bitrate + ' kb/s' : '', current.codec].filter(Boolean).join(' · ') : 'Des milliers de radios françaises et du monde entier';
  $('play').textContent = audio.paused ? '▶' : '❚❚';
  $('fav-current').textContent = current && isFav(current) ? '★' : '☆';
  $('logo').src = current?.favicon || '../../assets/logo-mark.png';
}
async function play(s) {
  current = s;
  recent = [s, ...recent.filter(r => r.stationuuid !== s.stationuuid)].slice(0, 30);
  store.set('recent', recent); store.set('last', s);
  audio.src = s.url;
  $('play').classList.add('loading');
  updateNow(); render();
  status('Connexion à ' + s.name + '…');
  try { await audio.play(); status('▶ ' + s.name); window.RadioHost?.nowPlaying(s.name); }
  catch (e) { status('Impossible de lire cette station (flux indisponible ou format non pris en charge).'); window.RadioHost?.nowPlaying(''); }
  finally { $('play').classList.remove('loading'); updateNow(); }
  // Compteur de clics de l'annuaire (recommandé par radio-browser.info).
  api('/json/url/' + encodeURIComponent(s.stationuuid)).catch(() => {});
}
$('play').addEventListener('click', () => {
  if (!current) { const first = (view === 'fav' ? favorites : stations)[0]; if (first) play(first); return; }
  if (audio.paused) { audio.play().then(() => window.RadioHost?.nowPlaying(current.name)).catch(() => status('Lecture impossible.')); }
  else { audio.pause(); window.RadioHost?.nowPlaying(''); }
  updateNow();
});
audio.addEventListener('pause', updateNow);
audio.addEventListener('playing', () => { updateNow(); status('▶ ' + (current?.name || '')); });
audio.addEventListener('waiting', () => status('Mise en mémoire tampon…'));
audio.addEventListener('error', () => { status('Flux interrompu. Choisis une autre station.'); window.RadioHost?.nowPlaying(''); updateNow(); });
$('volume').value = store.get('volume', 80);
audio.volume = $('volume').value / 100;
$('volume').addEventListener('input', () => { audio.volume = $('volume').value / 100; store.set('volume', Number($('volume').value)); });
$('fav-current').addEventListener('click', () => current && toggleFav(current));
$('country').addEventListener('change', () => { store.set('country', $('country').value); loadStations(); });
$('tag').addEventListener('change', loadStations);
$('sort').addEventListener('change', loadStations);
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(view === 'all' ? loadStations : render, 350); });
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => {
  view = b.dataset.view;
  for (const x of document.querySelectorAll('[data-view]')) x.classList.toggle('active', x === b);
  render();
  if (view === 'all' && !stations.length) loadStations();
});
document.addEventListener('keydown', e => { if (e.code === 'Space' && !/INPUT|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); $('play').click(); } });
window.RadioHost?.theme().then(t => { if (t) document.documentElement.dataset.theme = t; }).catch(() => {});
window.RadioHost?.onTheme(t => { document.documentElement.dataset.theme = t || ''; });
current = store.get('last', null); updateNow();
loadCountries().then(() => { loadTags(); loadStations(); });
