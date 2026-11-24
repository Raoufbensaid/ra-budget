-- Un article modifié doit rester rattaché à un achat de son propriétaire :
-- sans ce contrôle, on pourrait déplacer son article (purchase_id) vers l'achat
-- d'un autre utilisateur. Même règle que pour l'ajout.
drop policy "purchase_items: modification de ses articles" on public.purchase_items;

create policy "purchase_items: modification de ses articles"
on public.purchase_items for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.purchases p
    where p.id = purchase_id and p.user_id = (select auth.uid())
  )
);
