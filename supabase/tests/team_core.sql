-- Test des Teams, membres et historique. Tout se passe dans une transaction
-- annulée à la fin : aucune donnée ne reste dans la base.
-- Lancer : pnpm exec supabase db query --remote -f supabase/tests/team_core.sql
begin;

-- Trois comptes de test.
insert into auth.users (id, email, aud, role, email_confirmed_at)
values
  ('00000000-0000-4000-a000-00000000000a', 'a@test.local', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-a000-00000000000b', 'b@test.local', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-a000-00000000000c', 'c@test.local', 'authenticated', 'authenticated', now());

-- Vérifie qu'une instruction échoue avec le code attendu.
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

-- ── A crée une Team ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.team', public.create_team('Voyage Lisbonne', '✈️')::text, true);

do $$ begin
  if (select count(*) from public.teams) <> 1 then raise exception 'A doit voir 1 Team'; end if;
  if (select count(*) from public.team_members
      where team_id = current_setting('test.team')::uuid and role = 'owner' and status = 'active') <> 1
  then raise exception 'A doit être owner actif'; end if;
end $$;

-- Invité sans compte, sans e-mail, puis invitation de B (casse et espaces).
select set_config('test.dana', public.add_guest(current_setting('test.team')::uuid, 'Dana', null)::text, true);
select set_config('test.b', public.invite_member(current_setting('test.team')::uuid, '  B@Test.local ')::text, true);
-- Réinviter une invitation en attente renvoie la même invitation (pas de doublon).
do $$ begin
  if public.invite_member(current_setting('test.team')::uuid, 'b@test.local') <> current_setting('test.b')::uuid
  then raise exception 'réinvitation : doit renvoyer la même invitation'; end if;
end $$;
-- Une adresse sans compte est acceptée aussi : on ne révèle pas qui a un compte.
select public.invite_member(current_setting('test.team')::uuid, 'nobody@test.local');

do $$ begin
  if (select count(*) from public.team_invitations
      where team_id = current_setting('test.team')::uuid and accepted_at is null and declined_at is null) <> 2
  then raise exception 'il doit y avoir 2 invitations en attente'; end if;
  -- Le nom de B n'est pas visible avant qu'il accepte.
  if exists (select 1 from public.team_members where user_id = '00000000-0000-4000-a000-00000000000b')
  then raise exception 'B ne doit pas être membre avant d''accepter'; end if;
  if (select role from public.team_members where id = current_setting('test.dana')::uuid) <> 'guest'
  then raise exception 'Dana doit être invitée sans compte'; end if;
end $$;

-- Erreurs attendues côté A.
select pg_temp.expect_error(format('select public.invite_member(%L, %L)', current_setting('test.team'), 'a@test.local'), 'already_member');
select pg_temp.expect_error($q$select public.create_team('', '👥')$q$, 'invalid_name');
select pg_temp.expect_error(format('select public.create_team(%L, %L)', repeat('x', 61), '👥'), 'invalid_name');
select pg_temp.expect_error(format('select public.add_guest(%L, %L, %L)', current_setting('test.team'), 'Eve', 'pas-un-email'), 'invalid_email');
reset role;

-- ── B voit l'invitation et accepte ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.teams) <> 1 then raise exception 'B doit voir la Team où il est invité'; end if;
end $$;
do $$ begin
  if (select count(*) from public.team_invitations) <> 1
  then raise exception 'avant d''accepter, B ne doit voir que sa propre invitation'; end if;
  if (select count(*) from public.team_members) <> 0
  then raise exception 'avant d''accepter, B ne doit voir aucun membre'; end if;
end $$;
select set_config('test.bm', public.respond_invitation(current_setting('test.b')::uuid, true)::text, true);
do $$ begin
  if (select status from public.team_members where id = current_setting('test.bm')::uuid) <> 'active'
  then raise exception 'B doit être actif'; end if;
end $$;
-- Écriture directe interdite.
select pg_temp.expect_error($q$insert into public.teams (name, created_by) values ('Pirate', auth.uid())$q$, 'permission denied for table teams');
select pg_temp.expect_error(format('select public.delete_team(%L)', current_setting('test.team')), 'forbidden');
reset role;

-- ── C, étranger à la Team, ne voit rien et ne peut rien faire ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.teams) <> 0 then raise exception 'C ne doit voir aucune Team'; end if;
  if (select count(*) from public.team_members) <> 0 then raise exception 'C ne doit voir aucun membre'; end if;
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'C ne doit voir aucun historique'; end if;
  if (select count(*) from public.team_invitations) <> 0 then raise exception 'C ne doit voir aucune invitation'; end if;
end $$;
select pg_temp.expect_error(format('select public.add_guest(%L, %L, null)', current_setting('test.team'), 'Intrus'), 'forbidden');
select pg_temp.expect_error(format('select public.respond_invitation(%L, true)', current_setting('test.b')), 'forbidden');
reset role;

-- ── A retire B, ne peut pas se retirer, puis supprime la Team ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
-- B, déjà membre, ne peut pas être réinvité.
select pg_temp.expect_error(format('select public.invite_member(%L, %L)', current_setting('test.team'), 'b@test.local'), 'already_member');
select public.remove_member(current_setting('test.bm')::uuid);
do $$ begin
  if (select status from public.team_members where id = current_setting('test.bm')::uuid) <> 'removed'
  then raise exception 'B doit être retiré'; end if;
  if (select count(*) from public.audit_logs where team_id = current_setting('test.team')::uuid) < 5
  then raise exception 'historique incomplet'; end if;
end $$;
select pg_temp.expect_error(
  format('select public.remove_member(id) from public.team_members where team_id = %L and role = %L', current_setting('test.team'), 'owner'),
  'cannot_remove_owner');
select public.delete_team(current_setting('test.team')::uuid);
do $$ begin
  if (select count(*) from public.teams) <> 0 then raise exception 'la Team doit être supprimée'; end if;
end $$;
reset role;

select 'team_core : tous les tests passent' as resultat;
rollback;
