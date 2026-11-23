begin;
create table public.plans(code text primary key, members integer not null, matters integer not null, storage_bytes bigint not null);
insert into public.plans values('standard',50,10000,1073741824);
alter table public.plans enable row level security;
revoke all on public.plans from public,anon,authenticated;
alter table public.workspaces add plan text not null default 'standard' references public.plans, add subscription_state text not null default 'active';
create function ot.entitlement() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; lim plans; state text;
begin
if tg_table_name='files' then select workspace_id into w from matters where id=new.matter_id;else w:=new.workspace_id;end if;
perform 1 from workspaces where id=w for update;
select p.* into lim from plans p join workspaces s on s.plan=p.code where s.id=w;
select subscription_state into state from workspaces where id=w;
if state<>'active' then raise exception 'Workspace inactive';end if;
case tg_table_name when 'memberships' then
 if (select count(*) from memberships where workspace_id=w)>=lim.members then raise exception 'Member limit reached';end if;
when 'matters' then
 if (select count(*) from matters where workspace_id=w)>=lim.matters then raise exception 'Matter limit reached';end if;
when 'files' then
 if (select coalesce(sum(length(f.body)),0) from files f join matters m on m.id=f.matter_id where m.workspace_id=w)+length(new.body)>lim.storage_bytes then raise exception 'Storage limit reached';end if;
end case;return new;end$$;
create trigger member_limit before insert on public.memberships for each row execute function ot.entitlement();
create trigger matter_limit before insert on public.matters for each row execute function ot.entitlement();
create trigger storage_limit before insert on public.files for each row execute function ot.entitlement();
create function public.report_rows(w uuid) returns setof public.matters language sql stable security invoker set search_path='' as $$select m.* from public.matters m where m.workspace_id=w and ot.manager(w,m.department_id) and not m.deleted order by m.ref$$;
revoke all on function public.report_rows(uuid) from public,anon;
grant execute on function public.report_rows(uuid) to authenticated;
create table public.digest_queue(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,user_id uuid not null,day date not null,sent timestamptz,unique(workspace_id,user_id,day));
alter table public.digest_queue enable row level security;
revoke all on public.digest_queue from public,anon,authenticated;
create function public.daily_reminders() returns table(id uuid,email text) language plpgsql security definer set search_path=public,pg_temp as $$
begin
insert into notices(matter_id,recipient,kind,dedupe)
select m.id,m.owner_id,case when m.deadline<t.d then 'Overdue' else 'Due soon' end,m.id::text||':'||m.owner_id||':'||t.d
from matters m join workspaces w on w.id=m.workspace_id join memberships s on s.workspace_id=w.id and s.user_id=m.owner_id cross join lateral(select (now() at time zone w.timezone)::date d)t
where not m.deleted and m.ended is null and (m.deadline<=t.d+7 or m.followup<=t.d) on conflict(dedupe) do nothing;
insert into digest_queue(workspace_id,user_id,day)
select distinct w.id,n.recipient,(now() at time zone w.timezone)::date from notices n join matters m on m.id=n.matter_id and m.owner_id=n.recipient join workspaces w on w.id=m.workspace_id join memberships s on s.workspace_id=w.id and s.user_id=n.recipient where s.digest and not m.deleted and (n.at at time zone w.timezone)::date=(now() at time zone w.timezone)::date on conflict do nothing;
return query select q.id,u.email::text from digest_queue q join workspaces w on w.id=q.workspace_id join memberships s on s.workspace_id=w.id and s.user_id=q.user_id join auth.users u on u.id=q.user_id where q.sent is null and s.digest and q.day=(now() at time zone w.timezone)::date and u.email_confirmed_at is not null;
end$$;
create function public.digest_done(job uuid) returns void language sql security definer set search_path='' as $$update public.digest_queue set sent=now() where id=job$$;
revoke all on function public.daily_reminders(),public.digest_done(uuid) from public,anon,authenticated;
grant execute on function public.daily_reminders(),public.digest_done(uuid) to service_role;
commit;
