-- Revue de sécurité finale : deux fonctions plus anciennes pouvaient être
-- appelées par n'importe qui via /rest/v1/rpc. Ce sont des fonctions de
-- déclencheur (création du profil, RLS automatique) : elles fonctionnent sans
-- ce droit, qui ne sert qu'aux appels directs.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
