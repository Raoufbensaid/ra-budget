# Module Team, étape 1 (socle) : plan de mise en œuvre

> **Pour les agents :** sous-compétence requise : superpowers:executing-plans. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :**

- créer le paquet de calculs `@ra/team` ;
- créer les tables Teams, membres et historique, avec leurs règles d'accès et leurs fonctions ;
- créer l'onglet « Teams », qui permet de créer une Team, d'y ajouter des invités et d'inviter des personnes ayant un compte.

**Architecture :**

- Logique financière pure dans `packages/team`, testée avec Vitest.
- La base n'accepte aucune écriture directe sur ces tables. Tout passe par des fonctions RPC `security definer`, qui vérifient les droits et écrivent dans `audit_logs`.
- L'application lit les tables (sous la RLS) et appelle ces RPC avec TanStack Query.

**Technologies :** TypeScript, Vitest, Postgres/Supabase (migrations envoyées avec `db push --remote`), Expo Router et TanStack Query.

**Conception :** `docs/superpowers/specs/2026-11-24-team-design.md`

## Contraintes générales

- Montants en centimes entiers. Aucun nombre à virgule dans les calculs.
- Pas de Docker : les migrations sont envoyées avec `pnpm exec supabase db push --remote --yes`, après un `--dry-run`.
- Tests SQL : `pnpm exec supabase db query --remote -f <fichier>`.
  - Chaque fichier commence par `begin;` et finit par `rollback;`.
  - Une vérification qui échoue lève une exception (`raise exception`).
- Les textes de l'interface sont en français et tutoient l'utilisateur (`apps/mobile/src/i18n/fr.ts`), avec une version anglaise équivalente (`en.ts`). Les deux fichiers ont les mêmes clés.
- Le style reprend les jetons de `@/theme` et les composants `Button`, `Field` et `Notice` de `@/components/ui`. Pas de nouvelle bibliothèque d'interface.
- Avant chaque commit : `pnpm typecheck`, `pnpm test` et `pnpm exec biome check .`, sans nouvelle erreur.
- Les commits se terminent par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Points de vigilance

1. **E-mail invité avec des majuscules ou des espaces** (« Bob@Mail.fr ») : il doit retrouver le compte « bob@mail.fr ». Normaliser avec `lower(trim())`.
2. **Nom de Team vide ou de plus de 60 caractères** : refusé avec l'erreur `invalid_name`, que l'application affiche.
3. **Inviter quelqu'un qui est déjà membre, ou s'inviter soi-même** : refusé avec l'erreur `already_member`, sans créer de doublon.
4. **Un compte étranger à la Team** qui appelle une RPC avec l'identifiant de cette Team : erreur `forbidden`, et ses `select` ne renvoient rien.
5. **1 centime partagé entre 3 personnes**, ou un total de 0 : la somme des parts reste exacte (`[1, 0, 0]`, `[0, 0, 0]`).

---

### Task 1: paquet de calculs `@ra/team`

**Fichiers :**

- Créer :
  - `packages/team/package.json` (même forme que `packages/insights`, sans dépendance) ;
  - `packages/team/tsconfig.json` ;
  - `packages/team/src/{types,split,balances,repayments,index}.ts`.
- Tests : `packages/team/test/team.test.ts`

**Interfaces produites :**

