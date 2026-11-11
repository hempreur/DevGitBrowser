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
    $$('.card,.layer,.step,.head,.reassure,.spec,.store-mock,.faq-list,.comm-cards').forEach(n => { n.classList.add('rv'); io.observe(n); });
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
})();
