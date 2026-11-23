begin;
alter table public.workspaces add timezone text not null default 'Asia/Kolkata';
alter table public.memberships add digest boolean not null default true;
create table public.invitations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,email text not null,role public.workspace_role not null,expires timestamptz default now()+interval '7 days');
create table public.matters(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,ref bigint generated always as identity,title text not null check(length(trim(title)) between 1 and 250),description text not null default '',category text default '',external_ref text default '',department_id uuid not null,owner_id uuid not null,creator uuid not null,priority text not null check(priority in ('Low','Medium','High','Critical')),status text not null default 'Open' check(status in ('Open','In Progress','On Hold','Closed','Cancelled')),opened date not null,deadline date,followup date,waiting text default '',reason text default '',ended timestamptz,updated timestamptz not null default now(),deleted boolean not null default false,unique(workspace_id,id),unique(workspace_id,ref),foreign key(workspace_id,department_id) references public.departments(workspace_id,id),check(deadline is null or deadline>=opened));
create table public.shares(matter_id uuid references public.matters,user_id uuid references auth.users,primary key(matter_id,user_id));
create table public.events(id bigint generated always as identity primary key,workspace_id uuid references public.workspaces,matter_id uuid references public.matters,actor uuid,kind text not null,at timestamptz default now(),details jsonb);
create table public.comments(id uuid primary key default gen_random_uuid(),matter_id uuid not null references public.matters,author uuid not null,body text not null check(length(trim(body)) between 1 and 10000),at timestamptz default now());
create table public.intervals(id uuid primary key default gen_random_uuid(),matter_id uuid not null references public.matters,starts date not null,ends date,outcome text);
create unique index one_active_interval on public.intervals(matter_id) where ends is null;
create table public.files(id uuid primary key default gen_random_uuid(),matter_id uuid not null references public.matters,name text not null,body bytea,created timestamptz default now());
create table public.notices(id bigint generated always as identity primary key,matter_id uuid not null references public.matters,recipient uuid not null,kind text not null,at timestamptz default now(),dedupe text unique);
create index matters_dashboard on public.matters(workspace_id,deleted,deadline);
create index events_history on public.events(matter_id,at);
create index notice_recipient on public.notices(recipient,at);
create schema if not exists ot;
revoke all on schema ot from public;
grant usage on schema ot to authenticated;
create function ot.role(w uuid) returns public.workspace_role language sql stable security definer set search_path='' as $$select role from public.memberships where workspace_id=w and user_id=auth.uid()$$;
create function ot.manager(w uuid,d uuid) returns boolean language sql stable security definer set search_path='' as $$select ot.role(w)='admin' or (ot.role(w)='manager' and exists(select from public.manager_departments where workspace_id=w and department_id=d and user_id=auth.uid()))$$;
create function ot.visible(m public.matters) returns boolean language sql stable security definer set search_path='' as $$select ot.role(m.workspace_id) is not null and ((ot.role(m.workspace_id)='admin') or (not m.deleted and (ot.manager(m.workspace_id,m.department_id) or auth.uid() in (m.owner_id,m.creator) or exists(select from public.shares where matter_id=m.id and user_id=auth.uid()))))$$;
do $$declare t text;begin foreach t in array array['invitations','matters','shares','events','comments','intervals','files','notices'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
end loop;end$$;
grant select on public.matters,public.events,public.comments,public.intervals,public.notices to authenticated;
create policy visible on public.matters for select using(ot.visible(matters));
create policy visible on public.events for select using(ot.role(workspace_id)='admin' or exists(select from public.matters where id=matter_id));
create policy visible on public.comments for select using(exists(select from public.matters where id=matter_id));
create policy visible on public.intervals for select using(exists(select from public.matters where id=matter_id));
create policy visible on public.notices for select using(recipient=auth.uid() and exists(select from public.matters where id=matter_id));
create policy workspace_directory on public.memberships for select using(ot.role(workspace_id) is not null);
create function public.directory(w uuid) returns table(id uuid,email text,role public.workspace_role) language sql stable security definer set search_path='' as $$select u.id,u.email::text,m.role from auth.users u join public.memberships m on u.id=m.user_id where m.workspace_id=w and ot.role(w) is not null$$;
create function public.workspace_action(w uuid,action text,p jsonb) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); target uuid; inv invitations; token uuid; role_name workspace_role;
begin
if u is null then raise exception 'Sign in required';end if;
perform 1 from workspaces where id=w for update;
if action='accept' then
 select * into inv from invitations where workspace_id=w and id=(p->>'token')::uuid and expires>now() and lower(email)=(select lower(email) from auth.users where id=u and email_confirmed_at is not null) for update;
 if inv.id is null then raise exception 'Invitation unavailable';end if;
 insert into memberships(workspace_id,user_id,role) values(w,u,inv.role) on conflict do nothing;
 delete from invitations where id=inv.id;
