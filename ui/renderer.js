'use strict';
const api=window.DevGit;
const $=id=>document.getElementById(id);
const TAB_MIME='application/x-devgit-tab';
let current=null, panel='', toastTimer, statusTimer, libraryView='history', historyOffset=0, historyQuery='', suggestTimer, draggingTabId=null, draggingBookmark=null;
const panels=['github','extensions','security','settings','library','about'];
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
  panel=name||'';
  for(const key of panels)$(`panel-${key}`).classList.toggle('hidden',key!==panel);
  if(panel)closeFind(false);
  await api.panel(Boolean(panel));
  if(panel==='library')loadLibrary();
  if(panel==='about')loadAbout();
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
    const b=elem('div','tab'+(tab.id===state.activeId?' active':'')+(tab.loading?' loading':''));
    b.dataset.id=tab.id;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(tab.id===state.activeId));b.draggable=true;
    b.title=(tab.title||'Nouvel onglet')+(tab.url?'\n'+tab.url:'');
    const icon=tab.loading?elem('span','tab-spinner'):tab.url?favicon(tab.url,tab.title,tab.favicon):elem('span','tab-home','✦');
    const label=elem('span','tab-title',tab.title||'Nouvel onglet');
    b.append(icon,label);
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
  $('welcome').classList.toggle('hidden',hasPage);
  const secure=hasPage && t.url.startsWith('https://') && !t.error;
  const info=$('site-info');
  info.classList.toggle('secure',secure);info.classList.toggle('insecure',hasPage && !secure);info.classList.toggle('empty',!hasPage);
  info.title=!hasPage?'Saisis une adresse ou une recherche':secure?'Connexion chiffrée (HTTPS) — autorisations du site':'Connexion non chiffrée ou erreur — tes données peuvent être lues';
  $('engine-badge').classList.toggle('hidden',t?.engine!=='mshtml');
  const star=$('bookmark-star');
  star.disabled=!hasPage;star.classList.toggle('on',Boolean(state.bookmarkedHere));
  star.title=state.bookmarkedHere?'Retirer des favoris (Ctrl+D)':'Ajouter aux favoris (Ctrl+D)';
  $('pip-button').disabled=!hasPage || t?.engine!=='chromium';
  $('pip-button').classList.toggle('attention',Boolean(t?.audible));
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
  const updated=guard.lastUpdated?' · listes du '+new Date(guard.lastUpdated).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'';
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
  const label=g.syncing?'Synchronisation en cours…':g.lastError?`Dernière erreur : ${g.lastError}`:g.lastSync?`Dernière synchronisation : ${new Date(g.lastSync).toLocaleTimeString('fr-FR')}`:'';
  if(label)$('git-connected').textContent+=' · '+label;
  const list=$('extension-list');list.replaceChildren();
  const exts=state.extensions||[];
  $('extension-total').textContent=String(exts.length);
  if(!exts.length){list.append(elem('div','empty-list','Aucune extension chargée.'));}
  for(const ext of exts){
    const item=elem('div','extension-row');const ico=elem('span','extension-ico',ext.source==='included'?'⚡':'▦');
    const detail=elem('div','ext-detail');detail.append(elem('strong','',ext.name||ext.key),elem('small','',ext.source==='included'?`Officielle · fournie avec le navigateur · ${ext.version||'version inconnue'}`:`Dépôt GitHub privé · extensions/${ext.key} · ${ext.version||'version inconnue'}`));
    if(ext.error)detail.append(elem('small','error-message',ext.error));
    const stateLabel=elem('span',ext.loaded?'ext-ok':'ext-bad',ext.loaded?(ext.source==='included'?'INCLUSE':'CHARGÉE'):'ERREUR');
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
  updateTabs(state);updateToolbar(state);updateBookmarksBar(state);updateHome(state);
  if(panel==='security')updateSecurity(state);
  if(panel==='github'||panel==='extensions')updateGithub(state);
  if(panel==='settings'){updateProxy(state);updateSettings(state);updateSecurity(state);}
  if(panel==='library'||panel==='about')updateSettings(state);
  document.title=(activeTab()?.title||'Nouvel onglet')+' — DevGitBrowser';
}

// ---------------------------------------------------------------- Historique / favoris / téléchargements
function dayLabel(ts){
  const d=new Date(ts),today=new Date();today.setHours(0,0,0,0);
  const diff=Math.round((today-new Date(d).setHours(0,0,0,0))/86400000);
  if(diff===0)return 'Aujourd’hui';if(diff===1)return 'Hier';
  return d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:d.getFullYear()===today.getFullYear()?undefined:'numeric'});
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
    const time=new Date(entry.visitedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
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
  $('about-update').textContent=(labels[u.status]||'')+(u.lastCheck&&u.status==='none'?' · vérifié à '+new Date(u.lastCheck).toLocaleTimeString('fr-FR'):'');
  $('about-progress').classList.toggle('hidden',u.status!=='downloading');
  $('about-progress').firstElementChild.style.width=(u.progress||0)+'%';
  $('about-check').disabled=['checking','downloading','disabled'].includes(u.status);
  $('about-install').classList.toggle('hidden',u.status!=='downloaded');
}
async function loadAbout(){
  const info=await run(()=>api.about());if(!info)return;
  $('about-version').textContent='v'+info.version;
  const rows=[['Version',info.version+(info.packaged?'':' (développement)')],['Éditeur',info.author],['Chromium',info.chrome],['Electron',info.electron],['Node.js',info.node],['V8',info.v8],
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
function submitNavigation(value){return run(async()=>{if(panel)await showPanel('');await api.go(value);$('address').blur();});}
$('add-tab').addEventListener('click',()=>run(async()=>{await showPanel('');await api.newTab();$('address').focus();}));
$('back').addEventListener('click',()=>run(()=>api.back()));
$('forward').addEventListener('click',()=>run(()=>api.forward()));
$('reload').addEventListener('click',()=>run(()=>api.reload()));
$('home').addEventListener('click',()=>run(async()=>{await showPanel('');return api.home();}));
$('menu-button').addEventListener('click',()=>run(()=>api.menu()));
$('shield-button').addEventListener('click',()=>run(()=>api.shieldMenu()));
$('extensions-button').addEventListener('click',()=>run(()=>showPanel(panel==='extensions'?'':'extensions')));
$('site-info').addEventListener('click',()=>run(()=>showPanel(activeTab()?.url?(panel==='security'?'':'security'):'')).then(()=>{if(!activeTab()?.url)$('address').focus();}));
$('bookmark-star').addEventListener('click',()=>run(()=>api.toggleBookmark()));
$('pip-button').addEventListener('click',()=>run(()=>api.pip()).then(message=>{if(message)notify(message);}));
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
api.initial().then(state=>{render(state);reportChromeHeight();}).catch(err=>notify(err.message||String(err),true));
