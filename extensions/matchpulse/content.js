/* MatchPulse — Panneau local en lecture seule sur les sites reconnus. */
(function(){
  'use strict';
  const core=globalThis.MatchPulseCore;
  const bookmaker=core?.detectBookmaker(location.hostname);
  if(!bookmaker || !document.documentElement || document.getElementById('mp-root')) return;
  const selections=[];
  const tracked=[];
  const latestAlerts=[];
  let active=false, apiConfigured=false, pollTimer=null, pollBusy=false, pollNumber=0;
  const root=document.createElement('div');root.id='mp-root';
  root.innerHTML=`
  <div class="mp-panel mp-hidden" id="mp-panel" role="region" aria-label="MatchPulse, suivi sportif">
    <header class="mp-head"><div><b>⚡ MatchPulse</b><small id="mp-bookmaker">Bookmaker reconnu</small></div><button type="button" class="mp-x" id="mp-close" aria-label="Fermer le panneau">✕</button></header>
    <div class="mp-body">
      <section class="mp-section">
        <h3>🎟️ Mon ticket visible</h3>
        <p>Ouvre ton ticket sur le bookmaker, puis lance sa lecture. Aucun identifiant, cookie ou montant de mise n'est collecté.</p>
        <div class="mp-group"><button type="button" class="mp-btn" id="mp-scan">Lire les sélections affichées</button><button type="button" class="mp-btn" id="mp-clear">Effacer</button></div>
        <div class="mp-items" id="mp-selections"></div>
        <label class="mp-label">Ajouter/corriger manuellement une sélection</label>
        <div class="mp-group"><input id="mp-selection-label" placeholder="Ex. Équipe A gagne" aria-label="Libellé de la sélection"><input id="mp-selection-odds" placeholder="Cote 2,10" style="flex:0 1 100px!important" aria-label="Cote décimale"><button type="button" class="mp-btn" id="mp-add">Ajouter</button></div>
        <div id="mp-probability" class="mp-note">Ajoute des cotes pour calculer la probabilité implicite.</div>
        <p>⚠️ Ce chiffre est déduit des cotes affichées, pas une prédiction fiable de gain. Il ne tient pas compte de la marge du bookmaker ni de la dépendance entre sélections. Ticket validé : non vérifié.</p>
      </section>
      <section class="mp-section">
        <h3>🔴 Matchs et alertes en direct</h3>
        <p>Buts, cartons, pénaltys et évolution des fautes (total d'équipe). Données API-Football facultatives, avec un délai possible d'au moins 90 secondes.</p>
        <label class="mp-label">Clé personnelle API-Football (non enregistrée)</label>
        <div class="mp-group"><input type="password" id="mp-api-key" spellcheck="false" autocomplete="off" placeholder="Clé API-Football"><button class="mp-btn mp-primary" type="button" id="mp-key-connect">Connecter</button><button type="button" class="mp-btn" id="mp-key-clear">Retirer</button></div>
        <div id="mp-api-status" class="mp-note">Aucune source live connectée.</div>
        <label class="mp-label">Chercher un match du jour (ou choisir une date)</label>
        <div class="mp-group"><input type="date" id="mp-date" aria-label="Date du match" style="flex:0 1 148px!important"><input id="mp-team" placeholder="Équipe, ex. Lyon" aria-label="Nom d'équipe"><button class="mp-btn" type="button" id="mp-find-fixtures">Chercher</button></div>
        <div class="mp-items" id="mp-results"></div>
        <h3 style="margin-top:14px!important">Mes matchs suivis (3 maximum)</h3>
        <div class="mp-items" id="mp-tracked"></div>
        <div class="mp-group"><button type="button" class="mp-btn mp-primary" id="mp-start">Démarrer les alertes</button><button type="button" class="mp-btn" id="mp-stop">Arrêter</button></div>
        <div class="mp-note" id="mp-poll-status">Suivi arrêté.</div>
        <div id="mp-alerts"></div>
      </section>
      <div class="mp-foot">By CodexHempreur · Extension privée 0.1</div>
    </div>
  </div>
  <button type="button" class="mp-launch" id="mp-launch"><span class="mp-pulse"></span> MatchPulse</button>
  <div id="mp-toast" class="mp-alert mp-hidden" role="status" style="clear:both!important;max-width:340px!important;pointer-events:auto!important"></div>`;
  document.documentElement.appendChild(root);
  const $=id=>root.querySelector('#'+id);
  $('mp-bookmaker').textContent=`${bookmaker.name} · ${bookmaker.region} · lecture seule`;
  function setText(id,text){$(id).textContent=String(text);}
  function note(msg,error=false){const el=$('mp-poll-status');el.textContent=msg;el.classList.toggle('mp-bad',error);}
  function toast(msg){
    const value=core.niceLabel(msg,200);
    latestAlerts.unshift(value);latestAlerts.length=Math.min(latestAlerts.length,12);
    const alert=$('mp-toast');alert.textContent=value;alert.classList.remove('mp-hidden');
    // Ne pas perdre de ressources sur les onglets fermés.
    clearTimeout(toast.timer);toast.timer=setTimeout(()=>alert.classList.add('mp-hidden'),9000);
    renderAlerts();
  }
  function el(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
  function button(text,fn,cls='mp-btn'){const e=el('button',cls,text);e.type='button';e.addEventListener('click',fn);return e;}
  function openPanel(force){$('mp-panel').classList.toggle('mp-hidden',!force);}
  $('mp-launch').addEventListener('click',()=>openPanel($('mp-panel').classList.contains('mp-hidden')));
  $('mp-close').addEventListener('click',()=>openPanel(false));
  function renderSelections(){
    const area=$('mp-selections');area.replaceChildren();
    if(!selections.length)area.append(el('p','mp-muted','Aucune sélection.'));
    selections.forEach((s,i)=>{
      const row=el('div','mp-item'),txt=el('span','',s.label),v=el('b','',s.odds.toFixed(2));
      row.append(txt,v,button('✕',()=>{selections.splice(i,1);renderSelections();}));area.append(row);
    });
    const result=core.combinedImplied(selections);
    if(!result){setText('mp-probability','Probabilité implicite non calculée (cotes manquantes).');return;}
    $('mp-probability').replaceChildren(el('b','mp-strong',(result.probability*100).toFixed(1)+' %'),
      el('span','mp-note',` · Cote combinée ${result.decimalOdds.toFixed(2)} · hypothèse d’indépendance`));
  }
  function addSelection(label,odds){
    const clean=core.niceLabel(label,100),parsed=core.parseOdds(odds);
    if(!clean || !parsed)throw new Error('Indique un libellé et une cote décimale valide (ex. 2,10).');
    if(selections.length>=15)throw new Error('Maximum de 15 sélections dans ce prototype.');
    if(selections.some(s=>s.label===clean&&s.odds===parsed))return;
    selections.push({label:clean,odds:parsed});renderSelections();
  }
  $('mp-add').addEventListener('click',()=>{
    try{addSelection($('mp-selection-label').value,$('mp-selection-odds').value);$('mp-selection-label').value='';$('mp-selection-odds').value='';}catch(e){note(e.message,true);}
  });
  $('mp-clear').addEventListener('click',()=>{selections.splice(0);renderSelections();});
  function extractVisibleSlip(){
    const selectors=[
      '[data-testid*="betslip" i]','[data-testid*="bet-slip" i]','[data-test-id*="betslip" i]',
      '[class*="betslip" i]','[data-testid*="coupon" i]','[class*="bet-slip" i]',
      '[class*="betSlip"]','[class*="ticket" i]'
    ];
    const containers=[...document.querySelectorAll(selectors.join(','))].slice(0,50);
    let count=0;
    for(const container of containers){
      const rect=container.getBoundingClientRect();
      const style=getComputedStyle(container);
      if(rect.width<30||rect.height<16||style.display==='none'||style.visibility==='hidden')continue;
      const rows=[...container.querySelectorAll('li,[data-testid*="selection" i],[class*="selection" i],p')].slice(0,60);
      for(const row of rows){
        const text=(row.innerText||row.textContent||'').trim();
        if(text.length>220)continue;
        const item=core.extractOddsAndLabel(text);
        if(item && !selections.some(s=>s.label===item.label&&s.odds===item.odds)){
          if(selections.length>=15)break;
          selections.push(item);count++;
        }
      }
      if(count)break;
    }
    renderSelections();
    note(count?`${count} sélection(s) candidate(s) lue(s). Vérifie les valeurs : ticket validé non vérifié.`:'Aucune cote clairement identifiable dans le ticket affiché : ajoute les sélections manuellement.',!count);
  }
  $('mp-scan').addEventListener('click',extractVisibleSlip);
  function msg(action,details={}){
    return new Promise((resolve,reject)=>{
      let done=false;
      const timer=setTimeout(()=>{if(!done){done=true;reject(new Error('Le module de données n’a pas répondu.'));}},16000);
      try{chrome.runtime.sendMessage({action,...details},response=>{
        if(done)return;done=true;clearTimeout(timer);
        const error=chrome.runtime.lastError;
        if(error)reject(new Error(error.message));
        else if(!response?.ok)reject(new Error(response?.error||'Erreur du fournisseur de données.'));
        else resolve(response.data);
      });}catch(e){clearTimeout(timer);reject(e);}
    });
  }
  $('mp-key-connect').addEventListener('click',async()=>{
    const key=$('mp-api-key').value;$('mp-api-key').value='';
    try{await msg('set-key',{value:key});apiConfigured=true;setText('mp-api-status','✓ Clé disponible pendant la session uniquement.');}
    catch(e){setText('mp-api-status','Erreur : '+e.message);}
  });
  $('mp-key-clear').addEventListener('click',async()=>{
    stop();try{await msg('clear-key');}catch{}apiConfigured=false;setText('mp-api-status','Clé retirée de la mémoire.');
  });
  function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  $('mp-date').value=localDate();
  async function findFixtures(){
    const area=$('mp-results');area.replaceChildren();
    const search=$('mp-team').value.trim();
    if(search.length<2){note('Saisis au moins deux lettres du nom d’une équipe.',true);return;}
    if(!apiConfigured){note('Configure ta clé API-Football pour chercher les rencontres.',true);return;}
    try{
      note('Recherche des matchs via API-Football…');
      const result=await msg('fixtures',{date:$('mp-date').value,search});
      if(!result.items.length)area.append(el('p','mp-muted','Aucun match correspondant sur cette date.'));
      for(const f of result.items){
        const row=el('div','mp-item');
        row.append(el('span','',`${f.home} – ${f.away} (${f.status})`),button('Suivre',()=>follow(f)));
        area.append(row);
      }
      note(`${result.items.length} match(s) trouvé(s).`);
    }catch(e){note(e.message,true);}
  }
  $('mp-find-fixtures').addEventListener('click',findFixtures);
  function follow(f){
    if(tracked.some(t=>t.id===f.id))return;
    if(tracked.length>=3){note('Trois matchs maximum. Retire un match avant d’en ajouter un autre.',true);return;}
    tracked.push({id:f.id,label:`${f.home} – ${f.away}`,seen:null,fouls:null,events:[],score:f.score,requestCount:0});
    renderTracked();
    note('Match ajouté. Clique « Démarrer les alertes ».');
  }
  function renderTracked(){
    const area=$('mp-tracked');area.replaceChildren();
    if(!tracked.length)area.append(el('p','mp-muted','Aucun match suivi.'));
    for(const t of tracked){
      const row=el('div','mp-item');row.append(el('span','',t.label+' · '+t.score),button('✕',()=>{
        const i=tracked.indexOf(t);if(i!==-1)tracked.splice(i,1);renderTracked();
        if(!tracked.length)stop();
      }));area.append(row);
      for(const event of t.events.slice(-3))area.append(el('p','mp-muted',core.eventText(event)||'Événement sportif'));
    }
  }
  function renderAlerts(){const area=$('mp-alerts');area.replaceChildren();
    if(latestAlerts.length){area.append(el('h3','','Alertes reçues'));for(const text of latestAlerts)area.append(el('div','mp-alert',text));}
  }
  async function poll(){
    if(!active||pollBusy||!apiConfigured||!tracked.length)return;
    pollBusy=true;pollNumber++;
    try{
      for(const t of tracked){
        const events=await msg('events',{fixture:t.id});
        const items=(events.items||[]).filter(x=>core.eventKind(x));
        const nextSeen=new Set(items.map(core.eventId));
        if(t.seen!==null){
          for(const event of items){if(!t.seen.has(core.eventId(event))){
            const text=core.eventText(event);if(text)toast(`${t.label}: ${text}`);
          }}
        }
        t.seen=nextSeen;t.events=items.slice(-6);
        if(pollNumber%2===1){
          const fouls=await msg('fouls',{fixture:t.id});
          if(fouls.total!==null){
            if(t.fouls!==null&&fouls.total>t.fouls)toast(`${t.label} : fautes totales ${t.fouls} → ${fouls.total} (statistique, sans détail joueur)`);
            t.fouls=fouls.total;
          }
        }
      }
      renderTracked();note(`Actualisé à ${new Date().toLocaleTimeString('fr-FR')} · suivi actif, rafraîchissement ≈90 s`);
    }catch(e){note('Données live indisponibles : '+e.message,true);}
    finally{pollBusy=false;}
  }
  function start(){
    if(!apiConfigured){note('Connecte d’abord API-Football.',true);return;}
    if(!tracked.length){note('Sélectionne au moins un match.',true);return;}
    stop();active=true;pollNumber=0;
    for(const t of tracked){t.seen=null;t.fouls=null;}
    poll();pollTimer=setInterval(poll,90_000);
  }
  function stop(){active=false;if(pollTimer)clearInterval(pollTimer);pollTimer=null;note('Suivi arrêté.');}
  $('mp-start').addEventListener('click',start);
  $('mp-stop').addEventListener('click',stop);
  // Ne demande aucun accès au compte bookmaker ni au paiement.
  renderSelections();renderTracked();
  msg('status').then(s=>{apiConfigured=s.configured;setText('mp-api-status',s.configured?'✓ Source sportive connectée pour cette session.':'Aucune source live connectée.');}).catch(()=>{
    setText('mp-api-status','Le module de messagerie de cette version du navigateur ne répond pas.');
  });
})();