elsif action='digest' and ot.role(w) is not null then update memberships set digest=(p->>'enabled')::boolean where workspace_id=w and user_id=u;
else
 if ot.role(w) is distinct from 'admin' then raise exception 'Access denied';end if;
 case action
 when 'invite' then insert into invitations(workspace_id,email,role) values(w,lower(trim(p->>'email')),(p->>'role')::workspace_role) returning id into token;
 when 'department' then insert into departments(workspace_id,name) values(w,trim(p->>'name'));
 when 'settings' then
 if not exists(select from pg_timezone_names where name=p->>'timezone') then raise exception 'Unknown timezone';end if;
 update workspaces set name=p->>'name',timezone=p->>'timezone' where id=w;
 when 'member','remove','assign' then
 target:=(p->>'user')::uuid;
 select role into strict role_name from memberships where workspace_id=w and user_id=target;
 if action='assign' then
 if role_name<>'manager' then raise exception 'Select a manager';end if;
 insert into manager_departments values(w,(p->>'department')::uuid,target) on conflict do nothing;
 else
 if role_name='admin' and (select count(*) from memberships where workspace_id=w and role='admin')=1 then raise exception 'Keep one administrator';end if;
 delete from manager_departments where workspace_id=w and user_id=target;
 if action='remove' then
 if exists(select from matters where workspace_id=w and owner_id=target and not deleted and ended is null) then raise exception 'Reassign active matters first';end if;
 delete from shares where user_id=target and matter_id in(select id from matters where workspace_id=w);
 delete from memberships where workspace_id=w and user_id=target;
 else update memberships set role=(p->>'role')::workspace_role where workspace_id=w and user_id=target;end if;
 end if;
 else raise exception 'Unknown action';end case;
