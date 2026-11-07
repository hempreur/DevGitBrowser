/* MatchPulse 0.4 — module de données en arrière-plan.
 * Les données de pari, cookies et identifiants du bookmaker ne transitent jamais ici :
 * seuls des noms d'équipes et des identifiants de matchs publics sont utilisés.
 * Le suivi continue même si l'onglet du bookmaker change de page.
 */
(function () {
  'use strict';
  const Core = globalThis.MatchPulseCore;
  const BASE = 'https://v3.football.api-sports.io';
  const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
  const SOFA_HOSTS = ['https://api.sofascore.com/api/v1', 'https://www.sofascore.com/api/v1'];
  const MAX_TRACKED = 12;
  const INTERVALS = {sofascore: 30_000, public: 60_000, 'api-football': 120_000};
  const cache = new Map();
  const pending = new Map();
  let sessionKey = null; // Clé API gardée en mémoire ; jamais écrite sur disque.
  let keyGeneration = 0;
  const tracked = []; // {id, source, league, date, home, away, label, score, status, seen:Set|null, stats, events}
  const alerts = []; // {id, at, text, match}
  let running = false, timer = null, busy = false, lastPoll = null, lastError = '', alertSeq = 0;
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
  function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  async function fetchJSON(url, {headers = {}, timeout = 12000} = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: ctrl.signal, headers});
      if (res.status === 429) throw new Error('Source temporairement limitée (trop de requêtes).');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error('La source ne répond pas (délai dépassé).');
      throw e;
    } finally { clearTimeout(t); }
  }
  async function cached(key, ttl, loader) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.at < ttl) return entry.value;
    if (pending.has(key)) return pending.get(key);
    const task = loader().then(value => { cache.set(key, {at: Date.now(), value}); if (cache.size > 120) cache.delete(cache.keys().next().value); return value; });
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  // ------------------------------------------------------------ SofaScore
  async function sofa(path, ttl) {
    return cached('sofa:' + path, ttl, async () => {
      let last;
      for (const host of SOFA_HOSTS) {
        try { return await fetchJSON(host + path, {headers: {Accept: 'application/json'}}); }
        catch (e) { last = e; }
      }
      throw new Error('SofaScore indisponible : ' + (last?.message || 'erreur'));
    });
  }
  async function sofaDay(date) {
    const [day, live] = await Promise.allSettled([
      sofa('/sport/football/scheduled-events/' + assertDate(date), 5 * 60_000),
      date === today() ? sofa('/sport/football/events/live', 25_000) : Promise.resolve({events: []})
    ]);
    if (day.status !== 'fulfilled' && live.status !== 'fulfilled') throw day.reason || live.reason;
    const map = new Map();
    for (const r of [day, live]) if (r.status === 'fulfilled') for (const ev of (r.value?.events || []).slice(0, 4000)) {
      const rec = Core.sofaRecord(ev); if (rec) map.set(rec.id, rec);
    }
    return [...map.values()];
  }
  // ------------------------------------------------------------ ESPN
  async function espnBoard(league, date, ttl = 120000) {
    if (!Core.allowedEspnLeague(league)) throw new Error('Championnat non autorisé.');
    const day = assertDate(date).replace(/-/g, '');
    return cached('espn:' + league + day, ttl, async () => {
      const body = await fetchJSON(ESPN_BASE + league + '/scoreboard?dates=' + day);
      if (!Array.isArray(body?.events)) throw new Error('Format ESPN non reconnu.');
      return body.events.slice(0, 350).map(e => Core.espnRecord(e, league)).filter(Boolean).map(r => ({...r, source: 'public'}));
    });
  }
  async function espnDay(date) {
    const results = await Promise.allSettled(Core.ESPN_LEAGUES.map(l => espnBoard(l.id, date, 180000)));
    const all = []; let ok = 0;
    for (const r of results) if (r.status === 'fulfilled') { ok++; all.push(...r.value); }
    if (!ok) throw new Error('ESPN inaccessible.');
    return all;
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
    const errors = [];
    if (source === 'api-football') {
      const items = Core.matchingFixtures(await apiFootball('/fixtures?date=' + assertDate(date), 10 * 60_000), query).map(f => ({...f, source: 'api-football'}));
      return {items, source};
    }
    if (source === 'auto' || source === 'sofascore') {
      try {
        const q = Core.normalizeTeam(query);
        const items = (await sofaDay(date)).filter(r => Core.normalizeTeam(r.home).includes(q) || Core.normalizeTeam(r.away).includes(q) || Core.teamSimilarity(r.home, query) >= 0.85 || Core.teamSimilarity(r.away, query) >= 0.85);
        items.sort((a, b) => (b.state === 'live') - (a.state === 'live'));
        if (items.length || source === 'sofascore') return {items: items.slice(0, 30), source: 'sofascore'};
      } catch (e) { errors.push(e.message); if (source === 'sofascore') throw e; }
    }
    const records = await espnDay(date);
    return {items: Core.searchPublicMatches(records, query).map(x => ({...x, source: 'public'})), source: 'public', fallback: errors[0] || ''};
  }
  // ------------------------------------------------------------ Suivi et alertes
  function publicMatch(t) { return {id: t.id, source: t.source, label: t.label, home: t.home, away: t.away, score: t.score, status: t.status, state: t.state, stats: t.stats || null, events: (t.events || []).slice(-4).map(e => Core.liveEventText(e, t.home, t.away) || Core.publicEventText(e) || Core.eventText(e)).filter(Boolean)}; }
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
    const source = ['sofascore', 'public', 'api-football'].includes(match?.source) ? match.source : 'sofascore';
    if (source === 'sofascore' ? !Core.validSofaId(id) : source === 'public' ? !/^\d{1,12}$/.test(id) : !Core.validFixtureId(id)) throw new Error('Identifiant de match invalide.');
    if (source === 'public' && !Core.allowedEspnLeague(match.league)) throw new Error('Championnat ESPN non autorisé.');
    if (tracked.some(t => t.id === id && t.source === source)) return false;
    if (tracked.length >= MAX_TRACKED) throw new Error(`${MAX_TRACKED} matchs maximum suivis en même temps.`);
    const home = Core.niceLabel(match.home, 70), away = Core.niceLabel(match.away, 70);
    tracked.push({id, source, league: match.league || null, date: /^\d{4}-\d{2}-\d{2}$/.test(match.date || '') ? match.date : today(),
      home, away, label: `${home} – ${away}`, score: Core.niceLabel(match.score || '- : -', 20), status: Core.niceLabel(match.status || '', 40), state: match.state || '', seen: null, stats: null, events: []});
    if (!running && !(source === 'api-football' && !sessionKey)) start().catch(() => {});
    return true;
  }
  async function pollOne(t) {
    if (t.source === 'sofascore') {
      const [incidents, event] = await Promise.all([
        sofa('/event/' + t.id + '/incidents', 20_000),
        sofa('/event/' + t.id, 20_000).catch(() => null)
      ]);
      const rec = event?.event ? Core.sofaRecord(event.event) : null;
      if (rec) { t.score = rec.score; t.status = rec.status; t.state = rec.state; }
      const items = Core.sofaIncidents(incidents);
      if (t.seen) for (const e of items) if (!t.seen.has(e.id) && kindAllowed(e.kind)) { const text = Core.liveEventText(e, t.home, t.away); if (text) pushAlert(t, text); }
      t.seen = new Set(items.map(e => e.id)); t.events = items;
      if (t.state !== 'pre' && (prefs.kinds.fouls || prefs.kinds.corners)) {
        try {
          const stats = Core.sofaStatistics(await sofa('/event/' + t.id + '/statistics', 25_000));
          const enabled = [prefs.kinds.fouls && 'fouls', prefs.kinds.corners && 'corners'].filter(Boolean);
          for (const change of Core.statChanges(t.stats, stats, enabled)) pushAlert(t, change.text);
          if (Object.keys(stats).length) t.stats = stats;
        } catch {}
      }
      return;
    }
    if (t.source === 'public') {
      const board = await espnBoard(t.league, t.date, 50_000);
      const match = board.find(x => x.id === t.id);
      if (!match) throw new Error('Match absent du flux ESPN.');
      if (t.seen) for (const e of match.events) if (!t.seen.has(e.id) && kindAllowed(e.kind)) { const text = Core.publicEventText(e); if (text) pushAlert(t, text); }
      if (t.seen && match.score !== t.score && !match.events.some(e => !t.seen.has(e.id))) pushAlert(t, `score mis à jour ${match.score}`);
      t.seen = new Set(match.events.map(e => e.id)); t.events = match.events; t.score = match.score; t.status = match.status; t.state = match.state;
      return;
    }
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
        catch (e) {
          // SofaScore indisponible : basculer automatiquement vers ESPN si le match y est trouvé.
          if (t.source === 'sofascore' && !t.fallbackTried) {
            t.fallbackTried = true;
            try {
              const match = Core.bestFixtureMatch(await espnDay(t.date), {home: t.home, away: t.away});
              if (match) { Object.assign(t, {id: match.id, source: 'public', league: match.league, seen: null}); errors.push(`${t.label} : bascule vers ESPN`); continue; }
            } catch {}
          }
          errors.push(`${t.label} : ${e.message}`);
        }
      }
      lastPoll = Date.now(); lastError = errors.join(' · ').slice(0, 300);
    })();
    try { await busy; } finally { busy = false; }
  }
  function interval() { return Math.min(...tracked.map(t => INTERVALS[t.source] || 60_000), 120_000); }
  function schedule() { if (timer) clearTimeout(timer); timer = running ? setTimeout(async () => { await poll(); schedule(); }, tracked.length ? interval() : 60_000) : null; }
  function start() {
    if (tracked.some(t => t.source === 'api-football') && !sessionKey) throw new Error('Ajoute une clé API-Football pour les matchs suivis avec cette source.');
    // Les matchs nouvellement suivis ont seen=null : le premier passage sert de
    // référence. Un redémarrage conserve la référence pour ne rien manquer.
    running = true;
    return poll().finally(schedule);
  }
  function stop() { running = false; if (timer) clearTimeout(timer); timer = null; }
  async function trackTicket(items, date) {
    const day = assertDate(date || today());
    let sofaRecords = [], espnRecords = null;
    try { sofaRecords = await sofaDay(day); } catch {}
    const matched = [], missing = [];
    const seenFixtures = new Set();
    for (const item of (Array.isArray(items) ? items : []).slice(0, 20)) {
      const teams = Core.parseFixtureTeams(item?.fixture || '') || Core.parseFixtureTeams(item?.label || '');
      if (!teams) { missing.push(Core.niceLabel(item?.label || item?.fixture || '?', 80)); continue; }
      const key = Core.normalizeTeam(teams.home) + '|' + Core.normalizeTeam(teams.away);
      if (seenFixtures.has(key)) continue; seenFixtures.add(key);
      let match = Core.bestFixtureMatch(sofaRecords, teams);
      if (!match) { if (!espnRecords) { try { espnRecords = await espnDay(day); } catch { espnRecords = []; } } match = Core.bestFixtureMatch(espnRecords, teams); }
      if (!match) { missing.push(`${teams.home} – ${teams.away}`); continue; }
      try { track({...match, date: day}); matched.push(`${match.home} – ${match.away}`); }
      catch (e) { missing.push(`${teams.home} – ${teams.away} (${e.message})`); }
    }
    return {matched, missing, snapshot: snapshot()};
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
      case 'search': return search(assertDate(message.date), message.search, ['auto', 'sofascore', 'public', 'api-football'].includes(message.source) ? message.source : 'auto');
      case 'track': track(message.match); return snapshot();
      case 'untrack': { const i = tracked.findIndex(t => t.id === String(message.id)); if (i >= 0) tracked.splice(i, 1); if (!tracked.length) stop(); return snapshot(); }
      case 'track-ticket': return trackTicket(message.items, message.date);
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
