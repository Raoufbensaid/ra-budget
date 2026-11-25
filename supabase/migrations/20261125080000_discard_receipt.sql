-- Si l'enregistrement d'une dépense échoue après l'envoi de la photo du
-- ticket, l'application retire le ticket et sa photo au lieu de les laisser
-- dans le stockage.
--
-- - discard_receipt : la personne qui a ajouté un ticket peut le retirer tant
--   qu'aucune dépense n'y est rattachée ; renvoie le chemin de la photo.
-- - Stockage : chacun peut supprimer une photo qu'il a déposée, si elle n'est
--   pas (ou plus) enregistrée comme ticket.

create function public.discard_receipt(p_receipt uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.receipts;
begin
  select * into v_row from public.receipts r where r.id = p_receipt for update;
  if not found or v_row.uploaded_by is distinct from public.current_member(v_row.team_id) then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from public.expenses e where e.receipt_id = p_receipt) then
    raise exception 'receipt_in_use';
  end if;
  delete from public.receipts where id = p_receipt;
  perform public.log_team_action(v_row.team_id, 'receipt.discarded', p_receipt, '{}'::jsonb);
  return v_row.storage_path;
end;
$$;

revoke execute on function public.discard_receipt(uuid) from public, anon;
grant execute on function public.discard_receipt(uuid) to authenticated;

create policy "receipts: suppression d'une photo à soi non enregistrée"
on storage.objects for delete to authenticated
using (
  bucket_id = 'receipts'
  and owner_id = (select auth.uid())::text
  and not exists (select 1 from public.receipts r where r.storage_path = name)
);
