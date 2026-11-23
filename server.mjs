import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {csv,sendEmail} from './core.mjs';
const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
const key=process.env.SUPABASE_PUBLISHABLE_KEY;
const origin=new URL(process.env.APP_URL||'http://localhost:3000').origin;
const prod=origin.startsWith('https:');
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const rates=new Map();
setInterval(()=>{for(const [k,v] of rates)if(v.until<Date.now())rates.delete(k);},60000).unref();
function fail(message,status=400){throw Object.assign(Error(message),{status});}
function limit(k,max){let r=rates.get(k);if(!r||r.until<Date.now()){r={until:Date.now()+60000,count:0};rates.set(k,r);}if(++r.count>max)fail('Too many requests. Try again shortly.',429);}
const allowed=['workspaces','memberships','departments','matters','comments','events','intervals','notices'];
const calls=['create_workspace','directory','workspace_action','matter_action','file_list'];
const staticFiles={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/dates.js':'dates.js'};
export const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'), path=url.pathname;
 const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(c=>c.trim().split(/=(.*)/s).slice(0,2)));
 const cookie=(name,value,age)=>name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(prod?'; Secure':'');
 let token=cookies.ot_access,sessionCookies=[];
 function session(data){if(!data.access_token)return;token=data.access_token;sessionCookies=[cookie('ot_access',token,data.expires_in||3600),cookie('ot_refresh',data.refresh_token,2592000)];res.setHeader('Set-Cookie',sessionCookies);}
 function json(v,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));}
 async function upstream(route,method='GET',body,auth=token,extra={}){
  if(!base||!key)fail('Configure Supabase or start the local stack. See START-HERE.md.',503);
  const headers={apikey:key,'Content-Type':'application/json',...extra};if(auth)headers.Authorization='Bearer '+auth;
  const r=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const text=await r.text();let data;try{data=text?JSON.parse(text):null;}catch{fail('Backend unavailable',502);}
  if(!r.ok){let msg=data?.code==='P0001'?data.message:'Request declined. Check your access and entered values.';fail(msg,r.status);}return data;
 }
 try{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
 if(req.method==='GET'&&Object.hasOwn(staticFiles,path)){const f=staticFiles[path];res.setHeader('Content-Type',f.endsWith('html')?'text/html':f.endsWith('css')?'text/css':'text/javascript');return res.end(await readFile(new URL('./public/'+f,import.meta.url)));}
 if(path==='/health'){await upstream('/rest/v1/', 'GET',undefined,null);return json({status:'ready'});}
 if(req.method!=='POST'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))fail('Invalid request',403);
 let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>3000000)fail('File too large',413);chunks.push(chunk);}
 let p;try{p=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail('Invalid JSON');}
 if(['login','signup','recover','verify'].includes(path.slice(1))){
 limit(req.socket.remoteAddress,35);if(p.email)limit(String(p.email).toLowerCase(),10);
 if(path==='/verify'){session(await upstream('/auth/v1/verify','POST',{token_hash:p.hash,type:p.type},null));return json({ok:true});}
 if(path==='/recover'){await upstream('/auth/v1/recover','POST',{email:p.email},null);return json({ok:true});}
 let input={email:p.email,password:p.password};
 session(await upstream(path==='/login'?'/auth/v1/token?grant_type=password':'/auth/v1/signup','POST',input,null));return json({signedIn:!!token});
 }
 if(!token&&cookies.ot_refresh){session(await upstream('/auth/v1/token?grant_type=refresh_token','POST',{refresh_token:cookies.ot_refresh},null));}
 if(path==='/me'&&!token)return json(null);
 if(!token)fail('Please sign in.',401);
 if(path==='/me'){const u=await upstream('/auth/v1/user');return json({id:u.id,email:u.email});}
 if(path==='/logout'){res.setHeader('Set-Cookie',[cookie('ot_access','',0),cookie('ot_refresh','',0)]);await upstream('/auth/v1/logout','POST');return json(true);}
 if(path==='/password'){await upstream('/auth/v1/user','PUT',{password:p.password});return json(true);}
 const rpc=(name,args)=>upstream('/rest/v1/rpc/'+name,'POST',args);
 if(path==='/rpc'&&calls.includes(p.name)){limit(token.slice(-24),180);const result=await rpc(p.name,p.args);
 if(p.name==='workspace_action'&&p.args.action==='invite'){const link=origin+'/?workspace='+encodeURIComponent(p.args.w)+'&invite='+result;let sent=false;try{await sendEmail(p.args.p.email,'OpenTrack workspace invitation','Accept your invitation: '+link,result);sent=true;}catch{}return json({link,sent});}
 return json(result);}
 if(path==='/rows'&&allowed.includes(p.table)){
 const query=new URLSearchParams({select:'*'});for(const k of ['workspace_id','matter_id','id'])if(p[k]){if(!uuid.test(p[k]))fail('Invalid identifier');query.set(k,'eq.'+p[k]);}
 query.set('order',({matters:'ref',events:'id',notices:'id',memberships:'user_id'})[p.table]||'id');
 const rows=[];for(let offset=0;;){query.set('offset',offset);query.set('limit',500);const page=await upstream('/rest/v1/'+p.table+'?'+query);rows.push(...page);if(!page.length)break;offset+=page.length;}
 return json(rows);}
 if(path==='/download'){const [f]=await rpc('file_read',{fid:p.id});if(!f)fail('File unavailable',404);return json(f);}
 if(path==='/export'||path==='/report'){
 const user=await upstream('/auth/v1/user');const directory=await rpc('directory',{w:p.w});if(!['manager','admin'].includes(directory.find(x=>x.id===user.id)?.role))fail('Access denied',403);
 const rows=[];for(let offset=0;;){const page=await upstream('/rest/v1/rpc/report_rows?limit=500&offset='+offset,'POST',{w:p.w});rows.push(...page);if(!page.length)break;offset+=page.length;}return json(path==='/report'?rows:csv(rows));}
 fail('Unknown request',404);
 }catch(e){if(!res.headersSent)json({error:e.status?e.message:'Connection unavailable. Try again.'},e.status||503);console.error(JSON.stringify({event:'request_error',status:e.status||503}));}
});
server.listen(Number(process.env.PORT||3000));
