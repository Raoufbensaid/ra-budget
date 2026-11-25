-- La suppression d'une photo exige d'être encore membre de la Team : une
-- personne retirée ne voit plus les tickets de la Team et pourrait sinon
-- supprimer la photo d'un ticket enregistré.
drop policy "receipts: suppression d'une photo à soi non enregistrée" on storage.objects;

create policy "receipts: suppression d'une photo à soi non enregistrée"
on storage.objects for delete to authenticated
using (
  bucket_id = 'receipts'
  and owner_id = (select auth.uid())::text
  and public.is_team_member(public.receipt_team(name))
  and not exists (select 1 from public.receipts r where r.storage_path = name)
);
