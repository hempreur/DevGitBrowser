'use strict';
// Journal local (userData/logs) : erreurs du navigateur pour le diagnostic.
// Aucune donnée n'est envoyée ; les adresses et jetons sont tronqués/masqués.
const fs = require('node:fs');
const path = require('node:path');
let file = '';
const MAX = 1024 * 1024;
function redact(text) {
  return String(text).replace(/(gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g, '$1***').replace(/([?&](?:token|key|sig|password|pass|auth)=)[^&\s]+/gi, '$1***');
}
function init(folder) {
  try {
    fs.mkdirSync(folder, {recursive: true});
    file = path.join(folder, 'devgitbrowser.log');
    if (fs.existsSync(file) && fs.statSync(file).size > MAX) fs.renameSync(file, file + '.1');
  } catch { file = ''; }
  return file;
}
function write(level, ...parts) {
  const line = `${new Date().toISOString()} [${level}] ${redact(parts.map(p => p instanceof Error ? (p.stack || p.message) : typeof p === 'string' ? p : JSON.stringify(p)).join(' ')).slice(0, 4000)}\n`;
  if (file) { try { fs.appendFileSync(file, line); } catch {} }
  if (level === 'ERROR' && !process.env.DGB_QUIET) process.stderr.write(line);
}
module.exports = {init, path: () => file, info: (...a) => write('INFO', ...a), warn: (...a) => write('WARN', ...a), error: (...a) => write('ERROR', ...a), redact};
