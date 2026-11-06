'use strict';
const api=window.DevGit;
const $=id=>document.getElementById(id);
let current=null, panel='', toastTimer;
const panels=['github','extensions','security','proxy'];
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
  $('popup-toggle').disabled=!hasSite;$('popup-toggle').checked=Boolean(state.popupAllowedHere);
  $('revoke-media').disabled=!hasSite;
  $('popup-blocked-count').textContent=String(state.blockedPopups);
  $('camera-status').textContent='Caméra : '+(state.mediaHere.camera?'autorisée':'non autorisée');
  $('mic-status').textContent='Micro : '+(state.mediaHere.microphone?'autorisé':'non autorisé');
  $('security-button').classList.toggle('attention',state.blockedPopups>0);
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
function render(state){current=state;updateTabs(state);updateSecurity(state);updateGithub(state);updateProxy(state);}
function submitNavigation(value){return run(async()=>{if(panel)await showPanel('');await api.go(value);});}

$('add-tab').addEventListener('click',()=>run(async()=>{await showPanel('');return api.newTab();}));
$('detach').addEventListener('click',()=>run(()=>api.detachTab(),'Onglet déplacé dans une nouvelle fenêtre.'));
$('back').addEventListener('click',()=>run(()=>api.back()));
$('forward').addEventListener('click',()=>run(()=>api.forward()));
$('reload').addEventListener('click',()=>run(()=>api.reload()));
$('home').addEventListener('click',()=>run(async()=>{await showPanel('');return api.home();}));
$('devtools').addEventListener('click',()=>run(()=>api.inspect()));
$('address-form').addEventListener('submit',ev=>{ev.preventDefault();submitNavigation($('address').value);});
$('start-search').addEventListener('submit',ev=>{ev.preventDefault();submitNavigation($('start-address').value);});
$('open-babel').addEventListener('click',()=>submitNavigation('https://www.BabelVisio.com'));
const panelBindings={ 'security-button':'security','github-button':'github','extensions-button':'extensions','proxy-button':'proxy',
  'card-github':'github','card-extensions':'extensions','card-security':'security','goto-git':'github'};
for(const [id,name] of Object.entries(panelBindings))$(id).addEventListener('click',()=>run(()=>showPanel(name)));
for(const item of document.querySelectorAll('[data-close]'))item.addEventListener('click',()=>run(()=>showPanel('')));
$('popup-toggle').addEventListener('change',()=>run(()=>api.allowPopups($('popup-toggle').checked),$('popup-toggle').checked?'Pop-up autorisés pour ce site.':'Pop-up bloqués pour ce site.'));
$('revoke-media').addEventListener('click',()=>run(()=>api.revokeMedia(),'Autorisations caméra / micro révoquées pour ce site.'));
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
api.onState(render);api.onFocusAddress(()=>{if(panel)showPanel('').catch(()=>{});$('address').focus();$('address').select();});
api.initial().then(render).catch(err=>notify(err.message||String(err),true));
