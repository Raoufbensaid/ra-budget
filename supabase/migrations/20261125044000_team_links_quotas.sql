-- Limites d'envoi par personne et par Team (remplacent celles de 20261125043000).
--
-- Une personne ne doit pas pouvoir épuiser le quota d'une adresse pour les
-- autres : les limites par adresse sont comptées par personne qui invite
-- (invitations) ou par Team (validations). Un lien n'est créé que si son
-- e-mail peut partir.
-- - invitations : 20 par jour par personne, 3 par jour vers une même adresse
--   depuis une même personne ;
-- - validations : 100 par jour par personne qui agit, 30 par jour vers une
--   même adresse pour une même Team ;
-- - 250 e-mails par jour au total (offre gratuite Brevo : 300).

create function public.email_allowed(p_to text, p_kind text, p_team uuid)
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

create or replace function public.queue_email(p_to text, p_kind text, p_team uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.email_allowed(p_to, p_kind, p_team) then
    return;
  end if;
  insert into public.email_outbox (to_email, kind, team_id, payload, sender_user)
  values (p_to, p_kind, p_team, p_payload, (select auth.uid()));
end;
$$;

create or replace function public.queue_expense_emails(p_expense uuid, p_actor uuid, p_corrected boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.expenses;
  v_team_name text;
  v_member record;
  v_token text;
  v_email text;
  v_payload jsonb;
begin
  select * into v_row from public.expenses e where e.id = p_expense;
  if not found or v_row.status = 'cancelled' then
    return;
  end if;
  select t.name into v_team_name from public.teams t where t.id = v_row.team_id;

  for v_member in
    select m.*, coalesce(b.share_cents, 0) as share_cents
    from public.team_members m
    left join public.expense_beneficiaries b on b.expense_id = p_expense and b.member_id = m.id
    where m.team_id = v_row.team_id and m.status = 'active'
      and (m.id = v_row.paid_by or b.member_id is not null)
  loop
    if exists (select 1 from public.expense_approvals a
               where a.expense_id = p_expense and a.member_id = v_member.id
                 and a.version = v_row.version and a.decision = 'approved') then
      continue;
    end if;
    v_payload := jsonb_build_object(
      'team_id', v_row.team_id, 'team_name', v_team_name, 'expense_id', p_expense,
      'title', v_row.title, 'total_cents', v_row.total_cents, 'share_cents', v_member.share_cents,
      'payer', public.member_name(v_row.paid_by), 'name', v_member.display_name,
      'corrected', p_corrected);

    if v_member.role = 'guest' then
      perform public.revoke_action_tokens('approve_expense', p_expense, v_member.id);
      if v_member.email is null
         or not public.email_allowed(v_member.email, 'approve_expense', v_row.team_id) then
        continue;
      end if;
      v_token := public.issue_action_token('approve_expense', v_row.team_id, v_member.id, null,
                                           p_expense, v_row.version, v_member.email);
      perform public.queue_email(v_member.email, 'approve_expense', v_row.team_id,
                                 v_payload || jsonb_build_object('token', v_token));
    elsif v_member.user_id is distinct from p_actor then
      select lower(u.email) into v_email from auth.users u
       where u.id = v_member.user_id and u.email_confirmed_at is not null;
      if v_email is not null then
        perform public.queue_email(v_email, 'approval_requested', v_row.team_id, v_payload);
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.audit_logs_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_email text;
begin
  if new.action = 'expense.created' then
    perform public.queue_expense_emails(new.target_id, new.actor_user, false);
  elsif new.action = 'expense.updated' then
    perform public.queue_expense_emails(new.target_id, new.actor_user, true);
  elsif new.action = 'expense.cancelled' then
    perform public.revoke_action_tokens('approve_expense', new.target_id, null);
  elsif new.action in ('member.removed', 'member.left') then
    update public.action_tokens set revoked_at = now()
     where member_id = new.target_id and used_at is null and revoked_at is null;
  elsif new.action = 'invitation.sent' then
    v_email := new.data ->> 'email';
    if not public.email_allowed(v_email, 'team_invitation', new.team_id) then
      return new;
    end if;
    v_token := public.issue_action_token('accept_invitation', new.team_id, null, new.target_id,
                                         null, null, v_email);
    perform public.queue_email(v_email, 'team_invitation', new.team_id, jsonb_build_object(
      'token', v_token,
      'team_name', (select t.name from public.teams t where t.id = new.team_id),
      'inviter', public.member_name(new.actor_member)));
  elsif new.action = 'invitation.cancelled' then
    perform public.revoke_action_tokens('accept_invitation', new.target_id, null);
  end if;
  return new;
end;
$$;

create or replace function public.token_resend(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tok public.action_tokens;
  v_state text;
  v_new text;
  v_expense public.expenses;
begin
  select * into v_tok from public.action_tokens t
   where t.token_hash = public.hash_token(p_token) for update;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  v_state := public.action_token_state(v_tok);
  if v_state in ('expired', 'revoked') and exists (
       select 1 from public.action_tokens t
        where t.kind = v_tok.kind and t.created_at > now() - interval '1 hour'
          and t.member_id is not distinct from v_tok.member_id
          and t.target_id is not distinct from v_tok.target_id
          and t.invitation_id is not distinct from v_tok.invitation_id) then
    return jsonb_build_object('state', 'too_soon');
  end if;
  if v_state <> 'expired' then
    return jsonb_build_object('state', 'not_expired');
  end if;
  if not public.email_allowed(v_tok.email,
       case when v_tok.kind = 'accept_invitation' then 'team_invitation' else 'approve_expense' end, v_tok.team_id) then
    return jsonb_build_object('state', 'too_soon');
  end if;

  update public.action_tokens set revoked_at = now() where id = v_tok.id;
  if v_tok.kind = 'approve_expense' then
    select * into v_expense from public.expenses e where e.id = v_tok.target_id;
    v_new := public.issue_action_token('approve_expense', v_tok.team_id, v_tok.member_id, null,
                                       v_expense.id, v_expense.version, v_tok.email);
    perform public.queue_email(v_tok.email, 'approve_expense', v_tok.team_id, jsonb_build_object(
      'token', v_new, 'team_id', v_tok.team_id,
      'team_name', (select t.name from public.teams t where t.id = v_tok.team_id),
      'expense_id', v_expense.id, 'title', v_expense.title, 'total_cents', v_expense.total_cents,
      'share_cents', coalesce((select b.share_cents from public.expense_beneficiaries b
                               where b.expense_id = v_expense.id and b.member_id = v_tok.member_id), 0),
      'payer', public.member_name(v_expense.paid_by), 'name', public.member_name(v_tok.member_id),
      'corrected', false));
  else
    v_new := public.issue_action_token('accept_invitation', v_tok.team_id, null, v_tok.invitation_id,
                                       null, null, v_tok.email);
    perform public.queue_email(v_tok.email, 'team_invitation', v_tok.team_id, jsonb_build_object(
      'token', v_new,
      'team_name', (select t.name from public.teams t where t.id = v_tok.team_id),
      'inviter', (select m.display_name from public.team_invitations i
                  join public.team_members m on m.team_id = i.team_id and m.user_id = i.invited_by
                  where i.id = v_tok.invitation_id)));
  end if;
  return jsonb_build_object('state', 'sent');
end;
$$;

revoke execute on function public.email_allowed(text, text, uuid) from public, anon, authenticated;
