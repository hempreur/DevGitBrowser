'use strict';
// Site vitrine statique : pas de cookies, pas de suivi, pas de dépendance JS.
// La seule requête API cherche la dernière release publique GitHub pour
// actualiser le bouton Windows. L'URL officielle v1.9.1 reste le secours.
(() => {
  const RELEASE_API = 'https://api.github.com/repos/hempreur/DevGitBrowser/releases/latest';
  const FALLBACK = 'https://github.com/hempreur/DevGitBrowser/releases/download/v1.9.1/DevGitBrowser-Setup-1.9.1.exe';

  document.getElementById('year').textContent = String(new Date().getFullYear());

  const toggle = document.getElementById('menu-toggle');
  const nav = document.getElementById('primary-nav');
  const closeMenu = () => {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Ouvrir le menu');
  };
  toggle.addEventListener('click', () => {
    const opened = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(opened));
    toggle.setAttribute('aria-label', opened ? 'Fermer le menu' : 'Ouvrir le menu');
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  document.addEventListener('click', event => {
    if (!nav.contains(event.target) && !toggle.contains(event.target)) closeMenu();
  });

  // Reveal uniquement quand l'API est disponible, sans gêner le mode réduit.
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const targets = document.querySelectorAll('.feature-card,.more-card,.section-heading,.protection-copy,.protection-visual,.store-showcase,.ecosystem-aside,.download-panel,.faq-layout');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    }, {threshold:0.08, rootMargin:'0px 0px -25px 0px'});
    for (const node of targets) {node.classList.add('reveal');observer.observe(node);}
    document.documentElement.classList.add('js-ready');
  }

  // La page n'effectue pas de téléchargement automatique et ne fait appel
  // qu'aux releases GitHub publiques. Aucune requête vers le VPS DevGit.
  async function refreshRelease() {
    if (!window.fetch) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);
    try {
      const response = await fetch(RELEASE_API, {
        signal: controller.signal,
        headers: {Accept:'application/vnd.github+json'}
      });
      if (!response.ok) return;
      const release = await response.json();
      if (release?.draft || release?.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name || '')) return;
      const asset = (Array.isArray(release.assets) ? release.assets : []).find(a => /^DevGitBrowser-Setup-\d+\.\d+\.\d+\.exe$/.test(a.name || '') && a.browser_download_url?.startsWith('https://github.com/hempreur/DevGitBrowser/releases/download/'));
      if (!asset) return;
      const version = release.tag_name.replace(/^v/, '');
      for (const anchor of document.querySelectorAll('[data-release-download]')) {
        anchor.href = asset.browser_download_url;
        anchor.title = 'Télécharger DevGitBrowser ' + version + ' pour Windows (site officiel GitHub)';
      }
      for (const label of document.querySelectorAll('[data-version-label]')) label.textContent = 'Version ' + version;
    } catch {
      // Réseau indisponible / API GitHub limitée : lien officiel de secours.
      for (const anchor of document.querySelectorAll('[data-release-download]')) if (!anchor.href) anchor.href = FALLBACK;
    } finally {
      clearTimeout(timeout);
    }
  }
  refreshRelease();
})();
