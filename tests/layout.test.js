'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('One scroll container, no left navigation rail', () => {
  const html=read('ui/index.html');
  const css=read('ui/style.css');
  const renderer=read('ui/renderer.js');
  assert.doesNotMatch(html,/class="left-rail"/);
  assert.doesNotMatch(renderer,/\$\('rail-/);
  assert.match(css,/html,body\{height:100%;width:100%;overflow:hidden;\}/);
  assert.match(css,/\.welcome,\.panel\{left:0!important;right:0!important;overflow-x:hidden;overflow-y:auto;/);
  assert.match(read('main.js'),/const RAIL_WIDTH = 0;/);
});
test('Footer signature uses the same professional font as the status bar brand', () => {
  assert.match(read('ui/index.html'),/class="signature">By <b>CodexHempreur<\/b><\/span>/);
  assert.match(read('ui/style.css'),/\.statusbar \.signature\{font-family:Inter,'Segoe UI',Arial,sans-serif!important;font-style:normal!important/);
  assert.equal(require('../package.json').version,'1.7.0');
});
