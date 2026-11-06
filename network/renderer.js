'use strict';
const api=window.NetworkPanel,$=id=>document.getElementById(id);
const list=new Map();let active='';
function clear(){list.clear();active='';$('items').replaceChildren();$('count').textContent='0';$('detail-content').classList.add('hidden');$('detail-placeholder').classList.remove('hidden');}
function el(tag,cls,txt){const node=document.createElement(tag);node.className=cls;if(txt!==undefined)node.textContent=txt;return node;}
function row(entry){
 const item=el('button','request'+(entry.id===active?' active':''));item.dataset.id=entry.id;
 item.append(el('span','method',entry.method||'GET'),el('span','resource',entry.url||'…'),el('span','status-code',entry.error?'ERR':String(entry.status??'…')));
 item.addEventListener('click',()=>select(entry.id));return item;
}
function update(entry){list.set(entry.id,entry);const host=$('items');const old=[...host.children].find(n=>n.dataset.id===entry.id);if(old)old.replaceWith(row(entry));else host.prepend(row(entry));while(host.children.length>400){const last=host.lastElementChild;list.delete(last.dataset.id);last.remove();} $('count').textContent=String(list.size);if(active===entry.id)select(entry.id);}
function select(id){const item=list.get(id);if(!item)return;active=id;for(const r of $('items').children)r.classList.toggle('active',r.dataset.id===id);
 $('detail-content').classList.remove('hidden');$('detail-placeholder').classList.add('hidden');
 $('detail-title').textContent=item.method+' · '+(item.url||'');
 $('detail-meta').textContent=`Statut : ${item.status??'…'}   Type : ${item.type||'?'}   MIME : ${item.mime||'?'}   Durée : ${item.duration??'?'} ms   Taille : ${item.size??'?'} octets${item.error?'  ·  '+item.error:''}`;
 $('request-headers').textContent=JSON.stringify(item.requestHeaders||{},null,2);
 $('response-headers').textContent=JSON.stringify(item.responseHeaders||{},null,2);
 $('response-body').textContent='Aucun contenu chargé. Le corps n’est lu que sur demande.';
 $('view-body').disabled=!item.finished||Boolean(item.error);}
$('clear').addEventListener('click',()=>api.clear().catch(e=>{$('status').textContent=e.message;}));
$('reconnect').addEventListener('click',()=>api.reconnect().catch(e=>{$('status').textContent=e.message;}));
$('view-body').addEventListener('click',async()=>{const id=active;try{$('response-body').textContent='Lecture…';const result=await api.body(id);if(id===active)$('response-body').textContent=result.text+(result.truncated?'\n… [TRONQUÉ]':'');}catch(e){if(id===active)$('response-body').textContent=e.message||String(e);}});
api.onEvent(msg=>{if(msg.kind==='reset')clear();if(msg.kind==='status')$('status').textContent=msg.value;if(msg.kind==='entry')update(msg.entry);});
api.initial().then(state=>{$('status').textContent=state.status;}).catch(e=>{$('status').textContent=String(e.message||e);});