```ts
export type MemberId = string;
export interface Share { memberId: MemberId; cents: number }
export type ExpenseStatus = "pending" | "validated" | "disputed" | "cancelled";
export interface TeamExpense { id: string; paidBy: MemberId; totalCents: number; shares: Share[]; status: ExpenseStatus }
export interface Balance { memberId: MemberId; paidCents: number; shareCents: number; balanceCents: number }
export interface Transfer { from: MemberId; to: MemberId; amountCents: number }
export type SplitError = "empty" | "not_integer" | "negative" | "duplicate" | "sum_mismatch";
export interface RepaymentEvent { kind: "declared" | "confirmed"; amountCents: number }
export type RepaymentStatus = "pending" | "declared" | "partial" | "confirmed";

splitEqual(totalCents: number, memberIds: MemberId[]): Share[]
validateShares(totalCents: number, shares: Share[]): SplitError | null
computeBalances(memberIds: MemberId[], expenses: TeamExpense[]): Balance[]
planRepayments(balances: Balance[]): Transfer[]
repaymentProgress(amountCents: number, events: RepaymentEvent[]):
  { declaredCents: number; confirmedCents: number; remainingCents: number; status: RepaymentStatus }
canConfirm(amountCents: number, events: RepaymentEvent[], confirmCents: number): boolean
```

- [ ] **Étape 1 : écrire les tests qui échouent**, dans `team.test.ts` :
  - `splitEqual(1200, ["A","B"])` donne `[{A,600},{B,600}]`.
  - `splitEqual(1000, ["A","B","C"])` donne `[334,333,333]` dans l'ordre donné.
  - `splitEqual(1, ["A","B","C"])` donne `[1,0,0]`, et `splitEqual(0, ["A"])` donne `[0]`.
  - `validateShares` :
    - 1200 avec `A:400, B:800` donne `null` ;
    - 1200 avec `A:400, B:700` donne `"sum_mismatch"` ;
    - une part `-1` donne `"negative"` ;
    - `1.5` donne `"not_integer"` ;
    - deux fois `A` donne `"duplicate"` ;
    - `[]` donne `"empty"`.
  - **Exemple des gâteaux :** une dépense validée, payée par B, de 1200, avec les parts A:600 et B:600.
    - `computeBalances(["A","B","C"], …)` donne :
      - A : paid 0, share 600, balance −600 ;
      - B : paid 1200, share 600, balance +600 ;
      - C : tout à 0.
    - `planRepayments` donne `[{from:"A", to:"B", amountCents:600}]`.
  - **Exemple du voyage :** trois dépenses validées, payées par A (30000), B (18000) et C (12000), chacune partagée à parts égales entre A, B et C.
    - Les soldes valent +10000, −2000 et −8000.
    - `planRepayments` donne `[{C→A 8000}, {B→A 2000}]`.
  - Les dépenses `pending`, `disputed` et `cancelled` sont ignorées par `computeBalances`.
  - **Propriétés :**
    - la somme des `balanceCents` vaut toujours 0 ;
    - après application des virements, tous les soldes valent 0 ;
    - le nombre de virements est inférieur ou égal au nombre de membres non nuls moins 1.
  - **`repaymentProgress(20000, …)` :**
    - `[]` donne `pending` et remaining 20000 ;
    - `[declared 20000]` donne `declared` et confirmed 0 ;
    - `[confirmed 8000]` donne `partial` et remaining 12000 ;
    - `[confirmed 8000, confirmed 12000]` donne `confirmed` et remaining 0.
  - **`canConfirm(20000, [confirmed 8000], …)` :**
    - 12000 donne true ;
    - 12001 donne false ;
    - 0 donne false.
- [ ] **Étape 2 :** `pnpm --filter @ra/team test` doit échouer (module introuvable).
- [ ] **Étape 3 : implémenter.**
  - `splitEqual` : `floor(total / n)` pour chacun, puis 1 centime de plus aux `total % n` premiers.
  - `planRepayments`, algorithme fixe :
    1. séparer les créanciers (solde > 0) et les débiteurs (solde < 0) ;
    2. trier chaque liste par montant absolu décroissant ; en cas d'égalité, garder l'ordre d'entrée ;
    3. tant qu'il reste des deux côtés, faire un virement du premier débiteur au premier créancier, d'un montant égal au plus petit des deux montants absolus ;
    4. retirer celui qui tombe à 0, puis retrier comme à l'étape 2.
