'use strict';
const api=window.DevGit;
const $=id=>document.getElementById(id);
const TAB_MIME='application/x-devgit-tab';
let current=null, panel='', toastTimer, statusTimer, libraryView='history', historyOffset=0, historyQuery='', suggestTimer, draggingTabId=null, draggingBookmark=null;
const panels=['github','extensions','security','settings','library','about','passwords','tasks','welcome','xgate','admin','trackers','achievements'];
const DEFAULT_STATUS='Navigateur indépendant · Profil local isolé';

// ---------------------------------------------------------------- Messages
function notify(message, bad=false){
  const text=String(message||'');
  // La barre d'état reste visible au-dessus des pages web ; la bulle ne l'est
  // que lorsque l'accueil ou un panneau est affiché.
  const status=$('status-message');
  status.textContent=text;status.classList.toggle('flash',!bad);status.classList.toggle('flash-bad',bad);
  clearTimeout(statusTimer);statusTimer=setTimeout(()=>{status.textContent=DEFAULT_STATUS;status.classList.remove('flash','flash-bad');},6000);
  const pageVisible=Boolean(activeTab()?.url) && !panel;
  if(pageVisible)return;
  const el=$('toast');el.textContent=text;el.classList.toggle('error',bad);el.classList.remove('hidden');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),4500);
}
async function run(fn, success=''){
  try{const result=await fn();if(success)notify(success);return result;}
  catch(err){notify(String(err?.message||err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''),true);return null;}
}
function elem(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function activeTab(){return current?.tabs.find(x=>x.id===current.activeId)||null;}
function hostOf(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return url||'';}}
function letterIcon(title,url){const span=elem('span','letter-icon',(hostOf(url)||title||'?').slice(0,1).toUpperCase());return span;}
function favicon(url,title,src){
  if(src && /^(https:|data:image\/)/.test(src)){
    const img=elem('img','fav');img.src=src;img.alt='';img.referrerPolicy='no-referrer';img.draggable=false;
    img.addEventListener('error',()=>img.replaceWith(letterIcon(title,url)),{once:true});return img;
  }
  return letterIcon(title,url);
}

// ---------------------------------------------------------------- Panneaux
async function showPanel(name){
  if(panel==='admin'&&name!=='admin')api.adminClose().catch(()=>{});
  panel=name||'';
  for(const key of panels)$(`panel-${key}`).classList.toggle('hidden',key!==panel);
  if(panel)closeFind(false);
  await api.panel(Boolean(panel));
  if(panel==='library')loadLibrary();
  if(panel==='about')loadAbout();
  if(panel==='extensions')loadStore(false);
  if(panel==='passwords'){loadVault();if($('profiles-card').open)loadProfiles();}
  if(panel==='settings')renderImportSources('settings-import');
  if(panel==='tasks')startPerf();else stopPerf();
  if(panel==='trackers')loadTrackers();
  if(panel==='achievements')loadAchievements();
  if(panel && current)render(current);
}
function openLibrary(view){libraryView=view;return showPanel('library');}

// ---------------------------------------------------------------- Hauteur de l'en-tête
const chromeEl=$('chrome');
function reportChromeHeight(){
  const height=Math.ceil(chromeEl.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--chrome-h',height+'px');
  api.chromeHeight(height).catch(()=>{});
}
new ResizeObserver(reportChromeHeight).observe(chromeEl);

// ---------------------------------------------------------------- Onglets
function tabInsertIndex(clientX){
  const nodes=[...$('tabs').querySelectorAll('.tab')].filter(n=>Number(n.dataset.id)!==draggingTabId);
  let index=nodes.length;
  for(let i=0;i<nodes.length;i++){const r=nodes[i].getBoundingClientRect();if(clientX<r.left+r.width/2){index=i;break;}}
  return {index,nodes};
}
function showDropMarker(clientX){
  const {index,nodes}=tabInsertIndex(clientX);
  const marker=$('tabs').querySelector('.drop-marker')||elem('i','drop-marker');
  const strip=$('tabs').getBoundingClientRect();
  const ref=nodes[index]?nodes[index].getBoundingClientRect().left:(nodes.at(-1)?.getBoundingClientRect().right??strip.left);
  marker.style.left=(ref-strip.left-2)+'px';
  if(!marker.parentNode)$('tabs').append(marker);
  return index;
}
function clearDropMarker(){$('tabs').querySelector('.drop-marker')?.remove();}
function draggedTabFrom(event){
  try{const raw=event.dataTransfer.getData(TAB_MIME);if(raw)return JSON.parse(raw);}catch{}
  return null;
}
function hasTabDrag(event){return [...(event.dataTransfer?.types||[])].includes(TAB_MIME) || draggingTabId!==null;}
function setupTabDropZone(zone){
  zone.addEventListener('dragover',event=>{
    if(!hasTabDrag(event))return;
    event.preventDefault();event.dataTransfer.dropEffect='move';showDropMarker(event.clientX);
  });
  zone.addEventListener('dragleave',event=>{if(!zone.contains(event.relatedTarget))clearDropMarker();});
  zone.addEventListener('drop',event=>{
    if(!hasTabDrag(event))return;
    event.preventDefault();
    const {index}=tabInsertIndex(event.clientX);clearDropMarker();
    const info=draggedTabFrom(event);
    if(info && info.windowId===current?.windowId)run(()=>api.moveTab(info.id,index));
    else run(()=>api.attachTab(info?info.id:null,index));
  });
}
setupTabDropZone($('tabs'));setupTabDropZone($('tab-drop-space'));
function updateTabs(state){
  const host=$('tabs');
  const nodes=[];
  for(const tab of state.tabs){
    const b=elem('div','tab'+(tab.id===state.activeId?' active':'')+(tab.loading?' loading':'')+(tab.private?' private':''));
    b.dataset.id=tab.id;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(tab.id===state.activeId));b.draggable=true;
    b.title=(tab.private?'🕶 Onglet privé sous VPN · rien n’est conservé\n':'')+(tab.title||'Nouvel onglet')+(tab.url?'\n'+tab.url:'');
    const icon=tab.loading?elem('span','tab-spinner'):tab.url?favicon(tab.url,tab.title,tab.favicon):elem('span','tab-home','✦');
    const label=elem('span','tab-title',tab.title||'Nouvel onglet');
    b.append(icon,label);
    if(tab.private)b.append(elem('span','tab-private','🕶'));
    if(tab.engine==='mshtml')b.append(elem('span','tab-badge','IE'));
    if(tab.audible||tab.muted){
      const audio=elem('button','tab-audio'+(tab.muted?' muted':''),tab.muted?'🔇':'🔊');audio.type='button';audio.title=tab.muted?'Réactiver le son':'Couper le son';
      audio.addEventListener('click',event=>{event.stopPropagation();run(()=>api.muteTab(tab.id));});
      b.append(audio);
    }
    const x=elem('button','tab-x','×');x.type='button';x.title='Fermer (Ctrl+W)';
    x.addEventListener('click',event=>{event.stopPropagation();run(()=>api.closeTab(tab.id));});
    b.append(x);
    b.addEventListener('click',()=>{if(tab.id!==current?.activeId)run(async()=>{if(panel)await showPanel('');return api.selectTab(tab.id);});else if(panel)showPanel('');});
    b.addEventListener('auxclick',event=>{if(event.button===1){event.preventDefault();run(()=>api.closeTab(tab.id));}});
    b.addEventListener('contextmenu',event=>{event.preventDefault();run(()=>api.tabContext(tab.id));});
    b.addEventListener('dragstart',event=>{
      draggingTabId=tab.id;b.classList.add('dragging');
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData(TAB_MIME,JSON.stringify({id:tab.id,windowId:state.windowId}));
      if(tab.url)event.dataTransfer.setData('text/uri-list',tab.url);
      api.dragStart(tab.id).catch(()=>{});
    });
    b.addEventListener('dragend',()=>{
      b.classList.remove('dragging');clearDropMarker();
      const id=draggingTabId;draggingTabId=null;
      // Le processus principal vérifie où le curseur a été relâché :
      // hors de toute fenêtre → nouvelle fenêtre ; sur une autre → rattachement.
      api.dragEnd(id).catch(()=>{});
    });
    nodes.push(b);
  }
  host.replaceChildren(...nodes);
  host.classList.toggle('crowded',state.tabs.length>8);
}

