'use strict';
// DevGitBrowser — traduction de l'interface (v1.14).
// Le français est la langue source : chaque texte affiché est cherché dans le
// dictionnaire (i18n/en.json) — d'abord tel quel, puis via les modèles à
// variables (« {0} onglet(s) mis en veille. »), puis morceau par morceau
// autour des séparateurs « · », « — », « : ». Utilisable dans le processus
// principal (require) et dans les pages de l'interface (window.DGBI18n).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DGBI18n = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function createTranslator(dict) {
    const exact = new Map(Object.entries(dict || {}));
    const patterns = [];
    for (const [fr, en] of exact) {
      if (!/\{\d*\}/.test(fr)) continue;
      let n = 0; const order = [];
      const src = fr.split(/(\{\d*\})/).map(part => {
        const m = part.match(/^\{(\d*)\}$/);
        if (!m) return esc(part);
        order.push(m[1] === '' ? n : Number(m[1])); n++;
        return '([\\s\\S]+?)';
      }).join('');
      if (src.replace(/\(\[\\s\\S\]\+\?\)/g, '').length < 3) continue; // modèle trop vague
      patterns.push({re: new RegExp('^' + src + '$'), en, order, weight: fr.replace(/\{\d*\}/g, '').length});
    }
    patterns.sort((a, b) => b.weight - a.weight);
    const cache = new Map();
    const fill = (en, values) => {
      let i = 0;
      return en.replace(/\{(\d*)\}/g, (_, d) => { const v = values[d === '' ? i++ : Number(d)]; return v === undefined ? '' : v; });
    };
    function core(s, depth) {
      if (exact.has(s)) return exact.get(s);
      for (const p of patterns) {
        const m = p.re.exec(s); if (!m) continue;
        const values = [];
        p.order.forEach((slot, idx) => { const v = m[idx + 1]; values[slot] = (depth < 2 && translate(v, depth + 1)) || v; });
        return fill(p.en, values);
      }
      return null;
    }
    // Texte complet → traduction, ou null si rien de connu.
    function translate(text, depth = 0) {
      if (typeof text !== 'string') return null;
      const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
      const s = text.trim();
      if (!s || !/[A-Za-zÀ-ÿ]/.test(s)) return null;
      if (cache.has(s)) { const c = cache.get(s); return c === null ? null : lead + c + trail; }
      let out = core(s, depth);
      // Icône ou symbole en tête : « 🔒 Coffre verrouillé ».
      if (out === null) { const m = s.match(/^([^\p{L}\p{N}«“"(]+)(.+)$/u); if (m) { const r = core(m[2], depth); if (r !== null) out = m[1] + r; } }
      // Morceaux séparés par « · », « — », retour à la ligne ou « : ».
      if (out === null && depth < 2) {
        const parts = s.split(/(\s+[·•—|]\s+|\n+|\s*:\s+)/);
        if (parts.length > 1) {
          let hit = false;
          const mapped = parts.map((p, i) => { if (i % 2) return p; const r = translate(p, depth + 1); if (r !== null) { hit = true; return r; } return p; });
          if (hit) out = mapped.join('');
        }
      }
      if (cache.size > 5000) cache.clear();
      cache.set(s, out);
      return out === null ? null : lead + out + trail;
    }
    const t = text => translate(text) ?? text;
    // Texte des balises d'une page HTML générée (pages d'erreur…), sans toucher au balisage.
    const html = src => String(src).replace(/(<title>|>)([^<>]+)(?=<)/g, (all, open, txt) => {
      if (/^\s*$/.test(txt)) return all;
      return open + (translate(decodeEntities(txt)) !== null ? encodeEntities(translate(decodeEntities(txt))) : txt);
    });
    return {t, translate, html, size: exact.size};
  }
  const decodeEntities = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const encodeEntities = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---- Traduction en direct d'un document (pages de l'interface uniquement).
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  function mountDocument(doc, initial) {
    let tr = null, lang = 'fr';
    const originals = new WeakMap(); // nœud → texte français d'origine
    const attrOriginals = new WeakMap();
    const skipNode = n => { for (let e = n.parentElement; e; e = e.parentElement) { if (SKIP.has(e.tagName) || e.hasAttribute('data-no-i18n') || e.isContentEditable) return true; } return false; };
    function doText(node) {
      if (skipNode(node)) return;
      const cur = node.data;
      if (lang === 'fr') { const o = originals.get(node); if (o && o.en === cur) node.data = o.fr; return; }
      const o = originals.get(node);
      if (o && o.en === cur) return; // déjà traduit
      const r = tr.translate(cur);
      if (r !== null && r !== cur) { originals.set(node, {fr: cur, en: r}); node.data = r; }
    }
    function doAttrs(el) {
      if (el.hasAttribute('data-no-i18n')) return;
      let saved = attrOriginals.get(el);
      for (const a of ATTRS) {
        if (!el.hasAttribute(a)) continue;
        const cur = el.getAttribute(a);
        if (lang === 'fr') { if (saved?.[a] && saved[a].en === cur) el.setAttribute(a, saved[a].fr); continue; }
        if (saved?.[a]?.en === cur) continue;
        const r = tr.translate(cur);
        if (r !== null && r !== cur) { saved ||= {}; saved[a] = {fr: cur, en: r}; attrOriginals.set(el, saved); el.setAttribute(a, r); }
      }
      if (el.tagName === 'OPTION' || el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
        // Les <option> et boutons de type input affichent leur texte/valeur.
        if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) {
          const r = lang === 'en' && tr.translate(el.value); if (r) el.value = r;
        }
      }
    }
    function walk(rootNode) {
      if (!rootNode) return;
      if (rootNode.nodeType === 3) { doText(rootNode); return; }
      if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11) return;
      if (rootNode.nodeType === 1) { if (SKIP.has(rootNode.tagName) || rootNode.hasAttribute('data-no-i18n')) return; doAttrs(rootNode); }
      const w = doc.createTreeWalker(rootNode, 5 /* éléments + textes */, {acceptNode: n => (n.nodeType === 1 && (SKIP.has(n.tagName) || n.hasAttribute('data-no-i18n'))) ? 2 : 1});
      let n; while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
    }
    const obs = new MutationObserver(list => {
      if (!tr) return;
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    });
    function set(next) {
      lang = next?.lang === 'en' ? 'en' : 'fr';
      tr = createTranslator(lang === 'en' ? next.dict : {});
      doc.documentElement.lang = lang;
      if (doc.title) { const r = lang === 'en' && tr.translate(doc.title); if (r) doc.title = r; }
      walk(doc.body || doc.documentElement);
      if (doc.head) for (const tEl of doc.head.querySelectorAll('title')) { const r = lang === 'en' && tr.translate(tEl.textContent); if (r) tEl.textContent = r; }
    }
    const start = () => {
      obs.observe(doc.documentElement, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS});
      set(initial);
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, {once: true}); else start();
    return {set, t: s => (tr ? tr.t(s) : s), get lang() { return lang; }};
  }
  return {createTranslator, mountDocument};
});
// Démarrage automatique dans les fenêtres de l'interface (dictionnaire fourni par le preload).
if (typeof window !== 'undefined' && window.DGBLang && window.DGBI18n) {
  const mounted = window.DGBI18n.mountDocument(document, window.DGBLang.initial);
  window.DGBLang.onChange(next => mounted.set(next));
  window.DGBT = mounted.t;
}
