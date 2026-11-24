-- Module Team, étape 2 : dépenses, bénéficiaires et articles.
-- « Saisi par » (entered_by) et « payé par » (paid_by) sont deux membres
-- distincts. La base recalcule et vérifie les parts : elle fait autorité.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  entered_by uuid not null references public.team_members (id),
  paid_by uuid not null references public.team_members (id),
  title text not null check (char_length(title) between 1 and 80),
  spent_on date not null,
  total_cents integer not null check (total_cents between 1 and 1000000000),
  category_id text check (category_id is null or category_id in (
    'alimentation', 'boissons', 'restauration', 'hygiene_beaute', 'entretien_maison', 'sante',
    'transport', 'logement', 'energie', 'abonnements', 'loisirs', 'habillement', 'enfants',
    'animaux', 'high_tech', 'education', 'cadeaux', 'autre')),
  split_mode text not null check (split_mode in ('equal', 'custom')),
  status text not null default 'pending'
    check (status in ('pending', 'validated', 'disputed', 'cancelled')),
  version integer not null default 1 check (version >= 1),
  receipt_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index expenses_team on public.expenses (team_id, spent_on desc);

create trigger expenses_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

create table public.expense_beneficiaries (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.team_members (id),
  position smallint not null check (position >= 1),
  share_cents integer not null check (share_cents >= 0),
  primary key (expense_id, member_id)
);

create index expense_beneficiaries_member on public.expense_beneficiaries (member_id);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  position smallint not null check (position between 1 and 200),
  label text not null check (char_length(label) between 1 and 120),
  quantity numeric(10, 3) not null default 1 check (quantity > 0),
  unit_price_cents integer,
  total_cents integer not null check (total_cents between -1000000000 and 1000000000),
  category_id text check (category_id is null or category_id in (
    'alimentation', 'boissons', 'restauration', 'hygiene_beaute', 'entretien_maison', 'sante',
    'transport', 'logement', 'energie', 'abonnements', 'loisirs', 'habillement', 'enfants',
    'animaux', 'high_tech', 'education', 'cadeaux', 'autre')),
  unique (expense_id, position)
);

-- ─────────────────────────── Aides internes ───────────────────────────

create function public.is_uuid(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false);
$$;

create function public.is_category(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p in (
    'alimentation', 'boissons', 'restauration', 'hygiene_beaute', 'entretien_maison', 'sante',
    'transport', 'logement', 'energie', 'abonnements', 'loisirs', 'habillement', 'enfants',
    'animaux', 'high_tech', 'education', 'cadeaux', 'autre');
$$;

-- Vrai si p est un membre actif de la Team (inscrit ou invité sans compte).
create function public.is_active_member_of(p_team uuid, p_member text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_uuid(p_member) and exists (
    select 1 from public.team_members m
    where m.id = p_member::uuid and m.team_id = p_team and m.status = 'active'
  );
$$;

-- État lisible d'une dépense, pour l'historique (avant / après).
create function public.expense_snapshot(p_expense uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', e.title, 'spent_on', e.spent_on, 'total_cents', e.total_cents,
    'paid_by', e.paid_by, 'category_id', e.category_id, 'split_mode', e.split_mode,
    'version', e.version, 'status', e.status,
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object('member_id', b.member_id, 'share_cents', b.share_cents)
                       order by b.position)
      from public.expense_beneficiaries b where b.expense_id = e.id), '[]'::jsonb),
    'items', (select count(*) from public.receipt_items i where i.expense_id = e.id)
  )
  from public.expenses e where e.id = p_expense;
$$;

-- Vérifie un brouillon et écrit les champs, les parts et les articles de la
-- dépense p_expense (qui doit déjà exister dans la Team p_team).
create function public.apply_expense_draft(p_team uuid, p_expense uuid, p_draft jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_draft ->> 'title', ''));
  v_date_text text := coalesce(p_draft ->> 'spent_on', '');
  v_date date;
  v_total integer;
  v_category text := nullif(p_draft ->> 'category_id', '');
  v_mode text := p_draft ->> 'split_mode';
  v_payer text := p_draft ->> 'paid_by';
  v_bens jsonb := coalesce(p_draft -> 'beneficiaries', '[]'::jsonb);
  v_items jsonb := coalesce(p_draft -> 'items', '[]'::jsonb);
  v_count integer;
  v_base integer;
  v_rest integer;
  v_sum bigint := 0;
  v_share integer;
  v_ben jsonb;
  v_item jsonb;
  v_i integer := 0;
  v_qty numeric;
