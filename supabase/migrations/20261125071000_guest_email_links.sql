-- Quand le créateur ajoute ou change l'e-mail d'un invité, l'invité reçoit le
-- lien de chaque dépense qui attend encore sa validation (avant, seules les
-- dépenses créées ou corrigées après le changement envoyaient un lien).

create function public.queue_guest_pending_links(p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.team_members;
  v_e record;
  v_token text;
begin
  select * into v_m from public.team_members m where m.id = p_member;
  if v_m.role <> 'guest' or v_m.email is null or v_m.status <> 'active' then
    return;
  end if;
  for v_e in
    select e.*, coalesce(b.share_cents, 0) as share_cents
      from public.expenses e
      left join public.expense_beneficiaries b on b.expense_id = e.id and b.member_id = p_member
     where e.team_id = v_m.team_id and e.status in ('pending', 'disputed')
       and (e.paid_by = p_member or b.member_id is not null)
       and not exists (select 1 from public.expense_approvals a
                       where a.expense_id = e.id and a.member_id = p_member
                         and a.version = e.version and a.decision = 'approved')
  loop
    perform public.revoke_action_tokens('approve_expense', v_e.id, p_member);
    if not public.email_allowed(v_m.email, 'approve_expense', v_m.team_id) then
      return;
    end if;
    v_token := public.issue_action_token('approve_expense', v_m.team_id, p_member, null,
                                         v_e.id, v_e.version, v_m.email);
    perform public.queue_email(v_m.email, 'approve_expense', v_m.team_id, jsonb_build_object(
      'token', v_token, 'team_id', v_m.team_id,
      'team_name', (select t.name from public.teams t where t.id = v_m.team_id),
      'expense_id', v_e.id, 'title', v_e.title, 'total_cents', v_e.total_cents,
      'share_cents', v_e.share_cents, 'payer', public.member_name(v_e.paid_by),
      'name', v_m.display_name, 'corrected', false));
  end loop;
end;
$$;

create or replace function public.update_guest(p_member uuid, p_name text, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_old text;
  v_new text := public.clean_email(p_email);
begin
  select m.team_id, m.email into v_team, v_old from public.team_members m
   where m.id = p_member and m.role = 'guest' and m.status <> 'removed';
  if v_team is null or not public.is_team_owner(v_team) then
    raise exception 'forbidden';
  end if;
  if (select t.status from public.teams t where t.id = v_team) <> 'active' then
    raise exception 'team_locked';
  end if;
  update public.team_members
     set display_name = public.clean_team_name(p_name), email = v_new
   where id = p_member;
  perform public.log_team_action(v_team, 'member.guest_updated', p_member,
    jsonb_build_object('name', p_name, 'email_set', v_new is not null));
  if v_new is not null and v_new is distinct from v_old then
    perform public.queue_guest_pending_links(p_member);
  end if;
end;
$$;

revoke execute on function public.queue_guest_pending_links(uuid) from public, anon, authenticated;
