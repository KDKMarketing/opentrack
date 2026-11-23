-- Disposable database. Run after migrations, with psql -v ON_ERROR_STOP=1.
begin;
insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000001','a@example.test',now()),
('20000000-0000-4000-8000-000000000002','b@example.test',now()),
('30000000-0000-4000-8000-000000000003','member@example.test',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('test.w',public.create_workspace('A')::text,true);
select set_config('test.m',public.matter_action(current_setting('test.w')::uuid,null,'create',jsonb_build_object('title','Review','priority','High','department_id',(select id from public.departments)))::text,true);
select public.matter_action(current_setting('test.w')::uuid,current_setting('test.m')::uuid,'edit','{"title":"Review revised"}');
select public.matter_action(current_setting('test.w')::uuid,current_setting('test.m')::uuid,'comment','{"body":"Reviewed"}');
select public.matter_action(current_setting('test.w')::uuid,current_setting('test.m')::uuid,'upload','{"name":"sample.pdf","data":"JVBERi0xLjQ="}');
select set_config('test.f',(select id::text from public.file_list(current_setting('test.m')::uuid)),true);
select public.matter_action(current_setting('test.w')::uuid,current_setting('test.m')::uuid,'status','{"status":"Closed","reason":"Approved"}');
select public.matter_action(current_setting('test.w')::uuid,current_setting('test.m')::uuid,'status','{"status":"Open"}');
do $$begin if (select count(*) from public.intervals)<>2 or (select count(*) from public.comments)<>1 or (select count(*) from public.notices)<3 then raise exception 'Lifecycle history failed';end if;end$$;
select set_config('test.inv',public.workspace_action(current_setting('test.w')::uuid,'invite','{"email":"member@example.test","role":"member"}'),true);
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select public.create_workspace('B');
do $$declare denied boolean:=false;begin
 if exists(select from public.matters) or exists(select from public.comments) or exists(select from public.file_read(current_setting('test.f')::uuid)) or exists(select from public.report_rows(current_setting('test.w')::uuid)) then raise exception 'Foreign data visible';end if;
 begin perform public.matter_action(current_setting('test.w')::uuid,current_setting('test.m')::uuid,'edit','{"title":"Changed"}');exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Foreign write permitted';end if;
 if has_table_privilege(current_user,'public.events','UPDATE') then raise exception 'Mutable audit';end if;
end$$;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
select public.workspace_action(current_setting('test.w')::uuid,'accept',jsonb_build_object('token',current_setting('test.inv')));
do $$declare denied boolean:=false;begin
 if exists(select from public.matters) then raise exception 'Unshared matter visible';end if;
 begin perform public.workspace_action(current_setting('test.w')::uuid,'member',jsonb_build_object('user',auth.uid(),'role','admin'));exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Unexpected role change';end if;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.matter_action(current_setting('test.w')::uuid,current_setting('test.m')::uuid,'share','{"user":"30000000-0000-4000-8000-000000000003"}');
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
do $$begin if not exists(select from public.matters) then raise exception 'Share failed';end if;end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.workspace_action(current_setting('test.w')::uuid,'remove','{"user":"30000000-0000-4000-8000-000000000003"}');
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
do $$begin if exists(select from public.matters) or exists(select from public.workspaces) then raise exception 'Revocation failed';end if;end$$;
rollback;
