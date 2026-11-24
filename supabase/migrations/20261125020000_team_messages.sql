-- Module Team, étape 4 : discussion et notifications dans l'application.
-- Un déclencheur sur audit_logs crée les messages automatiques de la
-- discussion et les notifications : toute action passe déjà par l'historique.

create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  author_member uuid references public.team_members (id),
  kind text not null check (kind in ('text', 'system')),
  body text not null default '' check (char_length(body) <= 2000),
  event text,
  expense_id uuid references public.expenses (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint team_messages_text_has_author check (kind = 'system' or author_member is not null)
);

create index team_messages_team on public.team_messages (team_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  kind text not null check (kind in (
    'approval_requested', 'expense_corrected', 'expense_disputed', 'expense_validated',
    'team_invitation')),
  expense_id uuid references public.expenses (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user on public.notifications (user_id, created_at desc);

-- Notifie les comptes inscrits (membres actifs) donnés, sauf l'auteur de l'action.
create function public.notify_members(
  p_team uuid, p_members uuid[], p_kind text, p_expense uuid, p_actor uuid, p_data jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, team_id, kind, expense_id, data)
  select distinct m.user_id, p_team, p_kind, p_expense, p_data
  from public.team_members m
  where m.id = any (p_members) and m.user_id is not null and m.status = 'active'
    and m.user_id is distinct from p_actor;
$$;

create function public.audit_logs_fanout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses;
  v_approvers uuid[];
  v_data jsonb := coalesce(new.data, '{}'::jsonb) || jsonb_build_object('actor_member', new.actor_member);
  v_is_expense boolean := new.action like 'expense.%';
begin
  if v_is_expense then
    select * into v_expense from public.expenses e where e.id = new.target_id;
    if found then
      select array_agg(distinct x) into v_approvers from (
        select v_expense.paid_by as x
        union select b.member_id from public.expense_beneficiaries b where b.expense_id = v_expense.id
      ) r;
      v_data := v_data || jsonb_build_object('title', v_expense.title,
                                             'total_cents', v_expense.total_cents);
    end if;
  end if;

  -- Messages automatiques de la discussion.
  if new.action in ('expense.created', 'expense.updated', 'expense.cancelled', 'expense.disputed',
                    'member.joined', 'member.guest_added', 'member.left', 'member.removed')
     or (new.action = 'expense.status' and new.data ->> 'to' = 'validated') then
    insert into public.team_messages (team_id, kind, event, expense_id, data)
    values (new.team_id, 'system', new.action,
            case when v_is_expense then new.target_id end,
            v_data || jsonb_build_object('target_id', new.target_id));
  end if;

  -- Notifications dans l'application.
  if new.action = 'expense.created' and v_expense.id is not null then
    perform public.notify_members(new.team_id, v_approvers, 'approval_requested',
                                  v_expense.id, new.actor_user, v_data);
  elsif new.action = 'expense.updated' and v_expense.id is not null then
    perform public.notify_members(new.team_id, v_approvers, 'expense_corrected',
                                  v_expense.id, new.actor_user, v_data);
  elsif new.action = 'expense.disputed' and v_expense.id is not null then
    perform public.notify_members(new.team_id, array[v_expense.entered_by, v_expense.paid_by],
                                  'expense_disputed', v_expense.id, new.actor_user, v_data);
  elsif new.action = 'expense.status' and new.data ->> 'to' = 'validated' and v_expense.id is not null then
    perform public.notify_members(new.team_id, array[v_expense.paid_by], 'expense_validated',
                                  v_expense.id, new.actor_user, v_data);
  elsif new.action = 'invitation.sent' then
    -- Le compte qui a confirmé cette adresse est notifié ; la personne qui
    -- invite ne voit rien de plus (aucune information sur les comptes).
    insert into public.notifications (user_id, team_id, kind, data)
    select u.id, new.team_id, 'team_invitation',
           jsonb_build_object('invitation_id', new.target_id,
                              'team_name', (select t.name from public.teams t where t.id = new.team_id))
    from auth.users u
    where lower(u.email) = new.data ->> 'email' and u.email_confirmed_at is not null
      and u.id is distinct from new.actor_user;
  end if;
  return new;
end;
$$;

create trigger audit_logs_fanout
after insert on public.audit_logs
for each row execute function public.audit_logs_fanout();

-- ─────────────────────────── Actions ───────────────────────────

create function public.send_message(p_team uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := public.current_member(p_team);
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_member is null then
    raise exception 'forbidden';
  end if;
  if (select t.status from public.teams t where t.id = p_team) = 'archived' then
    raise exception 'team_locked';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'invalid_message';
  end if;
  insert into public.team_messages (team_id, author_member, kind, body)
  values (p_team, v_member, 'text', v_body)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.mark_notifications_read(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null
    and (p_ids is null or id = any (p_ids));
$$;

-- ─────────────────────────── Droits ───────────────────────────

alter table public.team_messages enable row level security;
alter table public.notifications enable row level security;

create policy "team_messages: lecture par les membres de la Team"
on public.team_messages for select to authenticated
using (public.is_team_member(team_id));

create policy "notifications: lecture de ses notifications"
on public.notifications for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.team_messages, public.notifications from anon, authenticated;
grant select on public.team_messages, public.notifications to authenticated;

revoke execute on function
  public.notify_members(uuid, uuid[], text, uuid, uuid, jsonb),
  public.audit_logs_fanout()
from public, anon, authenticated;

revoke execute on function
  public.send_message(uuid, text),
  public.mark_notifications_read(uuid[])
from public, anon;

grant execute on function
  public.send_message(uuid, text),
  public.mark_notifications_read(uuid[])
to authenticated;

alter publication supabase_realtime add table public.team_messages, public.notifications;
