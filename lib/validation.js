'use strict';

const DEFAULT_PROXY = Object.freeze({ mode: 'system', type: 'socks5', host: '', port: '' });

function normalizeAddress(input) {
  if (typeof input !== 'string') throw new Error('Adresse invalide.');
  const text = input.trim();
  if (!text) return null;
  if (text.length > 2048) throw new Error('Adresse trop longue.');

  let candidate;
  if (/^https?:\/\//i.test(text)) {
    candidate = text;
  } else if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(text)) {
    candidate = `http://${text}`;
  } else if (!/\s/.test(text) && /^(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(text)) {
    candidate = `https://${text}`;
  } else {
    // Unknown protocols (file:, javascript:, data:, etc.) cannot be navigated to.
    if (/^[a-z][a-z\d+.-]*:/i.test(text)) {
      throw new Error('Seules les adresses http:// et https:// sont autorisées.');
    }
    return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
  }
  let url;
  try { url = new URL(candidate); } catch { throw new Error('Adresse web invalide.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protocole non autorisé.');
  if (url.username || url.password) throw new Error('Les identifiants dans les URL sont refusés.');
  return url.href;
}

function isWebUrl(raw) {
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch { return false; }
}

function normalizeProxy(value) {
  if (!value || typeof value !== 'object') throw new Error('Configuration proxy invalide.');
  const mode = String(value.mode || 'system');
  if (mode === 'system' || mode === 'direct') {
    return { mode, type: 'socks5', host: '', port: '' };
  }
  if (mode !== 'proxy') throw new Error('Mode de connexion inconnu.');
  const type = String(value.type || '').toLowerCase();
  if (!['http', 'socks5'].includes(type)) throw new Error('Type de proxy invalide.');
  const host = String(value.host || '').trim();
  const port = Number(value.port);
  if (!/^[a-z\d.-]{1,253}$/i.test(host) || host.startsWith('-') || host.endsWith('-') || host.includes('..')) {
    throw new Error('Nom d’hôte proxy invalide (ex. 127.0.0.1).');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port proxy invalide (1 à 65535).');
  return { mode: 'proxy', type, host, port: String(port) };
}

function proxyForElectron(proxy) {
  if (proxy.mode === 'system') return { mode: 'system' };
  if (proxy.mode === 'direct') return { mode: 'direct' };
  return { mode: 'fixed_servers', proxyRules: `${proxy.type}://${proxy.host}:${proxy.port}` };
}

module.exports = { DEFAULT_PROXY, normalizeAddress, isWebUrl, normalizeProxy, proxyForElectron };