// ---------------------------------------------------------------- Barre d'outils
function updateToolbar(state){
  const t=activeTab();
  const address=$('address');
  if(document.activeElement!==address)address.value=t?.url||'';
  $('back').disabled=!t?.back;$('forward').disabled=!t?.forward;
  $('reload').classList.toggle('is-loading',Boolean(t?.loading));
  $('reload').title=t?.loading?'Arrêter le chargement':'Actualiser (F5)';
  const hasPage=Boolean(t?.url);
  $('welcome').classList.toggle('hidden',hasPage||Boolean(state.xmode));
  $('x-home').classList.toggle('hidden',hasPage||!state.xmode);
  const secure=hasPage && t.url.startsWith('https://') && !t.error;
  const info=$('site-info');
  info.classList.toggle('secure',secure);info.classList.toggle('insecure',hasPage && !secure);info.classList.toggle('empty',!hasPage);
  info.title=!hasPage?'Saisis une adresse ou une recherche':secure?'Connexion chiffrée (HTTPS) — autorisations du site':'Connexion non chiffrée ou erreur — tes données peuvent être lues';
  $('engine-badge').classList.toggle('hidden',t?.engine!=='mshtml');
  const star=$('bookmark-star');
  star.disabled=!hasPage;star.classList.toggle('on',Boolean(state.bookmarkedHere));
  star.title=state.bookmarkedHere?'Retirer des favoris (Ctrl+D)':'Ajouter aux favoris (Ctrl+D)';
  const sh=state.shieldHere||{}, guard=state.adblock||{};
  const shieldOn=guard.enabled && !sh.allowed;
  $('shield-button').classList.toggle('off',!shieldOn);
  $('shield-count').textContent=sh.blocked>999?'999+':String(sh.blocked||0);
  $('shield-count').classList.toggle('hidden',!shieldOn || !sh.blocked);
  $('shield-button').title=!guard.enabled?'DevGitShield désactivé':sh.allowed?`DevGitShield en pause sur ${sh.host}`:`DevGitShield : ${sh.blocked||0} élément(s) bloqué(s) sur cette page`;
  const exts=state.extensions||[];
  $('extension-counter').textContent=String(exts.length);
  $('extension-counter').classList.toggle('hidden',exts.length<2&&!exts.some(e=>e.error));
  $('extensions-button').classList.toggle('attention',exts.some(e=>e.error));
  const legacy=state.legacyHere||{};
  const showIE=state.platform==='win32' && hasPage && (legacy.likely||legacy.trusted||legacy.engine!=='chromium');
  $('legacy-button').classList.toggle('hidden',!showIE);
  $('legacy-button').textContent=legacy.engine==='mshtml-pending'?'IE …':legacy.engine==='mshtml'?'IE ✓':'IE';
  $('legacy-button').classList.toggle('attention',legacy.engine!=='chromium'||legacy.likely);
  $('legacy-button').title=legacy.engine==='mshtml'?'Revenir au moteur moderne':legacy.engine==='mshtml-pending'?'Annuler le chargement IE':'Ancienne page détectée : ouvrir dans le moteur IE intégré';
  const upd=state.update||{};
  $('menu-dot').classList.toggle('hidden',upd.status!=='downloaded');
  const banner=$('update-banner');
  const showBanner=upd.status==='downloaded' && !banner.dataset.dismissed;
  banner.classList.toggle('hidden',!showBanner);
  if(showBanner)$('update-text').textContent=`DevGitBrowser ${upd.version} est prêt à être installé.`;
}
function updateBookmarksBar(state){
  const bar=$('bookmarks-bar');
  const show=state.preferences?.showBookmarksBar!==false;
  bar.classList.toggle('hidden',!show);
  if(!show)return;
  const items=(state.bookmarks||[]).map((b,i)=>{
    const chip=elem('button','bm-chip');chip.type='button';chip.title=b.title+'\n'+b.url;chip.draggable=true;
    chip.append(letterIcon(b.title,b.url),elem('span','',b.title));
    chip.addEventListener('click',event=>run(()=>api.openLink(b.url,event.ctrlKey||event.metaKey?'tab':'current')));
    chip.addEventListener('auxclick',event=>{if(event.button===1){event.preventDefault();run(()=>api.openLink(b.url,'tab'));}});
    chip.addEventListener('contextmenu',event=>{event.preventDefault();run(()=>api.bookmarkContext(b.id));});
    chip.addEventListener('dragstart',event=>{draggingBookmark=b.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/uri-list',b.url);});
    chip.addEventListener('dragend',()=>{draggingBookmark=null;});
    chip.addEventListener('dragover',event=>{if(draggingBookmark){event.preventDefault();}});
    chip.addEventListener('drop',event=>{if(draggingBookmark&&draggingBookmark!==b.id){event.preventDefault();run(()=>api.moveBookmark(draggingBookmark,i));}});
    return chip;
  });
  if(!items.length){
    const hint=elem('span','bm-hint','Clique sur ☆ dans la barre d’adresse (ou Ctrl+D) pour ajouter des favoris ici.');
    items.push(hint);
  }
  const all=elem('button','bm-all','Tous les favoris');all.type='button';all.addEventListener('click',()=>openLibrary('bookmarks'));
  bar.replaceChildren(...items,all);
}
function updateHome(state){
  const host=$('home-sites');
  const seen=new Set();const list=[];
  for(const b of state.bookmarks||[]){if(list.length<8&&!seen.has(b.url)){seen.add(b.url);list.push({...b,kind:'★'});}}
  for(const s of state.topSites||[]){if(list.length<8&&!seen.has(hostOf(s.url))&&![...seen].some(u=>hostOf(u)===hostOf(s.url))){seen.add(s.url);list.push({...s,kind:''});}}
  $('home-sites-section').classList.toggle('hidden',!list.length);
  host.replaceChildren(...list.map(item=>{
    const tile=elem('button','site-tile');tile.type='button';tile.title=item.url;
    tile.append(letterIcon(item.title,item.url),elem('strong','',item.title||hostOf(item.url)),elem('small','',(item.kind?item.kind+' ':'')+hostOf(item.url)));
    tile.addEventListener('click',event=>run(()=>api.openLink(item.url,event.ctrlKey?'tab':'current')));
    return tile;
  }));
}

// ---------------------------------------------------------------- Sécurité
function updateSecurity(state){
  const hasSite=Boolean(state.currentOrigin);
  const guard=state.adblock||{enabled:true,ready:false,quality:'initialisation'};
  $('adblock-enabled').checked=guard.enabled;
  $('adblock-refresh').disabled=Boolean(guard.updating);
  const updated=guard.lastUpdated?' · listes du '+new Date(guard.lastUpdated).toLocaleString(uiLocale(),{dateStyle:'short',timeStyle:'short'}):'';
  $('adblock-status').textContent=(guard.enabled?'Activé':'Désactivé')+' · '+String(guard.quality||'initialisation')+updated+(guard.updating?' · mise à jour…':'')+(guard.error?' · '+guard.error:'')+(guard.totalBlocked?` · ${guard.totalBlocked} requêtes bloquées depuis le démarrage`:'');
  const sh=state.shieldHere||{};
  $('adblock-site').disabled=!sh.host||!guard.enabled;
  $('adblock-site').checked=!sh.allowed;
  $('adblock-site-label').textContent=sh.host?`${sh.host} · ${sh.allowed?'en pause : aucun filtrage sur ce site.':'protégé. Désactive uniquement si le site ne fonctionne pas correctement.'}`:'Ouvre un site pour régler sa protection.';
  const allow=$('adblock-allowlist');
  const hosts=guard.allowlist||[];
  allow.replaceChildren(...(hosts.length?hosts.map(host=>{
    const chip=elem('span','chip',host);const x=elem('button','chip-x','×');x.type='button';x.title='Réactiver la protection';
    x.addEventListener('click',()=>run(()=>api.adblockRemove(host),`DevGitShield réactivé sur ${host}.`));chip.append(x);return chip;
  }):[elem('span','muted','Aucun site en pause.')]));
  $('origin-label').textContent=state.currentOrigin||'Ouvrir un site HTTPS';
  $('popup-mode').disabled=!hasSite;
  $('popup-mode').value=state.popupOverrideHere;
  $('popup-topmost').disabled=!hasSite; $('popup-topmost').value=state.popupTopmostOverride||'default';
  $('popup-effective').textContent=state.popupModeHere==='allow'
    ?(state.popupDefaultBabel?'✓ BabelVisio : pop-ups vidéo autorisés automatiquement, avec filtre anti-abus.':'✓ Pop-ups autorisés pour ce site, avec filtre anti-abus.')
    :'● Fenêtres pop-up bloquées pour ce site. Les liens « nouvel onglet » restent ouverts dans un onglet.';
  for(const key of ['camera','microphone','notifications','geolocation']){
    const el=$(`site-${key}`);el.disabled=!hasSite;el.value=state.privacyHere[key];
  }
  $('reset-site').disabled=!hasSite;
  $('popup-blocked-count').textContent=String(state.blockedPopups);
  $('camera-status').textContent='Caméra : '+(state.mediaHere.camera?'autorisée':'demande requise ou bloquée');
  $('mic-status').textContent='Micro : '+(state.mediaHere.microphone?'autorisé':'demande requise ou bloqué');
  const h=state.legacyHere||{likely:false,hints:[]};
  const inIE=h.engine==='mshtml', pendingIE=h.engine==='mshtml-pending';
  $('legacy-line').classList.toggle('hidden',state.platform!=='win32');
  $('legacy-status').textContent=pendingIE?'Chargement du moteur historique Windows dans cet onglet…':h.error?'Échec IE : '+h.error:inIE?'Mode IE/MSHTML intégré dans cet onglet — rechargement automatique pour ce site : activé.':
    h.trusted?'Site déjà approuvé : mode IE automatique au prochain chargement.':
    h.likely?'⚠ Ancienne structure détectée : '+(h.hints||[]).join(' · ')+'.':
    'Pour les anciens sites ActiveX/VBScript uniquement. Ton choix est mémorisé par site ; webcams et sites modernes restent dans Chromium.';
  if((inIE||pendingIE)&&h.pluginDiagnostic) $('legacy-status').textContent+=' · '+h.pluginDiagnostic;
  else if((inIE||pendingIE)&&h.hostBits) $('legacy-status').textContent+=' · Processus IE '+h.hostBits;
  $('settings-legacy').textContent=inIE||pendingIE?'Revenir à Chromium':'Activer pour ce site';
  $('settings-legacy').disabled=!activeTab()?.url;
}
function updateGithub(state){
  const g=state.github;
  $('git-connected').textContent=g.connected?
    `✓ Connecté à @${g.user} · ${g.repo?`Dépôt privé : ${g.repo} (${g.branch})`:'Aucun dépôt sélectionné'}` :
    '◌ Aucun compte GitHub connecté. Aucun dépôt accessible.';
  $('github-sync').disabled=!g.connected||!g.repo||g.syncing;
  $('extension-sync').disabled=!g.connected||!g.repo||g.syncing;
  if(g.repo && document.activeElement!==$('github-repo'))$('github-repo').value=g.repo;
  if(g.branch && document.activeElement!==$('github-branch'))$('github-branch').value=g.branch;
  const label=g.syncing?'Synchronisation en cours…':g.lastError?`Dernière erreur : ${g.lastError}`:g.lastSync?`Dernière synchronisation : ${new Date(g.lastSync).toLocaleTimeString(uiLocale())}`:'';
  if(label)$('git-connected').textContent+=' · '+label;
  const list=$('extension-list');list.replaceChildren();
  const exts=state.extensions||[];
  $('extension-total').textContent=String(exts.length);
  if(!exts.length){list.append(elem('div','empty-list','Aucune extension chargée.'));}
  for(const ext of exts){
    const item=elem('div','extension-row');const ico=elem('span','extension-ico',ext.source==='included'?'⚡':ext.source==='store'?'🧩':'▦');
    const detail=elem('div','ext-detail');detail.append(elem('strong','',ext.name||ext.key),elem('small','',ext.source==='included'?`Officielle · fournie avec le navigateur · ${ext.version||'version inconnue'}`:ext.source==='store'?`DevGit Store · ${ext.version||'version inconnue'} · mises à jour automatiques`:`Dépôt GitHub privé · extensions/${ext.key} · ${ext.version||'version inconnue'}`));
    if(ext.error)detail.append(elem('small','error-message',ext.error));
    const stateLabel=elem('span',ext.loaded?'ext-ok':'ext-bad',ext.loaded?(ext.source==='included'?'INCLUSE':ext.source==='store'?'INSTALLÉE':'CHARGÉE'):'ERREUR');
    item.append(ico,detail,stateLabel);list.append(item);
  }
}
function updateProxy(state){
  const p=state.proxy;
  if(document.activeElement!==$('proxy-mode'))$('proxy-mode').value=p.mode;
  if(document.activeElement!==$('proxy-type'))$('proxy-type').value=p.type||'socks5';
  if(document.activeElement!==$('proxy-host'))$('proxy-host').value=p.host||'';
  if(document.activeElement!==$('proxy-port'))$('proxy-port').value=p.port||'';
  $('proxy-extra').classList.toggle('hidden',$('proxy-mode').value!=='proxy');
}
function updateSettings(state){
  if(document.activeElement!==$('performance-mode'))$('performance-mode').value=state.performance.mode;
  $('hardware-acceleration').checked=state.performance.hardwareAcceleration;
  $('downloads-folder').textContent=state.downloads.folder;
  $('downloads-ask').checked=state.downloads.askEachTime!==false;
  const prefs=state.preferences||{};
  for(const input of document.querySelectorAll('[data-pref]'))input.checked=Boolean(prefs[input.dataset.pref]);
  const engine=$('search-engine');
  if(!engine.options.length)for(const e of state.searchEngines||[]){const o=elem('option','',e.name);o.value=e.id;engine.append(o);}
  if(document.activeElement!==engine)engine.value=prefs.searchEngine||'duckduckgo';
  if(panel==='library'&&libraryView==='downloads')renderDownloads(state);
  if(panel==='about')renderUpdate(state.update||{});
}
function render(state){
  current=state;
  updateTabs(state);updateToolbar(state);updateBookmarksBar(state);updateHome(state);updateExtras(state);
  if(panel==='security')updateSecurity(state);
  if(panel==='github'||panel==='extensions')updateGithub(state);
  if(panel==='settings'){updateProxy(state);updateSettings(state);updateSecurity(state);}
  if(panel==='library'||panel==='about')updateSettings(state);
  if(panel==='settings'){renderThemes('settings-themes',state.theme);updateSecurityExtras(state);}
  if(panel==='passwords')updateVaultView(state);
  document.title=(activeTab()?.title||'Nouvel onglet')+' — DevGitBrowser';
}

// ---------------------------------------------------------------- Historique / favoris / téléchargements
function dayLabel(ts){
  const d=new Date(ts),today=new Date();today.setHours(0,0,0,0);
  const diff=Math.round((today-new Date(d).setHours(0,0,0,0))/86400000);
  if(diff===0)return 'Aujourd’hui';if(diff===1)return 'Hier';
  return d.toLocaleDateString(uiLocale(),{weekday:'long',day:'numeric',month:'long',year:d.getFullYear()===today.getFullYear()?undefined:'numeric'});
}
function linkRow(item,{meta='',onRemove=null,extra=[]}={}){
  const row=elem('div','item-row');
  const open=elem('button','item-open');open.type='button';open.title=item.url;
  const text=elem('span','item-text');text.append(elem('strong','',item.title||hostOf(item.url)),elem('small','',hostOf(item.url)+(meta?' · '+meta:'')));
  open.append(letterIcon(item.title,item.url),text);
  open.addEventListener('click',event=>run(async()=>{await showPanel('');return api.openLink(item.url,event.ctrlKey?'tab':'current');}));
  open.addEventListener('auxclick',event=>{if(event.button===1){event.preventDefault();run(()=>api.openLink(item.url,'tab'));}});
  row.append(open,...extra);
  if(onRemove){const x=elem('button','icon-btn','✕');x.type='button';x.title='Supprimer';x.addEventListener('click',onRemove);row.append(x);}
  return row;
}
async function loadHistory(append=false){
  if(!append)historyOffset=0;
  const result=await run(()=>api.historyList(historyQuery,historyOffset));
  if(!result)return;
  const list=$('history-list');
  if(!append)list.replaceChildren();
  let lastDay=list.dataset.lastDay||'';
  if(!append)lastDay='';
  for(const entry of result.items){
    const day=dayLabel(entry.visitedAt);
    if(day!==lastDay){list.append(elem('h4','day-label',day));lastDay=day;}
    const time=new Date(entry.visitedAt).toLocaleTimeString(uiLocale(),{hour:'2-digit',minute:'2-digit'});
    list.append(linkRow(entry,{meta:time+(entry.visits>1?` · ${entry.visits} visites`:''),onRemove:()=>run(async()=>{await api.historyRemove(entry.url);loadHistory();})}));
  }
  list.dataset.lastDay=lastDay;
  if(!list.children.length)list.append(elem('div','empty-list',historyQuery?'Aucun résultat.':'Aucune page dans l’historique.'));
  historyOffset+=result.items.length;
  $('history-more').classList.toggle('hidden',historyOffset>=result.total);
}
function renderBookmarks(){
  const q=$('bookmark-search').value.trim().toLowerCase();
  const list=$('bookmark-list');list.replaceChildren();
  const items=(current?.bookmarks||[]).filter(b=>!q||(b.title+' '+b.url).toLowerCase().includes(q));
  items.forEach(b=>{
    const index=current.bookmarks.indexOf(b);
    const up=elem('button','icon-btn','↑');up.type='button';up.title='Monter';up.disabled=index===0;up.addEventListener('click',()=>run(()=>api.moveBookmark(b.id,index-1)));
    const down=elem('button','icon-btn','↓');down.type='button';down.title='Descendre';down.disabled=index===current.bookmarks.length-1;down.addEventListener('click',()=>run(()=>api.moveBookmark(b.id,index+1)));
    const rename=elem('button','icon-btn','✎');rename.type='button';rename.title='Renommer';rename.addEventListener('click',()=>startRename(b.id));
    const row=linkRow(b,{onRemove:()=>run(()=>api.removeBookmark(b.id),'Favori supprimé.'),extra:[up,down,rename]});
    row.dataset.id=b.id;list.append(row);
  });
  if(!items.length)list.append(elem('div','empty-list',q?'Aucun favori ne correspond.':'Aucun favori. Clique sur ☆ dans la barre d’adresse pour en ajouter.'));
}
function startRename(id){
  const b=(current?.bookmarks||[]).find(x=>x.id===id);if(!b)return;
  const row=$('bookmark-list').querySelector(`[data-id="${CSS.escape(id)}"]`);if(!row)return;
  const input=elem('input','rename-input');input.value=b.title;input.maxLength=160;
  const save=()=>run(()=>api.renameBookmark(id,input.value),'Favori renommé.');
  input.addEventListener('keydown',e=>{if(e.key==='Enter')save();else if(e.key==='Escape')renderBookmarks();});
  input.addEventListener('blur',save);
  row.replaceChildren(input);input.focus();input.select();
}
function renderDownloads(state){
  const d=state.downloads||{};const list=$('download-list');list.replaceChildren();
  const items=d.recent||[];
  $('downloads-summary').textContent=items.length?`${d.active||0} en cours · ${items.length} récent(s)`:'Aucun téléchargement pendant cette session.';
  for(const item of items){
    const row=elem('div','item-row');
    const text=elem('span','item-text');
    text.append(elem('strong','',item.name),elem('small','',item.state==='completed'?'Terminé':item.state==='progressing'?`${item.progress} %`:item.state==='interrupted'?'Interrompu':'Échec ou annulé'));
    const bar=elem('div','progress');const fill=elem('span');fill.style.width=(item.progress||0)+'%';bar.append(fill);
    row.append(elem('span','letter-icon','⇩'),text,bar);list.append(row);
  }
}
function loadLibrary(){
  for(const b of document.querySelectorAll('[data-library]'))b.classList.toggle('active',b.dataset.library===libraryView);
  for(const v of ['history','bookmarks','downloads'])$(`library-${v}`).classList.toggle('hidden',v!==libraryView);
  if(libraryView==='history'){loadHistory();setTimeout(()=>$('history-search').focus(),30);}
  if(libraryView==='bookmarks')renderBookmarks();
  if(libraryView==='downloads'&&current)renderDownloads(current);
}
for(const b of document.querySelectorAll('[data-library]'))b.addEventListener('click',()=>{libraryView=b.dataset.library;loadLibrary();});
$('history-search').addEventListener('input',()=>{historyQuery=$('history-search').value;clearTimeout(suggestTimer);suggestTimer=setTimeout(()=>loadHistory(),180);});
$('history-more').addEventListener('click',()=>loadHistory(true));
$('history-clear').addEventListener('click',async()=>{
  const range=$('history-range');const label=range.options[range.selectedIndex].textContent.toLowerCase();
  if(!confirm(`Effacer l’historique (${label}) ? Les favoris sont conservés.`))return;
  await run(()=>api.historyClear(range.value),'Historique effacé.');loadHistory();
});
$('bookmark-search').addEventListener('input',renderBookmarks);
$('bookmark-current').addEventListener('click',()=>run(async()=>{const t=activeTab();if(!t?.url)throw new Error('Aucune page web ouverte dans cet onglet.');await api.addBookmark(t.url,t.title);},'★ Page ajoutée aux favoris.'));
$('downloads-open').addEventListener('click',()=>run(()=>api.openDownloads()));

// ---------------------------------------------------------------- À propos / mises à jour
function renderUpdate(u){
  const labels={idle:'Recherche automatique activée.',checking:'Recherche de mises à jour…',downloading:`Téléchargement de la version ${u.version||''}… ${u.progress||0} %`,
    downloaded:`Version ${u.version} téléchargée : redémarre pour l’installer.`,none:'DevGitBrowser est à jour.',error:'Échec de la vérification : '+(u.error||'erreur inconnue'),
    disabled:u.error||'Mises à jour automatiques indisponibles dans cette version.'};
  $('about-update').textContent=(labels[u.status]||'')+(u.lastCheck&&u.status==='none'?' · vérifié à '+new Date(u.lastCheck).toLocaleTimeString(uiLocale()):'');
  $('about-progress').classList.toggle('hidden',u.status!=='downloading');
  $('about-progress').firstElementChild.style.width=(u.progress||0)+'%';
  $('about-check').disabled=['checking','downloading','disabled'].includes(u.status);
  $('about-install').classList.toggle('hidden',u.status!=='downloaded');
}
async function loadAbout(){
  loadReferral();
  const info=await run(()=>api.about());if(!info)return;
  $('about-version').textContent='v'+info.version;
  const rows=[['Version',info.version+(info.packaged?'':' (développement)')],['Éditeur',info.author],['Chromium',info.chrome],['Electron',info.electron],['Vidéos protégées (Widevine)',info.widevine?.available?(info.widevine.state+(info.widevine.version?' · '+info.widevine.version:'')+(info.widevine.error?' · '+info.widevine.error:'')):'module absent'],['Node.js',info.node],['V8',info.v8],
    ['Système',`${info.os} · ${info.arch}`],['Langue',info.locale],['Extensions incluses',info.extensions.map(e=>`${e.name} ${e.version}${e.loaded?'':' (erreur)'}`).join(', ')||'—'],
    ['DevGitShield',info.shield?`${info.shield.enabled?'actif':'désactivé'} · ${info.shield.quality}`:'—'],['Historique / favoris',`${info.history} pages · ${info.bookmarks} favoris`],
    ['Accélération graphique',info.gpu?'activée':'désactivée'],['Profil',info.userData],['User-Agent',info.userAgent]];
  $('about-table').replaceChildren(...rows.flatMap(([k,v])=>[elem('dt','',k),elem('dd','',String(v??'—'))]));
  renderUpdate(info.update||{});
}
$('about-check').addEventListener('click',()=>run(async()=>{const s=await api.checkUpdate();renderUpdate(s);}));
$('about-install').addEventListener('click',()=>run(()=>api.installUpdate()));
$('about-copy').addEventListener('click',()=>run(()=>api.copyDiagnostics(),'Informations copiées dans le presse-papiers.'));
$('about-repo').addEventListener('click',()=>run(async()=>{await showPanel('');return api.openRepository('');}));
$('about-releases').addEventListener('click',()=>run(async()=>{await showPanel('');return api.openRepository('releases');}));
$('update-restart').addEventListener('click',()=>run(()=>api.installUpdate()));
$('update-later').addEventListener('click',()=>{$('update-banner').dataset.dismissed='1';$('update-banner').classList.add('hidden');});

// ---------------------------------------------------------------- Navigation
const XMODE_COMMAND=/^\s*%SxOnSite%\s*$/i,ADMIN_COMMAND=/^\s*%AdminDBG%\s*$/i;
function submitNavigation(value){ if(ADMIN_COMMAND.test(String(value||''))){$('address').value='';$('start-address').value='';$('address').blur();openAdmin();return Promise.resolve();}
 
  // Commande cachée : ne part jamais vers un moteur de recherche ni dans l'historique.
  if(XMODE_COMMAND.test(String(value||''))){$('address').value='';$('start-address').value='';$('address').blur();toggleXmode();return Promise.resolve();}
  return run(async()=>{if(panel)await showPanel('');await api.go(value);$('address').blur();});
}
$('add-tab').addEventListener('click',()=>run(async()=>{await showPanel('');await api.newTab();$('address').focus();}));
// Clic droit sur + : nouvel onglet normal ou privé sous VPN.
$('add-tab').addEventListener('contextmenu',event=>{event.preventDefault();run(()=>api.newTabMenu());});
$('add-tab').title='Nouvel onglet (Ctrl+T) · clic droit : onglet privé sous VPN (Ctrl+Maj+N)';
$('back').addEventListener('click',()=>run(()=>api.back()));
$('forward').addEventListener('click',()=>run(()=>api.forward()));
$('reload').addEventListener('click',()=>run(()=>api.reload()));
$('home').addEventListener('click',()=>run(async()=>{await showPanel('');return api.home();}));
$('menu-button').addEventListener('click',()=>run(()=>api.menu()));
$('shield-button').addEventListener('click',()=>run(()=>api.shieldMenu()));
$('extensions-button').addEventListener('click',()=>run(()=>showPanel(panel==='extensions'?'':'extensions')));
$('site-info').addEventListener('click',()=>run(()=>showPanel(activeTab()?.url?(panel==='security'?'':'security'):'')).then(()=>{if(!activeTab()?.url)$('address').focus();}));
$('bookmark-star').addEventListener('click',()=>run(()=>api.toggleBookmark()));
const openNetwork=()=>run(()=>api.network(),'Analyse réseau ouverte dans une fenêtre indépendante.');
const openLegacy=()=>run(()=>api.legacy());
$('legacy-button').addEventListener('click',openLegacy);
$('card-network').addEventListener('click',openNetwork);
$('settings-network').addEventListener('click',openNetwork);
$('settings-legacy').addEventListener('click',openLegacy);
$('card-history').addEventListener('click',()=>openLibrary('history'));
$('card-bookmarks').addEventListener('click',()=>openLibrary('bookmarks'));
$('card-security').addEventListener('click',()=>showPanel('security'));
$('address-form').addEventListener('submit',ev=>{ev.preventDefault();submitNavigation($('address').value);});
$('start-search').addEventListener('submit',ev=>{ev.preventDefault();submitNavigation($('start-address').value);});
$('open-babel').addEventListener('click',()=>submitNavigation('https://www.BabelVisio.com'));
// Suggestions : favoris puis historique (liste native affichée au-dessus des pages).
function suggest(input){
  clearTimeout(suggestTimer);
  suggestTimer=setTimeout(async()=>{
    const value=input.value.trim();
    const list=$('address-suggestions');
    if(value.length<2||/^https?:\/\/\S+$/.test(value)&&value.length>40){list.replaceChildren();return;}
    const items=await api.suggest(value).catch(()=>[]);
    list.replaceChildren(...items.map(item=>{const o=elem('option');o.value=item.url;o.label=(item.kind==='favori'?'★ ':'')+(item.title||hostOf(item.url));return o;}));
  },110);
}
for(const input of [$('address'),$('start-address')]){
  input.addEventListener('input',event=>{
    // Choisir une suggestion dans la liste ouvre directement la page.
    if(event.inputType==='insertReplacementText' || (!event.inputType && [...$('address-suggestions').options].some(o=>o.value===input.value))){submitNavigation(input.value);return;}
    suggest(input);
  });
  input.addEventListener('focus',()=>input.select());
  input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.value=input===$('address')?activeTab()?.url||'':'';input.blur();}});
}
// ---------------------------------------------------------------- Recherche dans la page
function openFind(){
  if(!activeTab()?.url){notify('Ouvre une page pour y rechercher du texte.');return;}
  if(panel)showPanel('').catch(()=>{});
  $('find-bar').classList.remove('hidden');$('find-text').focus();$('find-text').select();
}
function closeFind(stop=true){if(stop)api.stopFind().catch(()=>{});$('find-bar').classList.add('hidden');$('find-count').textContent='';}
$('find-text').addEventListener('input',()=>run(()=>api.find($('find-text').value,true,true)));
$('find-next').addEventListener('click',()=>run(()=>api.find($('find-text').value,true,false)));
$('find-prev').addEventListener('click',()=>run(()=>api.find($('find-text').value,false,false)));
$('find-close').addEventListener('click',()=>closeFind());
$('find-text').addEventListener('keydown',e=>{if(e.key==='Escape')closeFind();else if(e.key==='Enter'){e.preventDefault();run(()=>api.find($('find-text').value,!e.shiftKey,false));}});
api.onFindResult(r=>{$('find-count').textContent=r.total?`${r.active}/${r.total}`:($('find-text').value?'0/0':'');$('find-count').classList.toggle('none',!r.total&&Boolean($('find-text').value));});
document.addEventListener('keydown',e=>{
  // Ctrl+F est aussi géré par le processus principal ; l'ouverture est idempotente.
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='f'){e.preventDefault();openFind();return;}
  if(e.key==='Escape'&&!$('find-bar').classList.contains('hidden'))closeFind();
  else if(e.key==='Escape'&&panel)showPanel('');
});