begin
  -- Champs de la dépense.
  if char_length(v_title) not between 1 and 80
     or v_date_text !~ '^\d{4}-\d{2}-\d{2}$'
     or jsonb_typeof(p_draft -> 'total_cents') <> 'number'
     or (p_draft ->> 'total_cents') !~ '^\d{1,10}$'
     or (v_category is not null and not public.is_category(v_category))
     or v_mode is null or v_mode not in ('equal', 'custom')
     or jsonb_typeof(v_bens) <> 'array'
     or jsonb_typeof(v_items) <> 'array'
     or jsonb_array_length(v_items) > 200 then
    raise exception 'invalid_expense';
  end if;
  v_total := (p_draft ->> 'total_cents')::bigint;
  if v_total < 1 or v_total > 1000000000 then
    raise exception 'invalid_expense';
  end if;
  begin
    v_date := v_date_text::date;
  exception when others then
    raise exception 'invalid_expense';
  end;
  if v_date < date '2000-01-01' or v_date > current_date + 1 then
    raise exception 'invalid_expense';
  end if;
  if not public.is_active_member_of(p_team, v_payer) then
    raise exception 'invalid_member';
  end if;

  -- Bénéficiaires.
  v_count := jsonb_array_length(v_bens);
  if v_count < 1 or v_count > 100 then
    raise exception 'invalid_shares';
  end if;
  if (select count(distinct b ->> 'member_id') from jsonb_array_elements(v_bens) b) <> v_count then
    raise exception 'invalid_shares';
  end if;

  update public.expenses
     set paid_by = v_payer::uuid, title = v_title, spent_on = v_date, total_cents = v_total,
         category_id = v_category, split_mode = v_mode
   where id = p_expense;
  delete from public.expense_beneficiaries where expense_id = p_expense;
  delete from public.receipt_items where expense_id = p_expense;

  v_base := v_total / v_count;
  v_rest := v_total % v_count;
  for v_ben in select value from jsonb_array_elements(v_bens) loop
    v_i := v_i + 1;
    if not public.is_active_member_of(p_team, v_ben ->> 'member_id') then
      raise exception 'invalid_member';
    end if;
    if v_mode = 'equal' then
      -- Même règle que splitEqual (@ra/team) : centimes restants aux premiers.
      v_share := v_base + case when v_i <= v_rest then 1 else 0 end;
    else
      if jsonb_typeof(v_ben -> 'share_cents') <> 'number'
         or (v_ben ->> 'share_cents') !~ '^\d{1,10}$' then
        raise exception 'invalid_shares';
      end if;
      v_share := (v_ben ->> 'share_cents')::bigint;
    end if;
    v_sum := v_sum + v_share;
    insert into public.expense_beneficiaries (expense_id, member_id, position, share_cents)
    values (p_expense, (v_ben ->> 'member_id')::uuid, v_i, v_share);
  end loop;
  if v_sum <> v_total then
    raise exception 'invalid_shares';
  end if;

  -- Articles (facultatifs).
  v_i := 0;
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_i := v_i + 1;
    if char_length(btrim(coalesce(v_item ->> 'label', ''))) not between 1 and 120
       or (v_item ->> 'total_cents') !~ '^-?\d{1,10}$'
       or ((v_item ->> 'unit_price_cents') is not null
           and (v_item ->> 'unit_price_cents') !~ '^-?\d{1,10}$')
       or ((v_item ->> 'category_id') is not null
           and not public.is_category(v_item ->> 'category_id')) then
      raise exception 'invalid_expense';
    end if;
    begin
      v_qty := coalesce((v_item ->> 'quantity')::numeric, 1);
    exception when others then
      raise exception 'invalid_expense';
    end;
    if v_qty <= 0 or v_qty > 9999999 then
      raise exception 'invalid_expense';
    end if;
    insert into public.receipt_items
      (expense_id, position, label, quantity, unit_price_cents, total_cents, category_id)
    values
      (p_expense, v_i, btrim(v_item ->> 'label'), v_qty, (v_item ->> 'unit_price_cents')::integer,
       (v_item ->> 'total_cents')::integer, v_item ->> 'category_id');
  end loop;
