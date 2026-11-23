export const day=s=>Math.floor(Date.parse(s.slice(0,10)+'T00:00:00Z')/86400000);
export const iso=n=>new Date(n*86400000).toISOString().slice(0,10);
export function today(tz,now=new Date()){const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;}
export function metrics(m,t,u,z){const open=!m.ended,d=m.deadline?day(m.deadline)-day(t):Infinity;return {unresolved:open,overdue:open&&d<0,upcoming:open&&d>=0&&d<=7,waiting:open&&!!m.waiting,stale:open&&day(t)-day(today(z,new Date(m.updated)))>=7,closed:m.status==='Closed'&&day(t)-day(today(z,new Date(m.ended)))<7,mine:open&&m.owner_id===u,due:open&&d===0};}
export function intervalPosition(i,start,t,scale){return {left:(day(i.starts)-start)*scale,width:(day(i.ends||t)-day(i.starts)+1)*scale};}