- [ ] **Étape 4 :** `pnpm install`, puis `pnpm --filter @ra/team test` et `pnpm --filter @ra/team typecheck` doivent passer.
- [ ] **Étape 5 : commit** « Ajoute le moteur de calcul des Teams (parts, soldes, remboursements) ».

### Task 2: base de données du socle (Teams, membres, historique)

**Fichiers :**

- Créer : `supabase/migrations/<horodatage>_team_core.sql`
- Test : `supabase/tests/team_core.sql`

**Interfaces produites (SQL, schéma `public`) :**

- **Tables :**
  - `teams(id uuid pk, name text 1..60, icon text ≤ 8 (emoji, défaut '👥'), created_by uuid → auth.users, status text in ('active','closing','settling','settled','archived') défaut 'active', created_at, updated_at, closed_at)` ;
  - `team_members(id uuid pk, team_id → teams on delete cascade, user_id uuid null → auth.users, display_name text 1..60, email text null, role text in ('owner','member','guest'), status text in ('invited','active','removed'), invited_by uuid null, created_at, joined_at)` :
    - unicité `(team_id, user_id)` quand `user_id` n'est pas nul ;
    - `role = 'guest'` si et seulement si `user_id is null` ;
  - `audit_logs(id bigint identity pk, team_id → teams on delete cascade, actor_user uuid null, actor_member uuid null, action text, target_id uuid null, data jsonb défaut '{}', created_at)`.
- **Fonctions d'aide** (`security definer`, `stable`, `search_path = ''`) :
  - `is_team_member(p_team uuid) returns boolean` : membre `active` avec `user_id = auth.uid()` ;
  - `is_team_owner(p_team uuid) returns boolean`.
- **RPC** (`security definer`, exécution réservée au rôle `authenticated`). Chacune écrit une ligne `audit_logs`. Les erreurs sont levées par `raise exception '<code>'` :
  - `create_team(p_name text, p_icon text) returns uuid`
    - crée la Team et le membre `owner`, dont le nom affiché vient de `profiles.display_name`, sinon de la partie avant « @ » de l'e-mail ;
    - erreur : `invalid_name`.
  - `update_team(p_team uuid, p_name text, p_icon text) returns void`
    - réservée au créateur, Team `active` ;
    - erreurs : `forbidden`, `invalid_name`, `team_locked`.
  - `add_guest(p_team uuid, p_name text, p_email text) returns uuid`
    - réservée au créateur ;
    - e-mail normalisé, ou `null` ;
    - erreurs : `forbidden`, `invalid_name`, `invalid_email`, `team_locked`.
  - `update_guest(p_member uuid, p_name text, p_email text) returns void`
    - réservée au créateur, uniquement pour un invité ;
    - l'e-mail peut être effacé (RGPD) ;
    - erreurs : `forbidden`, `invalid_name`, `invalid_email`.
  - `invite_member(p_team uuid, p_email text) returns uuid`
    - réservée au créateur ;
    - cherche le compte dans `auth.users` avec `lower(trim(email))` ;
    - erreurs :
      - `no_account` : aucun compte avec cet e-mail ; l'étape 6 enverra alors un e-mail ;
      - `already_member` : la personne est déjà membre invitée ou active, ou c'est le créateur lui-même ;
      - `forbidden`, `team_locked`.
    - Un ancien membre `removed` repasse en `invited`.
  - `respond_invitation(p_member uuid, p_accept boolean) returns void`
    - réservée à la personne invitée (`user_id = auth.uid()`, statut `invited`) ;
    - acceptation : statut `active` ; refus : statut `removed` ;
    - erreur : `forbidden`.
  - `remove_member(p_member uuid) returns void`
    - réservée au créateur ;
    - ne peut pas retirer le créateur ;
    - passe le membre en `removed` sans supprimer la ligne ;
    - erreurs : `forbidden`, `cannot_remove_owner`.
  - `leave_team(p_team uuid) returns void`
    - un membre (pas le créateur) quitte la Team ;
    - erreurs : `forbidden`, `owner_cannot_leave`.
  - `delete_team(p_team uuid) returns void`
    - réservée au créateur ;
    - supprime la Team (cascade), seulement si elle n'a encore aucune dépense ; l'étape 2 ajoutera cette vérification quand la table des dépenses existera ;
    - erreurs : `forbidden`, `team_has_expenses`.
