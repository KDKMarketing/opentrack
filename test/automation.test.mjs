import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const good='otk_'+'a'.repeat(64), bad='otk_'+'b'.repeat(64);
test('automation API: bearer key required, read as JSON/CSV, write passes items through',async()=>{
 const seen=[];
 const upstream=http.createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;const p=body?JSON.parse(body):{};seen.push({url:req.url,auth:req.headers.authorization,p});
  res.setHeader('Content-Type','application/json');
  if(p.api_key===bad){res.statusCode=400;return res.end(JSON.stringify({code:'P0001',message:'Invalid or revoked key'}));}
  if(req.url.startsWith('/rest/v1/rpc/feed_read'))return res.end(JSON.stringify(req.url.includes('offset=0')?[{ref:1,external_ref:'B-02',title:'=cmd()',status:'Open',attention:'due_soon'}]:[]));
  if(req.url==='/rest/v1/rpc/feed_write')return res.end(JSON.stringify({results:p.items.map(i=>({external_ref:i.external_ref,ok:true,result:'created'}))}));
  res.statusCode=404;res.end('{}');
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),APP_URL:origin,SUPABASE_URL:'http://127.0.0.1:'+upstream.address().port,SUPABASE_PUBLISHABLE_KEY:'test'},stdio:'ignore'});
 try{
  for(let i=0;i<100;i++){try{await fetch(origin+'/health');break;}catch{await new Promise(r=>setTimeout(r,20));}}
  const auth=k=>({authorization:'Bearer '+k});
  assert.equal((await fetch(origin+'/api/feed')).status,401);
  assert.equal((await fetch(origin+'/api/feed',{headers:{authorization:'Bearer not-a-key'}})).status,401);
  assert.equal((await fetch(origin+'/api/feed',{headers:auth(bad)})).status,401);
  const feed=await fetch(origin+'/api/feed',{headers:auth(good)});assert.equal(feed.status,200);
  assert.equal((await feed.json())[0].external_ref,'B-02');
  const call=seen.find(s=>s.url.startsWith('/rest/v1/rpc/feed_read')&&s.p.api_key===good);assert.equal(call.p.api_key,good);assert.equal(call.auth,undefined,'no user token forwarded');
  const csvText=await (await fetch(origin+'/api/feed?format=csv',{headers:auth(good)})).text();
  assert.match(csvText,/^"ref","external_ref"/);assert.match(csvText,/"'=cmd\(\)"/,'formula injection neutralised');
  assert.equal((await fetch(origin+'/api/items',{headers:auth(good)})).status,405);
  const w=await fetch(origin+'/api/items',{method:'POST',headers:{...auth(good),'content-type':'application/json'},body:JSON.stringify({items:[{external_ref:'B-02',title:'x',department:'Website content'}]})});
  assert.equal(w.status,200);assert.equal((await w.json()).results[0].result,'created');
  assert.equal((await fetch(origin+'/api/items',{method:'POST',headers:{...auth(good),'content-type':'application/json'},body:'{}'})).status,400);
  // Browser endpoints are unchanged: a key does not open them.
  assert.equal((await fetch(origin+'/rows',{method:'POST',headers:{...auth(good),'content-type':'application/json'},body:'{"table":"matters"}'})).status,403);
 }finally{child.kill();await once(child,'exit');await new Promise(r=>upstream.close(r));}
});
