-- Test des liens e-mail et de la file d'envoi (transaction annulée).
-- Lancer : pnpm exec supabase db query --remote --yes -f supabase/tests/team_links.sql
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
grant execute on function pg_temp.expect_error(text, text) to authenticated, anon, service_role;

create function pg_temp.draft(p_payer uuid, p_ids uuid[], p_total int default 1200) returns jsonb language sql as $$
  select jsonb_build_object(
    'paid_by', p_payer, 'title', 'Courses', 'spent_on', '2026-11-20', 'total_cents', p_total,
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

-- Dernier lien en clair envoyé à une adresse pour un type d'e-mail.
create function pg_temp.last_token(p_email text, p_kind text) returns text language sql as $$
  select payload ->> 'token' from public.email_outbox
  where to_email = p_email and kind = p_kind order by created_at desc, id desc limit 1;
$$;

-- ── Mise en place : A crée la Team, Eve (avec e-mail) et Dana (sans) sont invitées, B est invité ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.team', public.create_team('Voyage', '✈️')::text, true);
select set_config('test.am', (select id from public.team_members where team_id = current_setting('test.team')::uuid and user_id = auth.uid())::text, true);
select set_config('test.dana', public.add_guest(current_setting('test.team')::uuid, 'Dana', null)::text, true);
select set_config('test.eve', public.add_guest(current_setting('test.team')::uuid, 'Eve', 'eve@test.local')::text, true);
select set_config('test.invb', public.invite_member(current_setting('test.team')::uuid, 'b@test.local')::text, true);
reset role;

-- ── 1. Invitation : un e-mail avec un lien, lisible sans compte ──
select set_config('test.tinv', pg_temp.last_token('b@test.local', 'team_invitation'), true);
do $$ begin
  if current_setting('test.tinv', true) is null or length(current_setting('test.tinv')) < 40 then
    raise exception '1 : lien d''invitation attendu';
  end if;
  if exists (select 1 from public.action_tokens where token_hash::text like '%' || current_setting('test.tinv') || '%') then
    raise exception '1 : le jeton ne doit pas être stocké en clair';
  end if;
end $$;
select pg_temp.anon();
set local role anon;
do $$ declare v jsonb := public.token_view(current_setting('test.tinv')); begin
  if v ->> 'state' <> 'open' or v ->> 'kind' <> 'accept_invitation' or v ->> 'team_name' <> 'Voyage' then
    raise exception '1 : invitation ouverte attendue, obtenu %', v;
  end if;
  if v ->> 'email' = 'b@test.local' then raise exception '1 : e-mail masqué attendu'; end if;
end $$;
do $$ begin
  if public.token_view('nimportequoi') ->> 'state' <> 'invalid' then raise exception '1 : invalid attendu'; end if;
end $$;
select pg_temp.expect_error('select count(*) from public.action_tokens', 'permission denied for table action_tokens');
select pg_temp.expect_error('select count(*) from public.email_outbox', 'permission denied for table email_outbox');
select pg_temp.expect_error('select public.claim_outbox(10)', 'permission denied for function claim_outbox');
reset role;

-- ── 2. Dépense pour A, Eve et Dana : un lien pour Eve seulement ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.e1', public.create_expense(current_setting('test.team')::uuid,
  pg_temp.draft(current_setting('test.am')::uuid,
    array[current_setting('test.am'), current_setting('test.eve'), current_setting('test.dana')]::uuid[]))::text, true);
reset role;
select set_config('test.t1', pg_temp.last_token('eve@test.local', 'approve_expense'), true);
do $$ begin
  if current_setting('test.t1', true) is null then raise exception '2 : lien pour Eve attendu'; end if;
  if (select count(*) from public.email_outbox where kind = 'approve_expense') <> 1 then
    raise exception '2 : un seul e-mail de validation attendu (Dana n''a pas d''e-mail)';
  end if;
  if exists (select 1 from public.email_outbox where to_email = 'a@test.local') then
    raise exception '2 : pas d''e-mail pour la personne qui saisit';
  end if;