- **Règles d'accès (RLS) :**
  - **`select`** :
    - `teams` : membre (`is_team_member(id)`), ou compte invité (il existe une ligne `team_members` avec `user_id = auth.uid()` et `status = 'invited'`) ;
    - `team_members` : `is_team_member(team_id) or user_id = auth.uid()` ;
    - `audit_logs` : `is_team_member(team_id)`.
  - **Écritures :** aucun droit d'ajout, de modification ou de suppression pour `anon` ni pour `authenticated` sur les trois tables (`revoke` explicite).
- **Temps réel :** ajouter `teams` et `team_members` à la publication `supabase_realtime`.

- [ ] **Étape 1 : écrire `supabase/tests/team_core.sql`** (`begin; … rollback;`).
  - **Mise en place :**
    - créer trois comptes de test dans `auth.users` : A, B et C, avec les e-mails `a@test.local`, `b@test.local` et `c@test.local` ;
    - définir une fonction temporaire `pg_temp.as_user(uuid)`, qui exécute `set local role authenticated` et règle `request.jwt.claims` sur `{"sub": …}` ;
    - définir une fonction `pg_temp.expect_error(sql text, code text)`.
  - **Vérifications :**
    - A crée « Voyage Lisbonne » : 1 Team, 1 membre `owner` actif ;
    - A ajoute l'invité « Dana », avec un e-mail vide ou `null` ;
    - A invite « B@Test.local » : B est `invited` ;
    - B voit la Team ; C ne voit ni la Team ni ses membres (0 ligne) ;
    - B accepte : B est `active` ;
    - C appelle `add_guest` sur cette Team : erreur `forbidden` ;
    - A réinvite B : erreur `already_member` ; A s'invite lui-même : erreur `already_member` ;
    - `create_team('', '👥')` et un nom de 61 caractères : erreur `invalid_name` ;
    - `invite_member` avec `nobody@test.local` : erreur `no_account` ;
    - B fait `insert` dans `teams` : refusé (permission refusée) ;
    - A retire B : B est `removed` ; A tente de se retirer : erreur `cannot_remove_owner` ;
    - `audit_logs` contient au moins 5 lignes pour la Team ;
    - B appelle `delete_team` : erreur `forbidden` ; A l'appelle : la Team n'existe plus.
- [ ] **Étape 2 :** `pnpm exec supabase db query --remote -f supabase/tests/team_core.sql` doit échouer, car `create_team` n'existe pas.
- [ ] **Étape 3 :** écrire la migration selon les interfaces ci-dessus. Vérifier avec `db push --remote --dry-run` qu'elle est la seule en attente, puis l'appliquer avec `db push --remote --yes`.
- [ ] **Étape 4 :** relancer le test SQL. Résultat attendu : aucune exception, la transaction est annulée et aucune donnée n'est laissée.
- [ ] **Étape 5 :** `pnpm exec supabase db advisors --remote` ne doit signaler aucune nouvelle alerte de sécurité sur ces tables.
- [ ] **Étape 6 : commit** « Ajoute les Teams, leurs membres et l'historique dans la base ».

### Task 3: onglet « Teams » dans l'application

**Fichiers :**

- Créer :
  - `apps/mobile/src/features/teams/api.ts` ;
  - `apps/mobile/src/features/teams/errors.ts` ;
  - `apps/mobile/src/features/teams/member-row.tsx` ;
  - `apps/mobile/src/features/teams/status-pill.tsx` ;
  - `apps/mobile/src/app/(app)/teams/_layout.tsx` (Stack) ;
  - `apps/mobile/src/app/(app)/teams/index.tsx` (liste) ;
  - `apps/mobile/src/app/(app)/teams/new.tsx` (création) ;
  - `apps/mobile/src/app/(app)/teams/[id].tsx` (espace de la Team : en-tête et membres).
