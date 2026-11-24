-- Module Team, étape 1 : Teams, membres et historique.
-- Les clients ne lisent ces tables qu'à travers la RLS et n'y écrivent jamais
-- directement : toute modification passe par les fonctions ci-dessous, qui
-- vérifient les droits et laissent une trace dans audit_logs.

-- ───────────────────────────── Tables ─────────────────────────────

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  icon text not null default '👥' check (char_length(icon) between 1 and 8),
  created_by uuid not null references auth.users (id),
  status text not null default 'active'
    check (status in ('active', 'closing', 'settling', 'settled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create trigger teams_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  email text check (email is null or char_length(email) <= 254),
  role text not null check (role in ('owner', 'member', 'guest')),
  status text not null default 'active' check (status in ('invited', 'active', 'removed')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  -- Un invité n'a pas de compte ; un membre inscrit en a un.
  constraint team_members_guest_has_no_account check ((role = 'guest') = (user_id is null))
);

create unique index team_members_one_per_account
on public.team_members (team_id, user_id) where user_id is not null;
create index team_members_user on public.team_members (user_id);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  actor_user uuid,
  actor_member uuid,
  action text not null,
  target_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_team on public.audit_logs (team_id, created_at);

-- ───────────────────────────── Aides ─────────────────────────────

create function public.is_team_member(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create function public.is_team_owner(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = 'owner'
  );
$$;

create function public.is_team_invitee(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team and m.user_id = (select auth.uid()) and m.status = 'invited'
  );
$$;

-- Membre actif de l'utilisateur connecté dans une Team (null sinon).
create function public.current_member(p_team uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.team_members m
  where m.team_id = p_team and m.user_id = (select auth.uid()) and m.status = 'active';
$$;

create function public.log_team_action(
  p_team uuid, p_action text, p_target uuid, p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (team_id, actor_user, actor_member, action, target_id, data)
  values (p_team, (select auth.uid()), public.current_member(p_team), p_action, p_target, p_data);
$$;

create function public.clean_team_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_name, ''));
begin
  if char_length(v) < 1 or char_length(v) > 60 then
    raise exception 'invalid_name';
  end if;
  return v;
end;
$$;

create function public.clean_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_email, '')));
begin
  if v = '' then
    return null;
  end if;
  if char_length(v) > 254 or v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;
  return v;
end;
$$;

create function public.assert_team_owner_active(p_team uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_team_owner(p_team) then
    raise exception 'forbidden';
  end if;
  if (select t.status from public.teams t where t.id = p_team) <> 'active' then
    raise exception 'team_locked';
  end if;
end;
$$;

-- ───────────────────────────── Actions ─────────────────────────────

create function public.create_team(p_name text, p_icon text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_team uuid;
  v_member uuid;
  v_display text;
begin
  if v_user is null then
    raise exception 'forbidden';
  end if;
  select coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1), 'Moi')
    into v_display
    from auth.users u left join public.profiles p on p.id = u.id
    where u.id = v_user;

  insert into public.teams (name, icon, created_by)
  values (public.clean_team_name(p_name), coalesce(nullif(btrim(p_icon), ''), '👥'), v_user)
  returning id into v_team;

  insert into public.team_members (team_id, user_id, display_name, email, role, status, joined_at)
  select v_team, v_user, left(coalesce(v_display, 'Moi'), 60), u.email, 'owner', 'active', now()
    from auth.users u where u.id = v_user
  returning id into v_member;

  perform public.log_team_action(v_team, 'team.created', v_team, jsonb_build_object('name', p_name));
  return v_team;
end;
$$;

