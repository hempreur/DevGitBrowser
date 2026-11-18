'use strict';
// Zone 18+ : vérification de l'âge par la date de naissance avant d'afficher la commande d'accès.
// Site statique sans serveur : il s'agit d'une déclaration sur l'honneur, pas d'un contrôle d'identité.
(() => {
  const form = document.getElementById('age-form');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const DENY_KEY = 'dgbx-age-denied', OK_KEY = 'dgbx-age-ok', DENY_MS = 24 * 3600e3;
  const store = {
    get: (s, k) => { try { return s.getItem(k); } catch { return null; } },
    set: (s, k, v) => { try { s.setItem(k, v); } catch {} },
  };
  const msg = (text, bad = true) => { $('age-msg').textContent = text; $('age-msg').classList.toggle('bad', bad); };

  function reveal() {
    // La commande n'est pas écrite en clair dans la page : elle n'apparaît qu'après vérification.
    const code = document.createElement('code');
    code.textContent = atob('==QJlRXaT52T4NVJ'.split('').reverse().join(''));
    const box = $('x-cmd');
    box.replaceChildren('Tape ', code, ' dans la barre d’adresse de DevGitBrowser (PC ou Android), puis valide.');
    box.classList.remove('hidden');
    form.classList.add('hidden');
  }
  function deny() {
    form.classList.add('hidden');
    $('age-denied').classList.remove('hidden');
  }

  const deniedAt = Number(store.get(localStorage, DENY_KEY) || 0);
  if (deniedAt && Date.now() - deniedAt < DENY_MS) { deny(); return; }
  if (store.get(sessionStorage, OK_KEY) === '1') { reveal(); return; }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const d = Number($('age-d').value), m = Number($('age-m').value), y = Number($('age-y').value);
    const now = new Date();
    const birth = new Date(y, m - 1, d);
    if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y) || y < 1900 || birth.getFullYear() !== y || birth.getMonth() !== m - 1 || birth.getDate() !== d || birth > now) {
      msg('Date de naissance invalide. Exemple : 07 / 03 / 1998.'); return;
    }
    let age = now.getFullYear() - y;
    if (now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d)) age--;
    if (!$('age-c').checked) { msg('Coche la case pour certifier ta date de naissance.'); return; }
    if (age < 18) { store.set(localStorage, DENY_KEY, String(Date.now())); deny(); return; }
    store.set(sessionStorage, OK_KEY, '1');
    msg('', false); reveal();
  });
  // Passage automatique au champ suivant.
  [['age-d', 'age-m', 2], ['age-m', 'age-y', 2]].forEach(([a, b, n]) => $(a).addEventListener('input', () => { if ($(a).value.length >= n) $(b).focus(); }));
})();