- Modifier :
  - `apps/mobile/src/app/(app)/_layout.tsx` : onglet « Teams », icône `Users`, placé après « Bilan » ;
  - `apps/mobile/src/i18n/fr.ts` et `en.ts` : section `teams` ;
  - `apps/mobile/package.json` : dépendance `@ra/team` (servira à l'étape 2).

**Interfaces consommées :** les RPC et tables de la tâche 2.

**Interfaces produites** (dans `features/teams/api.ts`) :

```ts
export type TeamStatus = "active" | "closing" | "settling" | "settled" | "archived";
export type MemberRole = "owner" | "member" | "guest";
export type MemberStatus = "invited" | "active" | "removed";
export interface TeamMember { id: string; teamId: string; userId: string | null; displayName: string; email: string | null; role: MemberRole; status: MemberStatus }
export interface Team { id: string; name: string; icon: string; status: TeamStatus; createdBy: string; createdAt: string; members: TeamMember[] }
useTeams(): UseQueryResult<{ teams: Team[]; invitations: Team[] }>   // clé ["teams", userId]
useTeam(id: string): UseQueryResult<Team | null>                    // clé ["teams", userId, id]
useCreateTeam(), useUpdateTeam(), useAddGuest(), useUpdateGuest(), useInviteMember(),
useRespondInvitation(), useRemoveMember(), useLeaveTeam()          // mutations : invalident ["teams"]
teamErrorMessage(error: unknown, t: TFunction): string              // dans errors.ts : code SQL → texte i18n
```

- **Liste des Teams :**
  - les invitations en attente en haut, avec les boutons Rejoindre et Refuser ;
  - puis une carte par Team : icône, nom, pastille de statut (texte + icône, couleurs du thème), nombre de membres ;
  - un état vide avec le bouton « Créer une Team ».
- **Création :**
  - nom et icône à choisir parmi 12 emojis (✈️ 🏖️ 🏠 🍽️ 🎉 ⛺ 🚗 🎿 🛒 🎓 ⚽ 👥) ;
  - puis ouverture de la Team.
- **Espace de la Team :**
  - en-tête : icône, nom, statut, « Créée par X le … » ;
  - liste des membres, avec leur rôle et leur statut (« invité sans compte », « invitation envoyée ») ;
  - pour le créateur : formulaires « Inviter (e-mail d'un compte Ra Budget) » et « Ajouter un invité (nom, e-mail facultatif) », retrait d'un membre avec confirmation, modification d'un invité ;
  - pour un membre : « Quitter la Team » ;
  - les onglets Discussion, Dépenses et Comptes affichent « Bientôt disponible » jusqu'aux étapes 2 à 4.
- **Messages d'erreur :** chaque code SQL de la tâche 2 a son texte en français, sous `teams.errors.<code>`. Les codes inconnus affichent le texte générique `teams.errors.generic`.

- [ ] **Étape 1 :** écrire les fichiers ci-dessus et les traductions.
- [ ] **Étape 2 :** `pnpm typecheck` et `pnpm exec biome check .` doivent passer.
- [ ] **Étape 3 :** relancer Expo (`expo start --clear`, onglet de terminal) et ouvrir `http://localhost:8081/teams` dans le panneau navigateur.
  - Si Raouf est connecté : créer une Team, ajouter un invité, vérifier l'affichage, puis supprimer la Team de test.
  - Sinon : vérifier que la page de connexion se compile sans erreur, et demander le test sur l'iPhone.
- [ ] **Étape 4 : commit** « Ajoute l'onglet Teams : création, invités et invitations ».
