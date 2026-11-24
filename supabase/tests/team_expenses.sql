-- Test des dépenses de Team (transaction annulée : rien ne reste en base).
-- Lancer : pnpm exec supabase db query --remote --yes -f supabase/tests/team_expenses.sql
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

-- Brouillon de dépense : 10 € payés par p_payer, partage égal entre p_ids.
create function pg_temp.draft(p_payer uuid, p_ids uuid[], p_mode text default 'equal', p_shares int[] default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'paid_by', p_payer, 'title', 'Courses', 'spent_on', '2026-11-20', 'total_cents', 1000,
    'category_id', 'alimentation', 'split_mode', p_mode,
    'beneficiaries', coalesce((
      select jsonb_agg(jsonb_build_object('member_id', id, 'share_cents', p_shares[i]) order by i)
      from unnest(p_ids) with ordinality as u(id, i)), '[]'::jsonb
    ),
    'items', jsonb_build_array(jsonb_build_object('label', 'Pain', 'quantity', 1, 'unit_price_cents', 100, 'total_cents', 100, 'category_id', 'alimentation'))
  );
$$;
grant execute on function pg_temp.draft(uuid, uuid[], text, int[]) to authenticated;

-- ── A crée la Team, ajoute Dana, invite B ; C crée sa propre Team ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.cteam', public.create_team('Autre', '👥')::text, true);
select set_config('test.cm', (select id from public.team_members where team_id = current_setting('test.cteam')::uuid)::text, true);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.team', public.create_team('Voyage', '✈️')::text, true);
select set_config('test.am', (select id from public.team_members where team_id = current_setting('test.team')::uuid and user_id = auth.uid())::text, true);
select set_config('test.dana', public.add_guest(current_setting('test.team')::uuid, 'Dana', null)::text, true);
select set_config('test.inv', public.invite_member(current_setting('test.team')::uuid, 'b@test.local')::text, true);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.bm', public.respond_invitation(current_setting('test.inv')::uuid, true)::text, true);
reset role;

-- ── A saisit 10 € payés par Dana pour A, B et Dana ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.exp', public.create_expense(
  current_setting('test.team')::uuid,
  pg_temp.draft(current_setting('test.dana')::uuid,
    array[current_setting('test.am'), current_setting('test.bm'), current_setting('test.dana')]::uuid[])
)::text, true);

do $$
declare e public.expenses;
begin
  select * into e from public.expenses where id = current_setting('test.exp')::uuid;
  if e.status <> 'pending' or e.version <> 1 then raise exception 'statut/version inattendus'; end if;
  if e.entered_by <> current_setting('test.am')::uuid then raise exception 'saisi par doit être A'; end if;
  if e.paid_by <> current_setting('test.dana')::uuid then raise exception 'payé par doit être Dana'; end if;
  if (select array_agg(share_cents order by position) from public.expense_beneficiaries
      where expense_id = e.id) <> array[334, 333, 333] then
    raise exception 'parts attendues 334/333/333';
  end if;
  if (select count(*) from public.receipt_items where expense_id = e.id) <> 1 then
    raise exception 'un article attendu';
  end if;
end $$;

-- Parts personnalisées fausses, membre d'une autre Team, dépense invalide.
select pg_temp.expect_error(format('select public.create_expense(%L, pg_temp.draft(%L, array[%L, %L]::uuid[], %L, array[400, 500]))',
  current_setting('test.team'), current_setting('test.am'), current_setting('test.am'), current_setting('test.bm'), 'custom'), 'invalid_shares');
select pg_temp.expect_error(format('select public.create_expense(%L, pg_temp.draft(%L, array[%L]::uuid[]))',
  current_setting('test.team'), current_setting('test.am'), current_setting('test.cm')), 'invalid_member');
select pg_temp.expect_error(format('select public.create_expense(%L, pg_temp.draft(%L, array[]::uuid[]))',
  current_setting('test.team'), current_setting('test.am')), 'invalid_shares');
select pg_temp.expect_error(format($f$select public.create_expense(%L, pg_temp.draft(%L, array[%L]::uuid[]) || '{"total_cents": 0}')$f$,
  current_setting('test.team'), current_setting('test.am'), current_setting('test.am')), 'invalid_expense');
-- Parts personnalisées justes.
select public.create_expense(current_setting('test.team')::uuid,
  pg_temp.draft(current_setting('test.am')::uuid,
    array[current_setting('test.am'), current_setting('test.bm')]::uuid[], 'custom', array[400, 600]));
reset role;

-- ── C, étranger, ne voit rien et ne peut rien saisir ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.expenses) <> 0 then raise exception 'C ne doit voir aucune dépense'; end if;
  if (select count(*) from public.expense_beneficiaries) <> 0 then raise exception 'C ne doit voir aucune part'; end if;
  if (select count(*) from public.receipt_items) <> 0 then raise exception 'C ne doit voir aucun article'; end if;
end $$;
select pg_temp.expect_error(format('select public.create_expense(%L, pg_temp.draft(%L, array[%L]::uuid[]))',
  current_setting('test.team'), current_setting('test.cm'), current_setting('test.cm')), 'forbidden');
reset role;

-- ── B (ni saisi, ni payé, pas créateur) ne peut ni corriger ni annuler ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.expenses) <> 2 then raise exception 'B doit voir les 2 dépenses'; end if;
end $$;
select pg_temp.expect_error(format('select public.update_expense(%L, pg_temp.draft(%L, array[%L]::uuid[]))',
  current_setting('test.exp'), current_setting('test.bm'), current_setting('test.bm')), 'forbidden');
select pg_temp.expect_error(format('select public.cancel_expense(%L, %L)', current_setting('test.exp'), 'non'), 'forbidden');
select pg_temp.expect_error($q$insert into public.expenses (team_id, entered_by, paid_by, title, spent_on, total_cents, split_mode) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x', now(), 1, 'equal')$q$, 'permission denied for table expenses');
reset role;

-- ── A corrige (version 2, avant/après tracés), annule, ne peut plus supprimer la Team ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select public.update_expense(current_setting('test.exp')::uuid,
  pg_temp.draft(current_setting('test.dana')::uuid,
    array[current_setting('test.am'), current_setting('test.dana')]::uuid[]));
do $$ begin
  if (select version from public.expenses where id = current_setting('test.exp')::uuid) <> 2
  then raise exception 'version 2 attendue'; end if;
  if (select count(*) from public.expense_beneficiaries where expense_id = current_setting('test.exp')::uuid) <> 2
  then raise exception '2 bénéficiaires attendus après correction'; end if;
  if not exists (select 1 from public.audit_logs where action = 'expense.updated'
      and target_id = current_setting('test.exp')::uuid and data ? 'before' and data ? 'after')
  then raise exception 'historique avant/après manquant'; end if;
end $$;
select public.cancel_expense(current_setting('test.exp')::uuid, 'Doublon');
do $$ begin
  if (select status from public.expenses where id = current_setting('test.exp')::uuid) <> 'cancelled'
  then raise exception 'dépense annulée attendue'; end if;
end $$;
select pg_temp.expect_error(format('select public.update_expense(%L, pg_temp.draft(%L, array[%L]::uuid[]))',
  current_setting('test.exp'), current_setting('test.am'), current_setting('test.am')), 'expense_cancelled');
select pg_temp.expect_error(format('select public.delete_team(%L)', current_setting('test.team')), 'team_has_expenses');
reset role;

select 'team_expenses : tous les tests passent' as resultat;
rollback;
