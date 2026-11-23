import {sendEmail} from './core.mjs';
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!key)throw Error('Configure the scheduled worker credential');
async function rpc(name,body){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Digest database operation failed');return r.text();}
const jobs=JSON.parse(await rpc('daily_reminders',{}));
let failed=0;
for(const job of jobs){try{await sendEmail(job.email,'Your OpenTrack daily update','Sign in to review your workspace notifications: '+process.env.APP_URL,job.id);await rpc('digest_done',{job:job.id});}catch{failed++;}}
console.log(JSON.stringify({job:'digest',total:jobs.length,failed}));if(failed)process.exitCode=1;
