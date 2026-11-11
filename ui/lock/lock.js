'use strict';
// Écran de verrouillage : l'accès reste bloqué tant que le serveur de l'éditeur n'a pas levé
// l'arrêt d'urgence (le navigateur écoute le serveur en continu et se débloque tout seul).
const $ = id => document.getElementById(id);
const api = window.DevGitLock;
const tr = s => (window.DGBT ? window.DGBT(s) : s);
function apply(info) {
  $('version').textContent = 'v' + (info.version || '—');
  $('reason').textContent = info.message || '';
  $('reason-box').classList.toggle('hidden', !info.message);
}
apply(api.info || {});
let checking = false;
function setStatus(text, err) { const s = $('status'); s.textContent = text; s.classList.toggle('err', Boolean(err)); }
api.onStatus(st => {
  if (st.info) apply(st.info);
  checking = st.state === 'checking'; $('retry').disabled = checking;
  if (st.state === 'checking') setStatus(tr('Vérification auprès du serveur…'));
  else if (st.state === 'offline') setStatus(tr('Serveur injoignable. L’accès reste bloqué. Vérifie ta connexion, puis réessaie.'), true);
  else if (st.state === 'still') setStatus(tr('L’accès est toujours suspendu par l’éditeur.'), true);
  else if (st.state === 'admin-refused') { $('admin-status').textContent = tr(st.error || 'Clé admin incorrecte.'); $('admin-status').classList.add('err'); }
});
$('retry').addEventListener('click', () => { if (!checking) { checking = true; $('retry').disabled = true; setStatus(tr('Vérification auprès du serveur…')); api.retry(); } });
$('quit').addEventListener('click', () => api.quit());
$('admin-form').addEventListener('submit', e => { e.preventDefault(); const k = $('admin-key').value; $('admin-key').value = ''; $('admin-status').textContent = ''; if (k.trim()) api.admin(k); });
