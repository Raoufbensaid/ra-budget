-- Module Team, étape 7 : clôture, bilan et remboursements.
--
-- 1. Un membre demande la clôture (aucune dépense en attente ou contestée) :
--    le bilan est figé (dépenses incluses, soldes, virements proposés) et la
--    Team passe « closing » ; on ne peut plus ajouter de dépense.
-- 2. Tous les membres actifs valident le bilan (les invités avec e-mail par
--    lien, le créateur pour ceux sans e-mail). Une contestation rouvre la
--    Team et le bilan est « remplacé ».
-- 3. Bilan validé : la Team passe « settling ». Le débiteur déclare ce qu'il a
--    envoyé ; seul le créancier confirme ce qu'il a reçu, en une ou plusieurs
--    fois. Une déclaration ne confirme jamais rien.
-- 4. Tout est confirmé : la Team est « settled » ; le créateur peut l'archiver.
--
-- Les virements suivent planRepayments (@ra/team) : le plus gros débiteur
-- paie le plus gros créancier, égalités départagées par l'ordre des membres.

-- ─────────────────────────── Tables ───────────────────────────

create table public.team_settlements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  requested_by uuid references public.team_members (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'superseded')),
  -- Copie figée des dépenses incluses : [{id, version, title, total_cents}].
  expenses jsonb not null default '[]'::jsonb,
  total_cents bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz
);

create unique index team_settlements_one_pending on public.team_settlements (team_id)
where status = 'pending';
create index team_settlements_team on public.team_settlements (team_id, created_at desc);

create table public.settlement_balances (
  settlement_id uuid not null references public.team_settlements (id) on delete cascade,
  member_id uuid not null references public.team_members (id),
  position integer not null,
  paid_cents bigint not null,
  share_cents bigint not null,
  balance_cents bigint not null,
  must_approve boolean not null,
  primary key (settlement_id, member_id)
);

create table public.settlement_approvals (
  settlement_id uuid not null references public.team_settlements (id) on delete cascade,
  member_id uuid not null references public.team_members (id),
  decision text not null check (decision in ('approved', 'refused')),
  reason text check (reason is null or char_length(reason) <= 500),
  via text not null check (via in ('app', 'email', 'owner')),
  acted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (settlement_id, member_id)
);

create table public.repayments (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.team_settlements (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  position integer not null,
  from_member uuid not null references public.team_members (id),
  to_member uuid not null references public.team_members (id),
  amount_cents bigint not null check (amount_cents > 0),
  declared_cents bigint not null default 0,
  confirmed_cents bigint not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'declared', 'partial', 'confirmed')),
  created_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  constraint repayments_confirmed_le_amount check (confirmed_cents between 0 and amount_cents)
);

create index repayments_settlement on public.repayments (settlement_id, position);
create index repayments_team on public.repayments (team_id);

create table public.repayment_events (
  id uuid primary key default gen_random_uuid(),
  repayment_id uuid not null references public.repayments (id) on delete cascade,
  kind text not null check (kind in ('declared', 'confirmed')),
  amount_cents bigint not null check (amount_cents > 0),
  member_id uuid not null references public.team_members (id),
  via text not null check (via in ('app', 'email', 'owner')),
  acted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);

create index repayment_events_repayment on public.repayment_events (repayment_id, created_at);

-- Nouveaux types de notifications et d'e-mails.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'approval_requested', 'expense_corrected', 'expense_disputed', 'expense_validated',
  'team_invitation', 'settlement_requested', 'settlement_disputed', 'settlement_validated',
  'repayment_declared', 'repayment_confirmed', 'team_settled'));

alter table public.email_outbox drop constraint email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check check (kind in (
  'team_invitation', 'approve_expense', 'approval_requested', 'approve_settlement',
  'settlement_requested', 'repayment_due', 'confirm_repayment', 'repayment_declared'));

-- ─────────────────────────── Aides internes ───────────────────────────

