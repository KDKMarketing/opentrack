begin;
create type public.workspace_role as enum ('admin','manager','member');
create table public.workspaces (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 100),
 created_at timestamptz not null default now()
);
create table public.memberships (
 workspace_id uuid references public.workspaces on delete cascade,
 user_id uuid references auth.users on delete restrict,
 role public.workspace_role not null,
 primary key (workspace_id,user_id)
);
create index memberships_by_user on public.memberships(user_id,workspace_id);
create table public.departments (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces on delete cascade,
 name text not null check(length(trim(name)) between 1 and 100),
 unique(workspace_id,id), unique(workspace_id,name)
);
create table public.manager_departments (
 workspace_id uuid not null, department_id uuid not null, user_id uuid not null,
 primary key(workspace_id,department_id,user_id),
 foreign key(workspace_id,department_id) references public.departments(workspace_id,id) on delete cascade,
 foreign key(workspace_id,user_id) references public.memberships(workspace_id,user_id) on delete cascade
);
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.departments enable row level security;
alter table public.manager_departments enable row level security;
revoke all on public.workspaces,public.memberships,public.departments,public.manager_departments from public,anon,authenticated;
grant select on public.workspaces,public.memberships,public.departments,public.manager_departments to authenticated;
create policy own_membership on public.memberships for select to authenticated using(user_id=(select auth.uid()));
create policy joined_workspace on public.workspaces for select to authenticated using(exists(select 1 from public.memberships m where m.workspace_id=id and m.user_id=(select auth.uid())));
create policy joined_department on public.departments for select to authenticated using(exists(select 1 from public.memberships m where m.workspace_id=departments.workspace_id and m.user_id=(select auth.uid())));
create policy assigned_department on public.manager_departments for select to authenticated using(user_id=(select auth.uid()));
create function public.create_workspace(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid; caller uuid := auth.uid();
begin
 if caller is null then raise exception 'Authentication required'; end if;
 insert into public.workspaces(name) values(trim(workspace_name)) returning id into new_id;
 insert into public.memberships values(new_id,caller,'admin');
 insert into public.departments(workspace_id,name) values(new_id,'General');
 return new_id;
end $$;
revoke all on function public.create_workspace(text) from public,anon;
grant execute on function public.create_workspace(text) to authenticated;
commit;
