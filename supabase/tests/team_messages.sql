-- Test de la discussion et des notifications (transaction annulée).
-- Lancer : pnpm exec supabase db query --remote --yes -f supabase/tests/team_messages.sql
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

create function pg_temp.notif(p_letter text, p_kind text) returns bigint language sql as $$
  select count(*) from public.notifications
  where user_id = format('00000000-0000-4000-a000-00000000000%s', p_letter)::uuid and kind = p_kind;
$$;

-- ── A crée la Team et invite B : B est notifié ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.team', public.create_team('Voyage', '✈️')::text, true);
select set_config('test.am', (select id from public.team_members where team_id = current_setting('test.team')::uuid and user_id = auth.uid())::text, true);
select set_config('test.inv', public.invite_member(current_setting('test.team')::uuid, 'b@test.local')::text, true);
reset role;
do $$ begin
  if pg_temp.notif('b', 'team_invitation') <> 1 then raise exception 'B doit être notifié de l''invitation'; end if;
end $$;

select pg_temp.login('b');
set local role authenticated;
select set_config('test.bm', public.respond_invitation(current_setting('test.inv')::uuid, true)::text, true);
do $$ begin
  if not exists (select 1 from public.team_messages where team_id = current_setting('test.team')::uuid
                 and kind = 'system' and event = 'member.joined')
  then raise exception 'message automatique member.joined attendu'; end if;
end $$;
reset role;

-- ── A ajoute une dépense pour A et B : message + B notifié, pas A ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.e', public.create_expense(current_setting('test.team')::uuid, jsonb_build_object(
  'paid_by', current_setting('test.am'), 'title', 'Gâteaux', 'spent_on', '2026-11-20', 'total_cents', 1200,
  'category_id', null, 'split_mode', 'equal',
  'beneficiaries', jsonb_build_array(jsonb_build_object('member_id', current_setting('test.am')),
                                     jsonb_build_object('member_id', current_setting('test.bm')))))::text, true);
reset role;
do $$ begin
  if not exists (select 1 from public.team_messages where expense_id = current_setting('test.e')::uuid and event = 'expense.created')
  then raise exception 'message automatique expense.created attendu'; end if;
  if pg_temp.notif('b', 'approval_requested') <> 1 then raise exception 'B doit être notifié (validation demandée)'; end if;
  if pg_temp.notif('a', 'approval_requested') <> 0 then raise exception 'A ne doit pas être notifié de sa propre dépense'; end if;
end $$;

-- ── B valide : dépense validée, A (payeur) notifié ──
select pg_temp.login('b');
set local role authenticated;
select public.approve_expense(current_setting('test.e')::uuid, 1);
reset role;
do $$ begin
  if (select status from public.expenses where id = current_setting('test.e')::uuid) <> 'validated'
  then raise exception 'dépense validée attendue'; end if;
  if pg_temp.notif('a', 'expense_validated') <> 1 then raise exception 'A doit être notifié de la validation'; end if;
  if not exists (select 1 from public.team_messages where expense_id = current_setting('test.e')::uuid
                 and event = 'expense.status' and data ->> 'to' = 'validated')
  then raise exception 'message automatique de validation attendu'; end if;
end $$;

-- ── Discussion ──
select pg_temp.login('b');
set local role authenticated;
select public.send_message(current_setting('test.team')::uuid, '  Merci !  ');
select pg_temp.expect_error(format('select public.send_message(%L, %L)', current_setting('test.team'), '   '), 'invalid_message');
select pg_temp.expect_error(format('select public.send_message(%L, %L)', current_setting('test.team'), repeat('x', 2001)), 'invalid_message');
select pg_temp.expect_error($q$insert into public.team_messages (team_id, kind, body) values (gen_random_uuid(), 'text', 'x')$q$, 'permission denied for table team_messages');
-- B marque tout comme lu.
select public.mark_notifications_read(null);
do $$ begin
  if exists (select 1 from public.notifications where read_at is null) then
    raise exception 'B : toutes ses notifications doivent être lues';
  end if;
end $$;
reset role;

select pg_temp.login('a');
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.team_messages where kind = 'text' and body = 'Merci !')
  then raise exception 'A doit lire le message de B (espaces retirés)'; end if;
  if (select count(*) from public.notifications where read_at is null) = 0
  then raise exception 'les notifications de A ne doivent pas être marquées lues par B'; end if;
end $$;
reset role;

select pg_temp.login('c');
set local role authenticated;
do $$ begin
  if (select count(*) from public.team_messages) <> 0 then raise exception 'C ne doit voir aucun message'; end if;
  if (select count(*) from public.notifications) <> 0 then raise exception 'C ne doit voir aucune notification'; end if;
end $$;
select pg_temp.expect_error(format('select public.send_message(%L, %L)', current_setting('test.team'), 'Coucou'), 'forbidden');
reset role;

select 'team_messages : tous les tests passent' as resultat;
rollback;
