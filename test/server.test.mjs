import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
test('HTTP server serves UI and uses authenticated, origin-checked requests',async()=>{
 const upstream=http.createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/auth/v1/token?grant_type=password'){res.end(JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600}));}
 else if(req.url==='/auth/v1/user'&&req.headers.authorization==='Bearer test-access'){res.end(JSON.stringify({id:'u',email:'user@example.test'}));}
 else{res.statusCode=403;res.end('{}');}
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),APP_URL:origin,SUPABASE_URL:'http://127.0.0.1:'+upstream.address().port,SUPABASE_PUBLISHABLE_KEY:'test'},stdio:'ignore'});
 try{
 let front;for(let i=0;i<100;i++){try{front=await fetch(origin);break;}catch{await new Promise(r=>setTimeout(r,20));}}
 assert.match(await front.text(),/OpenTrack/);
 const post=(path,body={},extra={})=>fetch(origin+'/'+path,{method:'POST',headers:{origin,'content-type':'application/json',...extra},body:JSON.stringify(body)});
 assert.equal((await post('rows',{table:'matters'})).status,401);
 assert.equal((await post('login',{}, {origin:'http://elsewhere.test'})).status,403);
 const login=await post('login',{email:'user@example.test',password:'test'});assert.equal(login.status,200);
 const cookies=login.headers.getSetCookie();assert.equal(cookies.length,2);assert.ok(cookies.every(x=>x.includes('HttpOnly')&&x.includes('SameSite=Lax')));
 const cookie=cookies.map(x=>x.split(';')[0]).join('; ');
 assert.deepEqual(await (await post('me',{}, {cookie})).json(),{id:'u',email:'user@example.test'});
 assert.equal((await post('rows',{table:'auth.users'},{cookie})).status,404);
 assert.equal((await post('rpc',{name:'daily_reminders'},{cookie})).status,404);
 }finally{child.kill();await once(child,'exit');await new Promise(r=>upstream.close(r));}
});
