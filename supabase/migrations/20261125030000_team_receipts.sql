-- Module Team, étape 5 : photos des tickets de caisse.
-- Stockage privé « receipts », un dossier par Team (<team_id>/<fichier>) :
-- seuls les membres de la Team lisent et déposent ; personne ne modifie ni
-- ne supprime une photo depuis l'application (justificatif conservé).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Team du dossier d'une photo, ou null si le chemin n'en est pas un.
create function public.receipt_team(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when public.is_uuid(split_part(p_name, '/', 1))
              then split_part(p_name, '/', 1)::uuid end;
$$;

grant execute on function public.receipt_team(text) to authenticated;
grant execute on function public.is_uuid(text) to authenticated;

create policy "receipts: lecture par les membres de la Team"
on storage.objects for select to authenticated
using (bucket_id = 'receipts' and public.is_team_member(public.receipt_team(name)));

create policy "receipts: dépôt par les membres de la Team"
on storage.objects for insert to authenticated
with check (bucket_id = 'receipts' and public.is_team_member(public.receipt_team(name)));

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  uploaded_by uuid not null references public.team_members (id),
  storage_path text not null unique check (char_length(storage_path) <= 300),
  ocr_text text not null default '' check (char_length(ocr_text) <= 20000),
  created_at timestamptz not null default now()
);

create index receipts_team on public.receipts (team_id);

alter table public.expenses
  add constraint expenses_receipt_fk foreign key (receipt_id)
  references public.receipts (id) on delete set null;

create function public.create_receipt(p_team uuid, p_path text, p_ocr_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := public.current_member(p_team);
  v_id uuid;
begin
  if v_member is null then
    raise exception 'forbidden';
  end if;
  if p_path is null
     or public.receipt_team(p_path) is distinct from p_team
     or p_path !~* '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$'
     or not exists (select 1 from storage.objects o
                    where o.bucket_id = 'receipts' and o.name = p_path) then
    raise exception 'invalid_receipt';
  end if;
  insert into public.receipts (team_id, uploaded_by, storage_path, ocr_text)
  values (p_team, v_member, p_path, left(coalesce(p_ocr_text, ''), 20000))
  returning id into v_id;
  perform public.log_team_action(p_team, 'receipt.added', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

-- create_expense : rattache le ticket facultatif du brouillon (même Team).
create or replace function public.create_expense(p_team uuid, p_draft jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := public.current_member(p_team);
  v_expense uuid;
  v_receipt text := nullif(p_draft ->> 'receipt_id', '');
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
  if v_receipt is not null and (
       not public.is_uuid(v_receipt)
       or not exists (select 1 from public.receipts r
                      where r.id = v_receipt::uuid and r.team_id = p_team)) then
    raise exception 'invalid_receipt';
  end if;
  insert into public.expenses
    (team_id, entered_by, paid_by, title, spent_on, total_cents, split_mode, receipt_id)
  values (p_team, v_member, (p_draft ->> 'paid_by')::uuid, 'brouillon', current_date, 1, 'equal',
          v_receipt::uuid)
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

alter table public.receipts enable row level security;

create policy "receipts: lecture des tickets par les membres de la Team"
on public.receipts for select to authenticated
using (public.is_team_member(team_id));

revoke all on public.receipts from anon, authenticated;
grant select on public.receipts to authenticated;

revoke execute on function public.create_receipt(uuid, text, text) from public, anon;
grant execute on function public.create_receipt(uuid, text, text) to authenticated;
