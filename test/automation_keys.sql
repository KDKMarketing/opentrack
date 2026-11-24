-- Disposable database. Run after migrations, with psql -v ON_ERROR_STOP=1.
-- Exercises automation keys: creation rights, read feed, write (create/update/status), scoping and revocation.
begin;
insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000001','admin@example.test',now()),
('20000000-0000-4000-8000-000000000002','writer@example.test',now()),
('30000000-0000-4000-8000-000000000003','outsider@example.test',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('test.w',public.create_workspace('KDK Content')::text,true);
select public.workspace_action(current_setting('test.w')::uuid,'department','{"name":"Website content"}');
reset role;
insert into public.memberships values(current_setting('test.w')::uuid,'20000000-0000-4000-8000-000000000002','member');
set local role authenticated;
select set_config('test.rk',public.feed_token_create(current_setting('test.w')::uuid,'Dashboard reader','read'),true);
select set_config('test.wk',public.feed_token_create(current_setting('test.w')::uuid,'Content automation','write'),true);
do $$begin
 if current_setting('test.wk') !~ '^otk_[a-f0-9]{64}$' then raise exception 'key format';end if;
 if (select count(*) from public.feed_tokens_list(current_setting('test.w')::uuid))<>2 then raise exception 'admin list';end if;
end$$;

-- A member cannot create or list keys.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
do $$begin
 begin perform public.feed_token_create(current_setting('test.w')::uuid,'x','read'); raise exception 'member created key';
 exception when others then if sqlerrm<>'Access denied' then raise; end if; end;
 if (select count(*) from public.feed_tokens_list(current_setting('test.w')::uuid))<>0 then raise exception 'member listed keys';end if;
end$$;

-- Machine calls arrive as anon with no user.
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$declare r jsonb;begin
 r:=public.feed_write(current_setting('test.wk'),'[
  {"external_ref":"B-02","title":"GSTR-9C reconciliation blog","department":"website content","deadline":"2026-11-30","priority":"High","owner_email":"writer@example.test"},
  {"external_ref":"B-03","title":"Advance tax page update","department":"Website content","deadline":"2026-12-06"},
  {"external_ref":"B-99","title":"Bad dept","department":"Nowhere"},
  {"title":"No ref"},
  {"external_ref":"B-04","department":"Website content"}
 ]');
 if r->'results'->0->>'result'<>'created' or r->'results'->1->>'result'<>'created' then raise exception 'create: %',r;end if;
 if (r->'results'->2->>'ok')::boolean or r->'results'->2->>'error' not like 'Unknown department%' then raise exception 'dept: %',r;end if;
 if (r->'results'->3->>'ok')::boolean or (r->'results'->4->>'ok')::boolean then raise exception 'validation: %',r;end if;
 -- update, then move to In Progress, then close, then reopen with an edit
 r:=public.feed_write(current_setting('test.wk'),'[{"external_ref":"B-02","status":"In Progress","waiting":"CA review"}]');
 if r->'results'->0->>'result'<>'updated, status changed' then raise exception 'progress: %',r;end if;
 r:=public.feed_write(current_setting('test.wk'),'[{"external_ref":"B-02","status":"Closed","reason":"Published"}]');
 if r->'results'->0->>'result'<>'status changed' then raise exception 'close: %',r;end if;
 r:=public.feed_write(current_setting('test.wk'),'[{"external_ref":"B-02","status":"Closed"}]');
 if r->'results'->0->>'result'<>'unchanged' then raise exception 'idempotent: %',r;end if;
 r:=public.feed_write(current_setting('test.wk'),'[{"external_ref":"B-02","status":"Open","deadline":"2026-12-10"}]');
 if r->'results'->0->>'result'<>'status changed, updated' then raise exception 'reopen: %',r;end if;
 r:=public.feed_write(current_setting('test.wk'),'[{"external_ref":"B-03","status":"On Hold"}]');
 -- On Hold needs a review date: must fail cleanly without touching other items
 if (r->'results'->0->>'ok')::boolean then raise exception 'hold without review date: %',r;end if;
 -- read key can read, cannot write
 if (select count(*) from public.feed_read(current_setting('test.rk')))<>2 then raise exception 'read count';end if;
 -- B-02: open, waiting on "CA review", deadline 10 Dec 2026 -> waiting (or due_soon/overdue if run near/after that date)
 if (select attention from public.feed_read(current_setting('test.rk')) where external_ref='B-02') not in ('waiting','due_soon','overdue') then raise exception 'attention';end if;
 if (select owner from public.feed_read(current_setting('test.rk')) where external_ref='B-02')<>'writer@example.test' then raise exception 'owner';end if;
 begin perform public.feed_write(current_setting('test.rk'),'[{"external_ref":"B-02","title":"x"}]'); raise exception 'read key wrote';
 exception when others then if sqlerrm<>'Invalid or revoked key' then raise; end if; end;
 begin perform public.feed_read('otk_'||repeat('0',64)); raise exception 'bad key read';
 exception when others then if sqlerrm<>'Invalid or revoked key' then raise; end if; end;
end$$;

-- Anon still cannot touch tables or app functions directly.
do $$begin
 begin perform 1 from public.feed_tokens; raise exception 'anon read tokens';
 exception when insufficient_privilege then null; end;
 begin perform public.matter_action(current_setting('test.w')::uuid,null,'create','{}'); raise exception 'anon matter_action';
 exception when insufficient_privilege then null; end;
end$$;

-- Audit trail records the automation and the acting admin.
reset role;
do $$begin
 if (select count(*) from public.events where details->'input'->>'via'='automation: Content automation')<5 then raise exception 'audit';end if;
 if exists(select from public.events where details->'input'->>'via' is not null and actor<>'10000000-0000-4000-8000-000000000001') then raise exception 'actor';end if;
 if (select status from public.matters where external_ref='B-02')<>'Open' or (select deadline from public.matters where external_ref='B-02')<>'2026-12-10' then raise exception 'final state';end if;
end$$;

-- Revocation and demotion both kill a key.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.feed_token_revoke(current_setting('test.w')::uuid,(select id from public.feed_tokens_list(current_setting('test.w')::uuid) where label='Dashboard reader'));
reset role;
update public.memberships set role='manager' where user_id='10000000-0000-4000-8000-000000000001';
insert into public.memberships values(current_setting('test.w')::uuid,'30000000-0000-4000-8000-000000000003','admin');
set local role anon;
do $$begin
 begin perform public.feed_read(current_setting('test.rk')); raise exception 'revoked key worked';
 exception when others then if sqlerrm<>'Invalid or revoked key' then raise; end if; end;
 begin perform public.feed_read(current_setting('test.wk')); raise exception 'demoted creator key worked';
 exception when others then if sqlerrm<>'Invalid or revoked key' then raise; end if; end;
end$$;
reset role;
select 'automation key checks passed';
rollback;
