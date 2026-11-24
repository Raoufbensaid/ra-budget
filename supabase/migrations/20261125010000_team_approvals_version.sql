-- Une validation ou une contestation porte sur la version que la personne a
-- vue : si la dépense a été corrigée entre-temps, l'action est refusée
-- (stale_version) au lieu de s'appliquer à une version jamais lue.
-- La ligne de la dépense est verrouillée pendant l'enregistrement.

drop function public.approve_expense(uuid, uuid);
drop function public.dispute_expense(uuid, text, text, uuid);
drop function public.record_approval(uuid, uuid, text, text);

create function public.record_approval(
  p_expense uuid, p_version integer, p_member uuid, p_decision text, p_via text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.expenses;
begin
  select * into v_row from public.expenses e where e.id = p_expense for update;
  if not found then
    raise exception 'forbidden';
  end if;
  if p_version is null or v_row.version <> p_version then
    raise exception 'stale_version';
  end if;
  insert into public.expense_approvals (expense_id, member_id, version, decision, acted_by, via)
  values (p_expense, p_member, v_row.version, p_decision, (select auth.uid()), p_via)
  on conflict (expense_id, member_id, version)
  do update set decision = excluded.decision, acted_by = excluded.acted_by, via = excluded.via;

  if p_decision = 'approved' then
    update public.expense_disputes
       set status = 'resolved', resolved_at = now(), resolved_by = (select auth.uid()),
           resolution = 'withdrawn'
     where expense_id = p_expense and member_id = p_member and status = 'open';
  end if;

  perform public.log_team_action(v_row.team_id,
    case when p_decision = 'approved' then 'expense.approved' else 'expense.refused' end,
    p_expense,
    jsonb_build_object('member_id', p_member, 'via', p_via, 'version', v_row.version));
  perform public.refresh_expense_status(p_expense);
end;
$$;

create function public.approve_expense(p_expense uuid, p_version integer, p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select * into v_actor from public.resolve_approval_actor(p_expense, p_member);
  perform public.record_approval(p_expense, p_version, v_actor.member_id, 'approved', v_actor.via);
end;
$$;

create function public.dispute_expense(
  p_expense uuid, p_version integer, p_kind text, p_reason text, p_member uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_row public.expenses;
begin
  if p_kind is null or p_kind not in ('refuse', 'error', 'correction') then
    raise exception 'invalid_kind';
  end if;
  if p_kind in ('error', 'correction') and v_reason = '' then
    raise exception 'reason_required';
  end if;
  select * into v_actor from public.resolve_approval_actor(p_expense, p_member);
  select * into v_row from public.expenses e where e.id = p_expense for update;
  if p_version is null or v_row.version <> p_version then
    raise exception 'stale_version';
  end if;
  insert into public.expense_disputes (expense_id, member_id, version, kind, reason)
  values (p_expense, v_actor.member_id, v_row.version, p_kind, v_reason);
  perform public.log_team_action(v_row.team_id, 'expense.disputed', p_expense,
    jsonb_build_object('member_id', v_actor.member_id, 'kind', p_kind, 'reason', v_reason,
                       'via', v_actor.via, 'version', v_row.version));
  perform public.record_approval(p_expense, p_version, v_actor.member_id, 'refused', v_actor.via);
end;
$$;

-- create_expense et update_expense valident pour la personne qui saisit, sur
-- la version qu'elle vient d'enregistrer.
create or replace function public.create_expense(p_team uuid, p_draft jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := public.current_member(p_team);
  v_expense uuid;
begin
  if v_member is null then
    raise exception 'forbidden';
  end if;
  if (select t.status from public.teams t where t.id = p_team) <> 'active' then
    raise exception 'team_locked';
  end if;
  if not public.is_active_member_of(p_team, p_draft ->> 'paid_by') then
    raise exception 'invalid_member';
  end if;
  insert into public.expenses (team_id, entered_by, paid_by, title, spent_on, total_cents, split_mode)
  values (p_team, v_member, (p_draft ->> 'paid_by')::uuid, 'brouillon', current_date, 1, 'equal')
  returning id into v_expense;
  perform public.apply_expense_draft(p_team, v_expense, p_draft);
  perform public.log_team_action(p_team, 'expense.created', v_expense,
    jsonb_build_object('after', public.expense_snapshot(v_expense)));
  if public.is_expense_approver(v_expense, v_member) then
    perform public.record_approval(v_expense, 1, v_member, 'approved', 'app');
  end if;
  return v_expense;
end;
$$;

create or replace function public.update_expense(p_expense uuid, p_draft jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.expenses;
  v_before jsonb;
  v_member uuid;
begin
  select * into v_row from public.expenses e where e.id = p_expense for update;
  if not found or not public.is_team_member(v_row.team_id) or not public.can_edit_expense(p_expense) then
    raise exception 'forbidden';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'expense_cancelled';
  end if;
  if (select t.status from public.teams t where t.id = v_row.team_id) <> 'active' then
    raise exception 'team_locked';
  end if;
  v_before := public.expense_snapshot(p_expense);
  perform public.apply_expense_draft(v_row.team_id, p_expense, p_draft);
  update public.expense_disputes
     set status = 'resolved', resolved_at = now(), resolved_by = (select auth.uid()),
         resolution = 'corrected'
   where expense_id = p_expense and status = 'open';
  update public.expenses set version = version + 1, status = 'pending' where id = p_expense;
  perform public.log_team_action(v_row.team_id, 'expense.updated', p_expense,
    jsonb_build_object('before', v_before, 'after', public.expense_snapshot(p_expense)));
  v_member := public.current_member(v_row.team_id);
  if public.is_expense_approver(p_expense, v_member) then
    perform public.record_approval(p_expense, v_row.version + 1, v_member, 'approved', 'app');
  else
    perform public.refresh_expense_status(p_expense);
  end if;
end;
$$;

revoke execute on function public.record_approval(uuid, integer, uuid, text, text)
from public, anon, authenticated;

revoke execute on function
  public.approve_expense(uuid, integer, uuid),
  public.dispute_expense(uuid, integer, text, text, uuid)
from public, anon;

grant execute on function
  public.approve_expense(uuid, integer, uuid),
  public.dispute_expense(uuid, integer, text, text, uuid)
to authenticated;
