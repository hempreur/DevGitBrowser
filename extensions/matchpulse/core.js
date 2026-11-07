/* MatchPulse 0.1 — fonctions déterministes partagées, sans dépendance externe. */
(function (root, build) {
  const api = build();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MatchPulseCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DOMAINS = Object.freeze([
    { name: 'Betclic', region: 'France', domain: 'betclic.fr' },
    { name: 'Winamax', region: 'France', domain: 'winamax.fr' },
    { name: 'Unibet', region: 'France', domain: 'unibet.fr' },
    { name: 'Unibet', region: 'Belgique', domain: 'unibet.be' },
    { name: 'Unibet', region: 'Belgique', domain: 'unibetsports.be' }
  ]);
  function detectBookmaker(host) {
    const value = String(host || '').toLowerCase().replace(/\.$/, '');
    return DOMAINS.find(x => value === x.domain || value.endsWith('.' + x.domain)) || null;
  }
  function parseOdds(input) {
    const str = String(input ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (!/^(?:\d{1,3})(?:\.\d{1,3})?$/.test(str)) return null;
    const n = Number(str);
    return Number.isFinite(n) && n >= 1.01 && n <= 500 ? n : null;
  }
  function impliedProbability(odds) { const n = parseOdds(odds); return n === null ? null : 1 / n; }
  function combinedImplied(selections) {
    if (!Array.isArray(selections) || !selections.length) return null;
    let p = 1, total = 1;
    for (const sel of selections) {
      const odd = parseOdds(sel.odds);
      if (!odd) return null;
      total *= odd;
      p *= 1 / odd;
    }
    return { probability: p, decimalOdds: total, isIndependentAssumption: selections.length > 1 };
  }
  function niceLabel(value, max=95) {
    return String(value || '').replace(/[\r\n\t ]+/g, ' ').trim().slice(0, max);
  }
  function extractOddsAndLabel(text) {
    const line = niceLabel(text, 230);
    if (!line || /(mise totale|déposer|cashout|solde|montant|identifiant|retrait|gain potentiel)/i.test(line)) return null;
    // Accepte seulement une cote décimale positionnée en fin de ligne, pas un score au milieu.
    const m = line.match(/(?:^|\s)(\d{1,3}[,.]\d{1,3})\s*$/);
    if (!m) return null;
    const odds = parseOdds(m[1]);
    const label = niceLabel(line.slice(0, m.index).trim(), 100);
    if (!odds || label.length < 3 || !/[A-Za-zÀ-ÿ]/.test(label)) return null;
    return { label, odds };
  }
  function eventKind(event) {
    const type = String(event?.type || '').toLowerCase();
    const detail = String(event?.detail || '').toLowerCase();
    if (type === 'goal') return /penalt|penalt/i.test(detail) ? 'penalty' : 'goal';
    if (type === 'card') return detail.includes('red') ? 'red-card' : 'yellow-card';
    if (type === 'var' && detail.includes('penalt')) return 'penalty';
    if (type === 'var') return 'var';
    return null;
  }
  function eventText(event) {
    const kind = eventKind(event);
    const name = niceLabel(event?.player?.name || event?.team?.name || '', 75);
    const minute = Number.isFinite(Number(event?.time?.elapsed)) ? String(event.time.elapsed) + '′ ' : '';
    const pretty = {
      'goal': '⚽ But', 'penalty': '🎯 Pénalty', 'yellow-card': '🟨 Carton jaune',
      'red-card': '🟥 Carton rouge', 'var': '📺 VAR'
    };
    return kind ? `${minute}${pretty[kind]}${name ? ' — ' + name : ''}` : null;
  }
  function eventId(event) {
    return [event?.time?.elapsed, event?.time?.extra, event?.team?.id,
      event?.player?.id, event?.type, event?.detail, event?.comments].map(v => String(v ?? '')).join('|');
  }
  function foulCount(statistics) {
    if (!Array.isArray(statistics)) return null;
    let sum=0, known=false;
    for (const team of statistics) {
      const item = (team?.statistics || []).find(s=>String(s?.type).toLowerCase()==='fouls');
      const v = Number(item?.value);
      if (item && item.value !== null && Number.isFinite(v) && v>=0) { sum+=v;known=true; }
    }
    return known ? sum : null;
  }
  function validFixtureId(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 1e9; }
  function matchingFixtures(response, search) {
    const q = niceLabel(search, 70).toLocaleLowerCase();
    if (q.length < 2) return [];
    return (Array.isArray(response) ? response : []).filter(f => {
      const a = f?.teams?.home?.name || '', b = f?.teams?.away?.name || '';
      return `${a} ${b}`.toLocaleLowerCase().includes(q);
    }).slice(0,30).map(f => ({
      id:f.fixture?.id,
      home:niceLabel(f.teams?.home?.name,70), away:niceLabel(f.teams?.away?.name,70),
      date:f.fixture?.date, score:`${f.goals?.home ?? '-'} : ${f.goals?.away ?? '-'}`,
      status:f.fixture?.status?.short || ''
    })).filter(f=>validFixtureId(f.id));
  }
  return { detectBookmaker, parseOdds, impliedProbability, combinedImplied,
    niceLabel, extractOddsAndLabel, eventKind, eventText, eventId, foulCount,
    validFixtureId, matchingFixtures };
});
