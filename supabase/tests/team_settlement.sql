-- Test de la clôture, du bilan et des remboursements (transaction annulée).
-- Lancer : pnpm exec supabase db query --remote --yes -f supabase/tests/team_settlement.sql
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
grant execute on function pg_temp.expect_error(text, text) to authenticated, anon;

create function pg_temp.draft(p_payer uuid, p_ids uuid[], p_total int) returns jsonb language sql as $$
  select jsonb_build_object(
    'paid_by', p_payer, 'title', 'Dépense', 'spent_on', '2026-11-20', 'total_cents', p_total,
    'category_id', null, 'split_mode', 'equal',
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object('member_id', id) order by i)
                               from unnest(p_ids) with ordinality as u(id, i)), '[]'::jsonb));
$$;
grant execute on function pg_temp.draft(uuid, uuid[], int) to authenticated;

create function pg_temp.login(p_letter text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', p_letter), true);
$$;

create function pg_temp.anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

create function pg_temp.last_token(p_email text, p_kind text) returns text language sql as $$
  select payload ->> 'token' from public.email_outbox
  where to_email = p_email and kind = p_kind order by created_at desc, id desc limit 1;
$$;

create function pg_temp.v(p text) returns uuid language sql as $$ select current_setting(p)::uuid $$;
grant execute on function pg_temp.v(text) to authenticated, anon;

create function pg_temp.team_status(p text) returns text language sql as $$
  select status from public.teams where id = current_setting(p)::uuid;
$$;

-- ── Mise en place : A crée la Team ; B la rejoint ; Dana (sans e-mail) et Eve (avec) sont invitées ──
select pg_temp.login('a');
set local role authenticated;
select set_config('t.team', public.create_team('Voyage', '✈️')::text, true);
select set_config('t.a', (select id from public.team_members where team_id = pg_temp.v('t.team') and user_id = auth.uid())::text, true);
select set_config('t.dana', public.add_guest(pg_temp.v('t.team'), 'Dana', null)::text, true);
select set_config('t.eve', public.add_guest(pg_temp.v('t.team'), 'Eve', 'eve@test.local')::text, true);
select set_config('t.invb', public.invite_member(pg_temp.v('t.team'), 'b@test.local')::text, true);
reset role;
select pg_temp.login('b');
set local role authenticated;
select set_config('t.b', public.respond_invitation(pg_temp.v('t.invb'), true)::text, true);
reset role;

-- Exemple du cahier des charges : A paie 300 €, B 180 €, Eve 120 €, pour les quatre.
select pg_temp.login('a');
set local role authenticated;
select set_config('t.e1', public.create_expense(pg_temp.v('t.team'),
  pg_temp.draft(pg_temp.v('t.a'), array[pg_temp.v('t.a'), pg_temp.v('t.b'), pg_temp.v('t.dana'), pg_temp.v('t.eve')], 30000))::text, true);
select set_config('t.e3', public.create_expense(pg_temp.v('t.team'),
  pg_temp.draft(pg_temp.v('t.eve'), array[pg_temp.v('t.a'), pg_temp.v('t.b'), pg_temp.v('t.dana'), pg_temp.v('t.eve')], 12000))::text, true);
reset role;
select pg_temp.login('b');
set local role authenticated;
select set_config('t.e2', public.create_expense(pg_temp.v('t.team'),
  pg_temp.draft(pg_temp.v('t.b'), array[pg_temp.v('t.a'), pg_temp.v('t.b'), pg_temp.v('t.dana'), pg_temp.v('t.eve')], 18000))::text, true);

-- ── 1. Pas de clôture tant qu'une dépense attend ──
select pg_temp.expect_error(format('select public.request_settlement(%L)', current_setting('t.team')), 'expenses_open');
select public.approve_expense(pg_temp.v('t.e1'), 1);
select public.approve_expense(pg_temp.v('t.e3'), 1);
reset role;
select pg_temp.login('a');
set local role authenticated;
select public.approve_expense(pg_temp.v('t.e2'), 1);
select public.approve_expense(pg_temp.v('t.e1'), 1, pg_temp.v('t.dana'));
select public.approve_expense(pg_temp.v('t.e2'), 1, pg_temp.v('t.dana'));
select public.approve_expense(pg_temp.v('t.e3'), 1, pg_temp.v('t.dana'));
select public.approve_expense(pg_temp.v('t.e3'), 1);
reset role;
select public.record_approval(pg_temp.v('t.e1'), 1, pg_temp.v('t.eve'), 'approved', 'email');
select public.record_approval(pg_temp.v('t.e2'), 1, pg_temp.v('t.eve'), 'approved', 'email');
select public.record_approval(pg_temp.v('t.e3'), 1, pg_temp.v('t.eve'), 'approved', 'email');
do $$ begin
  if (select count(*) from public.expenses where team_id = pg_temp.v('t.team') and status = 'validated') <> 3 then
    raise exception 'mise en place : 3 dépenses validées attendues';
  end if;
end $$;

-- ── 2. B demande la clôture : bilan figé, Team en clôture ──
select pg_temp.login('b');
set local role authenticated;
select set_config('t.s1', public.request_settlement(pg_temp.v('t.team'))::text, true);
select pg_temp.expect_error(format('select public.request_settlement(%L)', current_setting('t.team')), 'team_locked');
select pg_temp.expect_error(format('select public.create_expense(%L, %L)', current_setting('t.team'),
  pg_temp.draft(pg_temp.v('t.b'), array[pg_temp.v('t.b')], 100)), 'team_locked');
reset role;
do $$ begin
  if pg_temp.team_status('t.team') <> 'closing' then raise exception '2 : closing attendu'; end if;
  if (select total_cents from public.team_settlements where id = pg_temp.v('t.s1')) <> 60000 then
    raise exception '2 : total 600 € attendu';
  end if;
  if (select string_agg(balance_cents::text, ',' order by balance_cents desc)
      from public.settlement_balances where settlement_id = pg_temp.v('t.s1')) <> '15000,3000,-3000,-15000' then
    raise exception '2 : soldes +150, +30, -30, -150 attendus';
  end if;
  if not exists (select 1 from public.settlement_approvals where settlement_id = pg_temp.v('t.s1')
                 and member_id = pg_temp.v('t.b') and decision = 'approved') then
    raise exception '2 : B a validé en demandant';
  end if;
  if not exists (select 1 from public.notifications where kind = 'settlement_requested'
                 and user_id = '00000000-0000-4000-a000-00000000000a') then
    raise exception '2 : A doit être notifié';
  end if;
  if pg_temp.last_token('eve@test.local', 'approve_settlement') is null then
    raise exception '2 : lien de validation du bilan pour Eve attendu';
  end if;
end $$;

-- ── 3. A conteste : la Team rouvre et le bilan est remplacé ──
select pg_temp.login('a');
set local role authenticated;
select pg_temp.expect_error(format('select public.dispute_settlement(%L, %L)', current_setting('t.s1'), ' '), 'reason_required');
select public.dispute_settlement(pg_temp.v('t.s1'), 'Il manque le resto de samedi');
reset role;
do $$ begin
  if pg_temp.team_status('t.team') <> 'active' then raise exception '3 : active attendu'; end if;
  if (select status from public.team_settlements where id = pg_temp.v('t.s1')) <> 'superseded' then
    raise exception '3 : superseded attendu';
  end if;
end $$;
select set_config('t.ts1', pg_temp.last_token('eve@test.local', 'approve_settlement'), true);
select pg_temp.anon();
set local role anon;
do $$ begin
  if public.token_view(current_setting('t.ts1')) ->> 'state' not in ('closed', 'revoked') then
    raise exception '3 : le lien du bilan remplacé doit être fermé';
  end if;
end $$;
reset role;

-- ── 4. Nouvelle demande : validée par tous (Dana par le créateur, Eve par lien) ──
select pg_temp.login('a');
set local role authenticated;
select set_config('t.s2', public.request_settlement(pg_temp.v('t.team'))::text, true);
reset role;
select pg_temp.login('b');
set local role authenticated;
select pg_temp.expect_error(format('select public.approve_settlement(%L, %L)', current_setting('t.s2'), current_setting('t.dana')), 'forbidden');
select public.approve_settlement(pg_temp.v('t.s2'));
reset role;
select pg_temp.login('a');
set local role authenticated;
select pg_temp.expect_error(format('select public.approve_settlement(%L, %L)', current_setting('t.s2'), current_setting('t.eve')), 'forbidden');
select public.approve_settlement(pg_temp.v('t.s2'), pg_temp.v('t.dana'));
reset role;
select set_config('t.ts2', pg_temp.last_token('eve@test.local', 'approve_settlement'), true);
select pg_temp.anon();
set local role anon;
do $$ declare v jsonb := public.token_view(current_setting('t.ts2')); begin
  if v ->> 'state' <> 'open' or v ->> 'kind' <> 'approve_settlement' then raise exception '4 : lien ouvert attendu, obtenu %', v; end if;
  if (v -> 'settlement' ->> 'my_balance_cents')::int <> -3000 then raise exception '4 : solde -30 € attendu pour Eve'; end if;
  if jsonb_array_length(v -> 'settlement' -> 'transfers') <> 2 then raise exception '4 : 2 virements attendus'; end if;
end $$;
select public.token_act(current_setting('t.ts2'), 'approve');
reset role;
do $$ begin
  if pg_temp.team_status('t.team') <> 'settling' then raise exception '4 : settling attendu'; end if;
  if (select string_agg(format('%s>%s:%s',
        (select display_name from public.team_members where id = r.from_member),
        (select display_name from public.team_members where id = r.to_member), r.amount_cents), ',' order by r.position)
      from public.repayments r where r.settlement_id = pg_temp.v('t.s2'))
     <> 'Dana>' || (select display_name from public.team_members where id = pg_temp.v('t.a')) || ':15000,Eve>'
        || (select display_name from public.team_members where id = pg_temp.v('t.b')) || ':3000' then
    raise exception '4 : virements Dana → A 150 € et Eve → B 30 € attendus';
  end if;
  if not exists (select 1 from public.email_outbox where to_email = 'eve@test.local' and kind = 'repayment_due') then
    raise exception '4 : Eve doit recevoir ce qu''elle doit';
  end if;
end $$;
select set_config('t.r1', (select id from public.repayments where settlement_id = pg_temp.v('t.s2') and position = 1)::text, true);
select set_config('t.r2', (select id from public.repayments where settlement_id = pg_temp.v('t.s2') and position = 2)::text, true);

-- ── 5. Remboursements : déclaration, confirmations partielles, droits ──
select pg_temp.login('b');
set local role authenticated;
select pg_temp.expect_error(format('select public.confirm_repayment(%L, 100)', current_setting('t.r1')), 'forbidden');
select pg_temp.expect_error(format('select public.declare_repayment(%L, 100)', current_setting('t.r1')), 'forbidden');
reset role;
select pg_temp.login('a');
set local role authenticated;
-- Après le début de la clôture, le créateur ne peut plus modifier un invité
-- (sinon il pourrait effacer son e-mail pour confirmer à sa place).
select pg_temp.expect_error(format('select public.update_guest(%L, %L, null)', current_setting('t.eve'), 'Eve'), 'team_locked');
select public.declare_repayment(pg_temp.v('t.r1'), 10000, pg_temp.v('t.dana'));
do $$ begin
  if (select status || ':' || confirmed_cents from public.repayments where id = pg_temp.v('t.r1')) <> 'declared:0' then
    raise exception '5 : une déclaration ne confirme rien';
  end if;
end $$;
select public.confirm_repayment(pg_temp.v('t.r1'), 5000);
select pg_temp.expect_error(format('select public.confirm_repayment(%L, 20000)', current_setting('t.r1')), 'invalid_amount');
select pg_temp.expect_error(format('select public.confirm_repayment(%L, 0)', current_setting('t.r1')), 'invalid_amount');
select public.confirm_repayment(pg_temp.v('t.r1'), 10000);
reset role;
do $$ begin
  if (select status || ':' || confirmed_cents from public.repayments where id = pg_temp.v('t.r1')) <> 'confirmed:15000' then
    raise exception '5 : 150 € confirmés attendus';
  end if;
  if pg_temp.team_status('t.team') <> 'settling' then raise exception '5 : encore settling'; end if;
end $$;
select pg_temp.login('b');
set local role authenticated;
select public.confirm_repayment(pg_temp.v('t.r2'), 3000);
reset role;

-- ── 6. Tout est confirmé : Team soldée, puis archivée par le créateur seulement ──
do $$ begin
  if pg_temp.team_status('t.team') <> 'settled' then raise exception '6 : settled attendu'; end if;
  if not exists (select 1 from public.notifications where kind = 'team_settled'
                 and user_id = '00000000-0000-4000-a000-00000000000a') then
    raise exception '6 : A doit être notifié de la Team soldée';
  end if;
end $$;
select pg_temp.login('b');
set local role authenticated;
select pg_temp.expect_error(format('select public.archive_team(%L)', current_setting('t.team')), 'forbidden');
reset role;
select pg_temp.login('a');
set local role authenticated;
select public.archive_team(pg_temp.v('t.team'));
reset role;
do $$ begin
  if pg_temp.team_status('t.team') <> 'archived' then raise exception '6 : archived attendu'; end if;
end $$;

-- ── 7. Invitée créancière : confirmation partielle par lien, nouveau lien pour le reste ──
select pg_temp.login('a');
set local role authenticated;
select set_config('t.team2', public.create_team('Coloc', '🏠')::text, true);
select set_config('t.a2', (select id from public.team_members where team_id = pg_temp.v('t.team2') and user_id = auth.uid())::text, true);
select set_config('t.zoe', public.add_guest(pg_temp.v('t.team2'), 'Zoé', 'zoe@test.local')::text, true);
select set_config('t.z1', public.create_expense(pg_temp.v('t.team2'),
  pg_temp.draft(pg_temp.v('t.zoe'), array[pg_temp.v('t.a2'), pg_temp.v('t.zoe')], 2000))::text, true);
select public.approve_expense(pg_temp.v('t.z1'), 1);
reset role;
select public.record_approval(pg_temp.v('t.z1'), 1, pg_temp.v('t.zoe'), 'approved', 'email');
select pg_temp.login('a');
set local role authenticated;
select set_config('t.s3', public.request_settlement(pg_temp.v('t.team2'))::text, true);
reset role;
select set_config('t.tz', pg_temp.last_token('zoe@test.local', 'approve_settlement'), true);
select pg_temp.anon();
set local role anon;
select public.token_act(current_setting('t.tz'), 'approve');
reset role;
select set_config('t.r3', (select id from public.repayments where settlement_id = pg_temp.v('t.s3'))::text, true);
select set_config('t.tk1', pg_temp.last_token('zoe@test.local', 'confirm_repayment'), true);
select pg_temp.anon();
set local role anon;
do $$ declare v jsonb := public.token_view(current_setting('t.tk1')); begin
  if v ->> 'state' <> 'open' or (v -> 'repayment' ->> 'remaining_cents')::int <> 1000 then
    raise exception '7 : lien de réception ouvert, 10 € restants attendus, obtenu %', v;
  end if;
end $$;
select pg_temp.expect_error(format('select public.token_act(%L, %L, null, null, 5000)', current_setting('t.tk1'), 'confirm'), 'invalid_amount');
select public.token_act(current_setting('t.tk1'), 'confirm', null, null, 400);
select pg_temp.expect_error(format('select public.token_act(%L, %L, null, null, 600)', current_setting('t.tk1'), 'confirm'), 'link_used');
reset role;
select set_config('t.tk2', pg_temp.last_token('zoe@test.local', 'confirm_repayment'), true);
do $$ begin
  if current_setting('t.tk2') = current_setting('t.tk1') then raise exception '7 : nouveau lien pour le reste attendu'; end if;
  if (select status || ':' || confirmed_cents from public.repayments where id = pg_temp.v('t.r3')) <> 'partial:400' then
    raise exception '7 : partial 4 € attendu';
  end if;
end $$;
select pg_temp.anon();
set local role anon;
select public.token_act(current_setting('t.tk2'), 'confirm', null, null, 600);
reset role;
do $$ begin
  if pg_temp.team_status('t.team2') <> 'settled' then raise exception '7 : Coloc soldée attendue'; end if;
  if (select via from public.repayment_events where repayment_id = pg_temp.v('t.r3') order by created_at desc limit 1) <> 'email' then
    raise exception '7 : confirmation par e-mail attendue';
  end if;
end $$;

-- ── 8. Lecture : membres seulement ──
select pg_temp.login('c');
set local role authenticated;
do $$ begin
  if exists (select 1 from public.team_settlements where team_id = pg_temp.v('t.team'))
     or exists (select 1 from public.repayments where team_id = pg_temp.v('t.team')) then
    raise exception '8 : C ne voit rien';
  end if;
end $$;
select pg_temp.expect_error(format('select public.approve_settlement(%L)', current_setting('t.s2')), 'forbidden');
reset role;
select pg_temp.login('b');
set local role authenticated;
do $$ begin
  if (select count(*) from public.repayments where settlement_id = pg_temp.v('t.s2')) <> 2
     or (select count(*) from public.settlement_balances where settlement_id = pg_temp.v('t.s2')) <> 4 then
    raise exception '8 : B voit le bilan et les virements';
  end if;
end $$;
select pg_temp.expect_error('insert into public.repayments (settlement_id, team_id, position, from_member, to_member, amount_cents) values (gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), gen_random_uuid(), 1)', 'permission denied for table repayments');
reset role;
select pg_temp.anon();
set local role anon;
select pg_temp.expect_error('select count(*) from public.team_settlements', 'permission denied for table team_settlements');
reset role;

select 'team_settlement : tous les tests passent' as resultat;
rollback;
