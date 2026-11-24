-- Test des validations et contestations (transaction annulée).
-- Lancer : pnpm exec supabase db query --remote --yes -f supabase/tests/team_approvals.sql
begin;

insert into auth.users (id, email, aud, role, email_confirmed_at)
values
  ('00000000-0000-4000-a000-00000000000a', 'a@test.local', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-a000-00000000000b', 'b@test.local', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-a000-00000000000c', 'c@test.local', 'authenticated', 'authenticated', now());

create function pg_temp.expect_error(stmt text, code text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'attendu : erreur %, obtenu : succès (%)', code, stmt;
exception when others then
  if sqlerrm <> code then
    raise exception 'attendu : erreur %, obtenu : % (%)', code, sqlerrm, stmt;
  end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

create function pg_temp.draft(p_payer uuid, p_ids uuid[]) returns jsonb language sql as $$
  select jsonb_build_object(
    'paid_by', p_payer, 'title', 'Courses', 'spent_on', '2026-11-20', 'total_cents', 1200,
    'category_id', null, 'split_mode', 'equal',
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object('member_id', id) order by i)
                               from unnest(p_ids) with ordinality as u(id, i)), '[]'::jsonb));
$$;
grant execute on function pg_temp.draft(uuid, uuid[]) to authenticated;

create function pg_temp.status(p text) returns text language sql as $$
  select status from public.expenses where id = current_setting(p)::uuid;
$$;
grant execute on function pg_temp.status(text) to authenticated;

create function pg_temp.ver(p text) returns int language sql as $$
  select version from public.expenses where id = current_setting(p)::uuid;
$$;
grant execute on function pg_temp.ver(text) to authenticated;

create function pg_temp.login(p_letter text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', p_letter), true);
$$;

-- ── Mise en place : A crée la Team, B et C la rejoignent, Dana et Eve sont invitées sans compte ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.team', public.create_team('Voyage', '✈️')::text, true);
select set_config('test.am', (select id from public.team_members where team_id = current_setting('test.team')::uuid and user_id = auth.uid())::text, true);
select set_config('test.dana', public.add_guest(current_setting('test.team')::uuid, 'Dana', null)::text, true);
select set_config('test.eve', public.add_guest(current_setting('test.team')::uuid, 'Eve', 'eve@test.local')::text, true);
select set_config('test.invb', public.invite_member(current_setting('test.team')::uuid, 'b@test.local')::text, true);
select set_config('test.invc', public.invite_member(current_setting('test.team')::uuid, 'c@test.local')::text, true);
reset role;
select pg_temp.login('b');
set local role authenticated;
select set_config('test.bm', public.respond_invitation(current_setting('test.invb')::uuid, true)::text, true);
reset role;
select pg_temp.login('c');
set local role authenticated;
select set_config('test.cm', public.respond_invitation(current_setting('test.invc')::uuid, true)::text, true);
reset role;

-- ── 1. A paie pour A et B : A validé automatiquement, B attend, puis valide ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.e1', public.create_expense(current_setting('test.team')::uuid,
  pg_temp.draft(current_setting('test.am')::uuid, array[current_setting('test.am'), current_setting('test.bm')]::uuid[]))::text, true);
do $$ begin
  if pg_temp.status('test.e1') <> 'pending' then raise exception '1 : pending attendu'; end if;
  if not exists (select 1 from public.expense_approvals where expense_id = current_setting('test.e1')::uuid
                 and member_id = current_setting('test.am')::uuid and decision = 'approved' and version = 1)
  then raise exception '1 : validation automatique de A attendue'; end if;
end $$;
reset role;
select pg_temp.login('b');
set local role authenticated;
select public.approve_expense(current_setting('test.e1')::uuid, pg_temp.ver('test.e1'));
select public.approve_expense(current_setting('test.e1')::uuid, pg_temp.ver('test.e1')); -- deux fois : pas de doublon
do $$ begin
  if pg_temp.status('test.e1') <> 'validated' then raise exception '1 : validated attendu'; end if;
  if (select count(*) from public.expense_approvals where expense_id = current_setting('test.e1')::uuid) <> 2
  then raise exception '1 : 2 validations attendues'; end if;
end $$;
-- C n'est pas concerné.
reset role;
select pg_temp.login('c');
set local role authenticated;
select pg_temp.expect_error(format('select public.approve_expense(%L, %s)', current_setting('test.e1'), pg_temp.ver('test.e1')), 'not_concerned');
reset role;

-- ── 2. A paie pour A, B, Dana et Eve ; B conteste ; A corrige ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.e2', public.create_expense(current_setting('test.team')::uuid,
  pg_temp.draft(current_setting('test.am')::uuid,
    array[current_setting('test.am'), current_setting('test.bm'), current_setting('test.dana'), current_setting('test.eve')]::uuid[]))::text, true);
