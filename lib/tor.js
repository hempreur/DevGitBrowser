'use strict';
// DevGit VPN : le trafic du navigateur passe par le réseau Tor (gratuit, chiffré
// en trois sauts, adresse IP masquée). Le choix d'un pays de sortie permet
// d'accéder aux contenus réservés à ce pays. Ne concerne que DevGitBrowser
// (comme le « VPN » d'Opera), pas les autres applications de Windows.
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const COUNTRIES = Object.freeze([
  {code: '', name: 'Automatique (le plus rapide)'}, {code: 'fr', name: 'France'}, {code: 'de', name: 'Allemagne'},
  {code: 'nl', name: 'Pays-Bas'}, {code: 'ch', name: 'Suisse'}, {code: 'be', name: 'Belgique'}, {code: 'gb', name: 'Royaume-Uni'},
  {code: 'se', name: 'Suède'}, {code: 'no', name: 'Norvège'}, {code: 'fi', name: 'Finlande'}, {code: 'at', name: 'Autriche'},
  {code: 'es', name: 'Espagne'}, {code: 'it', name: 'Italie'}, {code: 'pl', name: 'Pologne'}, {code: 'ro', name: 'Roumanie'},
  {code: 'us', name: 'États-Unis'}, {code: 'ca', name: 'Canada'}, {code: 'jp', name: 'Japon'}, {code: 'sg', name: 'Singapour'},
  {code: 'au', name: 'Australie'}, {code: 'br', name: 'Brésil'}
]);
const BOOTSTRAP_TIMEOUT_MS = 120_000;

function validCountry(code) { return COUNTRIES.some(c => c.code === code); }
function parseBootstrap(line) {
  const m = String(line).match(/Bootstrapped (\d{1,3})%(?:\s*\(([^)]+)\))?(?::\s*(.*))?/);
  return m ? {progress: Math.min(100, Number(m[1])), step: (m[3] || m[2] || '').trim()} : null;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const {port} = srv.address(); srv.close(() => resolve(port)); });
  });
}
function torArgs({socksPort, controlPort, dataDir, geoip, geoip6, country}) {
  const args = ['--SocksPort', `127.0.0.1:${socksPort} IsolateSOCKSAuth`, '--ControlPort', `127.0.0.1:${controlPort}`,
    '--CookieAuthentication', '1', '--DataDirectory', dataDir, '--ClientOnly', '1', '--AvoidDiskWrites', '1',
    '--Log', 'notice stdout', '--SafeSocks', '0', '--DisableNetwork', '0'];
  if (geoip && fs.existsSync(geoip)) args.push('--GeoIPFile', geoip);
  if (geoip6 && fs.existsSync(geoip6)) args.push('--GeoIPv6File', geoip6);
  if (country) args.push('--ExitNodes', `{${country}}`, '--StrictNodes', '1');
  return args;
}

