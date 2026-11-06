'use strict';
const api=window.DevGit;
const $=id=>document.getElementById(id);
let current=null, panel='', toastTimer;
const panels=['github','extensions','security','settings'];
function notify(message, bad=false){
  const el=$('toast');el.textContent=message;el.classList.toggle('error',bad);el.classList.remove('hidden');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),4500);
}
async function run(fn, success=''){
  try{const result=await fn();if(success)notify(success);return result;}
  catch(err){notify(err?.message||String(err),true);return null;}
}
async function showPanel(name){
  panel=name||'';
  for(const key of panels)$(`panel-${key}`).classList.toggle('hidden',key!==panel);
  await api.panel(Boolean(panel));
}
function elem(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function updateTabs(state){
  const host=$('tabs');host.replaceChildren();
  for(const tab of state.tabs){
    const b=elem('div','tab'+(tab.id===state.activeId?' active':''));b.setAttribute('role','tab');b.setAttribute('aria-selected',String(tab.id===state.activeId));
    const icon=elem('span','tab-favicon',tab.loading?'◌':tab.url?'◈':'◇');
    const label=elem('span','tab-title',tab.title||'Nouvel onglet');label.title=tab.title;
    const x=elem('button','tab-x','×');x.type='button';x.title='Fermer';
    x.addEventListener('click',event=>{event.stopPropagation();run(()=>api.closeTab(tab.id));});
    b.append(icon,label,x);b.addEventListener('click',()=>run(()=>api.selectTab(tab.id)));
    host.append(b);
  }
  const t=state.tabs.find(x=>x.id===state.activeId);
  const address=$('address');
  if(document.activeElement!==address)address.value=t?.url||'';
  $('back').disabled=!t?.back;$('forward').disabled=!t?.forward;
  $('reload').textContent=t?.loading?'✕':'↻';
  $('welcome').classList.toggle('hidden',Boolean(t?.url));
  $('ssl-symbol').textContent=t?.url?.startsWith('https://')?'♢':'◇';
}
function updateSecurity(state){
  const hasSite=Boolean(state.currentOrigin);
  $('origin-label').textContent=state.currentOrigin||'Ouvrir un site HTTPS';
  $('popup-mode').disabled=!hasSite;
  $('popup-mode').value=state.popupOverrideHere;
  $('popup-topmost').disabled=!hasSite; $('popup-topmost').value=state.popupTopmostOverride||'default';
  $('popup-effective').textContent=state.popupModeHere==='allow'
    ?(state.popupDefaultBabel?'✓ BabelVisio : pop-ups vidéo autorisés automatiquement, avec filtre anti-abus.':'✓ Pop-ups autorisés pour ce site, avec filtre anti-abus.')
    :'● Pop-ups bloqués pour ce site. Tu peux les autoriser après vérification.';
  for(const key of ['camera','microphone','notifications','geolocation']){
    const el=$(`site-${key}`);el.disabled=!hasSite;el.value=state.privacyHere[key];
  }
  $('reset-site').disabled=!hasSite;
  $('popup-blocked-count').textContent=String(state.blockedPopups);
  $('camera-status').textContent='Caméra : '+(state.mediaHere.camera?'autorisée':'demande requise ou bloquée');
  $('mic-status').textContent='Micro : '+(state.mediaHere.microphone?'autorisé':'demande requise ou bloqué');
  $('security-button').classList.toggle('attention',state.blockedPopups>0);
  const h=state.legacyHere||{likely:false,hints:[]};
  const inIE=h.engine==='mshtml';
  const pendingIE=h.engine==='mshtml-pending';
  $('legacy-status').textContent=pendingIE?'Chargement du moteur historique Windows dans cet onglet…':h.error?'Échec IE : '+h.error:inIE?'Mode IE/MSHTML intégré dans cet onglet — rechargement automatique pour ce site : activé.':
    h.trusted?'Site déjà approuvé : mode IE automatique au prochain chargement.':
    h.likely?'⚠ Ancienne structure détectée : '+(h.hints||[]).join(' · ')+' — clique IE pour activer une première fois.':
    'Mode Chromium moderne. Le bouton IE permet de confier ce site au moteur historique et mémorise ton choix.';
  $('legacy-button').textContent=pendingIE?'IE …':inIE?'IE ✓':'IE';
  $('legacy-button').classList.toggle('attention',inIE||pendingIE||h.likely);
  $('legacy-button').title=pendingIE?'Annuler le chargement IE':inIE?'Revenir au mode moderne dans cet onglet':'Activer le moteur historique MSHTML dans cet onglet';
  $('settings-legacy').textContent=inIE?'Quitter le mode IE et revenir à Chromium':'IE • Activer pour ce site dans cet onglet';
}
function updateGithub(state){
  const g=state.github;
  $('git-indicator').classList.toggle('online',g.connected);
  $('git-connected').textContent=g.connected?
    `✓ Connecté à @${g.user} · ${g.repo?`Dépôt privé : ${g.repo} (${g.branch})`:'Aucun dépôt sélectionné'}` :
    '◌ Aucun compte GitHub connecté. Aucun dépôt accessible.';
  $('github-sync').disabled=!g.connected||!g.repo||g.syncing;
  $('extension-sync').disabled=!g.connected||!g.repo||g.syncing;
  if(g.repo && document.activeElement!==$('github-repo'))$('github-repo').value=g.repo;
  if(g.branch && document.activeElement!==$('github-branch'))$('github-branch').value=g.branch;
  const label=g.syncing?'Synchronisation en cours':g.lastError?`GitHub : ${g.lastError}`:
    g.lastSync?`Dernière synchro : ${new Date(g.lastSync).toLocaleTimeString('fr-FR')}`:
    (g.connected?'Compte GitHub relié':'Profil local isolé');
  $('status-message').textContent=label;
  const list=$('extension-list');list.replaceChildren();
  $('extension-counter').textContent=String(state.extensions.filter(x=>x.loaded).length);
  $('extension-total').textContent=String(state.extensions.length);
  if(!state.extensions.length)list.append(elem('div','empty-list','Aucune extension chargée. Ajoute un dossier dans « extensions/ » sur ton dépôt privé et publie-le sur GitHub.'));
  for(const ext of state.extensions){
    const item=elem('div','extension-row');
    const ico=elem('div','extension-ico',ext.loaded?'✓':'!');
    const detail=elem('div','ext-detail');detail.append(elem('strong','',ext.name||ext.key),elem('small','',`extensions/${ext.key} • ${ext.version||'version inconnue'}`));
    if(ext.error)detail.append(elem('small','error-message',ext.error));
    const stateLabel=elem('span',ext.loaded?'ext-ok':'ext-bad',ext.loaded?'CHARGÉE':'ERREUR');
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
  $('performance-mode').value=state.performance.mode;
  $('hardware-acceleration').checked=state.performance.hardwareAcceleration;
  $('downloads-folder').textContent=state.downloads.folder;
  $('zoom-value').textContent=`${Math.round(state.zoom*100)} %`;
}
function render(state){current=state;updateTabs(state);updateSecurity(state);updateGithub(state);updateProxy(state);updateSettings(state);}
function submitNavigation(value){return run(async()=>{if(panel)await showPanel('');await api.go(value);});}

$('add-tab').addEventListener('click',()=>run(async()=>{await showPanel('');return api.newTab();}));
$('detach').addEventListener('click',()=>run(()=>api.detachTab(),'Onglet déplacé dans une nouvelle fenêtre.'));
$('back').addEventListener('click',()=>run(()=>api.back()));
$('forward').addEventListener('click',()=>run(()=>api.forward()));
$('reload').addEventListener('click',()=>run(()=>api.reload()));
$('home').addEventListener('click',()=>run(async()=>{await showPanel('');return api.home();}));
$('devtools').addEventListener('click',()=>run(()=>api.inspect()));
const openNetwork=()=>run(()=>api.network(),'Analyse réseau ouverte dans une fenêtre indépendante.');
const openLegacy=()=>run(()=>api.legacy());
$('network-button').addEventListener('click',openNetwork);
$('legacy-button').addEventListener('click',openLegacy);
$('card-network').addEventListener('click',openNetwork);
$('settings-network').addEventListener('click',openNetwork);
$('settings-legacy').addEventListener('click',openLegacy);
function openFind(){if(panel)showPanel('').catch(()=>{});$('find-bar').classList.remove('hidden');$('find-text').focus();$('find-text').select();}
function closeFind(){api.stopFind().catch(()=>{});$('find-bar').classList.add('hidden');}
$('find-button').addEventListener('click',openFind);
$('find-text').addEventListener('input',()=>run(()=>api.find($('find-text').value,true)));
$('find-next').addEventListener('click',()=>run(()=>api.find($('find-text').value,true)));
$('find-prev').addEventListener('click',()=>run(()=>api.find($('find-text').value,false)));
$('find-close').addEventListener('click',closeFind);
$('find-text').addEventListener('keydown',e=>{if(e.key==='Escape')closeFind();else if(e.key==='Enter'){e.preventDefault();run(()=>api.find($('find-text').value,!e.shiftKey));}});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();openFind();}else if(e.key==='Escape'&&!$('find-bar').classList.contains('hidden'))closeFind();});
$('page-find').addEventListener('click',openFind);
$('page-print').addEventListener('click',()=>run(async()=>{await showPanel('');await api.print();}));
$('address-form').addEventListener('submit',ev=>{ev.preventDefault();submitNavigation($('address').value);});
$('start-search').addEventListener('submit',ev=>{ev.preventDefault();submitNavigation($('start-address').value);});
$('open-babel').addEventListener('click',()=>submitNavigation('https://www.BabelVisio.com'));
const panelBindings={ 'security-button':'security','github-button':'github','extensions-button':'extensions','proxy-button':'settings',
  'card-github':'github','card-extensions':'extensions','card-security':'security','goto-git':'github'};
