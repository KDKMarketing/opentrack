export function csv(rows){
 const columns=['ref','title','owner_id','department_id','status','priority','opened','deadline','ended','followup','waiting','description'];
 const cell=value=>{let s=String(value??'');if(/^\s*[=+@-]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return [columns,...rows.map(r=>columns.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function feedCsv(rows){
 const columns=['ref','external_ref','title','category','department','owner','status','priority','opened','deadline','followup','waiting','closed_on','updated','attention'];
 const cell=value=>{let s=String(value??'');if(/^\s*[=+@-]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return [columns,...rows.map(r=>columns.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\r\n');
}
export async function sendEmail(to,subject,text,id){
 const {RESEND_API_KEY,MAIL_FROM}=process.env;
 if(!RESEND_API_KEY||!MAIL_FROM)throw Error('Email delivery is not configured.');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:MAIL_FROM,to:[to],subject,text})});
 if(!response.ok)throw Error('Email provider did not accept delivery.');
}
