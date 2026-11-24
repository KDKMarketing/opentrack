import {today,day,iso,metrics,intervalPosition} from './dates.js';
const app=document.querySelector('#app'),ctx=document.querySelector('#context'),note=document.querySelector('#notice');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const qp=()=>new URLSearchParams(location.search);
function go(params,replace=false){const q=new URLSearchParams(params);history[replace?'replaceState':'pushState']({},'','/?'+q);load();}
async function api(path,data={}){const r=await fetch('/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
const rpc=(name,args)=>api('rpc',{name,args}),rows=(table,filters={})=>api('rows',{table,...filters});
const statuses=['Open','In Progress','On Hold','Closed','Cancelled'],priorities=['Low','Medium','High','Critical'],roles=['member','manager','admin'];
const btn=(text,a,v='',cls='')=>'<button type="button" class="'+cls+'" data-a="'+a+'" data-v="'+esc(v)+'">'+esc(text)+'</button>';
const opts=(arr,val)=>arr.map(x=>{const [k,l]=Array.isArray(x)?x:[x,x];return '<option value="'+esc(k)+'" '+(k===val?'selected':'')+'>'+esc(l)+'</option>';}).join('');
const field=(name,label,type='text',value='',required=false)=>'<label>'+esc(label)+(Array.isArray(type)?'<select name="'+name+'">'+opts(type,value)+'</select>':type==='textarea'?'<textarea name="'+name+'">'+esc(value)+'</textarea>':'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(required?'required':'')+'>')+'</label>';
const form=(id,fields,button)=>'<form data-f="'+id+'"><div class="grid">'+fields+'</div><button class="primary">'+button+'</button></form>';
const panel=(title,body)=>'<section><h2>'+esc(title)+'</h2>'+body+'</section>';
const fold=(title,body)=>'<details><summary>'+esc(title)+'</summary>'+body+'</details>';
let me,w,ws=[],people=[],deps=[],all=[],role,t,z,view,mid,seq=0;
const person=id=>people.find(x=>x.id===id)?.email||'Former member';
const dep=id=>deps.find(x=>x.id===id)?.name||'—';
const personOptions=()=>people.map(x=>[x.id,x.email]);
const depOptions=()=>deps.map(x=>[x.id,x.name]);
const names={dashboard:'Overview',list:'Matters',timeline:'Timeline',mine:'My work',waiting:'Waiting on others',reports:'Reports',notifications:'Notifications',admin:'Workspace'};
function nav(){return '<nav>'+Object.entries(names).filter(([k])=>k!=='reports'||role!=='member').map(([k,l])=>btn(l,'view',k,k===view?'active':'')).join('')+'</nav>';}
async function load(){
 const generation=++seq;app.setAttribute('aria-busy','true');
 try{
 const q=qp();me=await api('me');ctx.innerHTML='';
 if(!me){app.innerHTML='<section class="auth"><h1>Sign in to OpenTrack</h1><p>Every open matter. One clear path to closure.</p><form data-f="auth">'+field('email','Email','email','',true)+field('password','Password','password')+'<div class="actions"><button class="primary" value="login">Sign in</button><button value="signup">Create account</button><button value="recover">Reset password</button></div></form></section>';return;}
 if(q.get('reset')){app.innerHTML=panel('Set a new password',form('password',field('password','New password','password','',true),'Save password'));return;}
 if(q.get('invite')){app.innerHTML=panel('Workspace invitation','<p>Signed in as '+esc(me.email)+'</p>'+btn('Accept invitation','accept')+btn('Switch account','logout'));return;}
 ws=await rows('workspaces');w=ws.find(x=>x.id===q.get('w'))||ws[0];ctx.innerHTML=(w?'<select aria-label="Workspace" id="ws">'+opts(ws.map(x=>[x.id,x.name]),w.id)+'</select>':'')+btn('Sign out','logout');
 if(!w){app.innerHTML=panel('Create your first workspace',form('workspace',field('name','Business name','text','',true),'Create workspace'));return;}
 const data=await Promise.all([rpc('directory',{w:w.id}),rows('departments',{workspace_id:w.id}),rows('matters',{workspace_id:w.id})]);if(generation!==seq)return;[people,deps,all]=data;role=people.find(x=>x.id===me.id)?.role;z=w.timezone;t=today(z);view=q.get('view')||'dashboard';mid=q.get('matter');
 let html='';
 if(mid){const m=all.find(x=>x.id===mid);html=m?await detail(m):panel('Matter unavailable',btn('Return to matters','view','list'));}
 else if(view==='dashboard'){html='<h1>Workspace overview</h1><div class="actions">'+btn('New matter','view','new','primary')+'</div><div class="cards">'+Object.entries({unresolved:'Unresolved',overdue:'Overdue',upcoming:'Due in 7 days',waiting:'Waiting on others',stale:'No update in 7 days',closed:'Closed in 7 days',mine:'Assigned to me'}).map(([k,v])=>'<button class="card" data-a="metric" data-v="'+k+'">'+esc(v)+'<strong>'+all.filter(m=>!m.deleted&&metrics(m,t,me.id,z)[k]).length+'</strong></button>').join('')+'</div>'+panel('Recently updated',table(all.filter(m=>!m.deleted).sort((a,b)=>b.updated.localeCompare(a.updated)).slice(0,6)));}
 else if(view==='new')html=panel('Open a matter',form('create',matterFields({},true),'Create matter'));
 else if(view==='admin')html=await admin();
 else if(view==='reports')html=await reports();
 else if(view==='notifications'){const n=await rows('notices');html=panel('Notifications',n.filter(e=>all.some(m=>m.id===e.matter_id)).reverse().map(e=>'<p>'+btn(e.kind+' · '+all.find(m=>m.id===e.matter_id).title,'matter',e.matter_id)+' '+esc(new Date(e.at).toLocaleString())+'</p>').join('')||'No notifications.');}
 else {const items=filtered(q);html='<h1>'+esc(names[view]||'Matters')+'</h1>'+filters(q)+ (view==='timeline'?await timeline(items,q):tablePage(items,q));}
 if(generation===seq)app.innerHTML=nav()+html;
 }catch(e){if(generation===seq){note.textContent=e.message;app.innerHTML=btn('Try again','reload');}}finally{if(generation===seq)app.removeAttribute('aria-busy');}
}
function matterFields(m,create){return field('title','Matter title','text',m.title,true)+field('description','Description','textarea',m.description)+field('priority','Priority',priorities,m.priority||'Medium')+field('department_id','Department',depOptions(),m.department_id)+field('owner_id','Responsible owner',role==='member'?[[me.id,me.email]]:personOptions(),m.owner_id||me.id)+field('category','Category','text',m.category)+field('external_ref','Client / project reference','text',m.external_ref)+(create?field('opened','Open date','date',t,true):'')+field('deadline','Expected close','date',m.deadline)+field('followup','Next follow-up','date',m.followup)+field('waiting','Waiting on / reason','text',m.waiting);}
function filters(q){const f=(k,l,items)=>field(k,l,[['','All'],...items],q.get(k));return '<form class="filters" data-f="filter">'+field('search','Search','search',q.get('search'))+f('owner','Owner',personOptions())+f('dept','Department',depOptions())+f('priority','Priority',priorities)+f('status','Status',statuses)+f('metric','Show',[['due','Due today'],['overdue','Overdue'],['upcoming','Upcoming'],['waiting','Awaiting action'],['stale','Stale'],['closed','Recently closed'],['unresolved','Unresolved'],['mine','Assigned to me']])+field('from','Open during / from','date',q.get('from'))+field('to','Through','date',q.get('to'))+field('sort','Order',[['updated','Recently updated'],['deadline','Deadline'],['title','Title'],['ref','Reference']],q.get('sort'))+(view==='timeline'?field('zoom','Scale',['Day','Week','Month'],q.get('zoom')||'Week'):'')+'<button>Apply</button></form>';}
function filtered(q){return all.filter(m=>{let metric=metrics(m,t,me.id,z);return !m.deleted&&(view!=='mine'||m.owner_id===me.id)&&(view!=='waiting'||(m.owner_id===me.id&&metric.waiting))&&(!q.get('metric')||metric[q.get('metric')])&&['owner','dept','status','priority'].every((k,i)=>!q.get(k)||q.get(k)===m[['owner_id','department_id','status','priority'][i]])&&(!q.get('from')||!m.ended||today(z,new Date(m.ended))>=q.get('from'))&&(!q.get('to')||m.opened<=q.get('to'))&&[m.title,m.ref,m.external_ref,m.description].join(' ').toLowerCase().includes((q.get('search')||'').toLowerCase());}).sort((a,b)=>{switch(q.get('sort')){case 'title':return a.title.localeCompare(b.title);case 'ref':return a.ref-b.ref;case 'deadline':return (a.deadline||'9999').localeCompare(b.deadline||'9999');default:return b.updated.localeCompare(a.updated);}});}
function table(items){if(!items.length)return '<p>No matching matters.</p>';return '<div class="scroll"><table><thead><tr>'+['Ref','Matter','Owner','Department','Status','Priority','Opened','Expected close','Age (days)','Overdue (days)','Follow-up','Waiting on'].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+items.map(m=>'<tr><td>OT-'+m.ref+'</td><td>'+btn(m.title,'matter',m.id,'link')+'</td>'+[person(m.owner_id),dep(m.department_id),m.status,m.priority,m.opened,m.deadline,day(m.ended?today(z,new Date(m.ended)):t)-day(m.opened),m.deadline&&!m.ended?Math.max(0,day(t)-day(m.deadline)):0,m.followup,m.waiting].map(x=>'<td>'+esc(x??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function tablePage(items,q){let page=Math.max(1,Math.min(Math.ceil(items.length/25),Number(q.get('page'))||1));return btn('New matter','view','new','primary')+table(items.slice((page-1)*25,page*25))+'<div class="actions">'+(page>1?btn('Previous','page',page-1):'')+(page*25<items.length?btn('Next','page',page+1):'')+'<small>'+items.length+' matters · Page '+page+'</small></div>';}
async function timeline(items,q){
 if(!items.length)return '<p>No matching matters.</p>';const ids=new Set(items.map(m=>m.id));const intervals=(await rows('intervals')).filter(i=>ids.has(i.matter_id));
 const scale=({Day:54,Week:15,Month:5})[q.get('zoom')]||15,start=Math.min(day(t),...items.map(m=>day(m.opened))),end=Math.max(day(t),...items.map(m=>day(m.deadline||m.opened)),...intervals.map(i=>day(i.ends||t)));
 const width=(end-start+2)*scale,step=scale===54?1:scale===15?7:30;let ticks='';for(let d=start;d<=end;d+=step)ticks+='<span style="left:'+((d-start)*scale)+'px">'+iso(d).slice(scale===54?5:0)+'</span>';
 const colors={'Open':'open','In Progress':'progress','Closed':'closed','On Hold':'hold','Cancelled':'cancelled','Overdue':'late'};
 return '<div class="legend">'+Object.entries(colors).map(([k,v])=>'<span class="'+v+'">'+k+'</span>').join('')+'<b>┆ Deadline</b></div><div class="scroll"><div style="width:'+Math.max(width,430)+'px;--step:'+step*scale+'px"><div class="track axis">'+ticks+'</div>'+items.map(m=>'<b>'+esc(m.title)+'</b><div class="track">'+intervals.filter(i=>i.matter_id===m.id).map(i=>{const {left,width}=intervalPosition(i,start,t,scale),label=i.outcome||(metrics(m,t,me.id,z).overdue?'Overdue':m.status);return '<button data-a="matter" data-v="'+m.id+'" class="bar '+colors[label]+'" style="left:'+left+'px;width:'+width+'px" title="'+esc(m.title+' · '+label+' · '+i.starts+' to '+(i.ends||t))+'">'+esc(label)+'</button>';}).join('')+(m.deadline?'<span class="marker" title="Deadline '+esc(m.deadline)+'" style="left:'+(day(m.deadline)-start)*scale+'px"></span>':'')+'</div>').join('')+'</div></div>';
}
function historyList(events){return events.slice().reverse().map(e=>{const d=e.details||{},a=d.after||{},b=d.before||{};let diff=Object.keys(a).filter(k=>!['updated','id','workspace_id'].includes(k)&&a[k]!==b[k]).map(k=>k+': '+(b[k]??'—')+' → '+(a[k]??'—')).join('\n');return fold(e.kind+' · '+new Date(e.at).toLocaleString()+' · '+person(e.actor),'<div class="audit">'+esc(diff||JSON.stringify(d.input||d,null,2))+'</div>');}).join('')||'<p>No activity.</p>';}
async function detail(m){
 const [comments,files,events]=await Promise.all([rows('comments',{matter_id:m.id}),rpc('file_list',{mid:m.id}),rows('events',{matter_id:m.id})]);
 const sf=(id,fields,button)=>form(id,fields,button);
 return btn('Back to matters','view','list')+'<h1>'+esc(m.title)+'</h1><p>OT-'+m.ref+' · '+esc(m.status)+' · '+esc(m.priority)+'</p>'+table([m])+panel('Details','<p>'+esc(m.description)+'</p><p>'+esc([m.category,m.external_ref,m.reason,m.ended?'Ended '+today(z,new Date(m.ended)):''].filter(Boolean).join(' · '))+'</p>')+
 (m.deleted?btn('Restore matter','restore'):fold('Edit matter',sf('edit',matterFields(m,false),'Save changes'))+fold('Change status',sf('status',field('status','New status',m.ended?['Open']:statuses.filter(x=>x!==m.status))+field('reason','Reason / resolution','textarea')+field('followup','Next review','date',m.followup),'Update status'))+
 (role!=='member'?fold('Share with a colleague',sf('share',field('user','Member',personOptions()),'Share matter')):'')+
 panel('Comments',comments.map(c=>'<p><b>'+esc(person(c.author))+'</b> · '+esc(new Date(c.at).toLocaleString())+'<br>'+esc(c.body)+'</p>').join('')+sf('comment',field('body','Add a comment','textarea'),'Post comment'))+
 panel('Attachments',files.map(f=>'<p>'+btn(f.name,'download',f.id)+btn('Remove','removefile',f.id)+'</p>').join('')+sf('upload','<label>PDF or PNG · Up to 2 MB<input type="file" name="attachment" accept=".pdf,.png" required></label>','Upload file'))+(role==='admin'?btn('Archive matter','delete'):''))+panel('Activity history',historyList(events));
}
async function reports(){const visible=await rpc('directory',{w:w.id});if(!visible.some(x=>x.id===me.id&&x.role!=='member'))return '<p>Reports require a manager or administrator.</p>';const data=await api('report',{w:w.id});const q=qp(),open=data.filter(m=>!m.ended),late=open.filter(m=>m.deadline&&m.deadline<t),closed=data.filter(m=>m.status==='Closed'&&(!q.get('from')||today(z,new Date(m.ended))>=q.get('from'))&&(!q.get('to')||today(z,new Date(m.ended))<=q.get('to')));
 function group(items,key){const counts=new Map();for(const m of items){const k=key(m);counts.set(k,(counts.get(k)||0)+1);}return Array.from(counts,([k,v])=>'<p>'+esc(k)+' <b>'+v+'</b></p>').join('')||'No matching matters.';}
 return '<h1>Reports</h1>'+btn('Export CSV','export')+'<div class="grid">'+panel('Unresolved by status',group(open,m=>m.status))+panel('Overdue by department',group(late,m=>dep(m.department_id)))+panel('Matters by owner',group(data,m=>person(m.owner_id)))+panel('Average unresolved age',open.length?(open.reduce((s,m)=>s+day(t)-day(m.opened),0)/open.length).toFixed(1)+' days':'—')+'</div>'+panel('Closed during period',form('filter',field('from','From','date',q.get('from'))+field('to','To','date',q.get('to')),'Apply')+table(closed));}
async function admin(){
 const memberForm=(id,fields,label)=>fold(label,form(id,fields,label));
 let content=panel('Notification preferences',form('digest',field('enabled','Daily email digest',[['true','On'],['false','Off']],String((await rows('memberships',{workspace_id:w.id})).find(m=>m.user_id===me.id)?.digest)),'Save preference'))+memberForm('workspace',field('name','Business name','text','',true),'Create another workspace');
 if(role==='admin'){
 content=panel('Workspace settings',form('settings',field('name','Workspace name','text',w.name,true)+field('timezone','IANA timezone','text',w.timezone,true),'Save settings'))+panel('Team',people.map(x=>'<p>'+esc(x.email)+' · '+esc(x.role)+'</p>').join('')+memberForm('invite',field('email','Email','email','',true)+field('role','Role',roles),'Invite member')+memberForm('member',field('user','Member',personOptions())+field('role','New role',roles),'Change role')+memberForm('remove',field('user','Member',personOptions()),'Remove member'))+panel('Departments',deps.map(d=>esc(d.name)).join(', ')+memberForm('department',field('name','Department name','text','',true),'Create department')+memberForm('assign',field('user','Manager',personOptions().filter(([id])=>people.find(p=>p.id===id)?.role==='manager'))+field('department','Department',depOptions()),'Assign manager'))+panel('Automation keys','<p>Keys let scheduled jobs read this workspace or create and update matters by their client / project reference. Each key acts as you. Copy a new key when it is shown; it cannot be shown again.</p>'+((await rpc('feed_tokens_list',{w:w.id})).map(k=>'<p>'+esc(k.label)+' · '+esc(k.scope)+' · created '+esc(k.created.slice(0,10))+' · last used '+esc(k.last_used?k.last_used.slice(0,10):'never')+(k.revoked?' · revoked':' '+btn('Revoke','revokekey',k.id))+'</p>').join('')||'<p>No keys yet.</p>')+memberForm('feedkey',field('label','Key name','text','',true)+field('scope','Access',[['read','Read only'],['write','Read and write']]),'Create key'))+content+panel('Archived matters',table(all.filter(m=>m.deleted)))+panel('Workspace activity',historyList(await rows('events',{workspace_id:w.id})));
 }return '<h1>'+esc(w.name)+'</h1>'+content;
}
const wa=(action,p)=>rpc('workspace_action',{w:w.id,action,p}),ma=(action,p)=>rpc('matter_action',{w:w.id,mid:mid||null,action,p});
function saveFile(data,name){const a=document.createElement('a'),url=URL.createObjectURL(data);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function baseParams(){return {w:w.id,view};}
async function task(fn){note.textContent='';try{await fn();}catch(e){note.textContent=e.message;}}
document.addEventListener('change',e=>{if(e.target.id==='ws')go({w:e.target.value,view:'dashboard'});});
document.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(!b)return;task(async()=>{const a=b.dataset.a,v=b.dataset.v;
 if(a==='logout'){await api('logout');return load();}
 if(a==='reload')return load();
 if(a==='view')return go({w:w.id,view:v});
 if(a==='metric')return go({w:w.id,view:'list',metric:v});
 if(a==='matter')return go({...baseParams(),matter:v});
 if(a==='page')return go({...Object.fromEntries(qp()),page:v});
 if(a==='accept'){await rpc('workspace_action',{w:qp().get('workspace'),action:'accept',p:{token:qp().get('invite')}});return go({w:qp().get('workspace')});}
 if(a==='export'){return saveFile(new Blob([await api('export',{w:w.id})],{type:'text/csv'}),'OpenTrack.csv');}
 if(a==='download'){const f=await api('download',{id:v});return saveFile(new Blob([Uint8Array.from(atob(f.data),x=>x.charCodeAt(0))]),f.name);}
 if(a==='revokekey'){if(!confirm('Revoke this key? Jobs using it will stop working.'))return
await rpc('feed_token_revoke',{w:w.id,key_id:v})
return load()
}
 if(['delete','restore','removefile'].includes(a)&&confirm('Confirm this change?')){await ma(a,{file:v});await load();}
 });});
document.addEventListener('submit',e=>{e.preventDefault();const f=e.target,b=e.submitter;if(b)b.disabled=true;task(async()=>{
 const id=f.dataset.f,p=Object.fromEntries(new FormData(f));for(const k of ['opened','deadline','followup'])if(p[k]==='')p[k]=null;
 if(id==='auth'){const mode=b?.value||'login';const r=await api(mode,p);note.textContent=mode==='recover'?'Check your email for a reset link.':mode==='signup'&&!r.signedIn?'Check your email to verify your account.':'';return load();}
 if(id==='password'){await api('password',p);note.textContent='Password updated.';return go({});}
 if(id==='filter')return go({...baseParams(),...Object.fromEntries(Object.entries(p).filter(([,v])=>v))});
 if(id==='workspace'){const wid=await rpc('create_workspace',{workspace_name:p.name});return go({w:wid});}
 if(id==='upload'){const file=p.attachment;if(file.size>2097152)throw Error('Choose a file up to 2 MB.');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(file);});await ma('upload',{name:file.name,data});}
 else if(['create','edit','status','comment','share'].includes(id)){const record=await ma(id,p);if(id==='create')return go({w:w.id,matter:record});}
 else if(id==='feedkey'){const k=await rpc('feed_token_create',{w:w.id,key_label:p.label,key_scope:p.scope})
await load()
note.textContent='Copy this key now. It will not be shown again.\n'+k
return
}
 else{if(id==='remove'&&!confirm('Remove this member from the workspace?'))return;const r=await wa(id,id==='digest'?{enabled:p.enabled==='true'}:p);if(id==='invite')note.textContent=r.sent?'Invitation emailed.':'Share this invitation link with '+p.email+'\n'+r.link;}
 await load();
 }).finally(()=>{if(b)b.disabled=false;});});
window.addEventListener('popstate',load);
await task(async()=>{const q=qp();if(q.has('token_hash')){const type=q.get('type');await api('verify',{hash:q.get('token_hash'),type});history.replaceState({},'',type==='recovery'?'/?reset=1':'/');}await load();});
