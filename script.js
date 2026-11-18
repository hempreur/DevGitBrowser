'use strict';
// Site vitrine statique DevGitBrowser : aucun cookie, aucun traceur.
(() => {
  const REPO = 'hempreur/DevGitBrowser';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const year = $('#year'); if (year) year.textContent = String(new Date().getFullYear());

  // Menu mobile
  const burger = $('#burger'), menu = $('#menu');
  const setMenu = open => { menu.classList.toggle('open', open); burger.setAttribute('aria-expanded', String(open)); burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu'); };
  burger.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

  // Ombre de la barre de navigation au défilement
  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', onScroll, {passive: true}); onScroll();

  // Dernière version officielle : lien direct vers l'installateur, numéro, taille et date.
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {headers: {accept: 'application/vnd.github+json'}})
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(rel => {
      const version = String(rel.tag_name || '').replace(/^v/, '');
      const exe = (rel.assets || []).find(a => /^DevGitBrowser-Setup-.*\.exe$/i.test(a.name));
      if (/^\d+\.\d+\.\d+$/.test(version)) $$('.ver').forEach(n => { n.textContent = version; });
      if (exe && /^https:\/\/github\.com\//.test(exe.browser_download_url)) {
        $$('.dl-link').forEach(a => { a.href = exe.browser_download_url; });
        $$('.size').forEach(n => { n.textContent = 'Installateur ' + Math.round(exe.size / 1048576) + ' Mo'; });
      }
      if (rel.published_at) $$('.rel-date').forEach(n => { n.textContent = new Date(rel.published_at).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long', year: 'numeric'}); });
    })
    .catch(() => {});

  // Application Android : releases séparées (tag « android-v1.0.1 »), on prend la plus récente avec son APK.
  fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {headers: {accept: 'application/vnd.github+json'}})
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(list => {
      const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
      let best = null;
      for (const rel of Array.isArray(list) ? list : []) {
        const v = (String(rel.tag_name || '').match(/^android-v(\d+\.\d+\.\d+)$/) || [])[1];
        const apk = v && !rel.draft && !rel.prerelease && (rel.assets || []).find(a => a.name === `DevGitBrowser-Android-${v}.apk`);
        if (apk && /^https:\/\/github\.com\//.test(apk.browser_download_url) && (!best || cmp(v, best.v) > 0)) best = {v, apk};
      }
      if (!best) return;
      $$('.apk-link').forEach(a => { a.href = best.apk.browser_download_url; });
      $$('.apk-size').forEach(n => { n.textContent = Math.round(best.apk.size / 1048576) + ' Mo'; });
      $$('.ver-android,.ver-android-label').forEach(n => { n.textContent = best.v; });
    })
    .catch(() => {});

  // Boîte 3D : légère rotation qui suit la souris (désactivée si l'utilisateur limite les animations).
  const box = $('#box'), stage = $('.box-stage');
  if (box && matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) {
    stage.addEventListener('mousemove', e => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      box.style.transform = `rotateY(${-24 + x * 22}deg) rotateX(${6 - y * 12}deg)`;
    });
    stage.addEventListener('mouseleave', () => { box.style.transform = ''; });
  }

  // Apparition progressive des sections
  if ('IntersectionObserver' in window && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    const io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), {threshold: 0.12});
    $$('.card,.layer,.step,.head,.reassure,.spec,.store-mock,.x-card,.faq-list,.comm-cards').forEach(n => { n.classList.add('rv'); io.observe(n); });
  }
})();

// Lien de parrainage : https://hempreur.github.io/DevGitBrowser/?ref=CODE8
(() => {
  const code = String(new URLSearchParams(location.search).get('ref') || '').toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(code)) return;
  const box = document.getElementById('ref-invite'); if (!box) return;
  document.getElementById('ref-value').textContent = code;
  box.hidden = false;
  const btn = document.getElementById('ref-copy'), label = btn.querySelector('small');
  btn.addEventListener('click', () => navigator.clipboard?.writeText(code).then(() => { label.textContent = 'Copié ✓'; setTimeout(() => { label.textContent = 'Copier'; }, 1800); }, () => {}));
  try { sessionStorage.setItem('dgb-ref', code); } catch {}
  // Validation automatique au premier lancement : l'adresse complète de cette page (avec le code)
  // accompagne le téléchargement — Windows la note dans la « marque du web » de l'installateur —
  // et le code est aussi copié au format reconnu par le navigateur.
  const note = document.createElement('p');
  note.className = 'ref-auto'; note.textContent = '✅ Le code sera validé automatiquement au premier lancement du navigateur.';
  box.querySelector('div').append(note);
  document.querySelectorAll('a[href*="github.com/hempreur/DevGitBrowser/releases"]').forEach(a => {
    a.referrerPolicy = 'unsafe-url';
    a.addEventListener('click', () => { navigator.clipboard?.writeText('DevGitBrowser ref:' + code).catch(() => {}); });
  });
})();
