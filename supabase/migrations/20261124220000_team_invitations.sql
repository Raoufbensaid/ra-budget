-- Invitations par e-mail, sans révéler qui possède un compte.
-- Avant : invite_member cherchait le compte et répondait « no_account », ce qui
-- permettait de tester des adresses, et copiait le nom de la personne dans la
-- Team avant qu'elle accepte. Désormais, toute invitation est une adresse
-- e-mail en attente ; la personne n'entre dans la Team (avec son nom) que
-- lorsqu'elle accepte, connectée avec cette adresse confirmée.

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  invited_by uuid references auth.users (id) on delete set null,
  member_id uuid references public.team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz
);

create unique index team_invitations_one_pending
on public.team_invitations (team_id, email)
where accepted_at is null and declined_at is null and cancelled_at is null;
create index team_invitations_email on public.team_invitations (email);

-- E-mail confirmé du compte connecté (null s'il n'est pas confirmé).
create function public.my_confirmed_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
$$;

create or replace function public.is_team_invitee(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_invitations i
    where i.team_id = p_team and i.email = public.my_confirmed_email()
      and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null
  );
$$;

drop function public.invite_member(uuid, text);

-- Invite une adresse e-mail. Répond de la même façon qu'un compte existe ou non.
create function public.invite_member(p_team uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_invitation uuid;
begin
  perform public.assert_team_owner_active(p_team);
  v_email := public.clean_email(p_email);
  if v_email is null then
    raise exception 'invalid_email';
  end if;

  if exists (
    select 1 from public.team_members m join auth.users u on u.id = m.user_id
    where m.team_id = p_team and m.status = 'active' and lower(u.email) = v_email
  ) then
    raise exception 'already_member';
  end if;

  select i.id into v_invitation from public.team_invitations i
   where i.team_id = p_team and i.email = v_email
     and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;
  if v_invitation is not null then
    return v_invitation;
  end if;

  if (select count(*) from public.team_invitations i
      where i.team_id = p_team
        and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null) >= 50 then
    raise exception 'too_many_invitations';
  end if;

  insert into public.team_invitations (team_id, email, invited_by)
  values (p_team, v_email, (select auth.uid()))
  returning id into v_invitation;

  perform public.log_team_action(p_team, 'invitation.sent', v_invitation,
    jsonb_build_object('email', v_email));
  return v_invitation;
end;
$$;

create function public.cancel_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  select i.team_id into v_team from public.team_invitations i
   where i.id = p_invitation
     and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;
  if v_team is null or not public.is_team_owner(v_team) then
    raise exception 'forbidden';
  end if;
  update public.team_invitations set cancelled_at = now() where id = p_invitation;
  perform public.log_team_action(v_team, 'invitation.cancelled', p_invitation, '{}'::jsonb);
end;
$$;

drop function public.respond_invitation(uuid, boolean);

-- Accepte ou refuse une invitation adressée à l'e-mail confirmé du compte.
-- Renvoie l'identifiant du membre en cas d'acceptation, null sinon.
create function public.respond_invitation(p_invitation uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_inv public.team_invitations;
  v_member uuid;
  v_display text;
begin
  select * into v_inv from public.team_invitations i
   where i.id = p_invitation and i.email = public.my_confirmed_email()
     and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;
  if not found then
    raise exception 'forbidden';
  end if;

  if not p_accept then
    update public.team_invitations set declined_at = now() where id = p_invitation;
    insert into public.audit_logs (team_id, actor_user, action, target_id)
    values (v_inv.team_id, v_user, 'invitation.declined', p_invitation);
    return null;
  end if;

  if (select t.status from public.teams t where t.id = v_inv.team_id) <> 'active' then
    raise exception 'team_locked';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1))
    into v_display
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = v_user;

  select m.id into v_member from public.team_members m
   where m.team_id = v_inv.team_id and m.user_id = v_user;
  if v_member is not null then
    update public.team_members
       set status = 'active', role = case when role = 'owner' then 'owner' else 'member' end,
           joined_at = now()
     where id = v_member;
  else
    insert into public.team_members
      (team_id, user_id, display_name, email, role, status, invited_by, joined_at)
    values
      (v_inv.team_id, v_user, left(v_display, 60), v_inv.email, 'member', 'active',
       v_inv.invited_by, now())
    returning id into v_member;
  end if;

  update public.team_invitations set accepted_at = now(), member_id = v_member
   where id = p_invitation;
  insert into public.audit_logs (team_id, actor_user, actor_member, action, target_id)
  values (v_inv.team_id, v_user, v_member, 'member.joined', v_member);
  return v_member;
end;
$$;

alter table public.team_invitations enable row level security;

create policy "team_invitations: lecture par la Team et par la personne invitée"
on public.team_invitations for select to authenticated
using (public.is_team_member(team_id) or email = public.my_confirmed_email());

revoke all on public.team_invitations from anon, authenticated;
grant select on public.team_invitations to authenticated;

revoke execute on function
  public.my_confirmed_email(),
  public.invite_member(uuid, text),
  public.cancel_invitation(uuid),
  public.respond_invitation(uuid, boolean)
from public, anon;

grant execute on function
  public.my_confirmed_email(),
  public.invite_member(uuid, text),
  public.cancel_invitation(uuid),
  public.respond_invitation(uuid, boolean)
to authenticated;

alter publication supabase_realtime add table public.team_invitations;