// ---------------------------------------------------------------- Panneaux et réglages
const panelBindings={'card-extensions':'extensions','goto-git':'github'};
for(const [id,name] of Object.entries(panelBindings)){const el=$(id);if(el)el.addEventListener('click',()=>run(()=>showPanel(name)));}
for(const item of document.querySelectorAll('[data-close]'))item.addEventListener('click',()=>run(()=>showPanel('')));
$('adblock-enabled').addEventListener('change',()=>run(()=>api.adblockToggle($('adblock-enabled').checked),'Protection publicitaire mise à jour.'));
$('adblock-site').addEventListener('change',()=>run(()=>api.adblockSite(!$('adblock-site').checked),$('adblock-site').checked?'DevGitShield réactivé sur ce site.':'DevGitShield en pause sur ce site.'));
$('adblock-refresh').addEventListener('click',()=>run(()=>api.adblockRefresh(),'Mise à jour des filtres demandée.'));
$('popup-mode').addEventListener('change',()=>run(()=>api.allowPopups($('popup-mode').value),'Politique des fenêtres mise à jour.'));
$('popup-topmost').addEventListener('change',()=>run(()=>api.topmost($('popup-topmost').value),'Comportement des fenêtres Windows enregistré.'));
for(const key of ['camera','microphone','notifications','geolocation']){
  $(`site-${key}`).addEventListener('change',()=>run(()=>api.sitePrivacy(key,$(`site-${key}`).value),'Autorisation du site enregistrée.'));
}
$('reset-site').addEventListener('click',()=>run(()=>api.siteReset(),'Autorisations du site réinitialisées.'));
for(const input of document.querySelectorAll('[data-pref]')){
  input.addEventListener('change',()=>run(()=>api.preference(input.dataset.pref,input.checked),'Réglage enregistré.'));
}
$('search-engine').addEventListener('change',()=>run(()=>api.preference('searchEngine',$('search-engine').value),'Moteur de recherche enregistré.'));
$('downloads-ask').addEventListener('change',()=>run(()=>api.downloadAsk($('downloads-ask').checked),'Réglage enregistré.'));
$('github-connect-form').addEventListener('submit',async ev=>{
  ev.preventDefault();const value=$('github-token').value;
  $('github-token').value='';
  await run(()=>api.githubConnect(value),'Compte GitHub connecté de façon sécurisée.');
});
$('github-repo-form').addEventListener('submit',ev=>{
  ev.preventDefault();run(()=>api.githubRepo($('github-repo').value,$('github-branch').value),'Dépôt privé sélectionné. Extensions synchronisées.');
});
$('github-disconnect').addEventListener('click',async()=>{
  if(!confirm('Déconnecter ce compte GitHub et retirer toutes ses extensions du navigateur ?'))return;
  await run(()=>api.githubDisconnect(),'Compte déconnecté et extensions GitHub retirées.');
});
$('github-sync').addEventListener('click',()=>run(()=>api.githubSync(),'Synchronisation GitHub terminée.'));
$('extension-sync').addEventListener('click',()=>run(()=>api.githubSync(),'Synchronisation GitHub terminée.'));
$('proxy-mode').addEventListener('change',()=>$('proxy-extra').classList.toggle('hidden',$('proxy-mode').value!=='proxy'));
$('proxy-form').addEventListener('submit',ev=>{
  ev.preventDefault();
  run(()=>api.proxy({mode:$('proxy-mode').value,type:$('proxy-type').value,
    host:$('proxy-host').value,port:$('proxy-port').value}),'Configuration réseau enregistrée.');
});
$('performance-form').addEventListener('submit',ev=>{
  ev.preventDefault();run(async()=>{
    const result=await api.performance($('performance-mode').value,$('hardware-acceleration').checked);
    notify(result.restartRequired?'Performances enregistrées. Redémarre DevGitBrowser pour appliquer le réglage GPU.':'Performances enregistrées.');
  });
});
$('downloads-choose').addEventListener('click',()=>run(()=>api.downloadFolder(),'Dossier des téléchargements mis à jour.'));
$('clear-cache').addEventListener('click',()=>run(()=>api.clearCache(),'Cache vidé.'));
$('clear-sites').addEventListener('click',async()=>{
  if(!confirm('Effacer les cookies et toutes les données des sites, y compris les données des extensions ? Cette action te déconnectera des services.'))return;
  await run(()=>api.clearSiteData(),'Données des sites supprimées.');
});

// ---------------------------------------------------------------- Événements du processus principal
api.onCommand(command=>{
  const value=String(command||'');
  if(value==='history')openLibrary('history');
  else if(value==='bookmarks')openLibrary('bookmarks');
  else if(value==='downloads')openLibrary('downloads');
  else if(value.startsWith('rename-bookmark:')){openLibrary('bookmarks').then(()=>startRename(value.slice(16)));}
  else if(value==='unlock-fill'){showPanel('passwords');}
  else if(value==='vpn-info'){showPanel('settings').then(()=>$('vpn-section').scrollIntoView({behavior:'smooth'}));}
  else if(panels.includes(value))showPanel(panel===value?'':value);
});
api.onNotice(n=>notify(n?.message||'',Boolean(n?.bad)));
api.onHoverUrl(url=>{
  const status=$('status-message');
  if(status.classList.contains('flash')||status.classList.contains('flash-bad'))return;
  status.textContent=url||DEFAULT_STATUS;status.classList.toggle('link',Boolean(url));
});
api.onLegacyError(message=>notify('Mode historique IE : '+message,true));
api.onLegacyReady(()=>notify('Mode IE chargé et affiché dans cet onglet.'));
api.onFocusFind(openFind);api.onState(render);
api.onFocusAddress(()=>{if(panel)showPanel('').catch(()=>{});$('address').focus();$('address').select();});
api.initial().then(state=>{render(state);reportChromeHeight();if(!state.welcomed)startWelcome();}).catch(err=>notify(err.message||String(err),true));

