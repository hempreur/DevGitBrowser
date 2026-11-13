'use strict';
// Fenêtre de mise à jour : suit le téléchargement puis installe automatiquement
// après un compte à rebours, sauf si l'utilisateur choisit « Plus tard ».
const $ = id => document.getElementById(id);
const api = window.DevGitUpdate;
const tr = s => (window.DGBT ? window.DGBT(s) : s);
const COUNTDOWN = 10;
let timer = null, left = COUNTDOWN, installing = false;
function install() {
  if (installing) return; installing = true; clearInterval(timer);
  $('now').disabled = true; $('later').disabled = true;
  $('status').textContent = tr('Installation en cours… DevGitBrowser va redémarrer.');
  api.install();
}
function render(st) {
  $('from').textContent = 'v' + (st.current || '—');
  $('to').textContent = st.version ? 'v' + st.version : '—';
  if (st.releaseNotes) { $('notes').textContent = st.releaseNotes; $('notes-box').classList.remove('hidden'); }
  const status = $('status');
  status.classList.toggle('ready', st.status === 'downloaded');
  if (st.status === 'downloading' || st.status === 'checking') {
    $('bar').style.width = (st.progress || 0) + '%';
    status.textContent = tr(`Téléchargement… ${st.progress || 0} %`);
  } else if (st.status === 'downloaded') {
    $('bar').style.width = '100%';
    $('now').disabled = installing;
    if (st.autoInstall === false) { if (!installing) status.textContent = tr('Prête ! Clique sur « Installer maintenant » quand tu veux.'); }
    else if (!timer && !installing) {
      left = COUNTDOWN;
      const tick = () => { status.textContent = tr(`Prête ! Installation automatique dans ${left} s`); if (left-- <= 0) install(); };
      tick(); timer = setInterval(tick, 1000);
    }
  } else if (st.status === 'error') {
    clearInterval(timer); timer = null;
    status.textContent = tr('La mise à jour a échoué :') + ' ' + (st.error || '');
    $('later').textContent = tr('Fermer');
  }
}
$('now').addEventListener('click', install);
$('later').addEventListener('click', () => { clearInterval(timer); api.later(); });
api.onState(render);
api.ready();
