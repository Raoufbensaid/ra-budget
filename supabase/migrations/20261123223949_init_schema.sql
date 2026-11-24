-- Ra Budget : schéma initial.
-- Règle d'or : chaque ligne appartient à un utilisateur (user_id) et la sécurité
-- au niveau des lignes (RLS) garantit qu'il ne voit et ne modifie QUE ses données.
-- Montants en centimes entiers, jamais de flottants.

-- ───────────────────────────── Utilitaires ─────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────────── Profils ─────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  currency text not null default 'EUR' check (currency = 'EUR'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Un profil est créé automatiquement à l'inscription.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "profiles: lecture de son profil"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "profiles: modification de son profil"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- ───────────────────────────── Achats ─────────────────────────────

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null
    check (source in ('receipt_ocr', 'photo_items', 'barcode', 'voice', 'text', 'manual', 'pdf')),
  merchant text check (char_length(merchant) between 1 and 200),
  purchased_on date not null,
  currency text not null default 'EUR' check (currency = 'EUR'),
  total_paid_cents integer check (total_paid_cents >= 0),
  -- Problèmes signalés à la saisie (catégorie inconnue, écart de total…).
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchases_user_date_idx on public.purchases (user_id, purchased_on desc, created_at desc);

create trigger purchases_updated_at
before update on public.purchases
for each row execute function public.set_updated_at();

alter table public.purchases enable row level security;

create policy "purchases: lecture de ses achats"
on public.purchases for select to authenticated
using ((select auth.uid()) = user_id);

create policy "purchases: ajout de ses achats"
on public.purchases for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "purchases: modification de ses achats"
on public.purchases for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "purchases: suppression de ses achats"
on public.purchases for delete to authenticated
using ((select auth.uid()) = user_id);

-- ───────────────────────────── Articles ─────────────────────────────

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position smallint not null check (position >= 0),
  raw_label text not null check (char_length(raw_label) between 1 and 300),
  name text check (char_length(name) between 1 and 300),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text not null check (unit in ('piece', 'kg', 'g', 'l', 'cl', 'ml')),
  unit_price_cents integer check (unit_price_cents >= 0),
  total_price_cents integer check (total_price_cents >= 0),
  price_source text not null check (price_source in ('receipt', 'declared', 'estimated', 'barcode_db')),
  category_id text check (category_id in (
    'alimentation', 'boissons', 'restauration', 'hygiene_beaute', 'entretien_maison', 'sante',
    'transport', 'logement', 'energie', 'abonnements', 'loisirs', 'habillement', 'enfants',
    'animaux', 'high_tech', 'education', 'cadeaux', 'autre'
  )),
  confidence real not null check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (purchase_id, position)
);

create index purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index purchase_items_user_category_idx on public.purchase_items (user_id, category_id);

alter table public.purchase_items enable row level security;

create policy "purchase_items: lecture de ses articles"
on public.purchase_items for select to authenticated
using ((select auth.uid()) = user_id);

-- On ne peut ajouter un article qu'à SON achat.
create policy "purchase_items: ajout à ses achats"
on public.purchase_items for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.purchases p
    where p.id = purchase_id and p.user_id = (select auth.uid())
  )
);

create policy "purchase_items: modification de ses articles"
on public.purchase_items for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "purchase_items: suppression de ses articles"
on public.purchase_items for delete to authenticated
using ((select auth.uid()) = user_id);

-- ───────────────────────────── Enregistrement d'un brouillon ─────────────────────────────

-- Enregistre un brouillon d'achat (format PurchaseDraft de @ra/core) et ses articles
-- en une seule transaction. SECURITY INVOKER : les règles RLS s'appliquent.
create or replace function public.create_purchase(draft jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
  item_count integer := jsonb_array_length(coalesce(draft -> 'items', '[]'::jsonb));
begin
  if (select auth.uid()) is null then
    raise exception 'Non connecté' using errcode = '42501';
  end if;
  if item_count < 1 or item_count > 200 then
    raise exception 'Un achat doit contenir entre 1 et 200 articles' using errcode = '22023';
  end if;

  insert into public.purchases (source, merchant, purchased_on, currency, total_paid_cents, issues)
  values (
    draft ->> 'source',
    nullif(draft ->> 'merchant', ''),
    coalesce((draft ->> 'date')::date, current_date),
    coalesce(draft ->> 'currency', 'EUR'),
    (draft ->> 'totalPaidCents')::integer,
    coalesce(draft -> 'issues', '[]'::jsonb)
  )
  returning id into new_id;

  insert into public.purchase_items (
    purchase_id, position, raw_label, name, quantity, unit, unit_price_cents,
    total_price_cents, price_source, category_id, confidence
  )
  select
    new_id,
    (item.ordinality - 1)::smallint,
    item.value ->> 'rawLabel',
    item.value ->> 'name',
    (item.value ->> 'quantity')::numeric,
    item.value ->> 'unit',
    (item.value ->> 'unitPriceCents')::integer,
    (item.value ->> 'totalPriceCents')::integer,
    item.value ->> 'priceSource',
    item.value ->> 'categoryId',
    (item.value ->> 'confidence')::real
  from jsonb_array_elements(draft -> 'items') with ordinality as item (value, ordinality);

  return new_id;
end;
$$;

revoke execute on function public.create_purchase(jsonb) from public, anon;
grant execute on function public.create_purchase(jsonb) to authenticated;
