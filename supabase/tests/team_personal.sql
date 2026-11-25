-- Test de la part de Team dans le budget personnel et du pseudo (transaction annulée).
-- Lancer : pnpm exec supabase db query --remote --yes -f supabase/tests/team_personal.sql
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

create function pg_temp.login(p_letter text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', p_letter), true);
$$;

create function pg_temp.v(p text) returns uuid language sql as $$ select current_setting(p)::uuid $$;
grant execute on function pg_temp.v(text) to authenticated;

create function pg_temp.draft(p_payer uuid, p_ids uuid[], p_total int, p_title text) returns jsonb language sql as $$
  select jsonb_build_object(
    'paid_by', p_payer, 'title', p_title, 'spent_on', '2026-11-20', 'total_cents', p_total,
    'category_id', 'alimentation', 'split_mode', 'equal',
    'beneficiaries', (select jsonb_agg(jsonb_build_object('member_id', id) order by i)
                      from unnest(p_ids) with ordinality as u(id, i)));
$$;
grant execute on function pg_temp.draft(uuid, uuid[], int, text) to authenticated;

-- A crée la Team, B la rejoint ; A paie 12 € pour A et B (validée), puis 9 € (en attente).
select pg_temp.login('a');
set local role authenticated;
select set_config('t.team', public.create_team('Voyage', '✈️')::text, true);
select set_config('t.a', (select id from public.team_members where team_id = pg_temp.v('t.team') and user_id = auth.uid())::text, true);
select set_config('t.inv', public.invite_member(pg_temp.v('t.team'), 'b@test.local')::text, true);
reset role;
select pg_temp.login('b');
set local role authenticated;
select set_config('t.b', public.respond_invitation(pg_temp.v('t.inv'), true)::text, true);
reset role;
select pg_temp.login('a');
set local role authenticated;
select set_config('t.e1', public.create_expense(pg_temp.v('t.team'),
  pg_temp.draft(pg_temp.v('t.a'), array[pg_temp.v('t.a'), pg_temp.v('t.b')], 1200, 'Courses'))::text, true);
select public.create_expense(pg_temp.v('t.team'),
  pg_temp.draft(pg_temp.v('t.a'), array[pg_temp.v('t.a'), pg_temp.v('t.b')], 900, 'Pizza'));
reset role;
select pg_temp.login('b');
set local role authenticated;
select public.approve_expense(pg_temp.v('t.e1'), 1);

-- ── 1. B voit sa part des dépenses validées seulement ──
do $$ declare r record; n int; begin
  select count(*) into n from public.my_team_shares('2026-11-01', '2026-11-30');
  if n <> 1 then raise exception '1 : une seule part attendue, obtenu %', n; end if;
  select * into r from public.my_team_shares('2026-11-01', '2026-11-30');
  if r.share_cents <> 600 or r.title <> 'Courses' or r.team_name <> 'Voyage'
     or r.category_id <> 'alimentation' or r.spent_on <> '2026-11-20' then
    raise exception '1 : part de 6 € pour Courses attendue, obtenu %', r;
  end if;
  if (select count(*) from public.my_team_shares('2026-12-01', '2026-12-31')) <> 0 then
    raise exception '1 : rien en décembre';
  end if;
end $$;
reset role;

-- ── 2. C, hors de la Team, ne voit rien ──
select pg_temp.login('c');
set local role authenticated;
do $$ begin
  if (select count(*) from public.my_team_shares(null, null)) <> 0 then raise exception '2 : rien pour C'; end if;
end $$;
reset role;

-- ── 3. Pseudo : mis à jour dans le profil et dans les Teams ──
select pg_temp.login('b');
set local role authenticated;
select pg_temp.expect_error('select public.set_display_name(''  '')', 'invalid_name');
select public.set_display_name('  Bobby  ');
reset role;
do $$ begin
  if (select display_name from public.profiles where id = '00000000-0000-4000-a000-00000000000b') <> 'Bobby' then
    raise exception '3 : profil Bobby attendu';
  end if;
  if (select display_name from public.team_members where id = pg_temp.v('t.b')) <> 'Bobby' then
    raise exception '3 : nom Bobby dans la Team attendu';
  end if;
  if (select display_name from public.team_members where id = pg_temp.v('t.a')) = 'Bobby' then
    raise exception '3 : A ne doit pas changer';
  end if;
end $$;

select 'team_personal : tous les tests passent' as resultat;
rollback;