end $$;

-- ── 3. Le lien montre la dépense, sans compte ──
select pg_temp.anon();
set local role anon;
do $$ declare v jsonb := public.token_view(current_setting('test.t1')); begin
  if v ->> 'state' <> 'open' or v ->> 'kind' <> 'approve_expense' then raise exception '3 : ouvert attendu, obtenu %', v; end if;
  if (v -> 'expense' ->> 'i_paid')::boolean is distinct from false then raise exception '3 : i_paid faux attendu'; end if;
  if (v -> 'expense' ->> 'total_cents')::int <> 1200 or (v -> 'expense' ->> 'my_share_cents')::int <> 400 then
    raise exception '3 : total 1200 et part 400 attendus, obtenu %', v;
  end if;
  if v ->> 'member_name' <> 'Eve' or jsonb_array_length(v -> 'expense' -> 'beneficiaries') <> 3 then
    raise exception '3 : Eve et 3 bénéficiaires attendus';
  end if;
end $$;
reset role;

-- ── 4. Une correction annule l'ancien lien et en envoie un nouveau ──
select pg_temp.login('a');
set local role authenticated;
select public.update_expense(current_setting('test.e1')::uuid,
  pg_temp.draft(current_setting('test.am')::uuid,
    array[current_setting('test.am'), current_setting('test.eve'), current_setting('test.dana')]::uuid[], 1500));
reset role;
select set_config('test.t2', pg_temp.last_token('eve@test.local', 'approve_expense'), true);
select pg_temp.anon();
set local role anon;
do $$ begin
  if current_setting('test.t2') = current_setting('test.t1') then raise exception '4 : nouveau lien attendu'; end if;
  if public.token_view(current_setting('test.t1')) ->> 'state' <> 'revoked' then raise exception '4 : ancien lien révoqué attendu'; end if;
end $$;
select pg_temp.expect_error(format('select public.token_act(%L, %L)', current_setting('test.t1'), 'approve'), 'link_revoked');

-- ── 5. Eve valide par le lien : une seule fois ──
do $$ declare v jsonb := public.token_act(current_setting('test.t2'), 'approve'); begin
  if v ->> 'state' <> 'done' then raise exception '5 : done attendu, obtenu %', v; end if;
end $$;
select pg_temp.expect_error(format('select public.token_act(%L, %L)', current_setting('test.t2'), 'approve'), 'link_used');
do $$ begin
  if public.token_view(current_setting('test.t2')) ->> 'state' <> 'used' then raise exception '5 : used attendu'; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.expense_approvals
                 where expense_id = current_setting('test.e1')::uuid and member_id = current_setting('test.eve')::uuid
                   and version = 2 and decision = 'approved' and via = 'email' and acted_by is null) then
    raise exception '5 : validation par e-mail d''Eve attendue';
  end if;
  if not exists (select 1 from public.audit_logs where target_id = current_setting('test.e1')::uuid
                 and action = 'expense.approved' and actor_member = current_setting('test.eve')::uuid) then
    raise exception '5 : historique au nom d''Eve attendu';
  end if;
end $$;

-- ── 6. Contestation par le lien ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.e2', public.create_expense(current_setting('test.team')::uuid,
  pg_temp.draft(current_setting('test.am')::uuid, array[current_setting('test.eve')]::uuid[]))::text, true);
reset role;
select set_config('test.t3', pg_temp.last_token('eve@test.local', 'approve_expense'), true);
select pg_temp.anon();
set local role anon;
select pg_temp.expect_error(format('select public.token_act(%L, %L, %L, %L)', current_setting('test.t3'), 'dispute', 'error', ''), 'reason_required');
select pg_temp.expect_error(format('select public.token_act(%L, %L, %L, %L)', current_setting('test.t3'), 'dispute', 'autre', 'x'), 'invalid_kind');
select pg_temp.expect_error(format('select public.token_act(%L, %L)', current_setting('test.t3'), 'supprimer'), 'invalid_action');
select public.token_act(current_setting('test.t3'), 'dispute', 'error', 'Le pain coûtait 1 €');
reset role;
do $$ begin
  if (select status from public.expenses where id = current_setting('test.e2')::uuid) <> 'disputed' then
    raise exception '6 : disputed attendu';
  end if;
  if not exists (select 1 from public.expense_disputes where expense_id = current_setting('test.e2')::uuid
                 and member_id = current_setting('test.eve')::uuid and reason = 'Le pain coûtait 1 €') then
    raise exception '6 : contestation d''Eve attendue';
  end if;