for(const [id,name] of Object.entries(panelBindings))$(id).addEventListener('click',()=>run(()=>showPanel(name)));
for(const item of document.querySelectorAll('[data-close]'))item.addEventListener('click',()=>run(()=>showPanel('')));
$('popup-mode').addEventListener('change',()=>run(()=>api.allowPopups($('popup-mode').value),'Politique des fenêtres mise à jour.'));
$('popup-topmost').addEventListener('change',()=>run(()=>api.topmost($('popup-topmost').value),'Comportement des fenêtres Windows enregistré.'));
for(const key of ['camera','microphone','notifications','geolocation']){
  $(`site-${key}`).addEventListener('change',()=>run(()=>api.sitePrivacy(key,$(`site-${key}`).value),'Autorisation du site enregistrée.'));
}
$('reset-site').addEventListener('click',()=>run(()=>api.siteReset(),'Autorisations du site réinitialisées.'));
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
for(const [name,dir] of [['zoom-minus',-1],['zoom-plus',1],['zoom-reset',0]]){
  $(name).addEventListener('click',()=>run(()=>api.zoom(dir)));
}
$('downloads-choose').addEventListener('click',()=>run(()=>api.downloadFolder(),'Dossier des téléchargements mis à jour.'));
$('clear-cache').addEventListener('click',()=>run(()=>api.clearCache(),'Cache vidé.'));
$('clear-sites').addEventListener('click',async()=>{
  if(!confirm('Effacer les cookies et toutes les données des sites, y compris les données des extensions ? Cette action te déconnectera des services.'))return;
  await run(()=>api.clearSiteData(),'Données des sites supprimées.');
});
api.onLegacyError(message=>notify('Mode historique IE : '+message,true));
api.onLegacyReady(()=>notify('Mode IE chargé et affiché dans cet onglet.')); 
api.onFocusFind(openFind);api.onState(render);api.onFocusAddress(()=>{if(panel)showPanel('').catch(()=>{});$('address').focus();$('address').select();});
api.initial().then(render).catch(err=>notify(err.message||String(err),true));
