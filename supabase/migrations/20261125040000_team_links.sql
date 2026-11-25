-- Liens e-mail et file d'envoi.
--
-- - action_tokens : liens d'action. Seule l'empreinte SHA-256 du jeton est
--   gardée ; un lien sert une fois, expire au bout de 7 jours, et porte la
--   version de la dépense qu'il montre.
-- - email_outbox : e-mails à envoyer, lus seulement par le serveur (fonction
--   send-emails). Le lien en clair est effacé dès l'envoi.
-- - token_view / token_act / token_resend : seules fonctions ouvertes sans
--   compte ; elles ne montrent et ne permettent que ce que le lien concerne.

create extension if not exists pg_net with schema extensions;

-- ─────────────────────────── Tables ───────────────────────────

create table public.action_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  kind text not null
    check (kind in ('approve_expense', 'accept_invitation', 'approve_settlement', 'confirm_repayment')),
  team_id uuid not null references public.teams (id) on delete cascade,
  member_id uuid references public.team_members (id) on delete cascade,
  invitation_id uuid references public.team_invitations (id) on delete cascade,
  target_id uuid,
  target_version integer,
  -- Adresse à laquelle le lien a été envoyé : s'il change, le lien ne vaut plus.
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  revoked_at timestamptz
);

create index action_tokens_target on public.action_tokens (target_id, member_id);
create index action_tokens_invitation on public.action_tokens (invitation_id);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null check (char_length(to_email) between 3 and 254),
  kind text not null check (kind in ('team_invitation', 'approve_expense', 'approval_requested')),
  team_id uuid references public.teams (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz,
  last_error text
);

create index email_outbox_pending on public.email_outbox (created_at) where sent_at is null;

alter table public.action_tokens enable row level security;
alter table public.email_outbox enable row level security;
revoke all on public.action_tokens, public.email_outbox from anon, authenticated;

-- ─────────────────────────── Aides internes ───────────────────────────

