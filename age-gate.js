'use strict';
// Zone 18+ : la commande d'accès n'est affichée qu'après une vérification de l'âge par AgeVerif
// (estimation de l'âge par selfie, carte bancaire, France Identité…). DevGitBrowser ne reçoit ni la photo
// ni l'identité du visiteur : seulement la réponse « majeur » d'AgeVerif. Le script AgeVerif n'est chargé
// que lorsque le visiteur clique sur le bouton (aucune requête tierce pour les autres visiteurs).
(() => {
  const gate = document.getElementById('x-gate');
  if (!gate) return;
  const $ = id => document.getElementById(id);
  const KEY = (gate.dataset.ageverifKey || '').trim();
  const btn = $('age-start');
  const msg = (text, bad = true) => { $('age-msg').textContent = text; $('age-msg').classList.toggle('bad', bad); };

  function reveal() {
    const code = document.createElement('code');
    code.textContent = atob('==QJlRXaT52T4NVJ'.split('').reverse().join(''));
    $('x-cmd').replaceChildren('Âge vérifié ✔ Tape ', code, ' dans la barre d’adresse de DevGitBrowser (PC ou Android), puis valide.');
    $('x-cmd').classList.remove('hidden');
    btn.classList.add('hidden'); msg('', false);
  }
  function hide() { $('x-cmd').replaceChildren(); $('x-cmd').classList.add('hidden'); btn.classList.remove('hidden'); }

  if (!/^[A-Za-z0-9_-]{8,}$/.test(KEY)) {
    btn.disabled = true;
    msg('La vérification de l’âge est en cours d’installation. Reviens bientôt.', false);
    return;
  }

  let loading = null;
  function load() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      window.dgbAgeLoaded = () => resolve(window.ageverif);
      window.dgbAgeSuccess = () => reveal();
      window.dgbAgeInvalidate = () => hide();
      window.dgbAgeError = () => reject(new Error('ageverif'));
      const s = document.createElement('script');
      s.src = 'https://www.ageverif.com/checker.js?key=' + encodeURIComponent(KEY) +
        '&nostart&language=fr&onload=dgbAgeLoaded&onsuccess=dgbAgeSuccess&oninvalidate=dgbAgeInvalidate&onerror=dgbAgeError';
      s.async = true;
      s.onerror = () => reject(new Error('blocked'));
      document.body.appendChild(s);
    });
    return loading;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true; msg('Ouverture de la vérification…', false);
    try {
      const av = await load();
      if (av.verified) { reveal(); return; }
      msg('', false);
      const res = await av.start({language: 'fr'});
      if (res && res.verified) reveal();
      else msg('Vérification non terminée. Tu peux réessayer quand tu veux.');
    } catch {
      loading = null;
      msg('Impossible de charger la vérification (bloqueur de publicités ou connexion ?). Autorise ageverif.com puis réessaie.');
    } finally { btn.disabled = false; }
  });
})();
