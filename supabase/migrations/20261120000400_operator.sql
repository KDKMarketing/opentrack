begin;
-- A separately provisioned SQL login may inherit this role. Never grant it to API roles.
create role opentrack_operator nologin;
create function ot.provision(business text,confirmed_owner text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid; w uuid;
begin
select id into strict owner_id from auth.users where lower(email)=lower(confirmed_owner) and email_confirmed_at is not null;
insert into workspaces(name) values(business) returning id into w;
insert into memberships(workspace_id,user_id,role) values(w,owner_id,'admin');
insert into departments(workspace_id,name) values(w,'General');
insert into events(workspace_id,kind,details) values(w,'operator provision',jsonb_build_object('operator',session_user,'owner',owner_id));return w;
end$$;
revoke all on function ot.provision(text,text) from public,anon,authenticated;
grant usage on schema ot to opentrack_operator;
grant execute on function ot.provision(text,text) to opentrack_operator;
commit;
