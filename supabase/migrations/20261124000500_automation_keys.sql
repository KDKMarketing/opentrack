begin;
-- Automation keys: let a scheduled job read the workspace's tracker and create/update
-- items by their external reference (e.g. a content-calendar ID such as B-02),
-- without a user password. Keys are created by an administrator, stored only as a
-- SHA-256 hash, scoped to one workspace, revocable, and act as the administrator who
-- created them (so every change runs through matter_action and lands in the audit log).
create table public.feed_tokens(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces on delete cascade,
 label text not null check(length(trim(label)) between 1 and 80),
 scope text not null check(scope in ('read','write')),
 token_hash bytea not null unique,
 created_by uuid not null references auth.users on delete cascade,
 created timestamptz not null default now(),
 last_used timestamptz,
 revoked timestamptz
);
alter table public.feed_tokens enable row level security;
revoke all on public.feed_tokens from public,anon,authenticated;

create function public.feed_token_create(w uuid,key_label text,key_scope text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare raw text:='otk_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
begin
 if ot.role(w) is distinct from 'admin' then raise exception 'Access denied';end if;
 if key_scope is null or key_scope not in ('read','write') then raise exception 'Choose read or write access';end if;
 if (select count(*) from feed_tokens t where t.workspace_id=w and t.revoked is null)>=10 then raise exception 'Revoke an unused key first';end if;
 insert into feed_tokens(workspace_id,label,scope,token_hash,created_by) values(w,trim(key_label),key_scope,sha256(convert_to(raw,'UTF8')),auth.uid());
 insert into events(workspace_id,actor,kind,details) values(w,auth.uid(),'automation key created',jsonb_build_object('label',trim(key_label),'scope',key_scope));
 return raw;
end$$;

create function public.feed_tokens_list(w uuid) returns table(id uuid,label text,scope text,created timestamptz,last_used timestamptz,revoked timestamptz,created_by text)
language sql stable security definer set search_path='' as $$
select t.id,t.label,t.scope,t.created,t.last_used,t.revoked,u.email::text from public.feed_tokens t left join auth.users u on u.id=t.created_by
where t.workspace_id=w and ot.role(w)='admin' order by t.revoked nulls first,t.created desc$$;

create function public.feed_token_revoke(w uuid,key_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if ot.role(w) is distinct from 'admin' then raise exception 'Access denied';end if;
 update feed_tokens set revoked=now() where id=key_id and workspace_id=w and revoked is null;
 if not found then raise exception 'Key unavailable';end if;
 insert into events(workspace_id,actor,kind,details) values(w,auth.uid(),'automation key revoked',jsonb_build_object('key',key_id));
end$$;

-- Resolves a raw key. The creator must still be an administrator of an active workspace.
create function ot.feed_key(raw text,need text) returns public.feed_tokens
language plpgsql security definer set search_path=public,pg_temp as $$
declare k feed_tokens;
begin
 select * into k from feed_tokens t where t.token_hash=sha256(convert_to(coalesce(raw,''),'UTF8')) and t.revoked is null;
 if k.id is null or (need='write' and k.scope<>'write')
  or not exists(select from memberships s where s.workspace_id=k.workspace_id and s.user_id=k.created_by and s.role='admin')
  or not exists(select from workspaces s where s.id=k.workspace_id and s.subscription_state='active')
 then raise exception 'Invalid or revoked key';end if;
 update feed_tokens set last_used=now() where id=k.id;
 return k;
end$$;

-- Read: every live item in the key's workspace, with a computed attention flag.
-- Descriptions, comments and attachments are deliberately not exposed.
create function public.feed_read(api_key text) returns table(ref bigint,external_ref text,title text,category text,department text,owner text,status text,priority text,opened date,deadline date,followup date,waiting text,closed_on date,updated timestamptz,attention text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare k feed_tokens; tz text; d date;
begin
 k:=ot.feed_key(api_key,'read');
 select s.timezone into tz from workspaces s where s.id=k.workspace_id;
 d:=(now() at time zone tz)::date;
 return query select m.ref,m.external_ref,m.title,m.category,dp.name,u.email::text,m.status,m.priority,m.opened,m.deadline,m.followup,m.waiting,(m.ended at time zone tz)::date,m.updated,
  case when m.ended is not null then 'done'
       when m.deadline<d then 'overdue'
       when m.status='On Hold' and m.followup<=d then 'review_due'
       when m.deadline<=d+2 then 'due_soon'
       when coalesce(m.waiting,'')<>'' then 'waiting'
       else 'on_track' end
 from matters m join departments dp on dp.id=m.department_id left join auth.users u on u.id=m.owner_id
 where m.workspace_id=k.workspace_id and not m.deleted order by m.deadline nulls last,m.ref;
end$$;

-- Write: create or update up to 100 items, matched by external_ref. Each item succeeds or
-- fails on its own. Changes run through matter_action as the key's creator, so permissions,
-- lifecycle intervals, notifications and audit history behave exactly as in the app.
create function public.feed_write(api_key text,items jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare k feed_tokens; it jsonb; results jsonb:='[]'; m matters; mid uuid; dep uuid; own uuid; p jsonb; st jsonb; outcome text; via text; xref text;
begin
 k:=ot.feed_key(api_key,'write');
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 100 then raise exception 'Send between 1 and 100 items';end if;
 perform set_config('request.jwt.claim.sub',k.created_by::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',k.created_by,'role','authenticated')::text,true);
 via:='automation: '||k.label;
 for it in select * from jsonb_array_elements(items) loop
  xref:=trim(it->>'external_ref');
  begin
   if jsonb_typeof(it) is distinct from 'object' or coalesce(xref,'')='' then raise exception 'external_ref is required';end if;
   m:=null; dep:=null; own:=null; outcome:='unchanged';
   select * into m from matters x where x.workspace_id=k.workspace_id and x.external_ref=xref and not x.deleted order by x.ref desc limit 1;
   if it ? 'department' then
    select x.id into dep from departments x where x.workspace_id=k.workspace_id and lower(x.name)=lower(trim(it->>'department'));
    if dep is null then raise exception 'Unknown department: %',it->>'department';end if;
   end if;
   if it ? 'owner_email' then
    select u.id into own from auth.users u join memberships s on s.user_id=u.id and s.workspace_id=k.workspace_id where lower(u.email)=lower(trim(it->>'owner_email'));
    if own is null then raise exception 'Owner is not a workspace member: %',it->>'owner_email';end if;
   end if;
   p:=jsonb_strip_nulls(jsonb_build_object('title',it->>'title','priority',it->>'priority','category',it->>'category','deadline',it->>'deadline','followup',it->>'followup','waiting',it->>'waiting','description',it->>'description','department_id',dep,'owner_id',own));
   st:=null;
   if coalesce(it->>'status','')<>'' then
    st:=jsonb_strip_nulls(jsonb_build_object('status',it->>'status','followup',it->>'followup','reason',coalesce(nullif(trim(it->>'reason'),''),case when it->>'status' in ('Closed','Cancelled','On Hold') then via end)));
   end if;
   if m.id is null then
    if coalesce(trim(it->>'title'),'')='' or dep is null then raise exception 'A new item needs title and department';end if;
    mid:=matter_action(k.workspace_id,null,'create',jsonb_build_object('priority','Medium','category','','waiting','','description','')||p||jsonb_build_object('external_ref',xref,'via',via));
    outcome:='created';
    select * into m from matters where id=mid;
   else
    mid:=m.id;
    -- A closed item must be reopened before it can be edited.
    if st is not null and m.ended is not null and st->>'status'<>m.status then
     perform matter_action(k.workspace_id,mid,'status',st||jsonb_build_object('via',via));
     outcome:='status changed'; st:=null; select * into m from matters where id=mid;
    end if;
    if p<>'{}' and m.ended is null then
     perform matter_action(k.workspace_id,mid,'edit',p||jsonb_build_object('via',via));
     outcome:=case when outcome='unchanged' then 'updated' else outcome||', updated' end;
     select * into m from matters where id=mid;
    end if;
   end if;
   if st is not null and st->>'status'<>m.status then
    perform matter_action(k.workspace_id,mid,'status',st||jsonb_build_object('via',via));
    outcome:=case when outcome='unchanged' then 'status changed' else outcome||', status changed' end;
   end if;
   results:=results||jsonb_build_array(jsonb_build_object('external_ref',xref,'ok',true,'result',outcome,'ref',(select x.ref from matters x where x.id=mid)));
  exception when others then
   results:=results||jsonb_build_array(jsonb_build_object('external_ref',xref,'ok',false,'error',sqlerrm));
  end;
 end loop;
 return jsonb_build_object('results',results);
end$$;

revoke all on function public.feed_token_create(uuid,text,text),public.feed_tokens_list(uuid),public.feed_token_revoke(uuid,uuid),public.feed_read(text),public.feed_write(text,jsonb),ot.feed_key(text,text) from public,anon,authenticated;
grant execute on function public.feed_token_create(uuid,text,text),public.feed_tokens_list(uuid),public.feed_token_revoke(uuid,uuid) to authenticated;
grant execute on function public.feed_read(text),public.feed_write(text,jsonb) to anon,authenticated;
commit;
