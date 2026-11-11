'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

test('Brand asset references point to bundled files', () => {
  assert.equal(pkg.productName, 'DevGitBrowser');
  assert.equal(pkg.build.win.icon, 'assets/icon.ico');
  for (const key of ['installerIcon','uninstallerIcon','installerHeaderIcon']) {
    assert.equal(pkg.build.nsis[key], 'assets/icon.ico');
  }
  for (const name of ['icon.ico','icon.png','logo-mark.png','brand-source.png']) {
    assert.ok(fs.statSync(path.join(root,'assets',name)).size > 500);
  }
});

test('Brand icon is shown in the application interface', () => {
  const html = fs.readFileSync(path.join(root,'ui','index.html'),'utf8');
  assert.match(html, /brand-image[^>]+logo-mark\.png/);
  assert.match(html, /class="hp-brand"><img src="\.\.\/assets\/logo-mark\.png"/);
  assert.match(html, /By CodexHempreur/);
  assert.doesNotMatch(html, /By Hempreur</);
  assert.match(fs.readFileSync(path.join(root,'main.js'),'utf8'), /assets','icon\.png'/);
});
