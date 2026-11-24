-- Budget mensuel facultatif, en centimes, affiché dans le tableau de bord.
-- null = pas de budget défini. Plafond à 10 millions d'euros pour écarter les fautes de frappe.
alter table public.profiles
add column monthly_budget_cents integer
check (monthly_budget_cents is null or monthly_budget_cents between 1 and 1000000000);
