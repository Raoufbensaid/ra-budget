-- Part de Team dans le budget personnel, et pseudo modifiable.
--
-- my_team_shares : pour le compte connecté, sa part de chaque dépense de Team
-- validée (décision de Raouf : « seulement ma part »), entre deux dates.
-- set_display_name : change le pseudo du profil et dans toutes ses Teams.

create function public.my_team_shares(p_from date default null, p_to date default null)
returns table (
  expense_id uuid,
  team_id uuid,
  team_name text,
  team_icon text,
  title text,
  spent_on date,
  category_id text,
  total_cents integer,
  share_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.team_id, t.name, t.icon, e.title, e.spent_on, e.category_id,
         e.total_cents, b.share_cents
    from public.team_members m
    join public.expense_beneficiaries b on b.member_id = m.id
    join public.expenses e on e.id = b.expense_id
    join public.teams t on t.id = e.team_id
   where m.user_id = (select auth.uid())
     and e.status = 'validated'
     and b.share_cents > 0
     and (p_from is null or e.spent_on >= p_from)
     and (p_to is null or e.spent_on <= p_to)
   order by e.spent_on desc, e.created_at desc
   limit 5000;
$$;

create function public.set_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_user is null then
    raise exception 'forbidden';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'invalid_name';
  end if;
  update public.profiles set display_name = v_name where id = v_user;
  update public.team_members set display_name = v_name where user_id = v_user;
end;
$$;

revoke execute on function
  public.my_team_shares(date, date),
  public.set_display_name(text)
from public, anon;

grant execute on function
  public.my_team_shares(date, date),
  public.set_display_name(text)
to authenticated;
