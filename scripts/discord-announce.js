#!/usr/bin/env node
'use strict';
// Publication Discord après la création effective d'une nouvelle GitHub Release.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const repo = 'hempreur/DevGitBrowser';

function notesFor(version, changelog) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(line => line.startsWith('## ' + version) || line.startsWith('## [' + version + ']'));
  if (start < 0) return 'Consultez le changelog complet pour découvrir les nouveautés.';
  const notes = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.trim()) notes.push(line.trim());
  }
  const clean = notes.join('\n').replace(/@/g, '@\u200b');
  return clean.slice(0, 2700) || 'Nouvelle version disponible.';
}

function buildPayload(version, changelog) {
  const tag = 'v' + version;
  const release = 'https://github.com/' + repo + '/releases/tag/' + tag;
  const installer = 'https://github.com/' + repo + '/releases/download/' + tag + '/DevGitBrowser-Setup-' + version + '.exe';
  return {
    username: 'DevGitBrowser • Releases',
    allowed_mentions: {parse: []},
    embeds: [{
      title: '🚀 DevGitBrowser ' + version + ' est disponible !',
      url: release,
      description: notesFor(version, changelog),
      color: 8019199,
      fields: [
        {name: '⬇️ Télécharger pour Windows', value: '[Télécharger DevGitBrowser](' + installer + ')', inline: false},
        {name: '📋 Release officielle', value: '[Détails et changelog](' + release + ')', inline: true},
        {name: '🌐 Site officiel', value: '[DevGitBrowser](https://hempreur.github.io/DevGitBrowser/)', inline: true}
      ],
      footer: {text: 'CodexHempreur INC • Annonce GitHub Releases'}
    }]
  };
}

async function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const tag = 'v' + version;
  if (process.argv[2] !== tag) throw new Error('Tag de release inattendu : ' + process.argv[2]);
  const webhook = process.env.DISCORD_WEBHOOK_RELEASES;
  if (!webhook) {
    console.log('Secret DISCORD_WEBHOOK_RELEASES absent : annonce ignorée.');
    return;
  }
  const url = new URL(webhook);
  if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) ||
      !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(url.pathname)) {
    throw new Error('URL du webhook Discord invalide.');
  }
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const response = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(buildPayload(version, changelog)),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Discord HTTP ' + response.status);
  console.log('Annonce Discord publiée pour ' + tag);
}

if (require.main === module) {
  main().catch(err => {console.error(err.message); process.exitCode = 1;});
}
module.exports = {notesFor, buildPayload};