class TorService {
  constructor({torDir, dataDir, onState = () => {}, applyProxy = async () => {}, restoreProxy = async () => {}, spawnImpl = spawn}) {
    this.torDir = torDir; this.dataDir = dataDir; this.onState = onState;
    this.applyProxy = applyProxy; this.restoreProxy = restoreProxy; this.spawnImpl = spawnImpl;
    this.child = null; this.timer = null;
    this.state = {status: 'off', progress: 0, step: '', country: '', error: '', available: this.available(), since: null};
  }
  binary() {
    const exe = process.platform === 'win32' ? 'tor.exe' : 'tor';
    for (const candidate of [path.join(this.torDir, 'tor', exe), path.join(this.torDir, exe)]) if (fs.existsSync(candidate)) return candidate;
    return process.platform === 'win32' ? '' : (fs.existsSync('/usr/bin/tor') ? '/usr/bin/tor' : '');
  }
  available() { return Boolean(this.binary()); }
  set(patch) { this.state = {...this.state, ...patch}; try { this.onState(this.state); } catch {} }
  async start(country = '') {
    if (!validCountry(country)) throw new Error('Pays de sortie inconnu.');
    if (this.child) await this.stop(false);
    const bin = this.binary();
    if (!bin) { this.set({status: 'error', error: 'Composant VPN (Tor) absent de cette installation.', available: false}); throw new Error(this.state.error); }
    fs.mkdirSync(this.dataDir, {recursive: true, mode: 0o700});
    const [socksPort, controlPort] = [await freePort(), await freePort()];
    this.socksPort = socksPort; this.controlPort = controlPort;
    const dataRoot = path.join(this.torDir, 'data');
    const args = torArgs({socksPort, controlPort, dataDir: this.dataDir, geoip: path.join(dataRoot, 'geoip'), geoip6: path.join(dataRoot, 'geoip6'), country});
    this.set({status: 'starting', progress: 0, step: 'démarrage', country, error: '', since: null});
    const child = this.spawnImpl(bin, args, {cwd: path.dirname(bin), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    this.child = child;
    return new Promise((resolve, reject) => {
      let settled = false, buffer = '';
      const fail = message => {
        if (settled) return; settled = true;
        clearTimeout(this.timer);
        this.stop(false).catch(() => {});
        this.set({status: 'error', error: message});
        reject(new Error(message));
      };
      this.timer = setTimeout(() => fail('Connexion au réseau VPN trop longue. Vérifie ta connexion ou choisis un autre pays.'), BOOTSTRAP_TIMEOUT_MS);
      child.on('error', err => fail('Impossible de lancer le VPN : ' + err.message));
      child.on('exit', code => {
        if (this.child === child) this.child = null;
        if (!settled) fail(`Le VPN s’est arrêté (code ${code}).`);
        else if (this.state.status === 'on') { this.restoreProxy().catch(() => {}); this.set({status: 'error', error: 'Le VPN s’est arrêté de façon inattendue. Connexion directe rétablie.'}); }
      });
      child.stdout.on('data', chunk => {
        buffer = (buffer + chunk).slice(-4000);
        const lines = buffer.split(/\r?\n/); buffer = lines.pop();
        for (const line of lines) {
          const b = parseBootstrap(line);
          if (b && !settled) {
            this.set({progress: b.progress, step: b.step});
            if (b.progress >= 100) {
              settled = true; clearTimeout(this.timer);
              this.applyProxy(`socks5://127.0.0.1:${socksPort}`).then(() => {
                this.set({status: 'on', since: Date.now()}); resolve(this.state);
              }, err => { settled = false; fail('Proxy VPN impossible : ' + err.message); });
            }
          }
          if (/\[err\]/.test(line) && !settled && /Could not bind|Failed to parse|No such|StrictNodes/i.test(line)) fail('Erreur du VPN : ' + line.replace(/^.*\[err\]\s*/, '').slice(0, 160));
        }
      });
      child.stderr.on('data', () => {});
    });
  }
  async stop(restore = true) {
    clearTimeout(this.timer);
    const child = this.child; this.child = null;
    if (child && !child.killed) { try { child.kill(); } catch {} }
    if (restore) { await this.restoreProxy(); this.set({status: 'off', progress: 0, step: '', error: '', since: null}); }
  }
  // Nouveau circuit = nouvelle adresse IP de sortie (commande NEWNYM de Tor).
  newIdentity() {
    if (this.state.status !== 'on') return Promise.reject(new Error('Le VPN n’est pas connecté.'));
    return new Promise((resolve, reject) => {
      let cookie;
      try { cookie = fs.readFileSync(path.join(this.dataDir, 'control_auth_cookie')).toString('hex'); }
      catch { reject(new Error('Authentification du VPN indisponible.')); return; }
      const socket = net.connect(this.controlPort, '127.0.0.1');
      let reply = '';
      socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('Le VPN ne répond pas.')); });
      socket.on('error', reject);
      socket.on('data', d => {
        reply += d;
        if ((reply.match(/^250 /gm) || []).length >= 2) { socket.end('QUIT\r\n'); resolve(true); }
        else if (/^5\d\d /m.test(reply)) { socket.destroy(); reject(new Error('Refus du VPN : ' + reply.trim().slice(0, 80))); }
      });
      socket.write(`AUTHENTICATE ${cookie}\r\nSIGNAL NEWNYM\r\n`);
    });
  }
}
module.exports = {TorService, COUNTRIES, parseBootstrap, torArgs, validCountry, freePort};