create function public.update_team(p_team uuid, p_name text, p_icon text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_team_owner_active(p_team);
  update public.teams
     set name = public.clean_team_name(p_name),
         icon = coalesce(nullif(btrim(p_icon), ''), icon)
   where id = p_team;
  perform public.log_team_action(p_team, 'team.updated', p_team,
    jsonb_build_object('name', p_name, 'icon', p_icon));
end;
$$;

create function public.add_guest(p_team uuid, p_name text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  perform public.assert_team_owner_active(p_team);
  insert into public.team_members (team_id, display_name, email, role, status, invited_by, joined_at)
  values (p_team, public.clean_team_name(p_name), public.clean_email(p_email), 'guest', 'active',
          (select auth.uid()), now())
  returning id into v_member;
  perform public.log_team_action(p_team, 'member.guest_added', v_member,
    jsonb_build_object('name', p_name));
  return v_member;
end;
$$;

create function public.update_guest(p_member uuid, p_name text, p_email text)
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
  update public.team_members
     set display_name = public.clean_team_name(p_name), email = public.clean_email(p_email)
   where id = p_member;
  perform public.log_team_action(v_team, 'member.guest_updated', p_member,
    jsonb_build_object('name', p_name, 'email_set', public.clean_email(p_email) is not null));
end;
$$;

create function public.invite_member(p_team uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_user uuid;
  v_display text;
  v_existing public.team_members;
  v_member uuid;
begin
  perform public.assert_team_owner_active(p_team);
  v_email := public.clean_email(p_email);
  if v_email is null then
    raise exception 'invalid_email';
  end if;
  select u.id, coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1))
    into v_user, v_display
    from auth.users u left join public.profiles p on p.id = u.id
   where lower(u.email) = v_email;
  if v_user is null then
    raise exception 'no_account';
  end if;

  select * into v_existing from public.team_members m
   where m.team_id = p_team and m.user_id = v_user;
  if found and v_existing.status <> 'removed' then
    raise exception 'already_member';
  end if;

  if found then
    update public.team_members
       set status = 'invited', role = 'member', invited_by = (select auth.uid()), joined_at = null
     where id = v_existing.id
    returning id into v_member;
  else
    insert into public.team_members (team_id, user_id, display_name, email, role, status, invited_by)
    values (p_team, v_user, left(v_display, 60), v_email, 'member', 'invited', (select auth.uid()))
    returning id into v_member;
  end if;

  perform public.log_team_action(p_team, 'member.invited', v_member, '{}'::jsonb);
  return v_member;
end;
$$;

create function public.respond_invitation(p_member uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  select m.team_id into v_team from public.team_members m
   where m.id = p_member and m.user_id = (select auth.uid()) and m.status = 'invited';
  if v_team is null then
    raise exception 'forbidden';
  end if;
  update public.team_members
     set status = case when p_accept then 'active' else 'removed' end,
         joined_at = case when p_accept then now() else null end
   where id = p_member;
  insert into public.audit_logs (team_id, actor_user, actor_member, action, target_id)
  values (v_team, (select auth.uid()), p_member,
          case when p_accept then 'member.joined' else 'member.declined' end, p_member);
end;
$$;

create function public.remove_member(p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.team_members;
begin
  select * into v_row from public.team_members m where m.id = p_member;
  if not found or not public.is_team_owner(v_row.team_id) then
    raise exception 'forbidden';
  end if;
  if v_row.role = 'owner' then
    raise exception 'cannot_remove_owner';
  end if;
  update public.team_members set status = 'removed' where id = p_member;
  perform public.log_team_action(v_row.team_id, 'member.removed', p_member, '{}'::jsonb);
end;
$$;

create function public.leave_team(p_team uuid)
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
  perform public.log_team_action(p_team, 'member.left', v_row.id, '{}'::jsonb);
  update public.team_members set status = 'removed' where id = v_row.id;
end;
$$;

-- Supprime une Team qui n'a encore aucune dépense (l'étape 2 ajoutera ce contrôle).
create function public.delete_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_team_owner(p_team) then
    raise exception 'forbidden';
  end if;
  delete from public.teams where id = p_team;
end;
$$;

-- ───────────────────────────── Droits ─────────────────────────────

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.audit_logs enable row level security;

create policy "teams: lecture par les membres et les invités"
on public.teams for select to authenticated
using (public.is_team_member(id) or public.is_team_invitee(id));

create policy "team_members: lecture par les membres de la Team"
on public.team_members for select to authenticated
using (public.is_team_member(team_id) or user_id = (select auth.uid()));

create policy "audit_logs: lecture par les membres de la Team"
on public.audit_logs for select to authenticated
using (public.is_team_member(team_id));

-- Aucune écriture directe : uniquement par les fonctions ci-dessus.
revoke all on public.teams, public.team_members, public.audit_logs from anon, authenticated;
grant select on public.teams, public.team_members, public.audit_logs to authenticated;

-- Fonctions internes : appelables par la base seulement.
revoke execute on function
  public.current_member(uuid),
  public.log_team_action(uuid, text, uuid, jsonb),
  public.clean_team_name(text),
  public.clean_email(text),
  public.assert_team_owner_active(uuid)
from public, anon, authenticated;

-- Aides utilisées par la RLS et actions : comptes connectés seulement.
revoke execute on function
  public.is_team_member(uuid),
  public.is_team_owner(uuid),
  public.is_team_invitee(uuid),
  public.create_team(text, text),
  public.update_team(uuid, text, text),
  public.add_guest(uuid, text, text),
  public.update_guest(uuid, text, text),
  public.invite_member(uuid, text),
  public.respond_invitation(uuid, boolean),
  public.remove_member(uuid),
  public.leave_team(uuid),
  public.delete_team(uuid)
from public, anon;

grant execute on function
  public.is_team_member(uuid),
  public.is_team_owner(uuid),
  public.is_team_invitee(uuid),
  public.create_team(text, text),
  public.update_team(uuid, text, text),
  public.add_guest(uuid, text, text),
  public.update_guest(uuid, text, text),
  public.invite_member(uuid, text),
  public.respond_invitation(uuid, boolean),
  public.remove_member(uuid),
  public.leave_team(uuid),
  public.delete_team(uuid)
to authenticated;

-- Mises à jour en temps réel des Teams et des membres.
alter publication supabase_realtime add table public.teams, public.team_members;
