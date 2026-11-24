-- Module Team, étape 3 : validations et contestations des dépenses.
-- Une validation porte sur une version précise de la dépense : après une
-- correction, les anciennes validations restent dans l'historique mais ne
-- comptent plus. La base calcule le statut (même règle que approvalState).

create table public.expense_approvals (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.team_members (id),
  version integer not null check (version >= 1),
  decision text not null check (decision in ('approved', 'refused')),
  acted_by uuid references auth.users (id) on delete set null,
  via text not null check (via in ('app', 'email', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expense_id, member_id, version)
);

create trigger expense_approvals_updated_at
before update on public.expense_approvals
for each row execute function public.set_updated_at();

create table public.expense_disputes (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.team_members (id),
  version integer not null check (version >= 1),
  kind text not null check (kind in ('refuse', 'error', 'correction')),
  reason text not null default '' check (char_length(reason) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolution text check (resolution is null or resolution in ('withdrawn', 'corrected', 'cancelled'))
);

create index expense_disputes_expense on public.expense_disputes (expense_id, status);

-- ─────────────────────────── Aides internes ───────────────────────────

-- Vrai si le membre doit valider la dépense (payeur ou bénéficiaire).
create function public.is_expense_approver(p_expense uuid, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.expenses e where e.id = p_expense and e.paid_by = p_member)
      or exists (select 1 from public.expense_beneficiaries b
                 where b.expense_id = p_expense and b.member_id = p_member);
$$;

-- Recalcule pending / validated / disputed à partir de la version courante.
create function public.refresh_expense_status(p_expense uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.expenses;
  v_required uuid[];
  v_status text;
begin
  select * into v_row from public.expenses e where e.id = p_expense;
  if not found or v_row.status = 'cancelled' then
    return;
  end if;
  select array_agg(distinct x) into v_required from (
    select v_row.paid_by as x
    union select b.member_id from public.expense_beneficiaries b where b.expense_id = p_expense
  ) r;

  if exists (select 1 from public.expense_approvals a
             where a.expense_id = p_expense and a.version = v_row.version
               and a.decision = 'refused' and a.member_id = any (v_required))
     or exists (select 1 from public.expense_disputes d
                where d.expense_id = p_expense and d.status = 'open') then
    v_status := 'disputed';
  elsif (select count(distinct a.member_id) from public.expense_approvals a
         where a.expense_id = p_expense and a.version = v_row.version
           and a.decision = 'approved' and a.member_id = any (v_required))
        = coalesce(array_length(v_required, 1), 0) then
    v_status := 'validated';
  else
    v_status := 'pending';
  end if;

  if v_status <> v_row.status then
    update public.expenses set status = v_status where id = p_expense;
    perform public.log_team_action(v_row.team_id, 'expense.status', p_expense,
      jsonb_build_object('from', v_row.status, 'to', v_status, 'version', v_row.version));
  end if;
end;
$$;

-- Enregistre (ou met à jour) la décision d'un membre sur la version courante.
-- Utilisée par l'application, par le créateur pour un invité, et plus tard
-- par les liens e-mail (via = 'email').
create function public.record_approval(
  p_expense uuid, p_member uuid, p_decision text, p_via text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.expenses;
begin
  select * into v_row from public.expenses e where e.id = p_expense;
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

-- Vérifie qu'on peut agir sur la dépense pour p_member (null = soi-même) et
-- renvoie le membre concerné et le canal (app ou owner).
create function public.resolve_approval_actor(p_expense uuid, p_member uuid, out member_id uuid, out via text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.expenses;
  v_me uuid;
begin
  select * into v_row from public.expenses e where e.id = p_expense;
  if not found or not public.is_team_member(v_row.team_id) then
    raise exception 'forbidden';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'expense_cancelled';
  end if;
  if (select t.status from public.teams t where t.id = v_row.team_id) <> 'active' then
    raise exception 'team_locked';
  end if;
  v_me := public.current_member(v_row.team_id);
  if p_member is null or p_member = v_me then
    member_id := v_me;
    via := 'app';
  else
    -- Le créateur agit seulement pour un invité sans e-mail ; les autres
    -- invités valident eux-mêmes par lien.
    if not public.is_team_owner(v_row.team_id) or not exists (
      select 1 from public.team_members m
      where m.id = p_member and m.team_id = v_row.team_id and m.role = 'guest'
        and m.status = 'active' and m.email is null
    ) then
      raise exception 'forbidden';
    end if;
    member_id := p_member;
    via := 'owner';
  end if;
  if not public.is_expense_approver(p_expense, member_id) then
    raise exception 'not_concerned';
  end if;
end;
$$;

-- ─────────────────────────── Actions ───────────────────────────

create function public.approve_expense(p_expense uuid, p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select * into v_actor from public.resolve_approval_actor(p_expense, p_member);
  perform public.record_approval(p_expense, v_actor.member_id, 'approved', v_actor.via);
end;
$$;

create function public.dispute_expense(
  p_expense uuid, p_kind text, p_reason text, p_member uuid default null
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
  select * into v_row from public.expenses e where e.id = p_expense;
  insert into public.expense_disputes (expense_id, member_id, version, kind, reason)
  values (p_expense, v_actor.member_id, v_row.version, p_kind, v_reason);
  perform public.log_team_action(v_row.team_id, 'expense.disputed', p_expense,
    jsonb_build_object('member_id', v_actor.member_id, 'kind', p_kind, 'reason', v_reason,
                       'via', v_actor.via, 'version', v_row.version));
  perform public.record_approval(p_expense, v_actor.member_id, 'refused', v_actor.via);
end;
$$;

-- Création : la personne qui saisit valide automatiquement sa version.
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
    perform public.record_approval(v_expense, v_member, 'approved', 'app');
  end if;
  return v_expense;
end;
$$;

-- Correction : nouvelle version, contestations résolues, validations remises
-- à zéro (sauf celle de la personne qui corrige).
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
  select * into v_row from public.expenses e where e.id = p_expense;
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
    perform public.record_approval(p_expense, v_member, 'approved', 'app');
  else
    perform public.refresh_expense_status(p_expense);
  end if;
end;
$$;

-- Annulation : les contestations ouvertes sont closes.
create or replace function public.cancel_expense(p_expense uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.expenses;
begin
  select * into v_row from public.expenses e where e.id = p_expense;
  if not found or not public.is_team_member(v_row.team_id) or not public.can_edit_expense(p_expense) then
    raise exception 'forbidden';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'expense_cancelled';
  end if;
  if (select t.status from public.teams t where t.id = v_row.team_id) <> 'active' then
    raise exception 'team_locked';
  end if;
  update public.expense_disputes
     set status = 'resolved', resolved_at = now(), resolved_by = (select auth.uid()),
         resolution = 'cancelled'
   where expense_id = p_expense and status = 'open';
  update public.expenses set status = 'cancelled', cancelled_at = now() where id = p_expense;
  perform public.log_team_action(v_row.team_id, 'expense.cancelled', p_expense,
    jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 500),
                       'before', public.expense_snapshot(p_expense)));
end;
$$;

-- ─────────────────────────── Droits ───────────────────────────

alter table public.expense_approvals enable row level security;
alter table public.expense_disputes enable row level security;

create policy "expense_approvals: lecture par les membres de la Team"
on public.expense_approvals for select to authenticated
using (exists (select 1 from public.expenses e
               where e.id = expense_id and public.is_team_member(e.team_id)));

create policy "expense_disputes: lecture par les membres de la Team"
on public.expense_disputes for select to authenticated
using (exists (select 1 from public.expenses e
               where e.id = expense_id and public.is_team_member(e.team_id)));

revoke all on public.expense_approvals, public.expense_disputes from anon, authenticated;
grant select on public.expense_approvals, public.expense_disputes to authenticated;

revoke execute on function
  public.is_expense_approver(uuid, uuid),
  public.refresh_expense_status(uuid),
  public.record_approval(uuid, uuid, text, text),
  public.resolve_approval_actor(uuid, uuid)
from public, anon, authenticated;

revoke execute on function
  public.approve_expense(uuid, uuid),
  public.dispute_expense(uuid, text, text, uuid)
from public, anon;

grant execute on function
  public.approve_expense(uuid, uuid),
  public.dispute_expense(uuid, text, text, uuid)
to authenticated;

alter publication supabase_realtime add table public.expense_approvals, public.expense_disputes;
