'use strict';
// Le mode « dossier » d'electron-builder (--dir) n'écrit pas app-update.yml :
// sans lui, electron-updater ne trouve plus les mises à jour. On le génère ici
// à partir de build.publish, à l'identique de ce que fait la cible NSIS.
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const publish = [].concat(pkg.build.publish || [])[0];
if (!publish || publish.provider !== 'github' || !publish.owner || !publish.repo) throw new Error('build.publish (github) manquant dans package.json.');
const resources = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources');
if (!fs.existsSync(resources)) throw new Error('dist/win-unpacked/resources absent : lancer d’abord electron-builder --dir.');
const yml = `owner: ${publish.owner}\nrepo: ${publish.repo}\nprovider: github\nupdaterCacheDirName: ${String(pkg.name).toLowerCase()}-updater\n`;
fs.writeFileSync(path.join(resources, 'app-update.yml'), yml);
console.log('OK — app-update.yml écrit dans le paquet Windows :\n' + yml);
