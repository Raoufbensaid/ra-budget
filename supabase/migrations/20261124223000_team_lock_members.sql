-- Pendant la clôture (bilan, remboursements) ou après, la liste des membres
-- est figée : retirer un membre ou quitter la Team fausserait le bilan.

create or replace function public.remove_member(p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.team_members;
begin
  select * into v_row from public.team_members m where m.id = p_member;
  if not found then
    raise exception 'forbidden';
  end if;
  perform public.assert_team_owner_active(v_row.team_id);
  if v_row.role = 'owner' then
    raise exception 'cannot_remove_owner';
  end if;
  update public.team_members set status = 'removed' where id = p_member;
  perform public.log_team_action(v_row.team_id, 'member.removed', p_member, '{}'::jsonb);
end;
$$;

create or replace function public.leave_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.team_members;
begin
  select * into v_row from public.team_members m
   where m.team_id = p_team and m.user_id = (select auth.uid()) and m.status = 'active';
  if not found then
    raise exception 'forbidden';
  end if;
  if v_row.role = 'owner' then
    raise exception 'owner_cannot_leave';
  end if;
  if (select t.status from public.teams t where t.id = p_team) <> 'active' then
    raise exception 'team_locked';
  end if;
  perform public.log_team_action(p_team, 'member.left', v_row.id, '{}'::jsonb);
  update public.team_members set status = 'removed' where id = v_row.id;
end;
$$;