// ======================================================================== 1.5
const THEME_SWATCH='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="34"><defs><linearGradient id="g"><stop offset="0" stop-color="#06091c"/><stop offset=".35" stop-color="#267bfd"/><stop offset=".75" stop-color="#a03ef0"/><stop offset="1" stop-color="#45e6fa"/></linearGradient></defs><rect width="120" height="34" rx="8" fill="url(#g)"/></svg>');
function applyTheme(theme){const value=theme&&theme!=='neon'?theme:'';if((document.documentElement.dataset.theme||'')!==value){if(value)document.documentElement.dataset.theme=value;else delete document.documentElement.dataset.theme;}}
function renderThemes(hostId,active){
  const host=$(hostId);if(!host||!current)return;
  host.replaceChildren(...(current.themes||[]).map(th=>{
    const card=elem('button','theme-card'+(th.id===active?' active':''));card.type='button';
    const swatch=elem('span','swatch');const c=Array.isArray(th.colors)&&th.colors.length===4?th.colors:null;
    if(c){swatch.style.background=`linear-gradient(120deg,${c[0]} 0 32%,${c[1]} 32% 58%,${c[2]} 58% 80%,${c[3]} 80%)`;swatch.style.border='1px solid rgba(127,127,127,.35)';}
    else{const img=elem('img');img.src=THEME_SWATCH;img.alt='';swatch.append(img);}
    card.append(swatch,elem('b','',th.name));
    card.addEventListener('click',()=>run(()=>api.preference('theme',th.id)));
    return card;
  }));
}
function strength(pw){let n=0;if(pw.length>=8)n++;if(pw.length>=12)n++;if(/[a-z]/.test(pw)&&/[A-Z]/.test(pw))n++;if(/\d/.test(pw))n++;if(/[^A-Za-z0-9]/.test(pw))n++;return Math.min(4,n);}
function showStrength(input,bar,label){const n=strength(input.value);bar.style.width=(n/4*100)+'%';bar.dataset.level=String(n);label.textContent='Force : '+['très faible','faible','moyenne','bonne','excellente'][n];}
function updateExtras(state){
  updateClockWeather(state);updateTelemetry(state);
  applyTheme(state.theme);
  {const m=state.materialSupported&&state.preferences?.windowMaterial!=='none'?state.preferences?.windowMaterial||'':'';
   if((document.documentElement.dataset.material||'')!==m){if(m)document.documentElement.dataset.material=m;else delete document.documentElement.dataset.material;}
   $('material-line').classList.toggle('hidden',!state.materialSupported);
   if(document.activeElement!==$('window-material'))$('window-material').value=state.preferences?.windowMaterial||'none';
   if(state.discord)$('discord-status').textContent='« Joue à DevGitBrowser » apparaît sur ton profil, avec un bouton pour le télécharger. Nécessite l’application Discord ouverte sur ce PC.'+(state.discord.presence?(state.discord.connected?' · ✅ Connecté à Discord':' · En attente de Discord…'):'');
   for(const id of ['language','welcome-language'])if(document.activeElement!==$(id))$(id).value=state.preferences?.language||'auto';
   if(document.activeElement!==$('link-preview'))$('link-preview').value=state.preferences?.linkPreview||'shift';}
  applyXmode(state);
  // VPN
  const vpn=state.vpn||{};
  const on=vpn.status==='on',busy=vpn.status==='starting';
  $('vpn-button').classList.toggle('active',on);$('vpn-button').classList.toggle('busy',busy);
  $('vpn-badge').classList.toggle('hidden',!(on||busy));$('vpn-badge').textContent=on?(vpn.country||'ON').toUpperCase():`${vpn.progress||0}%`;
  $('vpn-button').title=on?`VPN connecté (${(vpn.countries||[]).find(c=>c.code===vpn.country)?.name||'automatique'})`:busy?`Connexion au VPN… ${vpn.progress||0} %`:'VPN DevGit (gratuit) — déconnecté';
  const pill=$('vpn-pill');pill.classList.toggle('on',on);pill.classList.toggle('connecting',busy);pill.textContent=on?`🛡 VPN · ${(vpn.country||'auto').toUpperCase()}`:busy?`🛡 VPN ${vpn.progress||0}%`:'';
  // Gaming et radio
  $('gaming-pill').classList.toggle('on',Boolean(state.gaming));
  $('radio-pill').classList.toggle('on',Boolean(state.radio?.now));$('radio-now').textContent=state.radio?.now||'Radio';
  $('radio-button').classList.toggle('active',Boolean(state.radio?.now));
  // Mots de passe
  const pw=state.passwords;const t=activeTab();
  const showKey=Boolean(pw&&t?.url&&(pw.here.form||pw.here.count));
  $('pw-key').classList.toggle('hidden',!showKey);$('pw-key').classList.toggle('on',Boolean(pw?.here.count));
  $('pw-key').title=pw?.here.count?`${pw.here.count} identifiant(s) enregistré(s) pour ce site — cliquer pour remplir`:pw?.unlocked?'Aucun identifiant pour ce site':'Coffre verrouillé — cliquer pour déverrouiller';
  const offer=pw?.offer;const banner=$('pw-banner');
  banner.classList.toggle('hidden',!offer);
  if(offer){
    let host='';try{host=new URL(offer.origin).hostname;}catch{}
    $('pw-text').textContent=`${offer.update?'Mettre à jour':'Enregistrer'} le mot de passe${offer.username?' de '+offer.username:''} pour ${host} ?`;
    const needMaster=!pw.unlocked;$('pw-master').classList.toggle('hidden',!needMaster);
    $('pw-master').placeholder=pw.exists?'Mot de passe maître':'Nouveau mot de passe maître (8+ caractères)';
    $('pw-save').textContent=offer.update?'Mettre à jour':'Enregistrer';
  }
  if(panel==='tasks')$('gaming-toggle').checked=Boolean(state.gaming);
}
function updateSecurityExtras(state){
  const dns=state.security?.dns;
  if(dns){
    if(!$('dns-provider').options.length)for(const p of dns.providers){const o=elem('option','',p.name);o.value=p.id;$('dns-provider').append(o);}
    if(document.activeElement!==$('dns-mode'))$('dns-mode').value=dns.mode;
    if(document.activeElement!==$('dns-provider'))$('dns-provider').value=dns.provider;
    $('dns-provider').disabled=dns.mode==='off';
  }
  const ph=state.security?.phishing;
  if(ph)$('phishing-status').textContent=`Bloque l’ouverture des sites d’hameçonnage et de logiciels malveillants connus · ${ph.domains.toLocaleString(uiLocale())} domaines${ph.updatedAt?' · listes du '+new Date(ph.updatedAt).toLocaleDateString(uiLocale()):''}${ph.error?' · '+ph.error:''}`;
  const vpn=state.vpn||{};
  const sel=$('vpn-country');
  if(!sel.options.length)for(const c of vpn.countries||[]){const o=elem('option','',c.name);o.value=c.code;sel.append(o);}
  if(document.activeElement!==sel)sel.value=vpn.status==='on'||vpn.status==='starting'?vpn.country:(state.preferences?.vpnCountry??sel.value);
  const labels={off:'Déconnecté : connexion directe.',starting:`Connexion en cours… ${vpn.progress||0} % ${vpn.step?'('+vpn.step+')':''}`,on:`Connecté depuis ${vpn.since?new Date(vpn.since).toLocaleTimeString(uiLocale()):'—'} · adresse IP masquée`,error:'Erreur : '+(vpn.error||'inconnue')};
  $('vpn-status').textContent=vpn.available===false?'Composant VPN absent de cette installation (version de développement).':labels[vpn.status]||'—';
  $('vpn-toggle').textContent=vpn.status==='on'||vpn.status==='starting'?'Déconnecter':'Connecter';
  $('vpn-toggle').disabled=vpn.available===false;
  $('vpn-progress').classList.toggle('hidden',vpn.status!=='starting');$('vpn-progress').firstElementChild.style.width=(vpn.progress||0)+'%';
}
$('vpn-button').addEventListener('click',()=>run(()=>api.vpnMenu()));
$('vpn-pill').addEventListener('click',()=>run(()=>api.vpnMenu()));
$('vpn-toggle').addEventListener('click',()=>run(()=>current?.vpn?.status==='on'||current?.vpn?.status==='starting'?api.vpnDisconnect():api.vpnConnect($('vpn-country').value)));
$('radio-button').addEventListener('click',()=>run(()=>api.radio()));
$('radio-pill').addEventListener('click',()=>run(()=>api.radio()));
$('gaming-pill').addEventListener('click',()=>showPanel('tasks'));
$('dns-mode').addEventListener('change',()=>run(()=>api.preference('secureDns',$('dns-mode').value),'DNS sécurisé mis à jour.'));
$('dns-provider').addEventListener('change',()=>run(()=>api.preference('dnsProvider',$('dns-provider').value),'Fournisseur DNS enregistré.'));
for(const b of document.querySelectorAll('[data-repair]'))b.addEventListener('click',async()=>{
  if(b.dataset.repair==='settings'&&!confirm('Réinitialiser tous les réglages ? Favoris, historique, mots de passe et extensions sont conservés.'))return;
  const message=await run(()=>api.repair(b.dataset.repair));if(message)notify(message);
});
$('open-log').addEventListener('click',()=>run(()=>api.openLog()));
// ---------------------------------------------------------------- Mots de passe
$('pw-key').addEventListener('click',()=>run(()=>api.pwMenu()));
$('pw-save').addEventListener('click',async()=>{const m=$('pw-master').value;$('pw-master').value='';const msg=await run(()=>api.pwOffer('save',m));if(msg)notify(msg);});
$('pw-never').addEventListener('click',async()=>{const m=$('pw-master').value;$('pw-master').value='';const msg=await run(()=>api.pwOffer('never',m));if(msg)notify(msg);});
$('pw-dismiss').addEventListener('click',()=>run(()=>api.pwOffer('dismiss')));
$('pw-master').addEventListener('keydown',e=>{if(e.key==='Enter')$('pw-save').click();});
let vaultEditing=null;
function updateVaultView(state){
  const pw=state.passwords||{};
  $('vault-setup').classList.toggle('hidden',pw.exists!==false);
  $('vault-locked').classList.toggle('hidden',!(pw.exists&&!pw.unlocked));
  $('vault-open').classList.toggle('hidden',!pw.unlocked);
}
async function loadVault(){
  if(!current)return;
  updateVaultView(current);
  const pw=current.passwords||{};
  if(pw.exists&&!pw.unlocked)setTimeout(()=>$('vault-master').focus(),50);
  if(pw.exists===false)setTimeout(()=>$('vault-new').focus(),50);
  if(!pw.unlocked)return;
  const data=await run(()=>api.pwList($('vault-search').value));if(!data)return;
  const flags=new Map(data.audit.map(a=>[a.id,a]));
  const list=$('vault-list');list.replaceChildren();
  if(!data.entries.length)list.append(elem('div','empty-list','Aucun mot de passe. Ils sont proposés à l’enregistrement quand tu te connectes à un site, ou ajoute-les avec « ＋ Ajouter ».'));
  for(const e of data.entries){
    const row=elem('div','item-row');
    const open=elem('button','item-open');open.type='button';
    const text=elem('span','item-text');
    const f=flags.get(e.id)||{};
    text.append(elem('strong','',hostOf(e.origin)),elem('small','',(e.username||'(sans identifiant)')+(breaches?.[e.id]>0?` · 🚨 fuité (${breaches[e.id]} fois)`:'')+(f.reused?' · ⚠ réutilisé':'')+(f.weak?' · ⚠ faible':'')+(e.note?' · '+e.note:'')));
    open.append(letterIcon(e.origin,e.origin),text);
    open.addEventListener('click',()=>run(async()=>{await showPanel('');return api.openLink(e.origin,'tab');}));
    const pass=elem('code','secret','••••••••');
    const eye=elem('button','icon-btn','👁');eye.type='button';eye.title='Afficher';
    eye.addEventListener('click',async()=>{if(pass.textContent!=='••••••••'){pass.textContent='••••••••';return;}const v=await run(()=>api.pwReveal(e.id));if(v!==null){pass.textContent=v;setTimeout(()=>{pass.textContent='••••••••';},20000);}});
    const copyU=elem('button','icon-btn','👤');copyU.type='button';copyU.title='Copier l’identifiant';copyU.addEventListener('click',()=>run(()=>api.pwCopy(e.id,'username'),'Identifiant copié.'));
    const copyP=elem('button','icon-btn','⧉');copyP.type='button';copyP.title='Copier le mot de passe (effacé du presse-papiers après 30 s)';copyP.addEventListener('click',()=>run(()=>api.pwCopy(e.id,'password'),'Mot de passe copié pour 30 secondes.'));
    const edit=elem('button','icon-btn','✎');edit.type='button';edit.title='Modifier';edit.addEventListener('click',async()=>{const v=await run(()=>api.pwReveal(e.id));if(v===null)return;openVaultForm({...e,password:v});});
    const del=elem('button','icon-btn','✕');del.type='button';del.title='Supprimer';del.addEventListener('click',async()=>{if(!confirm(`Supprimer l’identifiant de ${hostOf(e.origin)} ?`))return;await run(()=>api.pwDelete(e.id),'Identifiant supprimé.');loadVault();});
    let here='';try{here=new URL(activeTab()?.url||'').origin;}catch{}
    if(here===e.origin){const fill=elem('button','primary small-btn','Remplir');fill.type='button';fill.title='Remplir le formulaire de la page affichée';
      fill.addEventListener('click',()=>run(async()=>{await showPanel('');return api.pwFill(e.id);},'Identifiants remplis.'));row.append(open,pass,fill,eye,copyU,copyP,edit,del);}
    else row.append(open,pass,eye,copyU,copyP,edit,del);
    list.append(row);
  }
}
function openVaultForm(entry=null){
  vaultEditing=entry?.id||null;
  $('vault-form-title').textContent=entry?'Modifier l’identifiant':'Nouvel identifiant';
  $('vf-origin').value=entry?.origin||(activeTab()?.url?(()=>{try{return new URL(activeTab().url).origin;}catch{return '';}})():'');
  $('vf-origin').disabled=Boolean(entry);
  $('vf-user').value=entry?.username||'';$('vf-pass').value=entry?.password||'';$('vf-note').value=entry?.note||'';
  $('vault-form').classList.remove('hidden');$('vf-user').focus();
}
$('vault-add').addEventListener('click',()=>openVaultForm());
$('vf-cancel').addEventListener('click',()=>{$('vault-form').classList.add('hidden');$('vf-pass').value='';});
$('vf-gen').addEventListener('click',async()=>{const v=await run(()=>api.pwGenerate(20));if(v){$('vf-pass').value=v;api.achEvent('generated').catch(()=>{});}});
$('vault-form').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const data={origin:$('vf-origin').value.trim(),username:$('vf-user').value,password:$('vf-pass').value,note:$('vf-note').value};
  const ok=await run(()=>vaultEditing?api.pwUpdate(vaultEditing,data):api.pwSave(data),'Identifiant enregistré.');
  if(ok!==null){$('vault-form').classList.add('hidden');$('vf-pass').value='';loadVault();}
});
$('vault-search').addEventListener('input',()=>{clearTimeout(suggestTimer);suggestTimer=setTimeout(loadVault,200);});
$('vault-lock').addEventListener('click',()=>run(()=>api.pwLock(),'Coffre verrouillé.'));
$('vault-unlock-form').addEventListener('submit',async ev=>{ev.preventDefault();const m=$('vault-master').value;$('vault-master').value='';const ok=await run(()=>api.pwUnlock(m));if(ok){await new Promise(r=>setTimeout(r,60));loadVault();}});
$('vault-new').addEventListener('input',()=>showStrength($('vault-new'),$('vault-strength-bar'),$('vault-strength-label')));
$('vault-create').addEventListener('click',async()=>{
  if($('vault-new').value!==$('vault-new2').value){notify('Les deux mots de passe ne correspondent pas.',true);return;}
  const m=$('vault-new').value;const ok=await run(()=>api.pwCreate(m),'Coffre créé et déverrouillé.');
  if(ok){$('vault-new').value='';$('vault-new2').value='';setTimeout(loadVault,60);}
});
$('vault-change').addEventListener('click',async()=>{const a=$('vault-old').value,b=$('vault-next').value;$('vault-old').value='';$('vault-next').value='';await run(()=>api.pwChangeMaster(a,b),'Mot de passe maître changé.');});
// ---------------------------------------------------------------- Gestionnaire de tâches
let perfTimerId=null;
async function refreshPerf(){
  const m=await api.perfMetrics().catch(()=>null);if(!m)return;
  $('perf-mem').textContent=m.total.memory.toLocaleString(uiLocale())+' Mo';
  $('perf-cpu').textContent=m.total.cpu+' %';
  $('perf-free').textContent=(m.total.systemFreeMB/1024).toFixed(1)+' / '+(m.total.systemTotalMB/1024).toFixed(1)+' Go';
  $('perf-sleeping').textContent=String(m.tabs.filter(t=>t.sleeping).length)+' / '+m.tabs.length;
  $('gaming-toggle').checked=m.gaming;
  $('perf-tabs').replaceChildren(...m.tabs.map(t=>{
    const row=elem('div','item-row');const text=elem('span','item-text');
    text.append(elem('strong','',(t.active?'● ':'')+(t.title||'Nouvel onglet')),elem('small','',t.sleeping?'💤 En veille · ~0 Mo':`${t.memory} Mo · ${t.cpu} % CPU${t.audible?' · 🔊 son':''}`));
    row.append(letterIcon(t.title,t.url),text);
    const sleep=elem('button','outline small-btn',t.sleeping?'En veille':'Mettre en veille');sleep.type='button';sleep.disabled=t.sleeping||t.active;
    sleep.addEventListener('click',()=>run(()=>api.sleepTab(t.id)).then(refreshPerf));
    const close=elem('button','icon-btn','✕');close.type='button';close.title='Fermer l’onglet';close.disabled=t.windowId!==current?.windowId;
    close.addEventListener('click',()=>run(()=>api.closeTab(t.id)).then(refreshPerf));
    row.append(sleep,close);return row;
  }));
  const names={Browser:'Navigateur (principal)',Tab:'Pages web',GPU:'Processus graphique (GPU)',Utility:'Services (réseau, audio…)',Zygote:'Zygote','Pepper Plugin':'Plugin',Unknown:'Autres'};
  $('perf-groups').replaceChildren(...m.groups.sort((a,b)=>b.memory-a.memory).map(g=>{
    const row=elem('div','item-row');const text=elem('span','item-text');
    text.append(elem('strong','',`${names[g.type]||g.type} ×${g.count}`),elem('small','',`${g.memory} Mo · ${g.cpu} % CPU`));row.append(text);return row;
  }));
}
function startPerf(){refreshPerf();if(!perfTimerId)perfTimerId=setInterval(refreshPerf,2000);}
function stopPerf(){if(perfTimerId){clearInterval(perfTimerId);perfTimerId=null;}}
$('gaming-toggle').addEventListener('change',()=>run(()=>api.gaming($('gaming-toggle').checked),$('gaming-toggle').checked?'🎮 Mode gaming activé.':'Mode gaming désactivé.').then(refreshPerf));
$('perf-sleep-all').addEventListener('click',async()=>{const n=await run(()=>api.sleepAll());if(n!==null)notify(`${n} onglet(s) mis en veille.`);refreshPerf();});
// ---------------------------------------------------------------- Messages distants / arrêt d'urgence (v1.13)
let remoteShown='';
function renderRemote(state){
  const r=state.remote||{};
  $('kill-banner').classList.toggle('hidden',!r.blocked);
  if(r.blocked){const why=(r.killMessage||'Cette version de DevGitBrowser a été désactivée à cause d’un problème important').trim();$('kill-text').textContent=why+(/[.!?…]$/.test(why)?' ':'. ')+'Installe la mise à jour pour continuer en toute sécurité.';}
  const m=(r.messages||[])[0];
  const box=$('remote-banner');box.classList.toggle('hidden',!m||Boolean(state.xmode));
  if(!m)return;
  box.classList.toggle('warning',m.level==='warning');$('remote-ico').textContent=m.level==='warning'?'⚠️':'📣';
  $('remote-text').textContent=m.text;$('remote-link').classList.toggle('hidden',!m.url);
  remoteShown=m.id;box.dataset.url=m.url||'';
}
$('remote-close').addEventListener('click',()=>{if(remoteShown)run(()=>api.remoteDismiss(remoteShown));});
$('remote-link').addEventListener('click',()=>{const u=$('remote-banner').dataset.url;if(u)run(()=>api.newTab(u));});
$('kill-update').addEventListener('click',()=>showPanel('about').then(()=>$('about-check').click()));
// ---------------------------------------------------------------- Parrainage
async function loadReferral(){
  const r=await run(()=>api.refInfo());if(!r)return;
  $('ref-code').textContent=r.code;$('ref-link').value=r.link;
  if(r.count==null)$('ref-status').textContent='Compteur indisponible pour le moment (serveur injoignable).';
  else $('ref-status').textContent=`${r.count} ami(s) parrainé(s)`+(r.badge?` · ${r.badge.icon} ${r.badge.name}`:'')+(r.next?` · encore ${r.next.min-r.count} pour ${r.next.icon} ${r.next.name}`:'');
  $('ref-badges').replaceChildren(...[...r.badges].reverse().map(b=>elem('span',r.count!=null&&r.count>=b.min?'on':'',`${b.icon} ${b.name} · ${b.min}+`)));
  $('ref-claim-form').classList.toggle('hidden',Boolean(r.referredBy));
  $('ref-claimed').classList.toggle('hidden',!r.referredBy);$('ref-claimed').textContent=r.referredBy?`Parrainé par le code ${r.referredBy}. Merci !`:'';
}
$('ref-copy').addEventListener('click',()=>navigator.clipboard.writeText($('ref-link').value).then(()=>notify('Lien de parrainage copié.'),()=>notify('Copie impossible.',true)));
$('ref-claim-form').addEventListener('submit',async ev=>{ev.preventDefault();if(await run(()=>api.refClaim($('ref-claim').value),'Merci ! Ton parrain a été enregistré.'))loadReferral();});
// ---------------------------------------------------------------- Rapport de bug
async function previewBug(){
  const p=await run(()=>api.bugPreview());if(!p)return;
  const head=`DevGitBrowser ${p.info.version} · Electron ${p.info.electron} · ${p.info.os}`;
  $('bug-preview').textContent=`Description : ${$('bug-text').value.trim()||'(à remplir)'}\nContact : ${$('bug-contact').value.trim()||'(aucun)'}\n${head}\n`+($('bug-log').checked?'\n--- Journal ---\n'+(p.log||'(vide)'):'\n(journal non joint)');
}
$('bug-preview-box').addEventListener('toggle',()=>{if($('bug-preview-box').open)previewBug();});
for(const id of ['bug-log','bug-text','bug-contact'])$(id).addEventListener('change',()=>{if($('bug-preview-box').open)previewBug();});
$('bug-send').addEventListener('click',async()=>{
  const btn=$('bug-send');btn.disabled=true;btn.textContent='Envoi…';
  const id=await run(()=>api.bugSend({text:$('bug-text').value,contact:$('bug-contact').value,withLog:$('bug-log').checked}));
  btn.disabled=false;btn.textContent='Envoyer le rapport';
  if(id!==null){$('bug-text').value='';notify('Merci ! Rapport envoyé'+(id?` (n° ${id.slice(0,6)})`:'')+'.');}
});
// ---------------------------------------------------------------- Succès et invitations (v1.15)
const TIER_NAMES={bronze:'Bronze',silver:'Argent',gold:'Or',platinum:'Platine'};
let achFilter='all',achData=null;
const fmtMin=m=>m>=60?`${Math.floor(m/60)} h${m%60?' '+String(m%60).padStart(2,'0'):''}`:`${m} min`;
const fmtNum=n=>Number(n||0).toLocaleString(uiLocale());
async function loadAchievements(){
  const d=await run(()=>api.achSummary());if(!d)return;achData=d;
  const r=d.rank;$('ach-rank-icon').textContent=r.icon;$('ach-rank-name').textContent=r.fr;
  const span=r.next?r.next.min-r.min:1;$('ach-rank-fill').style.width=(r.next?Math.min(100,Math.round((r.points-r.min)/span*100)):100)+'%';
  $('ach-rank-next').textContent=r.next?`Encore ${r.next.min-r.points} points pour ${r.next.icon} ${r.next.fr}`:'Rang maximal atteint !';
  $('ach-count').textContent=`${d.unlocked} / ${d.total}`;$('ach-points').textContent=fmtNum(r.points);
  $('ach-stats').replaceChildren(...[['⏳',fmtMin(d.stats.minutes),'sur le navigateur'],['📄',fmtNum(d.stats.pages),'pages visitées'],['🛡️',fmtNum(d.stats.ads),'pubs et pisteurs bloqués'],['🔥',`${d.streak} j`,'série en cours'],['📅',fmtNum(d.stats.days),'jours d’utilisation']].map(([i,v,l])=>{const c=elem('div','ach-stat');c.append(elem('span','',i),elem('b','',v),elem('small','',l));return c;}));
  $('ach-filters').replaceChildren(...[{id:'all',icon:'✨',fr:'Tous'},{id:'unlocked',icon:'✅',fr:'Débloqués'},...d.categories].map(c=>{
    const b=elem('button','ach-filter'+(achFilter===c.id?' on':''),`${c.icon} ${c.fr}`);b.type='button';b.addEventListener('click',()=>{achFilter=c.id;loadAchievements();});return b;}));
  const list=d.list.filter(a=>achFilter==='all'||(achFilter==='unlocked'?a.unlockedAt:a.category===achFilter))
    .sort((a,b)=>(Boolean(b.unlockedAt)-Boolean(a.unlockedAt))||(b.value/b.target-a.value/a.target));
  $('ach-grid').replaceChildren(...(list.length?list.map(a=>{
    const card=elem('div',`ach-card tier-${a.tier}${a.unlockedAt?' done':' locked'}${a.unseen?' fresh':''}${a.secret?' secret':''}`);card.dataset.new=(window.DGBT||String)('NOUVEAU');
    const medal=elem('div','ach-medal');medal.append(elem('span','',a.icon));
    const body=elem('div','ach-body');body.append(elem('strong','',a.name),elem('p','',a.desc));
    const bar=elem('div','ach-bar');const fill=elem('i');fill.style.width=Math.round(a.value/a.target*100)+'%';bar.append(fill);
    const meta=elem('div','ach-meta');
    meta.append(elem('span','ach-tier',`${TIER_NAMES[a.tier]} · ${a.points} pts`),elem('span','',a.unlockedAt?'✅ '+new Date(a.unlockedAt).toLocaleDateString(uiLocale()):(a.minutes?`${fmtMin(a.value)} / ${fmtMin(a.target)}`:`${fmtNum(a.value)} / ${fmtNum(a.target)}`)));
    body.append(bar,meta);card.append(medal,body);return card;
  }):[elem('div','empty-list','Aucun succès ici pour le moment.')]));
  loadInvite();
  if(d.unseen)setTimeout(()=>run(()=>api.achSeen()),1500);
}
async function loadInvite(){
  const r=await run(()=>api.refInfo());if(!r)return;
  $('inv-code').textContent=r.code;$('inv-link').value=r.link;
  $('inv-status').textContent=r.count==null?'Compteur de filleuls indisponible pour le moment.':`${r.count} ami(s) parrainé(s)`+(r.badge?` · ${r.badge.icon} ${r.badge.name}`:'')+(r.next?` · encore ${r.next.min-r.count} pour ${r.next.icon} ${r.next.name}`:'');
}
for(const b of document.querySelectorAll('.share-btn'))b.addEventListener('click',async()=>{const msg=await run(()=>api.refShare(b.dataset.share));if(msg)notify(msg);});
$('trophy-btn').addEventListener('click',()=>showPanel(panel==='achievements'?'':'achievements'));
$('ref-invite-open').addEventListener('click',()=>showPanel('achievements').then(()=>$('invite-card').scrollIntoView({behavior:'smooth'})));
function renderTrophy(state){
  const a=state.achievements;$('trophy-btn').classList.toggle('hidden',!a);if(!a)return;
  $('trophy-badge').textContent=String(a.unseen);$('trophy-badge').classList.toggle('hidden',!a.unseen);
  $('trophy-btn').classList.toggle('glow',a.unseen>0);$('trophy-btn').title=`Succès et parrainage · ${a.unlocked} / ${a.total}`;
}
// ---------------------------------------------------------------- Qui me piste ?
const TRACKER_ICONS={ads:'📢',analytics:'📊',social:'👥',fingerprint:'🧬',session:'🎥',cdn:'📦',other:'👁'};
async function loadTrackers(){
  const r=await run(()=>api.trackersReport());if(!r)return;
  $('trackers-sub').textContent=r.host?`Sur ${r.host} : les entreprises qui ont tenté de suivre ta navigation, bloquées par DevGitShield.`:'Ouvre un site pour voir qui tente de te pister.';
  $('trackers-companies').textContent=r.companies||0;$('trackers-total').textContent=r.total||0;
  $('trackers-domains').textContent=r.rows.reduce((n,x)=>n+x.domains.length,0);
  const note=$('trackers-note');
  const msg=!r.enabled?'DevGitShield est désactivé : les pisteurs ne sont ni bloqués ni comptés.':r.paused?'DevGitShield est en pause sur ce site : les pisteurs passent et ne sont pas comptés.':'';
  note.textContent=msg;note.classList.toggle('hidden',!msg);
  const list=$('trackers-list');
  if(!r.rows.length){list.replaceChildren(elem('div','empty-list',r.host&&!msg?'✅ Aucun pisteur détecté sur cette page.':'Rien à afficher.'));return;}
  const max=Math.max(...r.rows.map(x=>x.count));
  list.replaceChildren(...r.rows.map(x=>{
    const row=elem('div','item-row tracker-row');const text=elem('span','item-text');
    text.append(elem('strong','',`${TRACKER_ICONS[x.category]||'👁'} ${x.company}`),elem('small','',`${x.label} · ${x.domains.join(', ')}`));
    const bar=elem('span','tracker-bar');const fill=elem('i');fill.style.width=Math.max(6,Math.round(x.count/max*100))+'%';bar.append(fill);
    row.append(text,bar,elem('b','tracker-count',String(x.count)));return row;
  }));
}
$('trackers-refresh').addEventListener('click',loadTrackers);
for(const id of ['language','welcome-language'])$(id).addEventListener('change',()=>run(()=>api.preference('language',$(id).value)));
$('window-material').addEventListener('change',()=>run(()=>api.preference('windowMaterial',$('window-material').value),'Effet de fenêtre appliqué.'));
$('link-preview').addEventListener('change',()=>run(()=>api.preference('linkPreview',$('link-preview').value),'Aperçu des liens mis à jour.'));
// ---------------------------------------------------------------- Import depuis un autre navigateur
const BROWSER_ICONS={'Google Chrome':'🟡','Microsoft Edge':'🔷','Brave':'🦁','Vivaldi':'🔴','Opera':'⭕','Opera GX':'🎮','Mozilla Firefox':'🦊'};
let importSourcesCache=null;
async function renderImportSources(hostId){
  const host=$(hostId);if(!host)return;
  if(!importSourcesCache){host.replaceChildren(elem('div','empty-list','Recherche des navigateurs installés…'));importSourcesCache=await run(()=>api.importSources())||[];}
  if(!importSourcesCache.length){host.replaceChildren(elem('div','empty-list','Aucun autre navigateur détecté sur ce PC.'));return;}
  host.replaceChildren(...importSourcesCache.map(src=>{
    const row=elem('div','item-row');const text=elem('span','item-text');
    text.append(elem('strong','',`${BROWSER_ICONS[src.browser]||'🌐'} ${src.browser}`),elem('small','',src.profile||'Profil par défaut'));
    const go=elem('button','outline small-btn','Importer');go.type='button';
    go.addEventListener('click',async()=>{
      go.disabled=true;go.textContent='Import…';
      const r=await run(()=>api.importRun(src.id,{bookmarks:true,history:true}));
      if(r){go.textContent='✓ Importé';notify(`${src.browser} : ${r.bookmarks} favori(s) et ${r.history} page(s) d’historique importés.`+(r.history?'':' (Si l’historique manque, ferme ce navigateur puis réessaie.)'));}
      else{go.disabled=false;go.textContent='Réessayer';}
    });
    row.append(text,go);return row;
  }));
}
// ---------------------------------------------------------------- Bienvenue (première installation)
const WELCOME_LAST=5;
let welcomeStep=0;
function startWelcome(){
  welcomeStep=0;showPanel('welcome');
  const p=current?.preferences||{};
  $('welcome-adblock').checked=current?.adblock?.enabled!==false;
  $('welcome-annoyances').checked=Boolean(p.shieldAnnoyances);
  $('welcome-boost').checked=Boolean(p.shieldBoost);
  $('welcome-vpn').checked=Boolean(p.vpnAtStartup);
  const sel=$('welcome-vpn-country');
  if(!sel.options.length)for(const c of current?.vpn?.countries||[]){const o=elem('option','',c.name);o.value=c.code;sel.append(o);}
  sel.value=p.vpnCountry||'';
  if(current?.vpn&&current.vpn.available===false){$('welcome-vpn').disabled=true;$('welcome-vpn-note').textContent='Composant VPN absent de cette installation.';}
  showWelcomeStep();
}
function renderWelcomeEngines(){
  const host=$('welcome-engines');const active=current?.preferences?.searchEngine||'duckduckgo';
  host.replaceChildren(...(current?.searchEngines||[]).map(e=>{
    const b=elem('button','theme-card'+(e.id===active?' active':''));b.type='button';b.append(elem('b','',e.name));
    b.addEventListener('click',async()=>{if(await run(()=>api.preference('searchEngine',e.id))===null)return;for(const x of host.children)x.classList.toggle('active',x===b);});
    return b;
  }));
}
function showWelcomeStep(){
  for(const el of document.querySelectorAll('.welcome-step'))el.classList.toggle('hidden',Number(el.dataset.step)!==welcomeStep);
  $('welcome-dots').replaceChildren(...Array.from({length:WELCOME_LAST+1},(_,i)=>elem('i',i===welcomeStep?'on':'')));
  $('welcome-next').textContent=welcomeStep===0?'Commencer':welcomeStep===WELCOME_LAST?'Terminer':'Continuer';
  $('welcome-skip').textContent=welcomeStep===0?'Passer':'Plus tard';
  if(welcomeStep===1)renderThemes('welcome-themes',current?.theme);
  if(welcomeStep===2)renderWelcomeEngines();
  if(welcomeStep===4)renderImportSources('welcome-import');
  if(welcomeStep===WELCOME_LAST){
    const exists=Boolean(current?.passwords?.exists);
    $('welcome-vault-done').classList.toggle('hidden',!exists);
    for(const id of ['welcome-master','welcome-master2'])$(id).disabled=exists;
  }
}
async function applyWelcomeProtection(){
  const p=current?.preferences||{};
  const ad=$('welcome-adblock').checked;
  if(ad!==(current?.adblock?.enabled!==false))await run(()=>api.adblockToggle(ad));
  for(const [key,id] of [['shieldAnnoyances','welcome-annoyances'],['shieldBoost','welcome-boost'],['vpnAtStartup','welcome-vpn']]){
    const v=$(id).checked;if(v!==Boolean(p[key]))await run(()=>api.preference(key,v));
  }
  const country=$('welcome-vpn-country').value;
  if(country!==(p.vpnCountry||''))await run(()=>api.preference('vpnCountry',country));
}
async function finishWelcome(){
  const ref=$('welcome-ref').value.trim();if(ref&&!current?.referral?.referredBy)await run(()=>api.refClaim(ref),'Merci ! Ton parrain a été enregistré.');
  await run(()=>api.welcomed());await showPanel('');
  notify('Bienvenue dans DevGitBrowser ! Bonne navigation.'+($('welcome-vpn').checked?' Le VPN se connectera au prochain démarrage.':''));
}
$('welcome-next').addEventListener('click',async()=>{
  if(welcomeStep===3)await applyWelcomeProtection();
  if(welcomeStep===WELCOME_LAST&&!current?.passwords?.exists){
    const a=$('welcome-master').value,b=$('welcome-master2').value;
    if(a||b){
      if(a!==b){notify('Les deux mots de passe ne correspondent pas.',true);return;}
      const ok=await run(()=>api.pwCreate(a),'Coffre à mots de passe créé.');if(!ok)return;
      $('welcome-master').value='';$('welcome-master2').value='';
    }
  }
  if(welcomeStep>=WELCOME_LAST){finishWelcome();return;}
  welcomeStep++;showWelcomeStep();
});
$('welcome-skip').addEventListener('click',async()=>{
  if(welcomeStep===0||welcomeStep===WELCOME_LAST){finishWelcome();return;}
  if(welcomeStep===3)await applyWelcomeProtection();
  welcomeStep++;showWelcomeStep();
});
$('welcome-master').addEventListener('input',()=>showStrength($('welcome-master'),$('welcome-strength-bar'),$('welcome-strength')));

