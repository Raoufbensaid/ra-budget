-- Garde-fou : qui peut appeler quelles fonctions SECURITY DEFINER du schéma public.
-- - Sans compte (anon) : seulement les pages des liens e-mail.
-- - Connecté (authenticated) : les actions des membres et les aides des règles
--   d'accès ; jamais les fonctions internes (déclencheurs, envoi, calculs).
-- Toute nouvelle fonction ouverte fait échouer ce test : il faut l'ajouter ici
-- en connaissance de cause.
-- Lancer : pnpm exec supabase db query --remote --yes -f supabase/tests/security.sql
begin;

do $$
declare
  v_anon text;
  v_auth text;
  v_anon_expected text := 'token_act,token_resend,token_view';
  v_auth_expected text := string_agg(x, ',' order by x) from unnest(array[
    'add_guest', 'approve_expense', 'approve_settlement', 'archive_team', 'cancel_expense',
    'cancel_invitation', 'confirm_repayment', 'create_expense', 'create_receipt', 'create_team',
    'declare_repayment', 'delete_team', 'dispute_expense', 'dispute_settlement', 'invite_member',
    'is_team_active', 'is_team_invitee', 'is_team_member', 'is_team_owner', 'leave_team',
    'mark_notifications_read', 'my_confirmed_email', 'my_team_shares',
    'remove_member', 'request_settlement', 'respond_invitation', 'send_message',
    'set_display_name', 'token_act', 'token_resend', 'token_view', 'update_expense',
    'update_guest', 'update_team']) as x;
begin
  select string_agg(distinct p.proname, ',' order by p.proname) into v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute');
  select string_agg(distinct p.proname, ',' order by p.proname) into v_auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v_anon is distinct from v_anon_expected then
    raise exception 'anon peut appeler : % (attendu : %)', v_anon, v_anon_expected;
  end if;
  if v_auth is distinct from v_auth_expected then
    raise exception 'authenticated peut appeler : % (attendu : %)', v_auth, v_auth_expected;
  end if;
end $$;

-- Toutes les tables du schéma public ont la RLS activée.
do $$
declare
  v text;
begin
  select string_agg(c.relname, ',') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v is not null then
    raise exception 'tables sans RLS : %', v;
  end if;
end $$;

-- Le bucket des tickets reste privé.
do $$ begin
  if (select public from storage.buckets where id = 'receipts') then
    raise exception 'le bucket receipts doit rester privé';
  end if;
end $$;

select 'security : tous les tests passent' as resultat;
rollback;
