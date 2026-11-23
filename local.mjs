import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('.',import.meta.url)));
function run(args,capture=false){
 const r=spawnSync('supabase',args,{encoding:'utf8',stdio:capture?'pipe':'inherit'});
 if(r.error||r.status!==0){console.error('Local stack could not start. Install the Supabase CLI, start Docker Desktop, and retry.');process.exit(1);}return r.stdout;
}
if(spawnSync('docker',['info'],{stdio:'ignore'}).status!==0){console.error('Start Docker Desktop and install the Supabase CLI, then run npm run local again.');process.exit(1);}
run(['start']);run(['migration','up','--local']);
const vars=Object.fromEntries(run(['status','-o','env'],true).split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{let i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')];}));
const key=vars.ANON_KEY||vars.PUBLISHABLE_KEY;
if(!vars.API_URL||!key)throw Error('Local API settings unavailable. See START-HERE.md.');
const values={APP_URL:'http://localhost:3000',PORT:'3000',SUPABASE_URL:vars.API_URL,SUPABASE_PUBLISHABLE_KEY:key};
writeFileSync('.env.local',Object.entries(values).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600});
Object.assign(process.env,values);console.log('Open http://localhost:3000 · Test email inbox http://localhost:54324');
await import('./server.mjs');
