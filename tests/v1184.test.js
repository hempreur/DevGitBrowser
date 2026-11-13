const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
test('fenêtre réduite puis rétablie : la page garde sa taille et est redessinée',()=>{
  assert.match(main,/function layout\(s\) \{\r?\n\s+if \(s\.win\.isDestroyed\(\)\) return;[\s\S]{0,300}if \(s\.win\.isMinimized\(\) \|\| !s\.win\.isVisible\(\)\) return;/,'pas de redimensionnement quand la fenêtre est réduite');
  assert.match(main,/if \(w < 50 \|\| h < 50\) return;/);
  assert.match(main,/win\.on\('restore',\(\)=>\{const t=activeTab\(s\);if\(t\)syncNativeHost\(t\);refreshAfterRestore\(s\);\}\);/);
  assert.match(main,/win\.on\('show',\(\)=>\{const t=activeTab\(s\);if\(t\)syncNativeHost\(t\);refreshAfterRestore\(s\);\}\);/);
  assert.match(main,/function refreshAfterRestore\(s\) \{[\s\S]*?t\.view\.webContents\.invalidate\(\)/);
  assert.match(main,/if\(process\.platform==='win32'\)app\.commandLine\.appendSwitch\('disable-features','CalculateNativeWinOcclusion'\);/);
  assert.ok(main.indexOf("appendSwitch('disable-features'")<main.indexOf('app.requestSingleInstanceLock()'),'avant le démarrage de l’app');
});
