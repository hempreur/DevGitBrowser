'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {notesFor, buildPayload} = require('../scripts/discord-announce');

test('Discord: extrait uniquement les nouveautés de la version demandée', () => {
  const changelog = '## 1.18.2 — Exemple\n- Correctif A\n- Amélioration B\n\n## 1.18.1\n- Ancien changement';
  const notes = notesFor('1.18.2', changelog);
  assert.match(notes, /Correctif A/);
  assert.doesNotMatch(notes, /Ancien changement/);
});

test('Discord: annonce officielle sans mention de masse', () => {
  const payload = buildPayload('1.18.2', '## 1.18.2\n- Bonjour @everyone');
  assert.deepEqual(payload.allowed_mentions, {parse: []});
  assert.doesNotMatch(payload.embeds[0].description, /@everyone/);
  assert.match(payload.embeds[0].fields[0].value, /DevGitBrowser-Setup-1\.18\.2\.exe/);
});