reset role;
select pg_temp.login('b');
set local role authenticated;
select pg_temp.expect_error(format('select public.dispute_expense(%L, %s, %L, %L)', current_setting('test.e2'), pg_temp.ver('test.e2'), 'error', ''), 'reason_required');
select pg_temp.expect_error(format('select public.dispute_expense(%L, %s, %L, %L)', current_setting('test.e2'), pg_temp.ver('test.e2'), 'n_importe_quoi', 'x'), 'invalid_kind');
select public.dispute_expense(current_setting('test.e2')::uuid, pg_temp.ver('test.e2'), 'error', 'Le pain coûtait 1 €');
do $$ begin
  if pg_temp.status('test.e2') <> 'disputed' then raise exception '2 : disputed attendu'; end if;
  if (select count(*) from public.expense_disputes where expense_id = current_setting('test.e2')::uuid and status = 'open') <> 1
  then raise exception '2 : une contestation ouverte attendue'; end if;
end $$;
-- B ne peut pas valider pour Dana (il n'est pas le créateur).
select pg_temp.expect_error(format('select public.approve_expense(%L, %s, %L)', current_setting('test.e2'), pg_temp.ver('test.e2'), current_setting('test.dana')), 'forbidden');
reset role;

select pg_temp.login('a');
set local role authenticated;
select public.update_expense(current_setting('test.e2')::uuid,
  pg_temp.draft(current_setting('test.am')::uuid,
    array[current_setting('test.am'), current_setting('test.bm'), current_setting('test.dana'), current_setting('test.eve')]::uuid[]));
do $$ begin
  if pg_temp.status('test.e2') <> 'pending' then raise exception '2 : pending attendu après correction'; end if;
  if exists (select 1 from public.expense_disputes where expense_id = current_setting('test.e2')::uuid and status = 'open')
  then raise exception '2 : la contestation doit être résolue par la correction'; end if;
end $$;
reset role;
-- B a vu la version 1 ; A a corrigé entre-temps (version 2) : la validation de B est refusée.
select pg_temp.login('b');
set local role authenticated;
select pg_temp.expect_error(format('select public.approve_expense(%L, 1)', current_setting('test.e2')), 'stale_version');
select pg_temp.expect_error(format('select public.dispute_expense(%L, 1, %L, %L)', current_setting('test.e2'), 'refuse', ''), 'stale_version');
reset role;
select pg_temp.login('a');
set local role authenticated;
-- A valide pour Dana (sans e-mail), pas pour Eve (avec e-mail).
select public.approve_expense(current_setting('test.e2')::uuid, pg_temp.ver('test.e2'), current_setting('test.dana')::uuid);
select pg_temp.expect_error(format('select public.approve_expense(%L, %s, %L)', current_setting('test.e2'), pg_temp.ver('test.e2'), current_setting('test.eve')), 'forbidden');
do $$ begin
  if (select via from public.expense_approvals where expense_id = current_setting('test.e2')::uuid
      and member_id = current_setting('test.dana')::uuid and version = 2) <> 'owner'
  then raise exception '2 : validation de Dana via owner attendue'; end if;
end $$;
reset role;

select pg_temp.login('b');
set local role authenticated;
select public.approve_expense(current_setting('test.e2')::uuid, pg_temp.ver('test.e2'));
do $$ begin
  -- Eve (invitée avec e-mail) n'a pas encore validé.
  if pg_temp.status('test.e2') <> 'pending' then raise exception '2 : pending attendu (Eve attend)'; end if;
end $$;
reset role;

-- Eve valide (simulation du lien e-mail de l'étape 6, en direct par la fonction interne).
select public.record_approval(current_setting('test.e2')::uuid, pg_temp.ver('test.e2'), current_setting('test.eve')::uuid, 'approved', 'email');
do $$ begin
  if pg_temp.status('test.e2') <> 'validated' then raise exception '2 : validated attendu'; end if;
end $$;

-- ── 3. Dépense annulée : on ne valide plus ──
select pg_temp.login('a');
set local role authenticated;
select public.cancel_expense(current_setting('test.e1')::uuid, 'Doublon');
reset role;
select pg_temp.login('b');
set local role authenticated;
select pg_temp.expect_error(format('select public.approve_expense(%L, %s)', current_setting('test.e1'), pg_temp.ver('test.e1')), 'expense_cancelled');
select pg_temp.expect_error($q$insert into public.expense_approvals (expense_id, member_id, version, decision, via) values (gen_random_uuid(), gen_random_uuid(), 1, 'approved', 'app')$q$, 'permission denied for table expense_approvals');
reset role;

select 'team_approvals : tous les tests passent' as resultat;
rollback;
