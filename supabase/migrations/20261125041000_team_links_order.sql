-- Ordre d'envoi exact : plusieurs e-mails créés dans la même action ont
-- chacun leur heure (now() est figé pendant toute la transaction).
alter table public.email_outbox alter column created_at set default clock_timestamp();
alter table public.action_tokens alter column created_at set default clock_timestamp();
