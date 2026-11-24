-- Test du stockage des tickets (transaction annulée).
-- Lancer : pnpm exec supabase db query --remote --yes -f supabase/tests/team_receipts.sql
begin;

insert into auth.users (id, email, aud, role, email_confirmed_at)
values
  ('00000000-0000-4000-a000-00000000000a', 'a@test.local', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-a000-00000000000c', 'c@test.local', 'authenticated', 'authenticated', now());

create function pg_temp.expect_error(stmt text, code text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'attendu : erreur %, obtenu : succès (%)', code, stmt;
exception when others then
  if sqlerrm not like code then
    raise exception 'attendu : erreur %, obtenu : % (%)', code, sqlerrm, stmt;
  end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

create function pg_temp.login(p_letter text) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-a000-00000000000%s","role":"authenticated"}', p_letter), true);
$$;

-- C a sa propre Team.
select pg_temp.login('c');
set local role authenticated;
select set_config('test.cteam', public.create_team('Autre', '👥')::text, true);
reset role;

-- ── A dépose la photo d'un ticket dans le dossier de sa Team ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.team', public.create_team('Voyage', '✈️')::text, true);
select set_config('test.am', (select id from public.team_members where team_id = current_setting('test.team')::uuid and user_id = auth.uid())::text, true);
select set_config('test.path', current_setting('test.team') || '/ticket-1.jpg', true);
insert into storage.objects (bucket_id, name, owner) values ('receipts', current_setting('test.path'), auth.uid());
-- Pas de dépôt dans le dossier d'une autre Team.
select pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, auth.uid())',
  'receipts', current_setting('test.cteam') || '/intrus.jpg'), 'new row violates row-level security policy%');

select set_config('test.r', public.create_receipt(current_setting('test.team')::uuid, current_setting('test.path'), 'CARREFOUR TOTAL 10,90')::text, true);
-- Chemin d'une autre Team, extension interdite, photo absente.
select pg_temp.expect_error(format('select public.create_receipt(%L, %L, %L)', current_setting('test.team'), current_setting('test.cteam') || '/x.jpg', ''), 'invalid_receipt');
select pg_temp.expect_error(format('select public.create_receipt(%L, %L, %L)', current_setting('test.team'), current_setting('test.team') || '/x.exe', ''), 'invalid_receipt');
select pg_temp.expect_error(format('select public.create_receipt(%L, %L, %L)', current_setting('test.team'), current_setting('test.team') || '/absent.jpg', ''), 'invalid_receipt');

-- Dépense rattachée au ticket.
select set_config('test.e', public.create_expense(current_setting('test.team')::uuid, jsonb_build_object(
  'paid_by', current_setting('test.am'), 'title', 'Carrefour', 'spent_on', '2026-11-12', 'total_cents', 1090,
  'category_id', 'alimentation', 'split_mode', 'equal', 'receipt_id', current_setting('test.r'),
  'beneficiaries', jsonb_build_array(jsonb_build_object('member_id', current_setting('test.am')))))::text, true);
do $$ begin
  if (select receipt_id from public.expenses where id = current_setting('test.e')::uuid) <> current_setting('test.r')::uuid
  then raise exception 'la dépense doit être rattachée au ticket'; end if;
end $$;
reset role;

-- ── Team en clôture : plus de dépôt ni de nouveau ticket ──
update public.teams set status = 'closing' where id = current_setting('test.team')::uuid;
select pg_temp.login('a');
set local role authenticated;
select pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, auth.uid())',
  'receipts', current_setting('test.team') || '/tard.jpg'), 'new row violates row-level security policy%');
select pg_temp.expect_error(format('select public.create_receipt(%L, %L, %L)', current_setting('test.team'), current_setting('test.path'), ''), 'team_locked');
reset role;
update public.teams set status = 'active' where id = current_setting('test.team')::uuid;

-- ── C ne voit ni le ticket ni la photo, et ne peut pas l'utiliser ──
select pg_temp.login('c');
set local role authenticated;
do $$ begin
  if (select count(*) from public.receipts) <> 0 then raise exception 'C ne doit voir aucun ticket'; end if;
  if (select count(*) from storage.objects where bucket_id = 'receipts' and name = current_setting('test.path')) <> 0
  then raise exception 'C ne doit pas voir la photo'; end if;
end $$;
select pg_temp.expect_error(format('select public.create_receipt(%L, %L, %L)', current_setting('test.team'), current_setting('test.path'), ''), 'forbidden');
select pg_temp.expect_error(format('select public.create_expense(%L, %L::jsonb)', current_setting('test.cteam'), jsonb_build_object(
  'paid_by', (select id from public.team_members where team_id = current_setting('test.cteam')::uuid and user_id = auth.uid()),
  'title', 'Vol', 'spent_on', '2026-11-12', 'total_cents', 100, 'category_id', null, 'split_mode', 'equal',
  'receipt_id', current_setting('test.r'),
  'beneficiaries', jsonb_build_array(jsonb_build_object('member_id',
    (select id from public.team_members where team_id = current_setting('test.cteam')::uuid and user_id = auth.uid())))
  )), 'invalid_receipt');
reset role;

select 'team_receipts : tous les tests passent' as resultat;
rollback;
