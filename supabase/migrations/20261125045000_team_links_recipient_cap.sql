-- Plafond par adresse, tous expéditeurs et Teams confondus : 40 e-mails par
-- jour. Il protège la personne qui reçoit, en plus des limites par personne et
-- par Team (assez haut pour ne pas gêner un usage normal).

create or replace function public.email_allowed(p_to text, p_kind text, p_team uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sender uuid := (select auth.uid());
  v_since timestamptz := now() - interval '1 day';
begin
  if (select count(*) from public.email_outbox o where o.created_at > v_since) >= 250 then
    return false;
  end if;
  if (select count(*) from public.email_outbox o
      where o.to_email = p_to and o.created_at > v_since) >= 40 then
    return false;
  end if;
  if p_kind = 'team_invitation' then
    if v_sender is not null and (select count(*) from public.email_outbox o
        where o.sender_user = v_sender and o.kind = 'team_invitation'
          and o.created_at > v_since) >= 20 then
      return false;
    end if;
    return (select count(*) from public.email_outbox o
            where o.to_email = p_to and o.kind = 'team_invitation'
              and o.sender_user is not distinct from v_sender and o.created_at > v_since) < 3;
  end if;
  if v_sender is not null and (select count(*) from public.email_outbox o
      where o.sender_user = v_sender and o.kind <> 'team_invitation'
        and o.created_at > v_since) >= 100 then
    return false;
  end if;
  return (select count(*) from public.email_outbox o
          where o.to_email = p_to and o.team_id is not distinct from p_team
            and o.kind <> 'team_invitation' and o.created_at > v_since) < 30;
end;
$$;

