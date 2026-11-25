-- Scénarios du cahier des charges, avec ses propres exemples (transaction annulée).
-- Sections 9 et 10, critères 14 à 20. Les autres critères sont couverts par
-- les tests team_core, team_expenses, team_approvals, team_receipts,
-- team_links et team_settlement (voir docs/team-scenarios.md).
-- Lancer : pnpm exec supabase db query --remote --yes -f supabase/tests/team_scenarios.sql
begin;

insert into auth.users (id, email, aud, role, email_confirmed_at)
values
  ('00000000-0000-4000-a000-00000000000a', 'a@test.local', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-a000-00000000000b', 'b@test.local', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-a000-00000000000d', 'd@test.local', 'authenticated', 'authenticated', now());

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
grant execute on function pg_temp.expect_error(text, text) to authenticated, anon;

create function pg_temp.login(p_letter text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', p_letter), true);
$$;
create function pg_temp.anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.v(p text) returns uuid language sql as $$ select current_setting(p)::uuid $$;
grant execute on function pg_temp.v(text) to authenticated, anon;

create function pg_temp.draft(p_payer uuid, p_ids uuid[], p_total int) returns jsonb language sql as $$
  select jsonb_build_object(
    'paid_by', p_payer, 'title', 'Dépense', 'spent_on', '2026-11-20', 'total_cents', p_total,
    'category_id', null, 'split_mode', 'equal',
    'beneficiaries', (select jsonb_agg(jsonb_build_object('member_id', id) order by i)
                      from unnest(p_ids) with ordinality as u(id, i)));
$$;
grant execute on function pg_temp.draft(uuid, uuid[], int) to authenticated;

create function pg_temp.last_token(p_email text, p_kind text) returns text language sql as $$
  select payload ->> 'token' from public.email_outbox
  where to_email = p_email and kind = p_kind order by created_at desc, id desc limit 1;
$$;

-- Team : A (créateur) et B (inscrits), C invitée sans compte, avec e-mail.
create function pg_temp.setup(p_name text, p_key text) returns void language plpgsql as $$
begin
  perform pg_temp.login('a');
  set local role authenticated;
  perform set_config(p_key, public.create_team(p_name, '✈️')::text, true);
  perform set_config(p_key || '_a', (select id::text from public.team_members
    where team_id = current_setting(p_key)::uuid and user_id = auth.uid()), true);
  perform set_config(p_key || '_c', public.add_guest(current_setting(p_key)::uuid, 'C',
    replace(p_key, 's.', '') || '-c@test.local')::text, true);
  perform set_config(p_key || '_inv', public.invite_member(current_setting(p_key)::uuid, 'b@test.local')::text, true);
  reset role;
  perform pg_temp.login('b');
  set local role authenticated;
  perform set_config(p_key || '_b', public.respond_invitation(current_setting(p_key || '_inv')::uuid, true)::text, true);
  reset role;
end $$;

-- Valide une dépense pour tous : A et B dans l'application, C par son lien.
create function pg_temp.validate_all(p_expense uuid) returns void language plpgsql as $$
begin
  perform pg_temp.login('a');
  set local role authenticated;
  begin perform public.approve_expense(p_expense, 1); exception when others then null; end;
  reset role;
  perform pg_temp.login('b');
  set local role authenticated;
  begin perform public.approve_expense(p_expense, 1); exception when others then null; end;
  reset role;
  perform public.record_approval(p_expense, 1, (select m.id from public.team_members m
    join public.expenses e on e.team_id = m.team_id where e.id = p_expense and m.display_name = 'C'),
    'approved', 'email');
end $$;

-- ── Section 9 (critères 12, 13, 14) : A 300 €, B 180 €, C 120 € pour les trois ──
select pg_temp.setup('Voyage', 's.t1');
select pg_temp.login('a');
set local role authenticated;
select set_config('s.t1_e1', public.create_expense(pg_temp.v('s.t1'),
  pg_temp.draft(pg_temp.v('s.t1_a'), array[pg_temp.v('s.t1_a'), pg_temp.v('s.t1_b'), pg_temp.v('s.t1_c')], 30000))::text, true);
select set_config('s.t1_e3', public.create_expense(pg_temp.v('s.t1'),
  pg_temp.draft(pg_temp.v('s.t1_c'), array[pg_temp.v('s.t1_a'), pg_temp.v('s.t1_b'), pg_temp.v('s.t1_c')], 12000))::text, true);
reset role;
select pg_temp.login('b');
set local role authenticated;
select set_config('s.t1_e2', public.create_expense(pg_temp.v('s.t1'),
  pg_temp.draft(pg_temp.v('s.t1_b'), array[pg_temp.v('s.t1_a'), pg_temp.v('s.t1_b'), pg_temp.v('s.t1_c')], 18000))::text, true);
reset role;
select pg_temp.validate_all(pg_temp.v('s.t1_e1'));
select pg_temp.validate_all(pg_temp.v('s.t1_e2'));
select pg_temp.validate_all(pg_temp.v('s.t1_e3'));

select pg_temp.login('a');
set local role authenticated;
select set_config('s.t1_s', public.request_settlement(pg_temp.v('s.t1'))::text, true);
reset role;
do $$ begin
  -- Critère 13 : le bilan attend B et C.
  if (select status from public.teams where id = pg_temp.v('s.t1')) <> 'closing' then
    raise exception '13 : le bilan doit attendre la validation de tous';
  end if;
  -- Critère 14 : part 200 €, A reçoit 100 €, B doit 20 €, C doit 80 €.
  if (select string_agg(b.share_cents || ':' || b.balance_cents, ',' order by
        case b.member_id when pg_temp.v('s.t1_a') then 1 when pg_temp.v('s.t1_b') then 2 else 3 end)
      from public.settlement_balances b where b.settlement_id = pg_temp.v('s.t1_s'))
     <> '20000:10000,20000:-2000,20000:-8000' then
    raise exception '14 : parts de 200 € et soldes +100 / -20 / -80 attendus';
  end if;
end $$;
select pg_temp.login('b');
set local role authenticated;
select public.approve_settlement(pg_temp.v('s.t1_s'));
reset role;
select set_config('s.t1_tk', pg_temp.last_token('t1-c@test.local', 'approve_settlement'), true);
select pg_temp.anon();
set local role anon;
select public.token_act(current_setting('s.t1_tk'), 'approve');
reset role;
do $$ begin
  -- « C rembourse 80 € à A, B rembourse 20 € à A » : 2 virements, pas plus.
  if (select string_agg(
        (select display_name from public.team_members where id = r.from_member) || '>' || r.amount_cents,
        ',' order by r.position)
      from public.repayments r where r.settlement_id = pg_temp.v('s.t1_s'))
     <> 'C>8000,' || (select display_name from public.team_members where id = pg_temp.v('s.t1_b')) || '>2000'
     or exists (select 1 from public.repayments r where r.settlement_id = pg_temp.v('s.t1_s')
                and r.to_member <> pg_temp.v('s.t1_a')) then
    raise exception '14 : virements C → A 80 € et B → A 20 € attendus';
  end if;
  if (select status from public.teams where id = pg_temp.v('s.t1')) <> 'settling' then
    raise exception '13 : remboursements ouverts après la validation de tous';
  end if;
end $$;

-- ── Section 10 (critères 15 à 19) : A et B doivent chacun 100 € à C, sans compte ──
select pg_temp.setup('Coloc', 's.t2');
select pg_temp.login('a');
set local role authenticated;
select set_config('s.t2_e', public.create_expense(pg_temp.v('s.t2'),
  pg_temp.draft(pg_temp.v('s.t2_c'), array[pg_temp.v('s.t2_a'), pg_temp.v('s.t2_b'), pg_temp.v('s.t2_c')], 30000))::text, true);
reset role;
select pg_temp.validate_all(pg_temp.v('s.t2_e'));
select pg_temp.login('a');
set local role authenticated;
select set_config('s.t2_s', public.request_settlement(pg_temp.v('s.t2'))::text, true);
reset role;
select pg_temp.login('b');
set local role authenticated;
select public.approve_settlement(pg_temp.v('s.t2_s'));
reset role;
select set_config('s.t2_tk', pg_temp.last_token('t2-c@test.local', 'approve_settlement'), true);
select pg_temp.anon();
set local role anon;
select public.token_act(current_setting('s.t2_tk'), 'approve');
reset role;
select set_config('s.t2_ra', (select id from public.repayments where settlement_id = pg_temp.v('s.t2_s') and from_member = pg_temp.v('s.t2_a'))::text, true);
select set_config('s.t2_rb', (select id from public.repayments where settlement_id = pg_temp.v('s.t2_s') and from_member = pg_temp.v('s.t2_b'))::text, true);

-- Critère 15 : A et B déclarent leurs virements ; rien n'est confirmé pour autant.
select pg_temp.login('a');
set local role authenticated;
select public.declare_repayment(pg_temp.v('s.t2_ra'), 10000);
reset role;
select pg_temp.login('b');
set local role authenticated;
select public.declare_repayment(pg_temp.v('s.t2_rb'), 10000);
-- B ne peut pas confirmer à la place de C.
select pg_temp.expect_error(format('select public.confirm_repayment(%L, 10000)', current_setting('s.t2_rb')), 'forbidden');
reset role;
do $$ begin
  if exists (select 1 from public.repayments where settlement_id = pg_temp.v('s.t2_s') and confirmed_cents > 0) then
    raise exception '15 : une déclaration ne confirme jamais rien';
  end if;
end $$;

-- Critères 16 et 17 : C confirme par lien, sans compte, d'abord en partie.
select set_config('s.t2_l1', (select payload ->> 'token' from public.email_outbox
  where kind = 'confirm_repayment' and to_email = 't2-c@test.local'
    and payload ->> 'from_name' = (select display_name from public.team_members where id = pg_temp.v('s.t2_a'))
  order by created_at desc limit 1), true);
select set_config('s.t2_l2', (select payload ->> 'token' from public.email_outbox
  where kind = 'confirm_repayment' and to_email = 't2-c@test.local'
    and payload ->> 'from_name' = (select display_name from public.team_members where id = pg_temp.v('s.t2_b'))
  order by created_at desc limit 1), true);
select pg_temp.anon();
set local role anon;
select public.token_act(current_setting('s.t2_l1'), 'confirm', null, null, 10000);
select public.token_act(current_setting('s.t2_l2'), 'confirm', null, null, 4000);
reset role;
do $$ begin
  -- Critère 18 : 60 € restent dus : la Team n'est pas soldée.
  if (select status from public.teams where id = pg_temp.v('s.t2')) <> 'settling' then
    raise exception '18 : la Team ne doit pas être soldée avant toutes les confirmations';
  end if;
  if (select confirmed_cents from public.repayments where id = pg_temp.v('s.t2_rb')) <> 4000 then
    raise exception '17 : confirmation partielle de 40 € attendue';
  end if;
  if (select count(*) from public.repayment_events e join public.repayments r on r.id = e.repayment_id
      where r.settlement_id = pg_temp.v('s.t2_s') and e.kind = 'confirmed' and e.via = 'email'
        and e.created_at is not null) <> 2 then
    raise exception '16 : 2 confirmations horodatées par e-mail attendues';
  end if;
end $$;
select set_config('s.t2_l3', pg_temp.last_token('t2-c@test.local', 'confirm_repayment'), true);
select pg_temp.anon();
set local role anon;
select public.token_act(current_setting('s.t2_l3'), 'confirm', null, null, 6000);
reset role;
do $$ begin
  if (select status from public.teams where id = pg_temp.v('s.t2')) <> 'settled' then
    raise exception '18 : Team soldée attendue après la dernière confirmation';
  end if;
end $$;

-- Critère 19 : après archivage, l'historique reste lisible, mais plus rien ne s'ajoute.
select pg_temp.login('a');
set local role authenticated;
select public.archive_team(pg_temp.v('s.t2'));
reset role;
select pg_temp.login('b');
set local role authenticated;
do $$ begin
  if (select count(*) from public.expenses where team_id = pg_temp.v('s.t2')) <> 1
     or (select count(*) from public.repayments where team_id = pg_temp.v('s.t2')) <> 2
     or (select count(*) from public.repayment_events e join public.repayments r on r.id = e.repayment_id
         where r.team_id = pg_temp.v('s.t2')) < 5
     or (select count(*) from public.audit_logs where team_id = pg_temp.v('s.t2')) < 10
     or (select count(*) from public.team_messages where team_id = pg_temp.v('s.t2')) < 5 then
    raise exception '19 : historique complet lisible après archivage attendu';
  end if;
end $$;
select pg_temp.expect_error(format('select public.send_message(%L, %L)', current_setting('s.t2'), 'Coucou'), 'team_locked');
select pg_temp.expect_error(format('select public.create_expense(%L, %L)', current_setting('s.t2'),
  pg_temp.draft(pg_temp.v('s.t2_b'), array[pg_temp.v('s.t2_b')], 100)), 'team_locked');
reset role;

-- ── Critère 20 : D, inscrit mais hors des Teams, ne voit ni ne modifie rien ──
select pg_temp.login('d');
set local role authenticated;
do $$ begin
  if exists (select 1 from public.teams where id in (pg_temp.v('s.t1'), pg_temp.v('s.t2')))
     or exists (select 1 from public.team_members where team_id in (pg_temp.v('s.t1'), pg_temp.v('s.t2')))
     or exists (select 1 from public.expenses where team_id in (pg_temp.v('s.t1'), pg_temp.v('s.t2')))
     or exists (select 1 from public.expense_beneficiaries where expense_id = pg_temp.v('s.t1_e1'))
     or exists (select 1 from public.team_messages where team_id in (pg_temp.v('s.t1'), pg_temp.v('s.t2')))
     or exists (select 1 from public.audit_logs where team_id in (pg_temp.v('s.t1'), pg_temp.v('s.t2')))
     or exists (select 1 from public.team_settlements where team_id in (pg_temp.v('s.t1'), pg_temp.v('s.t2')))
     or exists (select 1 from public.repayments where team_id in (pg_temp.v('s.t1'), pg_temp.v('s.t2')))
     or exists (select 1 from public.my_team_shares(null, null)) then
    raise exception '20 : D ne doit rien voir';
  end if;
end $$;
select pg_temp.expect_error(format('select public.create_expense(%L, %L)', current_setting('s.t1'),
  pg_temp.draft(pg_temp.v('s.t1_a'), array[pg_temp.v('s.t1_a')], 100)), 'forbidden');
select pg_temp.expect_error(format('select public.approve_settlement(%L)', current_setting('s.t1_s')), 'forbidden');
select pg_temp.expect_error(format('select public.confirm_repayment(%L, 100)',
  (select id from public.repayments where settlement_id = pg_temp.v('s.t1_s') limit 1)), 'forbidden');
select pg_temp.expect_error('delete from public.audit_logs', 'permission denied for table audit_logs');
reset role;
-- Sans compte, rien n'est lisible directement.
select pg_temp.anon();
set local role anon;
select pg_temp.expect_error('select count(*) from public.expenses', 'permission denied for table expenses');
select pg_temp.expect_error('select count(*) from public.team_members', 'permission denied for table team_members');
reset role;

select 'team_scenarios : tous les tests passent' as resultat;
rollback;
