-- Pendant la clôture (bilan, remboursements) ou après, les invités sont figés
-- comme les autres membres. Sinon le créateur pourrait effacer l'e-mail d'un
-- invité pour obtenir le droit de confirmer une réception à sa place.
create or replace function public.update_guest(p_member uuid, p_name text, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  select m.team_id into v_team from public.team_members m
   where m.id = p_member and m.role = 'guest' and m.status <> 'removed';
  if v_team is null or not public.is_team_owner(v_team) then
    raise exception 'forbidden';
  end if;
  if (select t.status from public.teams t where t.id = v_team) <> 'active' then
    raise exception 'team_locked';
  end if;
  update public.team_members
     set display_name = public.clean_team_name(p_name), email = public.clean_email(p_email)
   where id = p_member;
  perform public.log_team_action(v_team, 'member.guest_updated', p_member,
    jsonb_build_object('name', p_name, 'email_set', public.clean_email(p_email) is not null));
end;
$$;
