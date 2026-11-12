'use strict';
// Sélecteur de partage d'écran façon Chrome : onglets Fenêtre / Écran complet, aperçus, audio système.
const $ = id => document.getElementById(id);
const api = window.DevGitShare;
let data = {windows: [], screens: [], audio: false}, kind = 'window', selected = '', loaded = false;
function setTab(k) {
  kind = k;
  $('tab-window').classList.toggle('on', k === 'window'); $('tab-window').setAttribute('aria-selected', String(k === 'window'));
  $('tab-screen').classList.toggle('on', k === 'screen'); $('tab-screen').setAttribute('aria-selected', String(k === 'screen'));
  render();
}
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function render() {
  if (!loaded) return;
  const list = kind === 'window' ? data.windows : data.screens;
  if (!list.some(s => s.id === selected)) selected = '';
  const nodes = list.map(s => {
    const b = el('button', 'item' + (s.id === selected ? ' sel' : '')); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(s.id === selected)); b.title = s.name;
    const th = el('div', 'thumb' + (s.thumb ? '' : ' none'));
    if (s.thumb) { const img = el('img'); img.src = s.thumb; img.alt = ''; th.append(img); } else th.textContent = '';
    const lab = el('div', 'label');
    if (s.icon) { const i = el('img'); i.src = s.icon; i.alt = ''; lab.append(i); }
    const name = el('span'); name.textContent = s.name; name.dataset.noI18n = ''; lab.append(name);
    b.append(th, lab);
    b.addEventListener('click', () => { selected = s.id; render(); });
    b.addEventListener('dblclick', () => { selected = s.id; share(); });
    return b;
  });
  if (!nodes.length) { const p = el('p', 'empty'); p.textContent = kind === 'window' ? 'Aucune fenêtre à partager.' : 'Aucun écran détecté.'; nodes.push(p); }
  const scroll = $('grid').scrollTop; $('grid').replaceChildren(...nodes); $('grid').scrollTop = scroll;
  $('share').disabled = !selected;
}
function share() { if (selected) api.choose(selected, data.audio && $('audio').checked); }
$('tab-window').addEventListener('click', () => setTab('window'));
$('tab-screen').addEventListener('click', () => setTab('screen'));
$('share').addEventListener('click', share);
$('cancel').addEventListener('click', () => api.cancel());
document.addEventListener('keydown', e => { if (e.key === 'Escape') api.cancel(); if (e.key === 'Enter' && selected) share(); });
api.onSources(v => {
  loaded = true;
  data = v; $('origin').textContent = v.origin || '';
  $('audio-row').classList.toggle('hidden', !v.audio);
  render();
});
