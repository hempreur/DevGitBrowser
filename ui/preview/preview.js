'use strict';
const api = window.DevGitPreview;
const $ = id => document.getElementById(id);
$('open').addEventListener('click', () => api.action('open'));
$('close').addEventListener('click', () => api.action('close'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') api.action('close'); });
api.onInfo(info => {
  $('title').textContent = info.title || info.url || '';
  try { const u = new URL(info.url); $('host').textContent = u.hostname.replace(/^www\./, ''); $('lock').textContent = u.protocol === 'https:' ? '🔒' : '⚠'; } catch {}
  document.body.className = info.loading ? 'loading' : 'done';
});
