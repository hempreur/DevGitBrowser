'use strict';
// Discord Rich Presence (v1.13) : affiche « Joue à DevGitBrowser » sur le profil
// Discord de l'utilisateur, via le canal IPC local de l'application Discord
// (tube nommé \\?\pipe\discord-ipc-N sous Windows). Rien ne passe par Internet.
const net = require('node:net');
const path = require('node:path');

const OP = {HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4};
function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8); head.writeUInt32LE(op, 0); head.writeUInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}
// Découpe un flux en trames {op, data} ; renvoie aussi le reste non consommé.
function decode(buffer) {
  const frames = []; let buf = buffer;
  while (buf.length >= 8) {
    const op = buf.readUInt32LE(0), len = buf.readUInt32LE(4);
    if (len > 1_000_000) throw new Error('Trame Discord invalide');
    if (buf.length < 8 + len) break;
    let data = null; try { data = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch {}
    frames.push({op, data}); buf = buf.subarray(8 + len);
  }
  return {frames, rest: buf};
}
function pipePath(i, platform = process.platform, env = process.env) {
  if (platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  return path.join(base, `discord-ipc-${i}`);
}
// Champs acceptés par Discord, tronqués à leurs limites (128 caractères, 2 boutons).
function cleanActivity(a) {
  if (!a) return null;
  const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  const out = {details: str(a.details, 128), state: str(a.state, 128)};
  if (Number.isFinite(a.timestamps?.start)) out.timestamps = {start: Math.floor(a.timestamps.start)};
  if (a.assets) out.assets = {large_image: str(a.assets.large_image, 256), large_text: str(a.assets.large_text, 128)};
  const buttons = (a.buttons || []).filter(b => str(b?.label, 32) && /^https:\/\//.test(String(b?.url || ''))).slice(0, 2).map(b => ({label: str(b.label, 32), url: String(b.url).slice(0, 512)}));
  if (buttons.length) out.buttons = buttons;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

class DiscordPresence {
  constructor({clientId, connect = p => net.createConnection(p), onError = () => {}, pid = process.pid, retryMs = 30_000, minIntervalMs = 5_000}) {
    this.clientId = String(clientId); this.connectFn = connect; this.onError = onError; this.pid = pid;
    this.retryMs = retryMs; this.minIntervalMs = minIntervalMs;
    this.sock = null; this.connected = false; this.wanted = null; this.sentJson = ''; this.lastSent = 0;
    this.retryTimer = null; this.flushTimer = null; this.nonce = 0; this.active = false; this.buf = Buffer.alloc(0);
  }
  setActivity(activity) {
    this.active = true;
    this.wanted = cleanActivity(activity);
    if (!this.sock) this.connect(0);
    else this.flush();
  }
  stop() {
    this.active = false; this.wanted = null;
    clearTimeout(this.retryTimer); clearTimeout(this.flushTimer); this.retryTimer = this.flushTimer = null;
    if (this.sock) {
      try { if (this.connected) this.sock.write(encode(OP.FRAME, {cmd: 'SET_ACTIVITY', args: {pid: this.pid, activity: null}, nonce: String(++this.nonce)})); } catch {}
      try { this.sock.end(); } catch {}
    }
    this.sock = null; this.connected = false; this.sentJson = '';
  }
  connect(i) {
    if (!this.active || this.sock) return;
    let sock;
    try { sock = this.connectFn(pipePath(i)); } catch (e) { this.scheduleRetry(); return; }
    this.sock = sock; this.buf = Buffer.alloc(0);
    let opened = false;
    sock.once('connect', () => { opened = true; sock.write(encode(OP.HANDSHAKE, {v: 1, client_id: this.clientId})); });
    sock.on('data', chunk => this.onData(chunk));
    sock.on('error', () => {});
    sock.once('close', () => {
      const wasSock = this.sock === sock;
      if (wasSock) { this.sock = null; this.connected = false; this.sentJson = ''; }
      if (!wasSock || !this.active) return;
      // Discord peut utiliser discord-ipc-0 à 9 : on essaie le suivant avant d'attendre.
      if (!opened && i < 9) this.connect(i + 1); else this.scheduleRetry();
    });
  }
  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.active) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(0); }, this.retryMs);
    this.retryTimer.unref?.();
  }
  onData(chunk) {
    let parsed;
    try { parsed = decode(Buffer.concat([this.buf, chunk])); } catch (e) { this.onError(e); try { this.sock?.destroy(); } catch {} return; }
    this.buf = parsed.rest;
    for (const {op, data} of parsed.frames) {
      if (op === OP.PING) { try { this.sock.write(encode(OP.PONG, data)); } catch {} }
      else if (op === OP.CLOSE) { this.onError(new Error(data?.message || 'Discord a refusé la connexion')); try { this.sock?.destroy(); } catch {} }
      else if (op === OP.FRAME && data?.evt === 'READY') { this.connected = true; this.flush(); }
      else if (op === OP.FRAME && data?.evt === 'ERROR') this.onError(new Error(data?.data?.message || 'Erreur Discord'));
    }
  }
  // Discord limite les mises à jour (5 par 20 s) : au plus une toutes les 5 s, et seulement si elle change.
  flush() {
    if (!this.connected || !this.sock) return;
    const json = JSON.stringify(this.wanted);
    if (json === this.sentJson) return;
    const wait = this.lastSent + this.minIntervalMs - Date.now();
    if (wait > 0) { if (!this.flushTimer) { this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, wait); this.flushTimer.unref?.(); } return; }
    try {
      this.sock.write(encode(OP.FRAME, {cmd: 'SET_ACTIVITY', args: {pid: this.pid, activity: this.wanted}, nonce: String(++this.nonce)}));
      this.sentJson = json; this.lastSent = Date.now();
    } catch (e) { this.onError(e); }
  }
}
module.exports = {DiscordPresence, encode, decode, pipePath, cleanActivity, OP};
