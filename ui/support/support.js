'use strict';
// Fenêtre de tchat de support : même interface côté utilisateur et côté éditeur (mode « admin »).
const $ = id => document.getElementById(id);
const api = window.DevGitSupport;
const tr = s => (window.DGBT ? window.DGBT(s) : s);
const mode = new URLSearchParams(location.search).get('mode') === 'admin' ? 'admin' : 'user';
const timeFmt = new Intl.DateTimeFormat(window.DGBLang?.initial?.lang === 'en' ? 'en-GB' : 'fr-FR', {hour: '2-digit', minute: '2-digit'});
let view = null, sending = false;

if (mode === 'admin') {
  $('title').textContent = tr('Support — discussion avec l’utilisateur');
  $('subtitle').textContent = tr('Les messages arrivent en direct dans son navigateur');
  document.title = $('title').textContent;
  $('admin-bar').classList.remove('hidden');
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function showError(msg) { $('error').textContent = msg ? tr(msg) : ''; $('error').classList.toggle('hidden', !msg); }
function render(v) {
  if (!v) return;
  if (v.error) { showError(v.error); return; }
  view = {...view, ...v}; showError('');
  $('subject').textContent = view.subject || '—';
  if (mode === 'admin') {
    const meta = [view.v && 'v' + view.v, view.os, view.cc, view.contact && '✉ ' + view.contact].filter(Boolean).join(' · ');
    $('meta').textContent = meta; $('meta').classList.toggle('hidden', !meta);
  }
  const open = view.open !== false;
  $('state').textContent = tr(open ? 'Discussion ouverte' : 'Discussion terminée');
  $('state').className = 'state ' + (open ? 'on' : 'off');
  $('text').disabled = !open; $('send').disabled = !open || sending; $('end').disabled = !open;
  const box = $('thread'); const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const msgs = Array.isArray(view.messages) ? view.messages : [];
  const nodes = [];
  for (const m of msgs) {
    if (m.from === 'system') {
      nodes.push(el('div', 'sys', tr(m.text === 'open' ? (mode === 'admin' ? 'Tu as pris ce signalement en charge.' : 'L’équipe DevGitBrowser a pris ton signalement en charge.') : 'La discussion a été terminée.')));
      continue;
    }
    const mine = m.from === mode;
    const b = el('div', 'msg ' + (mine ? 'me' : 'them'));
    if (!mine) b.append(el('span', 'who', tr(m.from === 'admin' ? 'Équipe DevGitBrowser' : 'Utilisateur')));
    const body = el('span', '', m.text); body.dataset.noI18n = ''; b.append(body);
    const d = new Date(m.at); if (!Number.isNaN(d.getTime())) b.append(el('time', '', timeFmt.format(d)));
    nodes.push(b);
  }
  if (!nodes.length) nodes.push(el('p', 'empty', tr(mode === 'admin' ? 'Écris le premier message à l’utilisateur.' : 'La discussion va commencer.')));
  box.replaceChildren(...nodes);
  if (atBottom || sending === 'done') box.scrollTop = box.scrollHeight;
}
async function send() {
  const text = $('text').value.trim(); if (!text || sending) return;
  sending = true; $('send').disabled = true;
  try { const v = await api.send(text); $('text').value = ''; sending = 'done'; render(v); }
  catch (e) { showError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  finally { sending = false; if (view) $('send').disabled = view.open === false; $('text').focus(); }
}
$('form').addEventListener('submit', e => { e.preventDefault(); send(); });
$('text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('end').addEventListener('click', async () => {
  if ($('end').dataset.confirm !== '1') { $('end').dataset.confirm = '1'; $('end').textContent = tr('Confirmer : terminer ?'); setTimeout(() => { $('end').dataset.confirm = ''; $('end').textContent = tr('Terminer la discussion'); }, 4000); return; }
  try { render(await api.end()); } catch (e) { showError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
});
api.onUpdate(render);
api.get().then(v => { render(v); $('thread').scrollTop = $('thread').scrollHeight; $('text').focus(); }).catch(e => showError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
