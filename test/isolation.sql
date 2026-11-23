-- Run as database owner after migration in a disposable Supabase database.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.create_workspace('Business A');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select public.create_workspace('Business B');
do $$
begin
 if (select count(*) from public.workspaces) <> 1 or not exists(select from public.workspaces where name='Business B')
 or (select count(*) from public.departments) <> 1 or (select count(*) from public.memberships) <> 1
 then raise exception 'Tenant filtering failed'; end if;
 if has_table_privilege(current_user,'public.memberships','UPDATE') or has_table_privilege(current_user,'public.memberships','INSERT')
 then raise exception 'Direct role mutation permitted'; end if;
end $$;
rollback;