// ---------------------------------------------------------------- Coffre : fuites, import CSV, générateur, coordonnées
let breaches=null;
$('vault-breach').addEventListener('click',async()=>{
  const btn=$('vault-breach');btn.disabled=true;$('vault-breach-status').textContent='Vérification auprès de Have I Been Pwned…';
  const r=await run(()=>api.pwBreach());btn.disabled=false;
  if(!r){$('vault-breach-status').textContent='';return;}
  breaches=r;const hits=Object.values(r).filter(n=>n>0).length;
  $('vault-breach-status').textContent=hits?`⚠ ${hits} mot(s) de passe trouvé(s) dans des fuites de données : change-les.`:'✅ Aucun mot de passe trouvé dans les fuites connues.';
  loadVault();
});
async function loadExportHelp(){
  const list=$('vault-export-help');if(list.childElementCount)return;
  const srcs=importSourcesCache||await run(()=>api.importSources())||[];importSourcesCache=srcs;
  const seen=new Set();const items=[];
  for(const s of srcs){if(seen.has(s.browser)||!s.help)continue;seen.add(s.browser);const li=elem('li');li.append(elem('b','',s.browser+' : '),document.createTextNode(s.help));items.push(li);}
  if(!items.length)items.push(elem('li','','Chrome : chrome://password-manager/settings · Edge : edge://wallet/passwords · Firefox : about:logins → ⋯ → Exporter'));
  list.replaceChildren(...items);
}
$('vault-import').addEventListener('click',()=>{const d=$('vault-import-card');d.open=true;loadExportHelp();d.scrollIntoView({behavior:'smooth'});});
$('vault-import-card').addEventListener('toggle',()=>{if($('vault-import-card').open)loadExportHelp();});
$('vault-import-go').addEventListener('click',async()=>{
  const r=await run(()=>api.pwImportCsv($('vault-import-remove').checked));
  if(!r)return;
  notify(`Import terminé : ${r.added} ajouté(s), ${r.updated} mis à jour, ${r.skipped} ignoré(s).`+(r.removed?' Fichier CSV supprimé.':r.removed===false?' ⚠ Le CSV n’a pas pu être supprimé : efface-le toi-même.':''));
  $('vault-import-card').open=false;loadVault();
});
async function generateInto(){
  const v=await run(()=>api.pwGenerate(Number($('gen-len').value),{digits:$('gen-digits').checked,symbols:$('gen-symbols').checked}));
  if(v)$('gen-out').value=v;
}
$('gen-len').addEventListener('input',()=>{$('gen-len-value').textContent=$('gen-len').value;generateInto();});
for(const id of ['gen-digits','gen-symbols','gen-new'])$(id).addEventListener(id==='gen-new'?'click':'change',generateInto);
$('gen-copy').addEventListener('click',()=>{if($('gen-out').value){api.achEvent('generated').catch(()=>{});}if($('gen-out').value)navigator.clipboard.writeText($('gen-out').value).then(()=>notify('Mot de passe copié.'),()=>notify('Copie impossible.',true));});
const PF=['label','givenName','familyName','email','tel','organization','street','street2','postalCode','city','country'];
async function loadProfiles(){
  if(!current?.passwords?.unlocked)return;
  const list=await run(()=>api.pwProfiles());if(!list)return;
  const host=$('profile-list');
  if(!list.length){host.replaceChildren(elem('div','empty-list','Aucun profil. Ajoute tes coordonnées pour remplir les formulaires en un clic.'));return;}
  host.replaceChildren(...list.map(p=>{
    const row=elem('div','item-row');const text=elem('span','item-text');
    text.append(elem('strong','',p.label||[p.givenName,p.familyName].filter(Boolean).join(' ')||p.email||'Profil'),elem('small','',[p.email,p.city].filter(Boolean).join(' · ')));
    const edit=elem('button','outline small-btn','Modifier');edit.type='button';edit.addEventListener('click',()=>openProfile(p));
    const del=elem('button','icon-btn','✕');del.type='button';del.title='Supprimer';
    del.addEventListener('click',async()=>{if(await run(()=>api.pwProfileDelete(p.id),'Profil supprimé.'))loadProfiles();});
    row.append(text,edit,del);return row;
  }));
}
function openProfile(p){
  $('pf-id').value=p?.id||'';for(const k of PF)$('pf-'+k).value=p?.[k]||'';
  $('profile-form').classList.remove('hidden');$('profile-add').classList.add('hidden');$('pf-label').focus();
}
function closeProfile(){$('profile-form').classList.add('hidden');$('profile-add').classList.remove('hidden');}
$('profile-add').addEventListener('click',()=>openProfile(null));
$('pf-cancel').addEventListener('click',closeProfile);
$('profile-form').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const data={};for(const k of PF)data[k]=$('pf-'+k).value.trim();if($('pf-id').value)data.id=$('pf-id').value;
  const ok=await run(()=>api.pwProfileSave(data),'Coordonnées enregistrées dans le coffre.');
  if(ok){closeProfile();loadProfiles();}
});
$('profiles-card').addEventListener('toggle',()=>{if($('profiles-card').open)loadProfiles();});