end $$;

-- ── 7. Lien expiré : refusé, puis renvoyé à la même adresse ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.e3', public.create_expense(current_setting('test.team')::uuid,
  pg_temp.draft(current_setting('test.am')::uuid, array[current_setting('test.eve')]::uuid[]))::text, true);
reset role;
select set_config('test.t4', pg_temp.last_token('eve@test.local', 'approve_expense'), true);
update public.action_tokens set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
where target_id = current_setting('test.e3')::uuid;
select pg_temp.anon();
set local role anon;
do $$ begin
  if public.token_view(current_setting('test.t4')) ->> 'state' <> 'expired' then raise exception '7 : expired attendu'; end if;
end $$;
select pg_temp.expect_error(format('select public.token_act(%L, %L)', current_setting('test.t4'), 'approve'), 'link_expired');
do $$ declare v jsonb := public.token_resend(current_setting('test.t4')); begin
  if v ->> 'state' <> 'sent' then raise exception '7 : sent attendu, obtenu %', v; end if;
end $$;
do $$ begin
  if public.token_resend(current_setting('test.t4')) ->> 'state' <> 'too_soon' then raise exception '7 : too_soon attendu'; end if;
  if public.token_resend('nimportequoi') ->> 'state' <> 'invalid' then raise exception '7 : invalid attendu'; end if;
end $$;
reset role;
select set_config('test.t5', pg_temp.last_token('eve@test.local', 'approve_expense'), true);
do $$ begin
  if current_setting('test.t5') = current_setting('test.t4') then raise exception '7 : nouveau lien attendu'; end if;
end $$;

-- ── 8. Adresse d'Eve changée : l'ancien lien ne marche plus ──
select pg_temp.login('a');
set local role authenticated;
select public.update_guest(current_setting('test.eve')::uuid, 'Eve', 'eve2@test.local');
reset role;
select pg_temp.anon();
set local role anon;
do $$ begin
  if public.token_view(current_setting('test.t5')) ->> 'state' <> 'closed' then raise exception '8 : closed attendu'; end if;
end $$;
select pg_temp.expect_error(format('select public.token_act(%L, %L)', current_setting('test.t5'), 'approve'), 'link_closed');
reset role;

-- ── 9. Membre inscrit : un e-mail avec le lien vers l'application, sans jeton ──
select pg_temp.login('b');
set local role authenticated;
select set_config('test.bm', public.respond_invitation(current_setting('test.invb')::uuid, true)::text, true);
reset role;
select pg_temp.anon();
set local role anon;
do $$ begin
  if public.token_view(current_setting('test.tinv')) ->> 'state' <> 'closed' then raise exception '9 : invitation fermée attendue'; end if;
end $$;
reset role;
select pg_temp.login('a');
set local role authenticated;
select set_config('test.e4', public.create_expense(current_setting('test.team')::uuid,
  pg_temp.draft(current_setting('test.am')::uuid, array[current_setting('test.am'), current_setting('test.bm')]::uuid[]))::text, true);
reset role;
do $$ begin
  if not exists (select 1 from public.email_outbox where to_email = 'b@test.local' and kind = 'approval_requested'
                 and payload ->> 'expense_id' = current_setting('test.e4') and not payload ? 'token') then
    raise exception '9 : e-mail de validation pour B attendu';
  end if;
end $$;