create function public.hash_token(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.sha256(convert_to(coalesce(p_token, ''), 'UTF8'));
$$;

-- Crée un lien et renvoie le jeton en clair (256 bits, base64url).
create function public.issue_action_token(
  p_kind text, p_team uuid, p_member uuid, p_invitation uuid,
  p_target uuid, p_version integer, p_email text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
begin
  insert into public.action_tokens
    (token_hash, kind, team_id, member_id, invitation_id, target_id, target_version, email)
  values
    (public.hash_token(v_token), p_kind, p_team, p_member, p_invitation, p_target, p_version, p_email);
  return v_token;
end;
$$;

create function public.revoke_action_tokens(p_kind text, p_target uuid, p_member uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.action_tokens set revoked_at = now()
  where kind = p_kind and used_at is null and revoked_at is null
    and (p_target is null or target_id = p_target or invitation_id = p_target)
    and (p_member is null or member_id = p_member);
$$;

create function public.queue_email(p_to text, p_kind text, p_team uuid, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.email_outbox (to_email, kind, team_id, payload)
  values (p_to, p_kind, p_team, p_payload);
$$;

-- Prévient la fonction d'envoi. Une panne ici ne doit jamais bloquer l'action :
-- les e-mails restent dans la file et partent au prochain appel.
create function public.email_outbox_ping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform net.http_post(
      url := 'https://ekhcgjbleslgkwxkplxu.supabase.co/functions/v1/send-emails',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger email_outbox_ping
after insert on public.email_outbox
for each statement execute function public.email_outbox_ping();

-- Nom affiché d'un membre.
create function public.member_name(p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.display_name from public.team_members m where m.id = p_member;
$$;

-- Demande de validation d'une dépense : un lien pour chaque invité avec
-- e-mail, un e-mail vers l'application pour chaque membre inscrit (sauf la
-- personne qui vient d'agir et ceux qui ont déjà validé cette version).
create function public.queue_expense_emails(p_expense uuid, p_actor uuid, p_corrected boolean)
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
      if v_member.email is null then
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

-- E-mails déclenchés par l'historique (même source que les notifications).
create function public.audit_logs_emails()
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

create trigger audit_logs_emails
after insert on public.audit_logs
for each row execute function public.audit_logs_emails();

-- L'historique d'une action faite par lien porte le nom de l'invité.
create or replace function public.log_team_action(
  p_team uuid, p_action text, p_target uuid, p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (team_id, actor_user, actor_member, action, target_id, data)
  values (p_team, (select auth.uid()),
          coalesce(public.current_member(p_team), nullif(current_setting('ra.link_member', true), '')::uuid),
          p_action, p_target, p_data);
$$;

-- Contestation, partagée par l'application et les liens.
create function public.record_dispute(
  p_expense uuid, p_version integer, p_member uuid, p_kind text, p_reason text, p_via text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_row public.expenses;
begin
  if p_kind is null or p_kind not in ('refuse', 'error', 'correction') then
    raise exception 'invalid_kind';
  end if;
  if p_kind in ('error', 'correction') and v_reason = '' then
    raise exception 'reason_required';
  end if;
  select * into v_row from public.expenses e where e.id = p_expense for update;
  if p_version is null or v_row.version <> p_version then
    raise exception 'stale_version';
  end if;
  insert into public.expense_disputes (expense_id, member_id, version, kind, reason)
  values (p_expense, p_member, v_row.version, p_kind, v_reason);
  perform public.log_team_action(v_row.team_id, 'expense.disputed', p_expense,
    jsonb_build_object('member_id', p_member, 'kind', p_kind, 'reason', v_reason,
                       'via', p_via, 'version', v_row.version));
  perform public.record_approval(p_expense, p_version, p_member, 'refused', p_via);
end;
$$;

create or replace function public.dispute_expense(
  p_expense uuid, p_version integer, p_kind text, p_reason text, p_member uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  if p_kind is null or p_kind not in ('refuse', 'error', 'correction') then
    raise exception 'invalid_kind';
  end if;
  select * into v_actor from public.resolve_approval_actor(p_expense, p_member);
  perform public.record_dispute(p_expense, p_version, v_actor.member_id, p_kind, p_reason, v_actor.via);
end;
$$;

-- État d'un lien : open, used, revoked, expired, stale, closed (ou invalid).
create function public.action_token_state(p_token public.action_tokens)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses;
  v_member public.team_members;
  v_inv public.team_invitations;
begin
  if p_token.used_at is not null then
    return 'used';
  end if;
  if p_token.revoked_at is not null then
    return 'revoked';
  end if;
  if p_token.kind = 'approve_expense' then
    select * into v_expense from public.expenses e where e.id = p_token.target_id;
    select * into v_member from public.team_members m where m.id = p_token.member_id;
    if v_expense.id is null or v_member.id is null or v_expense.status = 'cancelled'
       or v_member.status <> 'active' or v_member.email is distinct from p_token.email
       or (select t.status from public.teams t where t.id = p_token.team_id) <> 'active'
       or not public.is_expense_approver(v_expense.id, v_member.id) then
      return 'closed';
    end if;
    if p_token.expires_at <= now() then
      return 'expired';
    end if;
    if v_expense.version <> p_token.target_version then
      return 'stale';
    end if;
    return 'open';
  elsif p_token.kind = 'accept_invitation' then
    select * into v_inv from public.team_invitations i where i.id = p_token.invitation_id;
    if v_inv.id is null or v_inv.accepted_at is not null or v_inv.declined_at is not null
       or v_inv.cancelled_at is not null then
      return 'closed';
    end if;
    if p_token.expires_at <= now() then
      return 'expired';
    end if;
    return 'open';
  end if;
  return 'closed';
end;
$$;

create function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2);
$$;

-- ─────────────────────────── Fonctions publiques (sans compte) ───────────────────────────

-- Ce que montre un lien : seulement la dépense ou l'invitation concernée.
create function public.token_view(p_token text)
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

-- Action par lien : valider ou contester la version montrée. Le lien est
-- ensuite inutilisable.
create function public.token_act(
  p_token text, p_action text, p_kind text default null, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tok public.action_tokens;
  v_state text;
begin
  if p_action is null or p_action not in ('approve', 'dispute') then
    raise exception 'invalid_action';
  end if;
  select * into v_tok from public.action_tokens t
   where t.token_hash = public.hash_token(p_token) for update;
  if not found or v_tok.kind <> 'approve_expense' then
    raise exception 'link_invalid';
  end if;
  v_state := public.action_token_state(v_tok);
  if v_state <> 'open' then
    raise exception 'link_%', v_state;
  end if;

  perform set_config('ra.link_member', v_tok.member_id::text, true);
  if p_action = 'approve' then
    perform public.record_approval(v_tok.target_id, v_tok.target_version, v_tok.member_id,
                                   'approved', 'email');
  else
    perform public.record_dispute(v_tok.target_id, v_tok.target_version, v_tok.member_id,
                                  p_kind, p_reason, 'email');
  end if;
  perform set_config('ra.link_member', '', true);

  update public.action_tokens set used_at = now() where id = v_tok.id;
  return jsonb_build_object('state', 'done',
    'status', (select e.status from public.expenses e where e.id = v_tok.target_id));
end;
$$;

-- Nouveau lien après expiration, envoyé uniquement à l'adresse d'origine
-- (au plus un par heure pour la même action).
create function public.token_resend(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tok public.action_tokens;
  v_new text;
  v_expense public.expenses;
begin
  select * into v_tok from public.action_tokens t
   where t.token_hash = public.hash_token(p_token) for update;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  if public.action_token_state(v_tok) <> 'expired' then
    return jsonb_build_object('state', 'not_expired');
  end if;
  if exists (select 1 from public.action_tokens t
             where t.kind = v_tok.kind and t.created_at > now() - interval '1 hour'
               and t.member_id is not distinct from v_tok.member_id
               and t.target_id is not distinct from v_tok.target_id
               and t.invitation_id is not distinct from v_tok.invitation_id) then
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

-- ─────────────────────────── File d'envoi (serveur seulement) ───────────────────────────

-- Réserve jusqu'à p_limit e-mails à envoyer (5 essais au plus, 2 minutes entre deux).
create function public.claim_outbox(p_limit integer default 20)
returns setof public.email_outbox
language sql
security definer
set search_path = ''
as $$
  update public.email_outbox o
     set claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select x.id from public.email_outbox x
      where x.sent_at is null and x.attempts < 5
        and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
      order by x.created_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked)
  returning o.*;
$$;

-- Marque un e-mail envoyé (lien effacé) ou garde l'erreur. Les e-mails
-- envoyés depuis plus de 30 jours sont supprimés.
create function public.complete_outbox(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error is null then
    update public.email_outbox
       set sent_at = now(), payload = payload - 'token', last_error = null
     where id = p_id;
  else
    update public.email_outbox set last_error = left(p_error, 500) where id = p_id;
  end if;
  delete from public.email_outbox where sent_at < now() - interval '30 days';
end;
$$;

-- ─────────────────────────── Droits ───────────────────────────

revoke execute on function
  public.hash_token(text),
  public.issue_action_token(text, uuid, uuid, uuid, uuid, integer, text),
  public.revoke_action_tokens(text, uuid, uuid),
  public.queue_email(text, text, uuid, jsonb),
  public.email_outbox_ping(),
  public.member_name(uuid),
  public.queue_expense_emails(uuid, uuid, boolean),
  public.audit_logs_emails(),
  public.record_dispute(uuid, integer, uuid, text, text, text),
  public.action_token_state(public.action_tokens),
  public.mask_email(text),
  public.claim_outbox(integer),
  public.complete_outbox(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.claim_outbox(integer),
  public.complete_outbox(uuid, text)
to service_role;

revoke execute on function
  public.token_view(text),
  public.token_act(text, text, text, text),
  public.token_resend(text)
from public;

grant execute on function
  public.token_view(text),
  public.token_act(text, text, text, text),
  public.token_resend(text)
to anon, authenticated;