end if;
insert into events(workspace_id,actor,kind,details) values(w,u,action,p-'token');
return token::text;
end$$;
create function public.matter_action(w uuid,mid uuid,action text,p jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare m matters; old_data jsonb; u uuid:=auth.uid(); today date; target uuid; st text; payload bytea;
begin
if ot.role(w) is null then raise exception 'Access denied';end if;
select (now() at time zone timezone)::date into today from workspaces where id=w for update;
if action='create' then
 target:=coalesce((p->>'owner_id')::uuid,u);
 if not exists(select from memberships where workspace_id=w and user_id=target) or ((target<>u or ot.role(w)='manager') and not coalesce(ot.manager(w,(p->>'department_id')::uuid),false)) then raise exception 'Assignment unavailable';end if;
 insert into matters(workspace_id,title,description,category,external_ref,department_id,owner_id,creator,priority,opened,deadline,followup,waiting) values(w,p->>'title',coalesce(p->>'description',''),p->>'category',p->>'external_ref',(p->>'department_id')::uuid,target,u,p->>'priority',coalesce((p->>'opened')::date,today),(p->>'deadline')::date,(p->>'followup')::date,p->>'waiting') returning * into m;
 if m.opened>today then raise exception 'Open date is in the future';end if;
 insert into intervals(matter_id,starts) values(m.id,m.opened);
else
 select * into m from matters where workspace_id=w and id=mid for update;
 if m.id is null or not coalesce(ot.visible(m),false) or (m.deleted and action<>'restore') then raise exception 'Matter unavailable';end if;
 old_data:=to_jsonb(m);
 if action not in ('comment','upload') and u<>m.owner_id and not coalesce(ot.manager(w,m.department_id),false) then raise exception 'Access denied';end if;
 case action
 when 'edit' then
 if m.ended is not null then raise exception 'Reopen this matter first';end if;
 target:=coalesce((p->>'owner_id')::uuid,m.owner_id);
 if target<>m.owner_id or (p->>'department_id')::uuid<>m.department_id then
 if not coalesce(ot.manager(w,m.department_id) and ot.manager(w,coalesce((p->>'department_id')::uuid,m.department_id)),false) then raise exception 'Assignment unavailable';end if;
 end if;
 if not exists(select from memberships where workspace_id=w and user_id=target) then raise exception 'Owner unavailable';end if;
 update matters set title=coalesce(p->>'title',title),description=coalesce(p->>'description',description),priority=coalesce(p->>'priority',priority),category=coalesce(p->>'category',category),external_ref=coalesce(p->>'external_ref',external_ref),waiting=coalesce(p->>'waiting',waiting),owner_id=target,department_id=coalesce((p->>'department_id')::uuid,department_id),deadline=case when p?'deadline' then (p->>'deadline')::date else deadline end,followup=case when p?'followup' then (p->>'followup')::date else followup end where id=mid;
 when 'status' then
 st:=p->>'status';
 if st=m.status or (m.ended is not null and st<>'Open') then raise exception 'Invalid transition';end if;
 if st in ('Closed','Cancelled','On Hold') and coalesce(trim(p->>'reason'),'')='' then raise exception 'Enter a reason or resolution';end if;
 if st='On Hold' and (p->>'followup')::date is null then raise exception 'Select a review date';end if;
 if m.ended is not null then insert into intervals(matter_id,starts) values(mid,today);
 elsif st in ('Closed','Cancelled') then update intervals set ends=today,outcome=st where matter_id=mid and ends is null;end if;
 update matters set status=st,reason=p->>'reason',followup=coalesce((p->>'followup')::date,followup),ended=case when st in ('Closed','Cancelled') then now() end where id=mid;
 when 'comment' then insert into comments(matter_id,author,body) values(mid,u,p->>'body');
 when 'share' then
 target:=(p->>'user')::uuid;
 if not coalesce(ot.manager(w,m.department_id),false) or not exists(select from memberships where workspace_id=w and user_id=target) then raise exception 'Access denied';end if;
 insert into shares values(mid,target) on conflict do nothing;
 when 'delete','restore' then
 if ot.role(w)<>'admin' then raise exception 'Access denied';end if;
 update matters set deleted=(action='delete') where id=mid;
 when 'upload' then
 payload:=decode(p->>'data','base64');
 if length(payload) not between 1 and 2097152 or not ((lower(p->>'name') like '%.pdf' and substring(payload for 5)=decode('255044462d','hex')) or (lower(p->>'name') like '%.png' and substring(payload for 8)=decode('89504e470d0a1a0a','hex'))) then raise exception 'Use PDF or PNG up to 2 MB';end if;
 insert into files(matter_id,name,body) values(mid,left(p->>'name',180),payload);
 when 'removefile' then update files set body=null where id=(p->>'file')::uuid and matter_id=mid;
 else raise exception 'Unknown action';end case;
 update matters set updated=now() where id=mid returning * into m;
end if;
if m.status='On Hold' and m.followup is null then raise exception 'Review date required';end if;
insert into events(workspace_id,matter_id,actor,kind,details) values(w,m.id,u,action,jsonb_build_object('before',old_data,'after',to_jsonb(m),'input',p-'data'));
if action in ('create','status') or (action='edit' and old_data->>'owner_id'<>m.owner_id::text) then insert into notices(matter_id,recipient,kind) values(m.id,m.owner_id,case when action='status' then m.status else 'Assigned' end);end if;
return m.id;
end$$;
create function public.file_list(mid uuid) returns table(id uuid,name text) language sql stable security definer set search_path='' as $$select f.id,f.name from public.files f join public.matters m on m.id=f.matter_id where m.id=mid and ot.visible(m) and f.body is not null$$;
create function public.file_read(fid uuid) returns table(name text,data text) language sql stable security definer set search_path='' as $$select f.name,encode(f.body,'base64') from public.files f join public.matters m on m.id=f.matter_id where f.id=fid and ot.visible(m) and f.body is not null$$;
revoke create on schema public from public,anon,authenticated;
do $$declare r record;begin for r in select oid::regprocedure as fn from pg_proc where pronamespace in ('public'::regnamespace,'ot'::regnamespace) and proname in ('directory','workspace_action','matter_action','file_list','file_read','manager','visible','role') loop execute format('revoke all on function %s from public,anon',r.fn);execute format('grant execute on function %s to authenticated',r.fn);end loop;end$$;
commit;
