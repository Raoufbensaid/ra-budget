-- Plus de nouveau ticket (photo ou enregistrement) dans une Team qui n'est
-- plus active (bilan en cours, remboursements, soldée, archivée).

create function public.is_team_active(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.teams t where t.id = p_team and t.status = 'active');
$$;

grant execute on function public.is_team_active(uuid) to authenticated;
revoke execute on function public.is_team_active(uuid) from public, anon;

drop policy "receipts: dépôt par les membres de la Team" on storage.objects;

create policy "receipts: dépôt par les membres d'une Team active"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'receipts'
  and public.is_team_member(public.receipt_team(name))
  and public.is_team_active(public.receipt_team(name))
);

create or replace function public.create_receipt(p_team uuid, p_path text, p_ocr_text text)
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
  if not public.is_team_active(p_team) then
    raise exception 'team_locked';
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
