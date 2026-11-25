-- Limites d'envoi contre les abus, et « i_paid » dans token_view.
--
-- Une personne connectée pourrait sinon faire partir beaucoup d'e-mails au nom
-- de Ra Budget (inviter et annuler en boucle, créer des Teams). Au-delà des
-- limites, l'e-mail n'est simplement pas envoyé ; l'action, elle, réussit.
-- - 10 e-mails par jour au plus vers une même adresse ;
-- - 20 invitations par jour au plus pour une même personne qui invite ;
-- - 250 e-mails par jour au total (offre gratuite Brevo : 300).

alter table public.email_outbox
  add column sender_user uuid references auth.users (id) on delete set null;

create index email_outbox_recent_to on public.email_outbox (to_email, created_at);
create index email_outbox_recent_sender on public.email_outbox (sender_user, created_at);

create or replace function public.queue_email(p_to text, p_kind text, p_team uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid := (select auth.uid());
  v_since timestamptz := now() - interval '1 day';
begin
  if (select count(*) from public.email_outbox o
      where o.to_email = p_to and o.created_at > v_since) >= 10 then
    return;
  end if;
  if p_kind = 'team_invitation' and v_sender is not null
     and (select count(*) from public.email_outbox o
          where o.sender_user = v_sender and o.kind = 'team_invitation'
            and o.created_at > v_since) >= 20 then
    return;
  end if;
  if (select count(*) from public.email_outbox o where o.created_at > v_since) >= 250 then
    return;
  end if;
  insert into public.email_outbox (to_email, kind, team_id, payload, sender_user)
  values (p_to, p_kind, p_team, p_payload, v_sender);
end;
$$;

-- Ce que montre un lien : seulement la dépense ou l'invitation concernée.
create or replace function public.token_view(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tok public.action_tokens;
  v_state text;
  v_expense public.expenses;
  v_base jsonb;
begin
  select * into v_tok from public.action_tokens t where t.token_hash = public.hash_token(p_token);
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  v_state := public.action_token_state(v_tok);
  v_base := jsonb_build_object('state', v_state, 'kind', v_tok.kind,
    'team_name', (select t.name from public.teams t where t.id = v_tok.team_id));
  if v_state in ('revoked', 'closed') then
    return jsonb_build_object('state', v_state, 'kind', v_tok.kind);
  end if;

  if v_tok.kind = 'accept_invitation' then
    return v_base || jsonb_build_object(
      'email', public.mask_email(v_tok.email),
      'inviter', (select m.display_name from public.team_invitations i
                  join public.team_members m on m.team_id = i.team_id and m.user_id = i.invited_by
                  where i.id = v_tok.invitation_id));
  end if;

  select * into v_expense from public.expenses e where e.id = v_tok.target_id;
  v_base := v_base || jsonb_build_object('member_name', public.member_name(v_tok.member_id));
  if v_state <> 'open' then
    return v_base || jsonb_build_object('expense', jsonb_build_object('title', v_expense.title));
  end if;
  return v_base || jsonb_build_object('expense', jsonb_build_object(
    'title', v_expense.title,
    'spent_on', v_expense.spent_on,
    'total_cents', v_expense.total_cents,
    'category_id', v_expense.category_id,
    'split_mode', v_expense.split_mode,
    'status', v_expense.status,
    'payer', public.member_name(v_expense.paid_by),
    'i_paid', v_expense.paid_by = v_tok.member_id,
    'entered_by', public.member_name(v_expense.entered_by),
    'my_share_cents', coalesce((select b.share_cents from public.expense_beneficiaries b
                                where b.expense_id = v_expense.id and b.member_id = v_tok.member_id), 0),
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object(
                                  'name', m.display_name, 'share_cents', b.share_cents,
                                  'is_me', b.member_id = v_tok.member_id) order by b.position)
                               from public.expense_beneficiaries b
                               join public.team_members m on m.id = b.member_id
                               where b.expense_id = v_expense.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                          'label', i.label, 'quantity', i.quantity, 'total_cents', i.total_cents)
                          order by i.position)
                       from public.receipt_items i where i.expense_id = v_expense.id), '[]'::jsonb)));
end;
$$;