-- ── 10. Limites anti-abus : 20 invitations par jour et par personne, 10 e-mails par jour et par adresse ──
select pg_temp.login('a');
set local role authenticated;
select set_config('test.team2', public.create_team('Spam', '📣')::text, true);
do $$ begin
  for i in 1..12 loop
    perform public.cancel_invitation(public.invite_member(current_setting('test.team2')::uuid, 'cible@test.local'));
  end loop;
  for i in 1..25 loop
    perform public.invite_member(current_setting('test.team2')::uuid, format('x%s@test.local', i));
  end loop;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.email_outbox where kind = 'team_invitation'
      and sender_user = '00000000-0000-4000-a000-00000000000a') > 20 then
    raise exception '10 : 20 invitations par jour au plus attendues';
  end if;
  if (select count(*) from public.email_outbox where to_email = 'cible@test.local') > 3 then
    raise exception '10 : 3 invitations par jour au plus vers une adresse depuis une personne attendues';
  end if;
end $$;
-- A ne peut pas empêcher B d'inviter la même adresse.
select pg_temp.login('b');
set local role authenticated;
select public.invite_member(public.create_team('Autre', '🏠'), 'cible@test.local');
reset role;
do $$ begin
  if not exists (select 1 from public.email_outbox where to_email = 'cible@test.local'
                 and sender_user = '00000000-0000-4000-a000-00000000000b') then
    raise exception '10 : l''invitation de B doit partir';
  end if;
end $$;
-- Plafond par adresse, tous expéditeurs confondus : 40 e-mails par jour.
insert into public.email_outbox (to_email, kind, payload)
select 'victime@test.local', 'approval_requested', '{}'::jsonb from generate_series(1, 40);
select pg_temp.login('b');
set local role authenticated;
select public.invite_member(public.create_team('Encore', '🎯'), 'victime@test.local');
reset role;
do $$ begin
  if (select count(*) from public.email_outbox where to_email = 'victime@test.local') <> 40 then
    raise exception '10 : plafond de 40 e-mails par jour pour une adresse attendu';
  end if;
end $$;

-- Un même expéditeur ne remplit pas seul ce plafond : 20 par adresse au plus.
insert into public.email_outbox (to_email, kind, payload, sender_user)
select 'victime2@test.local', 'approval_requested', '{}'::jsonb, '00000000-0000-4000-a000-00000000000b'
from generate_series(1, 20);
select pg_temp.login('b');
set local role authenticated;
select public.invite_member(public.create_team('Encore B', '🎯'), 'victime2@test.local');
reset role;
select pg_temp.login('c');
set local role authenticated;
select public.invite_member(public.create_team('Encore C', '🎯'), 'victime2@test.local');
reset role;
do $$ begin
  if (select count(*) from public.email_outbox where to_email = 'victime2@test.local'
      and sender_user = '00000000-0000-4000-a000-00000000000b') <> 20 then
    raise exception '10 : 20 e-mails par adresse au plus pour un même expéditeur attendus';
  end if;
  if (select count(*) from public.email_outbox where to_email = 'victime2@test.local'
      and sender_user = '00000000-0000-4000-a000-00000000000c') <> 1 then
    raise exception '10 : l''invitation de C vers victime2 doit partir';
  end if;
end $$;

-- ── 11. File d'envoi : réservée au serveur, lien effacé après l'envoi ──
set local role service_role;
do $$
declare
  v_id uuid;
  v_n int;
begin
  select count(*), (array_agg(id))[1] into v_n, v_id from public.claim_outbox(100);
  if v_n < 5 then raise exception '10 : au moins 5 e-mails attendus, obtenu %', v_n; end if;
  if (select count(*) from public.claim_outbox(100)) <> 0 then raise exception '10 : déjà réservés'; end if;
  perform public.complete_outbox(v_id, null);
  if (select payload ? 'token' or sent_at is null from public.email_outbox where id = v_id) then
    raise exception '10 : envoi marqué et lien effacé attendus';
  end if;
end $$;
reset role;

select 'team_links : tous les tests passent' as resultat;
rollback;
