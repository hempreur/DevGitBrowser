/* MatchPulse 0.6 — module de données en arrière-plan.
 * Source principale : flux public ESPN (gratuit, sans clé, toutes compétitions).
 * Option : API-Football avec une clé personnelle gardée en mémoire.
 * Les données de pari, cookies et identifiants du bookmaker ne transitent jamais ici :
 * seuls des noms d'équipes et des identifiants de matchs publics sont utilisés.
 */
(function () {
  'use strict';
  const Core = globalThis.MatchPulseCore;
  const BASE = 'https://v3.football.api-sports.io';
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
  const MAX_TRACKED = 12;
  const INTERVALS = {espn: 30_000, 'api-football': 120_000};
  const cache = new Map();
  const pending = new Map();
  let sessionKey = null; // Clé API gardée en mémoire ; jamais écrite sur disque.
  let keyGeneration = 0;
  const tracked = [];
  const alerts = [];
  let running = false, timer = null, busy = null, lastPoll = null, lastError = '', alertSeq = 0;
  const prefs = {notifications: true, kinds: {goals: true, cards: true, penalties: true, var: true, fouls: true, corners: true}};

  function authorizedSender(sender) {
    try { const u = new URL(sender?.url || ''); return u.protocol === 'https:' && Boolean(Core.detectBookmaker(u.hostname)); }
    catch { return false; }
  }
  function assertDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date invalide.');
    if (new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new Error('Date invalide.');
    return date;
  }
  function localDay(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function today() { return localDay(); }
  function shiftDay(date, days) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
  async function fetchJSON(url, {headers = {}, timeout = 15000} = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: ctrl.signal, headers});
      if (res.status === 429) throw new Error('Source temporairement limitée (trop de requêtes).');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error('La source ne répond pas (délai dépassé).');
      if (e?.name === 'TypeError') throw new Error('Connexion impossible à la source (réseau ou pare-feu).');
      throw e;
    } finally { clearTimeout(t); }
  }
  async function cached(key, ttl, loader) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.at < ttl) return entry.value;
    if (pending.has(key)) return pending.get(key);
    const task = loader().then(value => { cache.set(key, {at: Date.now(), value}); if (cache.size > 150) cache.delete(cache.keys().next().value); return value; });
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  // ------------------------------------------------------------ ESPN
  async function espnBoard(date, ttl) {
    const day = assertDate(date).replace(/-/g, '');
    return cached('espn-all:' + day, ttl, async () => {
      const body = await fetchJSON(ESPN + 'all/scoreboard?dates=' + day + '&limit=1000');
      if (!Array.isArray(body?.events)) throw new Error('Format ESPN non reconnu.');
      return body.events.slice(0, 1500).map(Core.espnAllRecord).filter(Boolean);
    });
  }
  // Un match du soir en Europe peut être daté du lendemain côté ESPN (et inversement) :
  // on fusionne la date demandée et ses voisines.
  async function espnDay(date, {live = false} = {}) {
    const ttl = live || date === today() ? 30_000 : 10 * 60_000;
    const days = [date, shiftDay(date, -1), shiftDay(date, 1)];
    const results = await Promise.allSettled(days.map((d, i) => espnBoard(d, i === 0 ? ttl : 10 * 60_000)));
    if (results[0].status !== 'fulfilled' && results.every(r => r.status !== 'fulfilled')) throw results[0].reason;
    const map = new Map();
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      for (const rec of r.value) {
        // Les jours voisins ne servent qu'aux matchs dont l'heure locale tombe le jour demandé.
        if (i > 0 && rec.date && localDay(new Date(rec.date)) !== date) continue;
        map.set(rec.id, rec);
      }
    });
    return [...map.values()];
  }
  function espnSummary(id, ttl = 25_000) {
    if (!/^\d{1,12}$/.test(String(id))) return Promise.reject(new Error('Identifiant ESPN invalide.'));
    return cached('espn-sum:' + id, ttl, () => fetchJSON(ESPN + 'all/summary?event=' + id).then(Core.espnSummaryData));
  }
  // ------------------------------------------------------------ API-Football
  async function apiFootball(path, ttl) {
    if (!sessionKey) throw new Error('Configure une clé personnelle API-Football.');
    const generation = keyGeneration;
    const data = await cached('af:' + path, ttl, () => fetchJSON(BASE + path, {headers: {'x-apisports-key': sessionKey}}));
    if (generation !== keyGeneration) throw new Error('Clé API modifiée pendant la requête.');
    if (data.errors && Object.keys(data.errors).length) throw new Error('API-Football : clé, quota ou paramètres invalides.');
    if (!Array.isArray(data.response)) throw new Error('Réponse API-Football non reconnue.');
    return data.response;
  }
  // ------------------------------------------------------------ Recherche
  async function search(date, query, source) {
    if (String(query || '').trim().length < 2) throw new Error('Nom d’équipe trop court.');
    if (source === 'api-football') {
      const items = Core.matchingFixtures(await apiFootball('/fixtures?date=' + assertDate(date), 10 * 60_000), query).map(f => ({...f, source: 'api-football'}));
      return {items, source};
    }
    const records = await espnDay(assertDate(date));
    return {items: Core.searchRecords(records, query), source: 'espn', total: records.length};
  }
  async function diagnose(date) {
    const day = assertDate(date || today());
    const out = {date: day, espn: null, apiFootball: sessionKey ? 'clé configurée' : 'non configurée'};
    const started = Date.now();
    try {
      const records = await espnDay(day);
      out.espn = {ok: true, matches: records.length, live: records.filter(r => r.state === 'in').length, ms: Date.now() - started,
        leagues: [...new Set(records.map(r => r.leagueName).filter(Boolean))].slice(0, 12)};
    } catch (e) { out.espn = {ok: false, error: e.message}; }
    return out;
  }
  // ------------------------------------------------------------ Suivi et alertes
  function eventLine(t, e) { return Core.liveEventText(e, t.home, t.away) || Core.eventText?.(e) || ''; }
  function publicMatch(t) {
    return {id: t.id, source: t.source, label: t.label, home: t.home, away: t.away, score: t.score, status: t.status, state: t.state, league: t.leagueName || '',
      stats: t.stats || null, events: (t.events || []).slice(-4).map(e => t.source === 'espn' ? eventLine(t, e) : Core.eventText(e)).filter(Boolean)};
  }
  function snapshot() {
    return {running, tracked: tracked.map(publicMatch), alerts: alerts.slice(0, 30), lastPoll, lastError, prefs, configured: Boolean(sessionKey), max: MAX_TRACKED};
  }
  function kindAllowed(kind) {
    if (['goal', 'penalty', 'own-goal'].includes(kind)) return prefs.kinds.goals;
    if (['yellow-card', 'second-yellow', 'red-card'].includes(kind)) return prefs.kinds.cards;
    if (['penalty-missed', 'penalty-not-scored'].includes(kind)) return prefs.kinds.penalties;
    if (kind === 'var') return prefs.kinds.var;
    return true;
  }
  function pushAlert(match, text) {
    const item = {id: ++alertSeq, at: Date.now(), text: Core.niceLabel(`${match.label} : ${text}`, 220), match: match.id};
    alerts.unshift(item); if (alerts.length > 60) alerts.length = 60;
    if (prefs.notifications && typeof Notification === 'function') {
      try { new Notification('MatchPulse · ' + match.label, {body: text, silent: false, tag: 'mp-' + match.id + '-' + item.id}); } catch {}
    }
  }
  function track(match) {
    const id = String(match?.id || '');
    const source = match?.source === 'api-football' ? 'api-football' : 'espn';
    if (source === 'espn' ? !/^\d{1,12}$/.test(id) : !Core.validFixtureId(id)) throw new Error('Identifiant de match invalide.');
    if (tracked.some(t => t.id === id && t.source === source)) return false;
    if (tracked.length >= MAX_TRACKED) throw new Error(`${MAX_TRACKED} matchs maximum suivis en même temps.`);
    const home = Core.niceLabel(match.home, 70), away = Core.niceLabel(match.away, 70);
    tracked.push({id, source, date: /^\d{4}-\d{2}-\d{2}$/.test(match.date || '') ? match.date : today(), leagueName: Core.niceLabel(match.leagueName || '', 60),
      home, away, label: `${home} – ${away}`, score: Core.niceLabel(match.score || '- : -', 20), status: Core.niceLabel(match.status || '', 40), state: match.state || '', seen: null, stats: null, events: []});
    if (!running && !(source === 'api-football' && !sessionKey)) start().catch(() => {});
    return true;
  }
  async function pollEspn(t) {
    const records = await espnDay(t.date, {live: true});
    const rec = records.find(r => r.id === t.id);
    if (rec) { t.score = rec.score; t.status = rec.status; t.state = rec.state; }
    let incidents = rec?.events || [];
    let stats = null;
    if (!rec || rec.state !== 'pre') {
      try { const sum = await espnSummary(t.id, rec?.state === 'in' ? 25_000 : 5 * 60_000); if (sum.incidents.length) incidents = sum.incidents; stats = sum.stats; }
      catch (e) { if (!rec) throw e; }
    }
    if (t.seen) for (const e of incidents) if (!t.seen.has(e.id) && kindAllowed(e.kind)) { const text = eventLine(t, e); if (text) pushAlert(t, text); }
    t.seen = new Set(incidents.map(e => e.id)); t.events = incidents;
    if (stats && Object.keys(stats).length) {
      const enabled = [prefs.kinds.fouls && 'fouls', prefs.kinds.corners && 'corners'].filter(Boolean);
      for (const change of Core.statChanges(t.stats, stats, enabled)) pushAlert(t, change.text);
      t.stats = stats;
    }
  }
  async function pollOne(t) {
    if (t.source === 'espn') return pollEspn(t);
    const events = (await apiFootball('/fixtures/events?fixture=' + Number(t.id), 90_000)).filter(x => Core.eventKind(x));
    if (t.seen) for (const e of events) if (!t.seen.has(Core.eventId(e)) && kindAllowed(Core.eventKind(e))) { const text = Core.eventText(e); if (text) pushAlert(t, text); }
    t.seen = new Set(events.map(Core.eventId)); t.events = events;
    if (prefs.kinds.fouls) {
      const total = Core.foulCount(await apiFootball('/fixtures/statistics?fixture=' + Number(t.id), 3 * 60_000));
      if (total !== null) { if (t.stats?.fouls && total > t.stats.fouls.total) pushAlert(t, `Fautes : ${t.stats.fouls.total} → ${total}`); t.stats = {fouls: {home: 0, away: 0, total}}; }
    }
  }
  async function poll() {
    if (!running || !tracked.length) return;
    if (busy) return busy;
    const errors = [];
    busy = (async () => {
      for (const t of [...tracked]) {
        try { await pollOne(t); }
        catch (e) { errors.push(`${t.label} : ${e.message}`); }
      }
      lastPoll = Date.now(); lastError = errors.join(' · ').slice(0, 300);
    })();
    try { await busy; } finally { busy = null; }
  }
  function interval() { return Math.min(...tracked.map(t => INTERVALS[t.source] || 60_000), 120_000); }
  function schedule() { if (timer) clearTimeout(timer); timer = running ? setTimeout(async () => { await poll(); schedule(); }, tracked.length ? interval() : 60_000) : null; }
  function start() {
    if (tracked.some(t => t.source === 'api-football') && !sessionKey) return Promise.reject(new Error('Ajoute une clé API-Football pour les matchs suivis avec cette source.'));
    // Les matchs nouvellement suivis ont seen=null : le premier passage sert de référence.
    running = true;
    return poll().finally(schedule);
  }
  function stop() { running = false; if (timer) clearTimeout(timer); timer = null; }
  function teamsOf(item) { return Core.parseFixtureTeams(item?.fixture || '') || Core.parseFixtureTeams(item?.label || ''); }
  async function trackTicket(items, date) {
    const day = assertDate(date || today());
    const records = await espnDay(day);
    const matched = [], missing = [];
    const seen = new Set();
    for (const item of (Array.isArray(items) ? items : []).slice(0, 20)) {
      const teams = teamsOf(item);
      if (!teams) { missing.push(Core.niceLabel(item?.label || item?.fixture || '?', 80)); continue; }
      const key = Core.normalizeTeam(teams.home) + '|' + Core.normalizeTeam(teams.away);
      if (seen.has(key)) continue; seen.add(key);
      const match = Core.bestFixtureMatch(records, teams);
      if (!match) { missing.push(`${teams.home} – ${teams.away}`); continue; }
      try { track({...match, date: day}); matched.push(`${match.home} – ${match.away}`); }
      catch (e) { missing.push(`${teams.home} – ${teams.away} (${e.message})`); }
    }
    return {matched, missing, total: records.length, snapshot: snapshot()};
  }
  // Analyse d'un ticket AVANT validation : probabilité estimée par sélection.
  async function analyzeSlip(items, date) {
    const day = assertDate(date || today());
    let records = [];
    try { records = await espnDay(day); } catch {}
    const results = [];
    for (const item of (Array.isArray(items) ? items : []).slice(0, 15)) {
      const clean = {label: Core.niceLabel(item?.label, 80), market: Core.niceLabel(item?.market, 120), fixture: Core.niceLabel(item?.fixture, 140), odds: Number(item?.odds) > 1 && Number(item?.odds) < 1000 ? Number(item.odds) : null};
      const teams = teamsOf(clean);
      const match = teams ? Core.bestFixtureMatch(records, teams) : null;
      const markets = match?.markets || null;
      const form = match && (match.form.home.length || match.form.away.length) ? match.form : null;
      const estimate = Core.estimateSelection(clean, {teams: match ? {home: match.home, away: match.away} : teams, markets, form});
      if (estimate.source === 'cotes du marché' || estimate.source === 'cotes du marché + forme') estimate.source += markets?.provider ? ` (${markets.provider})` : '';
      results.push({...clean, match: match ? `${match.home} – ${match.away}` : '', state: match?.state || '', ...estimate,
        form: form ? {home: form.home.join(''), away: form.away.join('')} : null});
    }
    const combined = Core.combineProbabilities(results);
    const totalOdds = results.length && results.every(r => r.odds) ? results.reduce((a, r) => a * r.odds, 1) : null;
    return {results, combined, totalOdds, sameMatch: new Set(results.map(r => r.match).filter(Boolean)).size < results.filter(r => r.match).length};
  }

  async function handle(message) {
    if (!message || typeof message !== 'object') throw new Error('Requête non reconnue.');
    switch (message.action) {
      case 'set-key': {
        const key = String(message.value || '').trim();
        if (!/^[a-zA-Z0-9_-]{20,128}$/.test(key)) throw new Error('Clé API invalide (20 à 128 caractères alphanumériques).');
        sessionKey = key; keyGeneration++; return {configured: true};
      }
      case 'clear-key': sessionKey = null; keyGeneration++; for (let i = tracked.length - 1; i >= 0; i--) if (tracked[i].source === 'api-football') tracked.splice(i, 1); return {configured: false};
      case 'status': case 'state': return snapshot();
      case 'search': return search(assertDate(message.date), message.search, message.source === 'api-football' ? 'api-football' : 'espn');
      case 'diagnose': return diagnose(message.date);
      case 'track': track(message.match); return snapshot();
      case 'untrack': { const i = tracked.findIndex(t => t.id === String(message.id)); if (i >= 0) tracked.splice(i, 1); if (!tracked.length) stop(); return snapshot(); }
      case 'track-ticket': return trackTicket(message.items, message.date);
      case 'analyze-slip': return analyzeSlip(message.items, message.date);
      case 'start': await start(); return snapshot();
      case 'stop': stop(); return snapshot();
      case 'clear-alerts': alerts.length = 0; return snapshot();
      case 'prefs': {
        if (typeof message.notifications === 'boolean') prefs.notifications = message.notifications;
        for (const k of Object.keys(prefs.kinds)) if (typeof message.kinds?.[k] === 'boolean') prefs.kinds[k] = message.kinds[k];
        if (prefs.notifications && typeof Notification === 'function' && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
        return snapshot();
      }
      default: throw new Error('Commande non autorisée.');
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!authorizedSender(sender)) { sendResponse({ok: false, error: 'Origine de page non autorisée.'}); return false; }
    Promise.resolve().then(() => handle(message)).then(data => sendResponse({ok: true, data}),
      error => sendResponse({ok: false, error: String(error?.message || 'Erreur fournisseur').slice(0, 220)}));
    return true;
  });
})();
