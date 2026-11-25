-- Un lien déjà renvoyé (donc remplacé) répond « too_soon » pendant une heure,
-- au lieu de « not_expired ».
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