// ======================================================================== Mode DGBx
let xRendered=false;
const X_FAV_KEY='dgbx-fav',X_RECENT_KEY='dgbx-recent';
const xStore={get:(k)=>{try{return JSON.parse(localStorage.getItem(k))||[];}catch{return [];}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}}};
function toggleXmode(){
  if(current?.xmode){run(()=>api.xExit(),'Mode DGBx fermé.');return;}
  const setup=current?.xmodeSetup||{};
  $('x-gate-first').classList.toggle('hidden',Boolean(setup.age));
  $('x-gate-code').classList.toggle('hidden',!(setup.age&&setup.code));
  $('x-age').checked=false;$('x-new-code').value='';$('x-enter-code').value='';
  if(setup.age&&!setup.code){run(()=>api.xEnter(''));return;}
  showPanel('xgate').then(()=>setTimeout(()=>(setup.age?$('x-enter-code'):$('x-age')).focus(),40));
}
$('x-gate-cancel').addEventListener('click',()=>showPanel(''));
$('x-gate-ok').addEventListener('click',async()=>{
  const setup=current?.xmodeSetup||{};
  const ok=setup.age?await run(()=>api.xEnter($('x-enter-code').value)):await run(()=>api.xSetup($('x-age').checked,$('x-new-code').value));
  $('x-new-code').value='';$('x-enter-code').value='';
  if(ok)await showPanel('');
});
for(const id of ['x-enter-code','x-new-code'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter')$('x-gate-ok').click();});
$('x-exit').addEventListener('click',()=>run(()=>api.xExit(),'Mode DGBx fermé.'));
$('x-code').addEventListener('click',async()=>{
  const now=current?.xmodeSetup?.code?prompt('Code actuel :'):'';if(now===null)return;
  const next=prompt('Nouveau code (4 à 8 chiffres, vide pour supprimer le code) :');if(next===null)return;
  await run(()=>api.xResetCode(now||'',next.trim()),next.trim()?'Code d’accès modifié.':'Code d’accès supprimé.');
});
function applyXmode(state){
  const on=Boolean(state.xmode);
  if(document.body.classList.contains('x-mode')!==on){
    document.body.classList.toggle('x-mode',on);
    for(const img of document.querySelectorAll('.brand-image,.footer-brand img'))img.src=on?'../assets/logo-dgbx-mark.png':'../assets/logo-mark.png';
  }
  $('x-exit').classList.toggle('hidden',!on);
  if(on&&!xRendered)renderXHome();
}
function xOpen(site){
  const recent=[site.url,...xStore.get(X_RECENT_KEY).filter(u=>u!==site.url)].slice(0,12);xStore.set(X_RECENT_KEY,recent);
  run(()=>api.xOpen(site.url)).then(()=>renderXHome());
}
function xCard(site,index){
  const card=elem('button','x-card');card.type='button';card.title=site.desc;
  card.style.setProperty('--hue',String((index*47)%360));
  const fav=xStore.get(X_FAV_KEY).includes(site.url);
  const art=elem('span','x-art');art.append(elem('b','',site.name.replace(/[^A-Za-z0-9&]/g,'').slice(0,2).toUpperCase()));
  const star=elem('span','x-fav'+(fav?' on':''),fav?'♥':'♡');star.title=fav?'Retirer de ma liste':'Ajouter à ma liste';
  star.addEventListener('click',ev=>{ev.stopPropagation();const list=xStore.get(X_FAV_KEY);xStore.set(X_FAV_KEY,fav?list.filter(u=>u!==site.url):[site.url,...list]);renderXHome();});
  const info=elem('span','x-info');
  info.append(elem('strong','',site.name),elem('small','',site.desc),elem('i','x-price x-'+site.price.toLowerCase(),site.price));
  card.append(art,star,info);
  card.addEventListener('click',()=>xOpen(site));
  return card;
}
function xRow(title,sites,offset=0){
  if(!sites.length)return null;
  const row=elem('section','x-row');const head=elem('div','x-row-head');head.append(elem('h3','',title));
  const track=elem('div','x-track');sites.forEach((site,i)=>track.append(xCard(site,i+offset)));
  const left=elem('button','x-nav left','‹'),right=elem('button','x-nav right','›');
  left.type=right.type='button';
  left.addEventListener('click',()=>track.scrollBy({left:-track.clientWidth*0.85,behavior:'smooth'}));
  right.addEventListener('click',()=>track.scrollBy({left:track.clientWidth*0.85,behavior:'smooth'}));
  row.append(head,left,track,right);return row;
}
function renderXHome(){
  xRendered=true;
  const catalog=window.DGBX_CATALOG||[];
  const all=catalog.flatMap(c=>c.sites);
  const q=$('x-search').value.trim().toLowerCase();
  const rows=[];
  if(q){
    rows.push(xRow(`Résultats pour « ${$('x-search').value.trim()} »`,all.filter(s=>(s.name+' '+s.desc+' '+s.tags.join(' ')).toLowerCase().includes(q))));
  }else{
    const favs=xStore.get(X_FAV_KEY).map(u=>all.find(s=>s.url===u)).filter(Boolean);
    const recent=xStore.get(X_RECENT_KEY).map(u=>all.find(s=>s.url===u)).filter(Boolean);
    rows.push(xRow('♥ Ma liste',favs,3),xRow('Reprendre',recent,7));
    catalog.forEach((c,i)=>rows.push(xRow(c.title,c.sites,i*5)));
  }
  const list=rows.filter(Boolean);
  $('x-rows').replaceChildren(...(list.length?list:[elem('p','x-empty','Aucune plateforme ne correspond.')]));
  $('x-chips').replaceChildren(...catalog.map(c=>{const b=elem('button','x-chip',c.title.split(' · ')[0]);b.type='button';
    b.addEventListener('click',()=>{$('x-search').value='';renderXHome();document.querySelectorAll('.x-row')[catalog.indexOf(c)+(xStore.get(X_FAV_KEY).length?1:0)+(xStore.get(X_RECENT_KEY).length?1:0)]?.scrollIntoView({behavior:'smooth',block:'start'});});return b;}));
}
$('x-search').addEventListener('input',()=>{clearTimeout(suggestTimer);suggestTimer=setTimeout(renderXHome,150);});
$('x-random').addEventListener('click',()=>{const free=(window.DGBX_CATALOG||[]).flatMap(c=>c.sites).filter(s=>s.price!=='Payant');xOpen(free[Math.floor(Math.random()*free.length)]);});


// ======================================================================== Horloge et météo
// Petites images météo (SVG dessinés, sans dépendance externe).
const W_SUN='<g class="w-sun"><circle cx="12" cy="12" r="4.6" fill="#ffc83d"/><g stroke="#ffc83d" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M5.4 18.6 7 17M17 7l1.6-1.6"/></g></g>';
const W_SMALLSUN='<g class="w-sun"><circle cx="8.5" cy="8.5" r="3.6" fill="#ffc83d"/><g stroke="#ffc83d" stroke-width="1.6" stroke-linecap="round"><path d="M8.5 1.8v1.6M1.8 8.5h1.6M3.7 3.7l1.1 1.1M13.3 3.7l-1.1 1.1M3.7 13.3l1.1-1.1"/></g></g>';
const W_MOON='<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z" fill="#d9e2ff"/>';
const W_SMALLMOON='<path d="M10 2.2a6 6 0 1 0 4.2 9.6A5 5 0 0 1 10 2.2z" fill="#d9e2ff"/>';
const W_CLOUD=(y=0,c='#e8eefc')=>`<path transform="translate(0 ${y})" d="M7 18.5h10.2a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2-1.2A4.4 4.4 0 0 0 7 18.5z" fill="${c}"/>`;
const W_DROPS='<g stroke="#4fa8ff" stroke-width="1.9" stroke-linecap="round"><path d="M8.5 19.5l-1 2.6M12.5 19.5l-1 2.6M16.5 19.5l-1 2.6"/></g>';
const W_FINEDROPS='<g fill="#4fa8ff"><circle cx="8.5" cy="20.6" r="1"/><circle cx="12.5" cy="21.4" r="1"/><circle cx="16.5" cy="20.6" r="1"/></g>';
const W_SNOW='<g fill="#ffffff"><circle cx="8.5" cy="20.4" r="1.25"/><circle cx="12.5" cy="21.6" r="1.25"/><circle cx="16.5" cy="20.4" r="1.25"/></g>';
const W_BOLT='<path d="M12.8 16.5 10 21h2.6l-1.2 3 4-5.2h-2.7l1.6-2.3z" fill="#ffd23d"/>';
const W_FOG='<g stroke="#c9d3ea" stroke-width="1.8" stroke-linecap="round"><path d="M4 9h16M6 13h12M4 17h16"/></g>';
const WEATHER_ICONS={
  sun:W_SUN, moon:W_MOON,
  partly:W_SMALLSUN+W_CLOUD(1), 'partly-night':W_SMALLMOON+W_CLOUD(1),
  cloud:W_CLOUD(0,'#dfe6f7'), fog:W_FOG,
  drizzle:W_CLOUD(-3,'#c9d4ec')+W_FINEDROPS, rain:W_CLOUD(-3,'#b7c4e0')+W_DROPS,
  showers:W_SMALLSUN+W_CLOUD(-2,'#c9d4ec')+W_DROPS, snow:W_CLOUD(-3,'#e8eefc')+W_SNOW, storm:W_CLOUD(-3,'#9eabc8')+W_BOLT,
};
function weatherSvg(kind){return `<svg viewBox="0 0 24 24" class="w-ico w-${kind}" aria-hidden="true">${WEATHER_ICONS[kind]||WEATHER_ICONS.cloud}</svg>`;}

const clockFmt=new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'});
const uiLocale=()=>current?.lang==='en'?'en-GB':'fr-FR';
const dateFmt={format:d=>d.toLocaleDateString(uiLocale(),{weekday:'long',day:'numeric',month:'long',year:'numeric'})};
function tickClock(){const now=new Date();$('clock').textContent=clockFmt.format(now);$('clock').title=dateFmt.format(now);}
tickClock();setTimeout(()=>{tickClock();setInterval(tickClock,60_000);},(60-new Date().getSeconds())*1000+50);
function updateClockWeather(state){
  const showClock=state.preferences?.showClock!==false;
  $('clock').classList.toggle('hidden',!showClock);
  const w=state.weather?.now;
  $('weather-pill').classList.toggle('hidden',!w);
  if(w){if($('weather-icon').dataset.kind!==w.icon){$('weather-icon').innerHTML=weatherSvg(w.icon);$('weather-icon').dataset.kind=w.icon;}$('weather-temp').textContent=`${w.temp}°`;$('weather-place').textContent=w.city;$('weather-pill').title=`${w.city} : ${w.temp} °C, ${w.label}${w.stale?' (hors ligne)':''}`;}
  $('clock-weather').classList.toggle('hidden',!showClock&&!w);
  if(document.activeElement!==$('weather-city'))$('weather-city').value=state.weather?.city||'';
  $('weather-status').textContent=w?`${w.city} : ${w.temp} °C, ${w.label}. Laisse vide et enregistre pour masquer la température.`:(state.weather?.city?`Ville : ${state.weather.city} (température en cours de chargement…)`:'Indique ta ville pour afficher la température à côté de l’horloge (source gratuite Open-Meteo, mise à jour toutes les 20 minutes).');
}
$('weather-form').addEventListener('submit',async e=>{
  e.preventDefault();const city=$('weather-city').value.trim();
  const res=await run(()=>api.weatherCity(city));
  if(res)notify(`Météo : ${res.name}${res.country?', '+res.country:''} enregistrée.`);else if(!city)notify('Température masquée.');
});
$('clock-weather').addEventListener('click',()=>{if(!current?.weather?.city){showPanel('settings').then(()=>setTimeout(()=>$('weather-city').focus(),60));}else run(()=>api.weatherRefresh());});

// ======================================================================== Panneau admin (%AdminDBG%)
const nf=new Intl.NumberFormat(uiLocale());
function openAdmin(){
  $('admin-lock').classList.remove('hidden');$('admin-dash').classList.add('hidden');
  $('admin-recover-form').classList.add('hidden');$('admin-newkey').classList.add('hidden');
  $('admin-key').value='';for(const id of ['admin-w1','admin-w2','admin-w3'])$(id).value='';
  showPanel('admin').then(()=>setTimeout(()=>$('admin-key').focus(),40));
}
async function closeAdmin(){await api.adminClose().catch(()=>{});$('admin-kpis').replaceChildren();$('admin-versions').replaceChildren();$('admin-community').replaceChildren();await showPanel('');}
$('admin-close').addEventListener('click',closeAdmin);
$('admin-unlock-form').addEventListener('submit',async e=>{
  e.preventDefault();const ok=await run(()=>api.adminUnlock($('admin-key').value));$('admin-key').value='';
  if(ok){$('admin-lock').classList.add('hidden');$('admin-dash').classList.remove('hidden');loadAdminStats();}
});
$('admin-lost').addEventListener('click',()=>{$('admin-recover-form').classList.toggle('hidden');$('admin-w1').focus();});
$('admin-recover-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const key=await run(()=>api.adminRecover([$('admin-w1').value,$('admin-w2').value,$('admin-w3').value]));
  for(const id of ['admin-w1','admin-w2','admin-w3'])$(id).value='';
  if(key){$('admin-newkey-value').textContent=key;$('admin-newkey').classList.remove('hidden');notify('Nouvelle clé admin générée.');}
});
$('admin-copy').addEventListener('click',()=>navigator.clipboard.writeText($('admin-newkey-value').textContent).then(()=>notify('Clé copiée.')).catch(()=>{}));
$('admin-refresh').addEventListener('click',loadAdminStats);
function kpi(label,value,hint){const box=elem('div','admin-kpi');box.append(elem('span','',label),elem('strong','',value));if(hint)box.append(elem('small','',hint));return box;}
const FLAG=cc=>/^[A-Z]{2}$/.test(cc)&&cc!=='ZZ'?String.fromCodePoint(...[...cc].map(c=>0x1F1E6+c.charCodeAt(0)-65)):'🏳️';
const regionNames={of:cc=>{try{return new Intl.DisplayNames([current?.lang==='en'?'en':'fr'],{type:'region'}).of(cc);}catch{return cc;}}};
const countryName=cc=>{if(cc==='ZZ')return 'Inconnu';try{return regionNames?.of(cc)||cc;}catch{return cc;}};
function bars(list,max,label){return list.map(([name,value])=>{const row=elem('div','admin-bar');const track=elem('div','admin-bar-track');const fill=elem('div','admin-bar-fill');fill.style.width=Math.max(2,Math.round(value/Math.max(1,max)*100))+'%';track.append(fill);row.append(elem('b','',name),track,elem('span','',label(value)));return row;});}
function renderServer(res){
  const srv=res.server;
  $('admin-server-setup').classList.toggle('hidden',Boolean(srv));$('admin-server-data').classList.toggle('hidden',!srv);
  if(!srv){
    $('admin-server-hint').textContent=res.serverError==='NO_SERVER'?'Le serveur de statistiques n’est pas encore relié à cette version du navigateur.':res.serverError==='NO_TOKEN'?`Serveur : ${res.serverUrl}. Colle le jeton affiché à la fin de l’installation sur ton VPS.`:`Serveur injoignable : ${res.serverError}`;
    $('admin-token-form').classList.toggle('hidden',res.serverError==='NO_SERVER');return;
  }
  $('admin-server-kpis').replaceChildren(
    kpi('Actifs aujourd’hui',nf.format(srv.active.today),`${nf.format(srv.active.week)} sur 7 j · ${nf.format(srv.active.month)} sur 30 j`),
    kpi('Utilisateurs au total',nf.format(srv.totalUsers),`+${nf.format(srv.newUsers30)} nouveaux sur 30 j`),
    kpi('Heures passées',nf.format(srv.hours.month)+' h',`${nf.format(srv.hours.today)} h aujourd’hui (30 derniers jours)`),
    kpi('Trafic généré',nf.format(srv.pages.month),`pages ouvertes sur 30 j · ${nf.format(srv.pages.today)} aujourd’hui`),
    kpi('Parrainages',nf.format(srv.referrals?.total||0),srv.referrals?.top?.length?'Meilleur code : '+srv.referrals.top[0][0]+' ('+srv.referrals.top[0][1]+')':'Aucun pour l’instant'),
    kpi('Rapports de bug',nf.format(srv.bugs||0),'Reçus depuis le navigateur'));
  const byDay=new Map(srv.daily.map(d=>[d.day,d]));
  const days=[...Array(30)].map((_,i)=>{const k=new Date(Date.now()-(29-i)*86400000).toISOString().slice(0,10);return byDay.get(k)||{day:k,users:0,hours:0,pages:0};});
  const maxDay=Math.max(1,...days.map(d=>d.users));
  $('admin-daily').replaceChildren(...days.map(d=>{const col=elem('div','admin-day');const bar=elem('i');bar.style.height=(d.users?Math.max(3,Math.round(d.users/maxDay*100)):0)+'%';col.title=`${d.day} : ${d.users} utilisateurs, ${d.hours} h, ${d.pages} pages`;col.append(bar);return col;}));
  $('admin-countries').replaceChildren(...(srv.countries.length?srv.countries.slice(0,10).map(([cc,n])=>{const li=elem('li');li.append(elem('span','',`${FLAG(cc)} ${countryName(cc)}`),elem('b','',nf.format(n)));return li;}):[elem('li','muted','Pas encore de données.')]));
  const r=srv.rating;const maxR=Math.max(1,...r.distribution);
  const head=elem('div','admin-rating-head');head.append(elem('strong','',r.count?String(r.average).replace('.',','):'—'),elem('span','',r.count?`★ sur 5 · ${nf.format(r.count)} avis`:'Aucun avis pour l’instant'));
  $('admin-rating').replaceChildren(head,...bars([5,4,3,2,1].map(n=>[n+' ★',r.distribution[n-1]]),maxR,v=>nf.format(v)));
  $('admin-uversions').replaceChildren(...bars(srv.versions.map(([v,n])=>['v'+v,n]),Math.max(1,...srv.versions.map(v=>v[1])),v=>nf.format(v)+' util.'));
}

// ---- Carte du monde (v1.13)
const SVGNS='http://www.w3.org/2000/svg';
const svgEl=(tag,attrs)=>{const el=document.createElementNS(SVGNS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el;};
function renderMap(srv){
  const map=$('admin-map'),W=window.DGB_WORLD;if(!W)return;
  const live=srv.live?.countries||{},month=Object.fromEntries(srv.countries||[]);
  const total=srv.live?.total||0;
  $('admin-live').replaceChildren(elem('i'),document.createTextNode(` ${nf.format(total)} en ligne maintenant`));
  const nodes=[svgEl('path',{d:W.d,class:'map-land'})];
  const maxM=Math.max(1,...Object.values(month)),maxL=Math.max(1,...Object.values(live));
  for(const [cc,n] of Object.entries(month)){const p=W.points[cc];if(!p)continue;const c=svgEl('circle',{cx:p[0],cy:p[1],r:(3+Math.sqrt(n/maxM)*14).toFixed(1),class:'map-month'});const t=svgEl('title',{});t.textContent=`${countryName(cc)} : ${n} actif(s) sur 30 jours`;c.append(t);nodes.push(c);}
  for(const [cc,n] of Object.entries(live)){const p=W.points[cc];if(!p)continue;const r=(3+Math.sqrt(n/maxL)*9).toFixed(1);
    const g=svgEl('g',{class:'map-live'});g.append(svgEl('circle',{cx:p[0],cy:p[1],r,class:'map-pulse'}),svgEl('circle',{cx:p[0],cy:p[1],r,class:'map-dot'}));
    const t=svgEl('title',{});t.textContent=`${countryName(cc)} : ${n} en ligne`;g.append(t);nodes.push(g);}
  map.replaceChildren(...nodes);
  const top=Object.entries(live).sort((a,b)=>b[1]-a[1]).slice(0,8);
  $('admin-live-list').replaceChildren(...(top.length?top.map(([cc,n])=>elem('span','',`${FLAG(cc)} ${countryName(cc)} · ${nf.format(n)}`)):[elem('span','muted','Personne en ligne en ce moment (statistiques activées uniquement).')]));
}
// ---- Rapports de bug
let adminBugs=[];
const BUG_STATUS={new:'🆕 Nouveau',seen:'👀 Vu',fixed:'✅ Corrigé'};
async function loadAdminBugs(){adminBugs=await run(()=>api.adminRemote('bugs'))||[];renderAdminBugs();}
function renderAdminBugs(){
  const f=$('admin-bug-filter').value;
  const list=adminBugs.filter(b=>f==='all'||(f==='fixed'?b.status==='fixed':b.status!=='fixed'));
  if(!list.length){$('admin-bug-list').replaceChildren(elem('div','empty-list','Aucun rapport ici.'));return;}
  $('admin-bug-list').replaceChildren(...list.map(b=>{
    const box=elem('details','admin-bug '+b.status);const sum=elem('summary');
    sum.append(elem('b','',BUG_STATUS[b.status]||b.status),elem('span','',new Date(b.at).toLocaleString(uiLocale())+` · v${b.v} · ${FLAG(b.cc)} ${b.os}`),elem('em','',b.text.slice(0,90)));
    box.append(sum,elem('p','admin-bug-text',b.text));
    if(b.contact)box.append(elem('p','muted','Contact : '+b.contact));
    if(b.log)box.append(elem('pre','bug-preview',b.log));
    const actions=elem('div','form-buttons');
    for(const [st,label] of [['seen','Marquer vu'],['fixed','Marquer corrigé'],['new','Remettre à traiter']])if(b.status!==st){const btn=elem('button','outline small-btn',label);btn.type='button';btn.addEventListener('click',async()=>{if(await run(()=>api.adminRemote('bug-status',b.id,st))){b.status=st;renderAdminBugs();}});actions.append(btn);}
    const del=elem('button','outline small-btn danger','Supprimer');del.type='button';del.addEventListener('click',async()=>{if(await run(()=>api.adminRemote('bug-delete',b.id))!==null){adminBugs=adminBugs.filter(x=>x!==b);renderAdminBugs();}});
    actions.append(del);box.append(actions);return box;
  }));
}
$('admin-bug-filter').addEventListener('change',renderAdminBugs);
// ---- Messages ciblés et arrêt d'urgence
const KILL_FEATURES={store:'Boutique',preview:'Aperçu des liens',media:'Lecteur protégé',vpn:'VPN',import:'Import',telemetry:'Statistiques'};
let adminConfig=null;
async function loadAdminConfig(){
  adminConfig=await run(()=>api.adminRemote('config'));if(!adminConfig)return;
  $('ak-versions').value=adminConfig.kill?.versions||'';$('ak-message').value=adminConfig.kill?.message||'';
  $('ak-features').replaceChildren(...Object.entries(KILL_FEATURES).map(([id,label])=>{const l=elem('label','check-line');const c=elem('input');c.type='checkbox';c.value=id;c.checked=(adminConfig.kill?.features||[]).includes(id);l.append(c,document.createTextNode(' '+label));return l;}));
  renderAdminMessages();$('admin-remote-status').textContent='';
}
function renderAdminMessages(){
  const msgs=adminConfig?.messages||[];
  if(!msgs.length){$('admin-msg-list').replaceChildren(elem('div','empty-list','Aucun message actif.'));return;}
  $('admin-msg-list').replaceChildren(...msgs.map((m,i)=>{
    const row=elem('div','item-row');const text=elem('span','item-text');
    text.append(elem('strong','',(m.level==='warning'?'⚠️ ':'📣 ')+m.text),elem('small','',`versions ${m.versions}`+(m.countries?.length?` · pays ${m.countries.join(', ')}`:' · tous pays')+(m.until?` · jusqu’au ${m.until}`:'')+(m.url?' · '+m.url:'')));
    const del=elem('button','icon-btn','✕');del.type='button';del.title='Retirer';del.addEventListener('click',()=>{adminConfig.messages.splice(i,1);renderAdminMessages();$('admin-remote-status').textContent='Modifications non publiées.';});
    row.append(text,del);return row;
  }));
}
$('admin-msg-form').addEventListener('submit',e=>{
  e.preventDefault();if(!adminConfig)return;
  const text=$('am-text').value.trim();if(!text){notify('Écris le texte du message.',true);return;}
  adminConfig.messages=[...(adminConfig.messages||[]),{text,level:$('am-level').value,versions:$('am-versions').value.trim()||'*',countries:$('am-countries').value,until:$('am-until').value,url:$('am-url').value.trim()}];
  for(const id of ['am-text','am-versions','am-countries','am-until','am-url'])$(id).value='';
  renderAdminMessages();$('admin-remote-status').textContent='Modifications non publiées.';
});
$('admin-remote-save').addEventListener('click',async()=>{
  if(!adminConfig)return;
  const body={messages:adminConfig.messages||[],kill:{versions:$('ak-versions').value.trim(),message:$('ak-message').value.trim(),features:[...$('ak-features').querySelectorAll('input:checked')].map(c=>c.value)}};
  if((body.kill.versions||body.kill.features.length)&&!confirm('Activer l’arrêt d’urgence pour '+(body.kill.versions||'aucune version')+(body.kill.features.length?' et couper : '+body.kill.features.map(f=>KILL_FEATURES[f]).join(', '):'')+' ?'))return;
  const r=await run(()=>api.adminRemote('config-save',body),'Configuration publiée : les navigateurs la reçoivent dans les 6 heures (immédiatement ici).');
  if(r){adminConfig=r;renderAdminMessages();$('admin-remote-status').textContent='✅ Publié';}
});
async function loadAdminStats(){
  $('admin-updated').textContent='Chargement…';
  const res=await run(()=>api.adminStats());
  if(!res){$('admin-updated').textContent='Statistiques indisponibles.';return;}
  $('admin-updated').textContent='Mis à jour à '+clockFmt.format(new Date());
  renderServer(res);
  if(res.server){renderMap(res.server);loadAdminBugs();loadAdminConfig();}
  loadAdminStore();
  const st=res.github;
  if(!st){$('admin-kpis').replaceChildren(elem('p','muted','GitHub : '+res.githubError));$('admin-versions').replaceChildren();$('admin-community').replaceChildren();return;}
  $('admin-kpis').replaceChildren(
    kpi('Installations',nf.format(st.totals.installs),'Téléchargements de l’installateur'),
    kpi('Vérifications / jour',st.activity?nf.format(st.activity.checksPerDay):'—',st.activity?`Mises à jour vérifiées, version ${st.activity.version}`:''),
    kpi('Mises à jour installées',nf.format(st.totals.updates),'Mises à jour automatiques téléchargées'),
    kpi('Versions publiées',nf.format(st.totals.releases),''));
  const max=Math.max(1,...st.versions.map(v=>v.installs+v.updates));
  $('admin-versions').replaceChildren(...st.versions.map(v=>{
    const row=elem('div','admin-bar');const bar=elem('div','admin-bar-fill');bar.style.width=Math.max(2,Math.round((v.installs+v.updates)/max*100))+'%';
    const track=elem('div','admin-bar-track');track.append(bar);
    row.append(elem('b','',v.tag),track,elem('span','',`${nf.format(v.installs)} install. · ${nf.format(v.updates)} MAJ`));return row;}));
  $('admin-community').replaceChildren(kpi('★ Étoiles',nf.format(st.repo.stars),'Les gens qui aiment le projet'),kpi('Abonnés',nf.format(st.repo.watchers),''),kpi('Forks',nf.format(st.repo.forks),''),kpi('Signalements ouverts',nf.format(st.repo.openIssues),'Bugs / demandes sur GitHub'));
}
$('admin-token-form').addEventListener('submit',async e=>{e.preventDefault();const ok=await run(()=>api.adminSetToken($('admin-token').value),'Jeton du serveur enregistré (chiffré).');$('admin-token').value='';if(ok)loadAdminStats();});
$('admin-token-change').addEventListener('click',()=>{$('admin-server-data').classList.add('hidden');$('admin-server-setup').classList.remove('hidden');$('admin-token-form').classList.remove('hidden');$('admin-server-hint').textContent='Colle le nouveau jeton du serveur.';$('admin-token').focus();});

// ======================================================================== Statistiques anonymes et note
function updateTelemetry(state){
  const tm=state.telemetry||{};
  renderRemote(state);renderTrophy(state);
  {const by=state.referral?.referredBy||'';$('welcome-ref-box').classList.toggle('hidden',Boolean(by));$('welcome-ref-done').classList.toggle('hidden',!by);
   if(by)$('welcome-ref-done').textContent=state.referral.auto?`🎁 Parrainage validé automatiquement : code ${by}. Merci !`:`🎁 Parrainé par le code ${by}. Merci !`;}
  $('tm-banner').classList.toggle('hidden',!(tm.available&&!tm.asked&&state.welcomed&&!state.xmode));
  $('telemetry-line').classList.toggle('hidden',!tm.available);
  $('rate-card').classList.toggle('hidden',!tm.available);
  const box=$('rate-stars');
  if(box.dataset.value!==String(tm.rating||0)||!box.childElementCount){
    box.dataset.value=String(tm.rating||0);
    box.replaceChildren(...[1,2,3,4,5].map(n=>{const b=elem('button',n<=(tm.rating||0)?'on':'','★');b.type='button';b.title=`${n} sur 5`;b.setAttribute('role','radio');b.setAttribute('aria-checked',String(n===tm.rating));b.addEventListener('click',()=>run(()=>api.rate(n),'Merci pour ta note !'));return b;}));
    $('rate-text').textContent=tm.rating?`Ta note : ${tm.rating}/5. Tu peux la changer à tout moment.`:'Note DevGitBrowser : ta note anonyme aide à savoir si le navigateur plaît.';
  }
}
$('tm-yes').addEventListener('click',()=>run(()=>api.telemetryConsent(true),'Merci ! Statistiques anonymes activées.'));
$('tm-no').addEventListener('click',()=>run(()=>api.telemetryConsent(false),'Aucune statistique ne sera envoyée.'));


// ======================================================================== DevGit Store
let storeItems=[],storeBusy=new Set();
const fmtSize=n=>n>1048576?(n/1048576).toFixed(1).replace('.',',')+' Mo':Math.max(1,Math.round(n/1024))+' Ko';
async function loadStore(force){
  if(!current?.storeAvailable){$('store-card').classList.add('hidden');return;}
  $('store-card').classList.remove('hidden');
  try{storeItems=await api.storeCatalog(force);renderStore();}
  catch(e){$('store-list').replaceChildren(elem('div','empty-list','Catalogue indisponible : '+String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'')));}
}
function renderStore(){
  const q=$('store-search').value.trim().toLowerCase();
  const items=storeItems.filter(e=>!q||(e.name+' '+e.description+' '+e.author).toLowerCase().includes(q));
  if(!items.length){$('store-list').replaceChildren(elem('div','empty-list',storeItems.length?'Aucune extension ne correspond.':'Aucune extension publiée pour le moment.'));return;}
  $('store-list').replaceChildren(...items.map(e=>{
    const card=elem('div','store-item');const icon=elem('span','store-icon',(e.name.match(/[A-Za-z0-9]/g)||['?']).slice(0,2).join('').toUpperCase());
    icon.style.setProperty('--h',String([...e.id].reduce((n,c)=>n+c.charCodeAt(0),0)%360));
    const info=elem('div','store-info');info.append(elem('strong','',e.name),elem('small','',`v${e.version}${e.author?' · '+e.author:''} · ${fmtSize(e.size)} · ${e.installs} installation${e.installs>1?'s':''}`));
    if(e.description)info.append(elem('p','',e.description));
    const actions=elem('div','store-actions');const busy=storeBusy.has(e.id);
    if(e.installed){
      if(e.update){const up=elem('button','primary small-btn',busy?'…':'Mettre à jour');up.type='button';up.disabled=busy;up.addEventListener('click',()=>storeAction(e,'install'));actions.append(up);}
      else actions.append(elem('span','ext-ok','INSTALLÉE'));
      const rm=elem('button','outline small-btn',busy?'…':'Désinstaller');rm.type='button';rm.disabled=busy;rm.addEventListener('click',()=>storeAction(e,'uninstall'));actions.append(rm);
    }else{const add=elem('button','primary small-btn',busy?'Installation…':'Installer');add.type='button';add.disabled=busy;add.addEventListener('click',()=>storeAction(e,'install'));actions.append(add);}
    card.append(icon,info,actions);return card;}));
}
async function storeAction(e,what){
  if(what==='install'&&!e.installed){
    const d=await run(()=>api.storeDetails(e.id));if(!d)return;
    const perms=d.permissions.length?'\n\nAutorisations demandées :\n• '+d.permissions.join('\n• '):'\n\nAucune autorisation particulière.';
    if(!confirm(`Installer « ${d.name} » v${d.version} ?${perms}`))return;
  }
  if(what==='uninstall'&&!confirm(`Désinstaller « ${e.name} » ?`))return;
  storeBusy.add(e.id);renderStore();
  const ok=await run(()=>what==='install'?api.storeInstall(e.id):api.storeUninstall(e.id),what==='install'?(e.installed?`${e.name} mise à jour.`:`${e.name} installée.`):`${e.name} désinstallée.`);
  storeBusy.delete(e.id);await loadStore(true);if(!ok)renderStore();
}
$('store-refresh').addEventListener('click',()=>loadStore(true));
$('store-search').addEventListener('input',renderStore);

// Admin : publication
async function loadAdminStore(){
  const box=$('admin-store-list');
  if(!current?.storeAvailable){box.replaceChildren(elem('div','empty-list','Aucun serveur DevGit configuré.'));return;}
  let list;try{list=await api.storeCatalog(true);}catch(e){box.replaceChildren(elem('div','empty-list','Catalogue indisponible.'));return;}
  if(!list.length){box.replaceChildren(elem('div','empty-list','Aucune extension publiée.'));return;}
  box.replaceChildren(...list.map(e=>{const row=elem('div','extension-row');const d=elem('div','ext-detail');
    d.append(elem('strong','',`${e.name} · v${e.version}`),elem('small','',`${e.id} · ${fmtSize(e.size)} · ${e.installs} installation${e.installs>1?'s':''} · mise à jour ${new Date(e.updated).toLocaleDateString(uiLocale())}`));
    const rm=elem('button','outline small-btn danger','Retirer');rm.type='button';
    rm.addEventListener('click',async()=>{if(!confirm(`Retirer « ${e.name} » de la boutique ? Les navigateurs qui l’ont déjà la gardent.`))return;if(await run(()=>api.storeUnpublish(e.id),'Extension retirée de la boutique.'))loadAdminStore();});
    row.append(elem('span','extension-ico','🧩'),d,rm);return row;}));
}
$('admin-store-publish').addEventListener('click',async()=>{
  const btn=$('admin-store-publish');btn.disabled=true;btn.textContent='Publication…';
  const r=await run(()=>api.storePublish($('admin-store-id').value.trim()));
  btn.disabled=false;btn.textContent='Publier une extension…';
  if(r){notify(`« ${r.name} » v${r.version} publiée sur la boutique.`);$('admin-store-id').value='';loadAdminStore();}
});