-- E-mail confirmé du compte d'un membre inscrit (null pour un invité).
create function public.member_account_email(p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from public.team_members m
  join auth.users u on u.id = m.user_id
  where m.id = p_member and u.email_confirmed_at is not null;
$$;

-- Qui agit : soi-même, ou le créateur pour un invité sans e-mail.
create function public.resolve_team_actor(p_team uuid, p_member uuid, out member_id uuid, out via text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member(p_team);
begin
  if v_me is null then
    raise exception 'forbidden';
  end if;
  if p_member is null or p_member = v_me then
    member_id := v_me;
    via := 'app';
    return;
  end if;
  if not public.is_team_owner(p_team) or not exists (
    select 1 from public.team_members m
    where m.id = p_member and m.team_id = p_team and m.role = 'guest'
      and m.status = 'active' and m.email is null
  ) then
    raise exception 'forbidden';
  end if;
  member_id := p_member;
  via := 'owner';
end;
$$;

-- Virements proposés pour un bilan (même méthode que planRepayments).
create function public.plan_settlement(p_settlement uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_ids uuid[];
  v_rem bigint[];
  v_n integer;
  v_c integer;
  v_d integer;
  v_amount bigint;
  v_pos integer := 0;
begin
  select s.team_id into v_team from public.team_settlements s where s.id = p_settlement;
  select array_agg(b.member_id order by b.position), array_agg(b.balance_cents order by b.position)
    into v_ids, v_rem
    from public.settlement_balances b where b.settlement_id = p_settlement;
  v_n := coalesce(array_length(v_ids, 1), 0);
  loop
    v_c := null;
    v_d := null;
    for i in 1 .. v_n loop
      if v_rem[i] > 0 and (v_c is null or v_rem[i] > v_rem[v_c]) then
        v_c := i;
      end if;
      if v_rem[i] < 0 and (v_d is null or v_rem[i] < v_rem[v_d]) then
        v_d := i;
      end if;
    end loop;
    exit when v_c is null or v_d is null;
    v_amount := least(v_rem[v_c], -v_rem[v_d]);
    v_pos := v_pos + 1;
    insert into public.repayments (settlement_id, team_id, position, from_member, to_member, amount_cents)
    values (p_settlement, v_team, v_pos, v_ids[v_d], v_ids[v_c], v_amount);
    v_rem[v_c] := v_rem[v_c] - v_amount;
    v_rem[v_d] := v_rem[v_d] + v_amount;
  end loop;
end;
$$;

-- Bilan validé par tous : remboursements ouverts, ou Team soldée s'il n'y a rien à rembourser.
create function public.finalize_settlement(p_settlement uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  update public.team_settlements set status = 'approved', decided_at = now()
   where id = p_settlement returning team_id into v_team;
  if exists (select 1 from public.repayments r where r.settlement_id = p_settlement) then
    update public.teams set status = 'settling' where id = v_team;
    perform public.log_team_action(v_team, 'settlement.validated', p_settlement, '{}'::jsonb);
  else
    update public.teams set status = 'settled', closed_at = now() where id = v_team;
    perform public.log_team_action(v_team, 'settlement.validated', p_settlement, '{}'::jsonb);
    perform public.log_team_action(v_team, 'team.settled', v_team, '{}'::jsonb);
  end if;
end;
$$;

-- Validation ou contestation du bilan par un membre (app, créateur ou lien).
create function public.record_settlement_decision(
  p_settlement uuid, p_member uuid, p_decision text, p_reason text, p_via text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.team_settlements;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  select * into v_row from public.team_settlements s where s.id = p_settlement for update;
  if not found then
    raise exception 'forbidden';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'settlement_closed';
  end if;
  if not exists (select 1 from public.settlement_balances b
                 where b.settlement_id = p_settlement and b.member_id = p_member and b.must_approve) then
    raise exception 'not_concerned';
  end if;
  if p_decision = 'refused' and v_reason is null then
    raise exception 'reason_required';
  end if;

  insert into public.settlement_approvals (settlement_id, member_id, decision, reason, via, acted_by)
  values (p_settlement, p_member, p_decision, v_reason, p_via, (select auth.uid()))
  on conflict (settlement_id, member_id)
  do update set decision = excluded.decision, reason = excluded.reason, via = excluded.via,
                acted_by = excluded.acted_by, created_at = clock_timestamp();

  if p_decision = 'refused' then
    update public.team_settlements set status = 'superseded', decided_at = now() where id = p_settlement;
    update public.teams set status = 'active' where id = v_row.team_id;
    perform public.log_team_action(v_row.team_id, 'settlement.disputed', p_settlement,
      jsonb_build_object('member_id', p_member, 'reason', v_reason, 'via', p_via));
    return;
  end if;

  perform public.log_team_action(v_row.team_id, 'settlement.approved', p_settlement,
    jsonb_build_object('member_id', p_member, 'via', p_via));
  if not exists (
    select 1 from public.settlement_balances b
    where b.settlement_id = p_settlement and b.must_approve
      and not exists (select 1 from public.settlement_approvals a
                      where a.settlement_id = p_settlement and a.member_id = b.member_id
                        and a.decision = 'approved')
  ) then
    perform public.finalize_settlement(p_settlement);
  end if;
end;
$$;

-- Confirmation de réception par le créancier (app, créateur ou lien).
create function public.record_repayment_confirmation(p_repayment uuid, p_amount bigint, p_via text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.repayments;
  v_remaining bigint;
begin
  select * into v_row from public.repayments r where r.id = p_repayment for update;
  if not found then
    raise exception 'forbidden';
  end if;
  if (select t.status from public.teams t where t.id = v_row.team_id) <> 'settling'
     or (select s.status from public.team_settlements s where s.id = v_row.settlement_id) <> 'approved' then
    raise exception 'repayment_closed';
  end if;
  v_remaining := v_row.amount_cents - v_row.confirmed_cents;
  if p_amount is null or p_amount <= 0 or p_amount > v_remaining then
    raise exception 'invalid_amount';
  end if;

  insert into public.repayment_events (repayment_id, kind, amount_cents, member_id, via, acted_by)
  values (p_repayment, 'confirmed', p_amount, v_row.to_member, p_via, (select auth.uid()));
  update public.repayments
     set confirmed_cents = confirmed_cents + p_amount,
         status = case when confirmed_cents + p_amount = amount_cents then 'confirmed' else 'partial' end,
         confirmed_at = case when confirmed_cents + p_amount = amount_cents then now() end
   where id = p_repayment;
  perform public.log_team_action(v_row.team_id, 'repayment.confirmed', p_repayment,
    jsonb_build_object('amount_cents', p_amount, 'remaining_cents', v_remaining - p_amount,
                       'from_member', v_row.from_member, 'to_member', v_row.to_member, 'via', p_via));

  if not exists (select 1 from public.repayments r
                 where r.settlement_id = v_row.settlement_id and r.confirmed_cents < r.amount_cents) then
    update public.teams set status = 'settled', closed_at = now() where id = v_row.team_id;
    perform public.log_team_action(v_row.team_id, 'team.settled', v_row.team_id, '{}'::jsonb);
  end if;
end;
$$;

-- Lien de validation du bilan pour un invité avec e-mail.
create function public.queue_settlement_link(p_settlement uuid, p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.team_members;
  v_set public.team_settlements;
  v_token text;
begin
  select * into v_m from public.team_members m where m.id = p_member;
  select * into v_set from public.team_settlements s where s.id = p_settlement;
  if v_m.role <> 'guest' or v_m.email is null or v_m.status <> 'active' or v_set.status <> 'pending' then
    return;
  end if;
  perform public.revoke_action_tokens('approve_settlement', p_settlement, p_member);
  if not public.email_allowed(v_m.email, 'approve_settlement', v_m.team_id) then
    return;
  end if;
  v_token := public.issue_action_token('approve_settlement', v_m.team_id, p_member, null,
                                       p_settlement, null, v_m.email);
  perform public.queue_email(v_m.email, 'approve_settlement', v_m.team_id, jsonb_build_object(
    'token', v_token,
    'team_name', (select t.name from public.teams t where t.id = v_m.team_id),
    'name', v_m.display_name,
    'total_cents', v_set.total_cents,
    'balance_cents', (select b.balance_cents from public.settlement_balances b
                      where b.settlement_id = p_settlement and b.member_id = p_member)));
end;
$$;

-- Lien de confirmation de réception pour un invité créancier (reste à recevoir).
create function public.queue_repayment_link(p_repayment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.repayments;
  v_m public.team_members;
  v_token text;
begin
  select * into v_r from public.repayments r where r.id = p_repayment;
  select * into v_m from public.team_members m where m.id = v_r.to_member;
  if v_m.role <> 'guest' or v_m.email is null or v_m.status <> 'active'
     or v_r.confirmed_cents >= v_r.amount_cents then
    return;
  end if;
  perform public.revoke_action_tokens('confirm_repayment', p_repayment, v_m.id);
  if not public.email_allowed(v_m.email, 'confirm_repayment', v_r.team_id) then
    return;
  end if;
  v_token := public.issue_action_token('confirm_repayment', v_r.team_id, v_m.id, null,
                                       p_repayment, null, v_m.email);
  perform public.queue_email(v_m.email, 'confirm_repayment', v_r.team_id, jsonb_build_object(
    'token', v_token,
    'team_name', (select t.name from public.teams t where t.id = v_r.team_id),
    'name', v_m.display_name,
    'from_name', public.member_name(v_r.from_member),
    'amount_cents', v_r.amount_cents,
    'declared_cents', v_r.declared_cents,
    'remaining_cents', v_r.amount_cents - v_r.confirmed_cents));
end;
$$;

-- ─────────────────────────── Actions ───────────────────────────

create function public.request_settlement(p_team uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := public.current_member(p_team);
  v_status text;
  v_settlement uuid;
begin
  if v_member is null then
    raise exception 'forbidden';
  end if;
  select t.status into v_status from public.teams t where t.id = p_team for update;
  if v_status <> 'active' then
    raise exception 'team_locked';
  end if;
  if exists (select 1 from public.expenses e
             where e.team_id = p_team and e.status in ('pending', 'disputed')) then
    raise exception 'expenses_open';
  end if;

  insert into public.team_settlements (team_id, requested_by, expenses, total_cents)
  select p_team, v_member,
         coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'version', e.version, 'title', e.title,
                                               'total_cents', e.total_cents) order by e.spent_on, e.created_at), '[]'::jsonb),
         coalesce(sum(e.total_cents), 0)
    from public.expenses e where e.team_id = p_team and e.status = 'validated'
  returning id into v_settlement;

  insert into public.settlement_balances
    (settlement_id, member_id, position, paid_cents, share_cents, balance_cents, must_approve)
  select v_settlement, x.id, row_number() over (order by x.created_at, x.id),
         x.paid, x.share, x.paid - x.share, x.status = 'active'
    from (
      select m.id, m.created_at, m.status,
             coalesce((select sum(e.total_cents) from public.expenses e
                       where e.team_id = p_team and e.status = 'validated' and e.paid_by = m.id), 0) as paid,
             coalesce((select sum(b.share_cents) from public.expense_beneficiaries b
                       join public.expenses e on e.id = b.expense_id
                       where e.team_id = p_team and e.status = 'validated' and b.member_id = m.id), 0) as share
        from public.team_members m
       where m.team_id = p_team
    ) x
   where x.status = 'active' or x.paid <> 0 or x.share <> 0;

  perform public.plan_settlement(v_settlement);
  update public.teams set status = 'closing' where id = p_team;
  perform public.log_team_action(p_team, 'settlement.requested', v_settlement,
    jsonb_build_object('total_cents', (select s.total_cents from public.team_settlements s
                                       where s.id = v_settlement)));
  perform public.record_settlement_decision(v_settlement, v_member, 'approved', null, 'app');
  return v_settlement;
end;
$$;

create function public.approve_settlement(p_settlement uuid, p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_actor record;
begin
  select s.team_id into v_team from public.team_settlements s where s.id = p_settlement;
  if v_team is null then
    raise exception 'forbidden';
  end if;
  select * into v_actor from public.resolve_team_actor(v_team, p_member);
  perform public.record_settlement_decision(p_settlement, v_actor.member_id, 'approved', null, v_actor.via);
end;
$$;

create function public.dispute_settlement(p_settlement uuid, p_reason text, p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_actor record;
begin
  select s.team_id into v_team from public.team_settlements s where s.id = p_settlement;
  if v_team is null then
    raise exception 'forbidden';
  end if;
  select * into v_actor from public.resolve_team_actor(v_team, p_member);
  perform public.record_settlement_decision(p_settlement, v_actor.member_id, 'refused', p_reason, v_actor.via);
end;
$$;

-- Le débiteur déclare ce qu'il a envoyé (information pour le créancier).
create function public.declare_repayment(p_repayment uuid, p_amount bigint, p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.repayments;
  v_actor record;
begin
  select * into v_row from public.repayments r where r.id = p_repayment for update;
  if not found then
    raise exception 'forbidden';
  end if;
  select * into v_actor from public.resolve_team_actor(v_row.team_id, p_member);
  if v_actor.member_id <> v_row.from_member then
    raise exception 'forbidden';
  end if;
  if (select t.status from public.teams t where t.id = v_row.team_id) <> 'settling'
     or (select s.status from public.team_settlements s where s.id = v_row.settlement_id) <> 'approved' then
    raise exception 'repayment_closed';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_row.amount_cents - v_row.confirmed_cents then
    raise exception 'invalid_amount';
  end if;
  insert into public.repayment_events (repayment_id, kind, amount_cents, member_id, via, acted_by)
  values (p_repayment, 'declared', p_amount, v_row.from_member, v_actor.via, (select auth.uid()));
  update public.repayments
     set declared_cents = declared_cents + p_amount,
         status = case when confirmed_cents = 0 then 'declared' else status end
   where id = p_repayment;
  perform public.log_team_action(v_row.team_id, 'repayment.declared', p_repayment,
    jsonb_build_object('amount_cents', p_amount, 'from_member', v_row.from_member,
                       'to_member', v_row.to_member, 'via', v_actor.via));
end;
$$;

create function public.confirm_repayment(p_repayment uuid, p_amount bigint, p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.repayments;
  v_actor record;
begin
  select * into v_row from public.repayments r where r.id = p_repayment;
  if not found then
    raise exception 'forbidden';
  end if;
  select * into v_actor from public.resolve_team_actor(v_row.team_id, p_member);
  if v_actor.member_id <> v_row.to_member then
    raise exception 'forbidden';
  end if;
  perform public.record_repayment_confirmation(p_repayment, p_amount, v_actor.via);
end;
$$;

create function public.archive_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_team_owner(p_team) then
    raise exception 'forbidden';
  end if;
  if (select t.status from public.teams t where t.id = p_team) <> 'settled' then
    raise exception 'not_settled';
  end if;
  update public.teams set status = 'archived' where id = p_team;
  perform public.log_team_action(p_team, 'team.archived', p_team, '{}'::jsonb);
end;
$$;

-- ─────────────────────────── Messages, notifications, e-mails ───────────────────────────

create function public.audit_logs_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
  v_all uuid[];
  v_data jsonb;
  v_r public.repayments;
  v_m record;
  v_email text;
begin
  if new.action not in ('settlement.requested', 'settlement.disputed', 'settlement.validated',
                        'repayment.declared', 'repayment.confirmed', 'team.settled', 'team.archived') then
    return new;
  end if;
  select t.name into v_team_name from public.teams t where t.id = new.team_id;
  select array_agg(m.id) into v_all from public.team_members m
   where m.team_id = new.team_id and m.status = 'active';
  v_data := coalesce(new.data, '{}'::jsonb)
         || jsonb_build_object('actor_member', new.actor_member, 'target_id', new.target_id,
                               'team_name', v_team_name);
  if new.action like 'repayment.%' then
    select * into v_r from public.repayments r where r.id = new.target_id;
    v_data := v_data || jsonb_build_object('from_name', public.member_name(v_r.from_member),
                                           'to_name', public.member_name(v_r.to_member),
                                           'total_cents', v_r.amount_cents);
  end if;

  insert into public.team_messages (team_id, kind, event, data)
  values (new.team_id, 'system', new.action, v_data);

  if new.action = 'settlement.requested' then
    perform public.notify_members(new.team_id,
      array(select b.member_id from public.settlement_balances b
            where b.settlement_id = new.target_id and b.must_approve),
      'settlement_requested', null, new.actor_user, v_data);
    for v_m in
      select m.*, b.balance_cents from public.settlement_balances b
      join public.team_members m on m.id = b.member_id
      where b.settlement_id = new.target_id and b.must_approve and m.status = 'active'
    loop
      if v_m.role = 'guest' then
        perform public.queue_settlement_link(new.target_id, v_m.id);
      elsif v_m.user_id is distinct from new.actor_user then
        v_email := public.member_account_email(v_m.id);
        if v_email is not null then
          perform public.queue_email(v_email, 'settlement_requested', new.team_id, jsonb_build_object(
            'team_id', new.team_id, 'team_name', v_team_name, 'name', v_m.display_name,
            'total_cents', new.data -> 'total_cents', 'balance_cents', v_m.balance_cents));
        end if;
      end if;
    end loop;

  elsif new.action = 'settlement.disputed' then
    perform public.notify_members(new.team_id, v_all, 'settlement_disputed', null, new.actor_user, v_data);
    perform public.revoke_action_tokens('approve_settlement', new.target_id, null);

  elsif new.action = 'settlement.validated' then
    perform public.notify_members(new.team_id, v_all, 'settlement_validated', null, new.actor_user, v_data);
    for v_r in select * from public.repayments r where r.settlement_id = new.target_id order by r.position loop
      v_email := coalesce(public.member_account_email(v_r.from_member),
                          (select m.email from public.team_members m
                           where m.id = v_r.from_member and m.role = 'guest'));
      if v_email is not null then
        perform public.queue_email(v_email, 'repayment_due', new.team_id, jsonb_build_object(
          'team_id', new.team_id, 'team_name', v_team_name,
          'name', public.member_name(v_r.from_member), 'to_name', public.member_name(v_r.to_member),
          'amount_cents', v_r.amount_cents,
          'guest', (select m.role = 'guest' from public.team_members m where m.id = v_r.from_member)));
      end if;
      perform public.queue_repayment_link(v_r.id);
    end loop;

  elsif new.action = 'repayment.declared' then
    perform public.notify_members(new.team_id, array[v_r.to_member], 'repayment_declared', null,
                                  new.actor_user, v_data);
    v_email := public.member_account_email(v_r.to_member);
    if v_email is not null then
      perform public.queue_email(v_email, 'repayment_declared', new.team_id, jsonb_build_object(
        'team_id', new.team_id, 'team_name', v_team_name,
        'from_name', public.member_name(v_r.from_member), 'amount_cents', new.data -> 'amount_cents'));
    else
      perform public.queue_repayment_link(v_r.id);
    end if;

  elsif new.action = 'repayment.confirmed' then
    perform public.notify_members(new.team_id, array[v_r.from_member], 'repayment_confirmed', null,
                                  new.actor_user, v_data);
    perform public.queue_repayment_link(v_r.id);

  elsif new.action = 'team.settled' then
    perform public.notify_members(new.team_id, v_all, 'team_settled', null, new.actor_user, v_data);
  end if;
  return new;
end;
$$;

create trigger audit_logs_settlement
after insert on public.audit_logs
for each row execute function public.audit_logs_settlement();

-- ─────────────────────────── Liens e-mail : bilan et réception ───────────────────────────

create or replace function public.action_token_state(p_token public.action_tokens)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses;
  v_member public.team_members;
  v_inv public.team_invitations;
  v_set public.team_settlements;
  v_r public.repayments;
begin
  if p_token.used_at is not null then
    return 'used';
  end if;
  if p_token.revoked_at is not null then
    return 'revoked';
  end if;
  select * into v_member from public.team_members m where m.id = p_token.member_id;

  if p_token.kind = 'approve_expense' then
    select * into v_expense from public.expenses e where e.id = p_token.target_id;
    if v_expense.id is null or v_member.id is null or v_expense.status = 'cancelled'
       or v_member.status <> 'active' or v_member.email is distinct from p_token.email
       or (select t.status from public.teams t where t.id = p_token.team_id) <> 'active'
       or not public.is_expense_approver(v_expense.id, v_member.id) then
      return 'closed';
    end if;
    if p_token.expires_at <= now() then
      return 'expired';
    end if;
    if v_expense.version <> p_token.target_version then
      return 'stale';
    end if;
    return 'open';

  elsif p_token.kind = 'accept_invitation' then
    select * into v_inv from public.team_invitations i where i.id = p_token.invitation_id;
    if v_inv.id is null or v_inv.accepted_at is not null or v_inv.declined_at is not null
       or v_inv.cancelled_at is not null then
      return 'closed';
    end if;

  elsif p_token.kind = 'approve_settlement' then
    select * into v_set from public.team_settlements s where s.id = p_token.target_id;
    if v_set.id is null or v_member.id is null or v_set.status <> 'pending'
       or v_member.status <> 'active' or v_member.email is distinct from p_token.email
       or not exists (select 1 from public.settlement_balances b
                      where b.settlement_id = v_set.id and b.member_id = v_member.id and b.must_approve)
       or exists (select 1 from public.settlement_approvals a
                  where a.settlement_id = v_set.id and a.member_id = v_member.id) then
      return 'closed';
    end if;

  elsif p_token.kind = 'confirm_repayment' then
    select * into v_r from public.repayments r where r.id = p_token.target_id;
    if v_r.id is null or v_member.id is null or v_r.to_member <> v_member.id
       or v_member.status <> 'active' or v_member.email is distinct from p_token.email
       or v_r.confirmed_cents >= v_r.amount_cents
       or (select t.status from public.teams t where t.id = v_r.team_id) <> 'settling' then
      return 'closed';
    end if;

  else
    return 'closed';
  end if;

  if p_token.expires_at <= now() then
    return 'expired';
  end if;
  return 'open';
end;
$$;

create or replace function public.token_view(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tok public.action_tokens;
  v_state text;
  v_expense public.expenses;
  v_set public.team_settlements;
  v_r public.repayments;
  v_base jsonb;
begin
  select * into v_tok from public.action_tokens t where t.token_hash = public.hash_token(p_token);
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  v_state := public.action_token_state(v_tok);
  if v_state in ('revoked', 'closed') then
    return jsonb_build_object('state', v_state, 'kind', v_tok.kind);
  end if;
  v_base := jsonb_build_object('state', v_state, 'kind', v_tok.kind,
    'team_name', (select t.name from public.teams t where t.id = v_tok.team_id));

  if v_tok.kind = 'accept_invitation' then
    return v_base || jsonb_build_object(
      'email', public.mask_email(v_tok.email),
      'inviter', (select m.display_name from public.team_invitations i
                  join public.team_members m on m.team_id = i.team_id and m.user_id = i.invited_by
                  where i.id = v_tok.invitation_id));
  end if;

  v_base := v_base || jsonb_build_object('member_name', public.member_name(v_tok.member_id));
  if v_state <> 'open' then
    return v_base;
  end if;

  if v_tok.kind = 'approve_settlement' then
    select * into v_set from public.team_settlements s where s.id = v_tok.target_id;
    return v_base || jsonb_build_object('settlement', jsonb_build_object(
      'total_cents', v_set.total_cents,
      'expense_count', jsonb_array_length(v_set.expenses),
      'my_balance_cents', (select b.balance_cents from public.settlement_balances b
                           where b.settlement_id = v_set.id and b.member_id = v_tok.member_id),
      'balances', coalesce((select jsonb_agg(jsonb_build_object(
                    'name', m.display_name, 'paid_cents', b.paid_cents, 'share_cents', b.share_cents,
                    'balance_cents', b.balance_cents, 'is_me', b.member_id = v_tok.member_id)
                    order by b.position)
                  from public.settlement_balances b join public.team_members m on m.id = b.member_id
                  where b.settlement_id = v_set.id), '[]'::jsonb),
      'transfers', coalesce((select jsonb_agg(jsonb_build_object(
                    'from', public.member_name(r.from_member), 'to', public.member_name(r.to_member),
                    'amount_cents', r.amount_cents,
                    'involves_me', v_tok.member_id in (r.from_member, r.to_member))
                    order by r.position)
                  from public.repayments r where r.settlement_id = v_set.id), '[]'::jsonb)));
  end if;

  if v_tok.kind = 'confirm_repayment' then
    select * into v_r from public.repayments r where r.id = v_tok.target_id;
    return v_base || jsonb_build_object('repayment', jsonb_build_object(
      'from_name', public.member_name(v_r.from_member),
      'amount_cents', v_r.amount_cents,
      'declared_cents', v_r.declared_cents,
      'confirmed_cents', v_r.confirmed_cents,
      'remaining_cents', v_r.amount_cents - v_r.confirmed_cents));
  end if;

  select * into v_expense from public.expenses e where e.id = v_tok.target_id;
  return v_base || jsonb_build_object('expense', jsonb_build_object(
    'title', v_expense.title,
    'spent_on', v_expense.spent_on,
    'total_cents', v_expense.total_cents,
    'category_id', v_expense.category_id,
    'split_mode', v_expense.split_mode,
    'status', v_expense.status,
    'payer', public.member_name(v_expense.paid_by),
    'i_paid', v_expense.paid_by = v_tok.member_id,
    'entered_by', public.member_name(v_expense.entered_by),
    'my_share_cents', coalesce((select b.share_cents from public.expense_beneficiaries b
                                where b.expense_id = v_expense.id and b.member_id = v_tok.member_id), 0),
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object(
                                  'name', m.display_name, 'share_cents', b.share_cents,
                                  'is_me', b.member_id = v_tok.member_id) order by b.position)
                               from public.expense_beneficiaries b
                               join public.team_members m on m.id = b.member_id
                               where b.expense_id = v_expense.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                          'label', i.label, 'quantity', i.quantity, 'total_cents', i.total_cents)
                          order by i.position)
                       from public.receipt_items i where i.expense_id = v_expense.id), '[]'::jsonb)));
end;
$$;

drop function public.token_act(text, text, text, text);

-- Action par lien : valider ou contester (dépense, bilan), confirmer une
-- réception (montant). Le lien est ensuite inutilisable.
create function public.token_act(
  p_token text, p_action text, p_kind text default null, p_reason text default null,
  p_amount bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tok public.action_tokens;
  v_state text;
begin
  if p_action is null or p_action not in ('approve', 'dispute', 'confirm') then
    raise exception 'invalid_action';
  end if;
  select * into v_tok from public.action_tokens t
   where t.token_hash = public.hash_token(p_token) for update;
  if not found or v_tok.kind = 'accept_invitation' then
    raise exception 'link_invalid';
  end if;
  v_state := public.action_token_state(v_tok);
  if v_state <> 'open' then
    raise exception 'link_%', v_state;
  end if;
  if (v_tok.kind = 'confirm_repayment') <> (p_action = 'confirm') then
    raise exception 'invalid_action';
  end if;

  perform set_config('ra.link_member', v_tok.member_id::text, true);
  if v_tok.kind = 'approve_expense' then
    if p_action = 'approve' then
      perform public.record_approval(v_tok.target_id, v_tok.target_version, v_tok.member_id,
                                     'approved', 'email');
    else
      perform public.record_dispute(v_tok.target_id, v_tok.target_version, v_tok.member_id,
                                    p_kind, p_reason, 'email');
    end if;
  elsif v_tok.kind = 'approve_settlement' then
    perform public.record_settlement_decision(v_tok.target_id, v_tok.member_id,
      case when p_action = 'approve' then 'approved' else 'refused' end, p_reason, 'email');
  else
    perform public.record_repayment_confirmation(v_tok.target_id, p_amount, 'email');
  end if;
  perform set_config('ra.link_member', '', true);

  update public.action_tokens set used_at = now() where id = v_tok.id;
  return jsonb_build_object('state', 'done');
end;
$$;

create or replace function public.token_resend(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tok public.action_tokens;
  v_state text;
  v_new text;
  v_expense public.expenses;
begin
  select * into v_tok from public.action_tokens t
   where t.token_hash = public.hash_token(p_token) for update;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  v_state := public.action_token_state(v_tok);
  if v_state in ('expired', 'revoked') and exists (
       select 1 from public.action_tokens t
        where t.kind = v_tok.kind and t.created_at > now() - interval '1 hour'
          and t.member_id is not distinct from v_tok.member_id
          and t.target_id is not distinct from v_tok.target_id
          and t.invitation_id is not distinct from v_tok.invitation_id) then
    return jsonb_build_object('state', 'too_soon');
  end if;
  if v_state <> 'expired' then
    return jsonb_build_object('state', 'not_expired');
  end if;
  if not public.email_allowed(v_tok.email,
       case when v_tok.kind = 'accept_invitation' then 'team_invitation' else v_tok.kind end,
       v_tok.team_id) then
    return jsonb_build_object('state', 'too_soon');
  end if;

  update public.action_tokens set revoked_at = now() where id = v_tok.id;
  if v_tok.kind = 'approve_settlement' then
    perform public.queue_settlement_link(v_tok.target_id, v_tok.member_id);
  elsif v_tok.kind = 'confirm_repayment' then
    perform public.queue_repayment_link(v_tok.target_id);
  elsif v_tok.kind = 'approve_expense' then
    select * into v_expense from public.expenses e where e.id = v_tok.target_id;
    v_new := public.issue_action_token('approve_expense', v_tok.team_id, v_tok.member_id, null,
                                       v_expense.id, v_expense.version, v_tok.email);
    perform public.queue_email(v_tok.email, 'approve_expense', v_tok.team_id, jsonb_build_object(
      'token', v_new, 'team_id', v_tok.team_id,
      'team_name', (select t.name from public.teams t where t.id = v_tok.team_id),
      'expense_id', v_expense.id, 'title', v_expense.title, 'total_cents', v_expense.total_cents,
      'share_cents', coalesce((select b.share_cents from public.expense_beneficiaries b
                               where b.expense_id = v_expense.id and b.member_id = v_tok.member_id), 0),
      'payer', public.member_name(v_expense.paid_by), 'name', public.member_name(v_tok.member_id),
      'corrected', false));
  else
    v_new := public.issue_action_token('accept_invitation', v_tok.team_id, null, v_tok.invitation_id,
                                       null, null, v_tok.email);
    perform public.queue_email(v_tok.email, 'team_invitation', v_tok.team_id, jsonb_build_object(
      'token', v_new,
      'team_name', (select t.name from public.teams t where t.id = v_tok.team_id),
      'inviter', (select m.display_name from public.team_invitations i
                  join public.team_members m on m.team_id = i.team_id and m.user_id = i.invited_by
                  where i.id = v_tok.invitation_id)));
  end if;
  return jsonb_build_object('state', 'sent');
end;
$$;

-- ─────────────────────────── Droits ───────────────────────────

alter table public.team_settlements enable row level security;
alter table public.settlement_balances enable row level security;
alter table public.settlement_approvals enable row level security;
alter table public.repayments enable row level security;
alter table public.repayment_events enable row level security;

create policy "team_settlements: lecture par les membres de la Team"
on public.team_settlements for select to authenticated
using (public.is_team_member(team_id));

create policy "settlement_balances: lecture par les membres de la Team"
on public.settlement_balances for select to authenticated
using (exists (select 1 from public.team_settlements s
               where s.id = settlement_id and public.is_team_member(s.team_id)));

create policy "settlement_approvals: lecture par les membres de la Team"
on public.settlement_approvals for select to authenticated
using (exists (select 1 from public.team_settlements s
               where s.id = settlement_id and public.is_team_member(s.team_id)));

create policy "repayments: lecture par les membres de la Team"
on public.repayments for select to authenticated
using (public.is_team_member(team_id));

create policy "repayment_events: lecture par les membres de la Team"
on public.repayment_events for select to authenticated
using (exists (select 1 from public.repayments r
               where r.id = repayment_id and public.is_team_member(r.team_id)));

revoke all on public.team_settlements, public.settlement_balances, public.settlement_approvals,
  public.repayments, public.repayment_events from anon, authenticated;
grant select on public.team_settlements, public.settlement_balances, public.settlement_approvals,
  public.repayments, public.repayment_events to authenticated;

revoke execute on function
  public.member_account_email(uuid),
  public.resolve_team_actor(uuid, uuid),
  public.plan_settlement(uuid),
  public.finalize_settlement(uuid),
  public.record_settlement_decision(uuid, uuid, text, text, text),
  public.record_repayment_confirmation(uuid, bigint, text),
  public.queue_settlement_link(uuid, uuid),
  public.queue_repayment_link(uuid),
  public.audit_logs_settlement()
from public, anon, authenticated;

revoke execute on function
  public.request_settlement(uuid),
  public.approve_settlement(uuid, uuid),
  public.dispute_settlement(uuid, text, uuid),
  public.declare_repayment(uuid, bigint, uuid),
  public.confirm_repayment(uuid, bigint, uuid),
  public.archive_team(uuid)
from public, anon;

grant execute on function
  public.request_settlement(uuid),
  public.approve_settlement(uuid, uuid),
  public.dispute_settlement(uuid, text, uuid),
  public.declare_repayment(uuid, bigint, uuid),
  public.confirm_repayment(uuid, bigint, uuid),
  public.archive_team(uuid)
to authenticated;

revoke execute on function public.token_act(text, text, text, text, bigint) from public;
grant execute on function public.token_act(text, text, text, text, bigint) to anon, authenticated;

alter publication supabase_realtime add table public.team_settlements, public.settlement_approvals,
  public.repayments;