end;
$$;

-- Droit de corriger ou d'annuler : celui qui a saisi, le payeur inscrit, ou le créateur.
create function public.can_edit_expense(p_expense uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense
      and (public.current_member(e.team_id) in (e.entered_by, e.paid_by)
           or public.is_team_owner(e.team_id))
  );
$$;

-- ─────────────────────────── Actions ───────────────────────────

create function public.create_expense(p_team uuid, p_draft jsonb)
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
  -- Ligne provisoire, complétée et vérifiée par apply_expense_draft.
  insert into public.expenses (team_id, entered_by, paid_by, title, spent_on, total_cents, split_mode)
  values (p_team, v_member, (p_draft ->> 'paid_by')::uuid, 'brouillon', current_date, 1, 'equal')
  returning id into v_expense;
  perform public.apply_expense_draft(p_team, v_expense, p_draft);
  perform public.log_team_action(p_team, 'expense.created', v_expense,
    jsonb_build_object('after', public.expense_snapshot(v_expense)));
  return v_expense;
end;
$$;

create function public.update_expense(p_expense uuid, p_draft jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.expenses;
  v_before jsonb;
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
  update public.expenses set version = version + 1, status = 'pending' where id = p_expense;
  perform public.log_team_action(v_row.team_id, 'expense.updated', p_expense,
    jsonb_build_object('before', v_before, 'after', public.expense_snapshot(p_expense)));
end;
$$;

create function public.cancel_expense(p_expense uuid, p_reason text)
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
  update public.expenses set status = 'cancelled', cancelled_at = now() where id = p_expense;
  perform public.log_team_action(v_row.team_id, 'expense.cancelled', p_expense,
    jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 500),
                       'before', public.expense_snapshot(p_expense)));
end;
$$;

-- Une Team qui a des dépenses ne peut plus être supprimée (l'historique doit rester).
create or replace function public.delete_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_team_owner(p_team) then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from public.expenses e where e.team_id = p_team) then
    raise exception 'team_has_expenses';
  end if;
  delete from public.teams where id = p_team;
end;
$$;

-- ─────────────────────────── Droits ───────────────────────────

alter table public.expenses enable row level security;
alter table public.expense_beneficiaries enable row level security;
alter table public.receipt_items enable row level security;

create policy "expenses: lecture par les membres de la Team"
on public.expenses for select to authenticated
using (public.is_team_member(team_id));

create policy "expense_beneficiaries: lecture par les membres de la Team"
on public.expense_beneficiaries for select to authenticated
using (exists (select 1 from public.expenses e
               where e.id = expense_id and public.is_team_member(e.team_id)));

create policy "receipt_items: lecture par les membres de la Team"
on public.receipt_items for select to authenticated
using (exists (select 1 from public.expenses e
               where e.id = expense_id and public.is_team_member(e.team_id)));

revoke all on public.expenses, public.expense_beneficiaries, public.receipt_items
from anon, authenticated;
grant select on public.expenses, public.expense_beneficiaries, public.receipt_items
to authenticated;

revoke execute on function
  public.is_uuid(text),
  public.is_category(text),
  public.is_active_member_of(uuid, text),
  public.expense_snapshot(uuid),
  public.apply_expense_draft(uuid, uuid, jsonb),
  public.can_edit_expense(uuid)
from public, anon, authenticated;

revoke execute on function
  public.create_expense(uuid, jsonb),
  public.update_expense(uuid, jsonb),
  public.cancel_expense(uuid, text)
from public, anon;

grant execute on function
  public.create_expense(uuid, jsonb),
  public.update_expense(uuid, jsonb),
  public.cancel_expense(uuid, text)
to authenticated;

alter publication supabase_realtime add table public.expenses;
