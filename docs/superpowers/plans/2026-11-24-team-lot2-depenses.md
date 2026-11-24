# Module Team, étape 2 (dépenses) : plan de mise en œuvre

> **Pour les agents :** sous-compétence requise : superpowers:executing-plans. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** saisir une dépense de Team avec :

- la personne qui l'a payée, distincte de celle qui la saisit ;
- ses bénéficiaires ;
- un partage égal ou personnalisé.

On peut la lister, la consulter, la corriger (chaque correction crée une nouvelle version tracée) et l'annuler.

**Architecture :**

- La règle des parts est dans `@ra/team`, testée, et elle est dupliquée dans la base. La base fait autorité : la fonction RPC recalcule et vérifie tout.
- Les tables restent en lecture seule pour les clients.
- Les validations (approbations, contestations) arrivent à l'étape 3. Ici, toute dépense créée ou corrigée est `pending`.

**Technologies :** les mêmes qu'à l'étape 1.

**Conception :** `docs/superpowers/specs/2026-11-24-team-design.md` (sections 3, 5, 6 et 8).

## Contraintes générales

Ce sont les mêmes qu'à l'étape 1 : centimes entiers, `db push --remote`, tests SQL `begin … rollback`, textes en français avec tutoiement et version anglaise, jetons du thème, puis types, tests et Biome avant chaque commit.

## Points de vigilance

1. **Partage égal de 10 € entre 3 personnes :** la base et l'application donnent exactement les mêmes parts (334, 333 et 333 centimes), dans l'ordre des bénéficiaires envoyé.
2. **Parts personnalisées dont la somme diffère du total**, ou part négative : refusées par l'application avant l'envoi, et par la base (`invalid_shares`).
3. **Payeur ou bénéficiaire qui n'est pas un membre actif de cette Team**, par exemple membre retiré ou membre d'une autre Team : refusé (`invalid_member`).
4. **Une personne qui n'a ni saisi ni payé la dépense, et qui n'est pas le créateur** : elle ne peut ni la corriger ni l'annuler (`forbidden`).
5. **Une Team qui a des dépenses ne peut plus être supprimée** (`team_has_expenses`). Une dépense annulée reste visible, avec son historique.

---

### Task 1: calcul des parts dans `@ra/team`

**Fichiers :** modifier `packages/team/src/split.ts` et `packages/team/test/team.test.ts`.

**Interface produite :**

```ts
export type SplitMode = "equal" | "custom";
buildShares(totalCents: number, beneficiaries: MemberId[], mode: SplitMode,
            custom?: Record<MemberId, number>): { shares: Share[] } | { error: SplitError | "invalid_total" }
```

- **Partage égal :** `splitEqual` sur les bénéficiaires, dans l'ordre donné.
- **Partage personnalisé :** les parts de `custom` sont prises dans l'ordre des bénéficiaires, puis vérifiées par `validateShares`.
- Un total non entier ou inférieur ou égal à 0 donne `invalid_total`. Une liste vide donne `empty`.

- [ ] **Tests :**
  - égal, 1000 entre `[A, B, C]` : `[334, 333, 333]` ;
  - personnalisé, 1200 avec `{A: 400, B: 800}` : les parts ;
  - personnalisé, 1200 avec `{A: 400, B: 700}` : `{ error: "sum_mismatch" }` ;
  - total 0 : `invalid_total` ;
  - aucun bénéficiaire : `empty`.
- [ ] **Vérifications :** les tests échouent, on implémente, puis ils passent (`pnpm --filter @ra/team test`).
- [ ] **Commit.**

### Task 2: dépenses dans la base

**Fichiers :**

- créer `supabase/migrations/<horodatage>_team_expenses.sql` ;
- créer `supabase/tests/team_expenses.sql`.

**Tables :**

- **`expenses`** :
  - `id`, `team_id`, `entered_by` (membre), `paid_by` (membre), `title` (1 à 80 caractères), `spent_on` (date), `total_cents` (entier de 1 à 1 000 000 000), `category_id` (null ou l'un des 18 identifiants de `@ra/core`) ;
  - `split_mode` : `equal` ou `custom` ;
  - `status` : `pending`, `validated`, `disputed` ou `cancelled`, par défaut `pending` ;
  - `version` (entier, par défaut 1), `receipt_id` (uuid, null ; la contrainte de clé viendra à l'étape 5), `created_at`, `updated_at`, `cancelled_at`.
- **`expense_beneficiaries`** : `(expense_id, member_id)` comme clé, `share_cents` supérieur ou égal à 0, `position`.
- **`receipt_items`** : `id`, `expense_id`, `position`, `label` (1 à 120 caractères), `quantity` (numeric supérieur à 0, par défaut 1), `unit_price_cents` (null possible), `total_cents` (entier, peut être négatif pour une remise), `category_id` (null possible).

**Fonctions RPC (`security definer`, réservées au rôle `authenticated`) :**

- **`create_expense(p_team uuid, p_draft jsonb) returns uuid`.**
  - Le brouillon contient :
    - `paid_by` (uuid), `title`, `spent_on` (« AAAA-MM-JJ »), `total_cents`, `category_id`, `split_mode` ;
    - `beneficiaries` : `[{member_id, share_cents?}]` ;
    - `items` : `[{label, quantity, unit_price_cents, total_cents, category_id}]`, facultatif.
  - Vérifications :
    - l'appelant est un membre actif et la Team est `active` ;
    - le payeur et les bénéficiaires sont des membres actifs de la Team, sans doublon, avec au moins un bénéficiaire ;
    - en partage égal, les parts sont recalculées comme `splitEqual` ;
    - en partage personnalisé, chaque part est supérieure ou égale à 0 et leur somme égale le total ;
    - au plus 200 articles.
  - Une ligne est écrite dans `audit_logs` (`expense.created`).
  - Erreurs : `forbidden`, `team_locked`, `invalid_member`, `invalid_shares`, `invalid_expense` (titre, date, montant ou catégorie invalide, ou trop d'articles).
- **`update_expense(p_expense uuid, p_draft jsonb) returns void`.**
  - Réservée à celui qui a saisi, au payeur inscrit, ou au créateur de la Team.
  - La dépense ne doit pas être annulée, et la Team doit être `active`.
  - Elle remplace les bénéficiaires et les articles, passe à `version + 1` et au statut `pending`.
  - L'historique (`expense.updated`) garde l'avant et l'après dans `data` (`before` et `after` : titre, total, payeur, parts).
- **`cancel_expense(p_expense uuid, p_reason text) returns void`.**
  - Mêmes droits que la correction.
  - Statut `cancelled` et `cancelled_at`, avec l'historique `expense.cancelled` et le motif.
- **`delete_team`** : erreur `team_has_expenses` s'il existe une dépense.

**Règles d'accès (RLS) :** lecture pour `is_team_member(team_id)`, en passant par la dépense pour les tables filles. Aucune écriture directe.

- [ ] **Test SQL :**
  - A crée une Team avec B (inscrit) et l'invitée Dana ;
  - A saisit 10 € payés par Dana pour A, B et Dana en partage égal : parts 334, 333 et 333, statut `pending`, `entered_by` = A et `paid_by` = Dana ;
  - partage personnalisé dont la somme est fausse : `invalid_shares` ;
  - bénéficiaire d'une autre Team : `invalid_member` ;
  - C, étranger à la Team, ne voit aucune dépense, et `create_expense` lui renvoie `forbidden` ;
  - B corrige la dépense de A, payée par Dana : `forbidden`, car B ni n'a saisi ni n'a payé, et n'est pas le créateur ;
  - A corrige : version 2, et l'historique contient `before` et `after` ;
  - A annule : statut `cancelled` ;
  - `delete_team` : `team_has_expenses`.
- [ ] **Vérifications :** le test échoue, on écrit la migration (`--dry-run`, puis envoi), puis le test passe sans laisser de données.
- [ ] **Commit.**

### Task 3: écrans des dépenses

**Fichiers :**

- déplacer `app/(app)/teams/[id].tsx` vers `app/(app)/teams/[id]/index.tsx` ;
- créer :
  - `app/(app)/teams/[id]/expenses/new.tsx` ;
  - `app/(app)/teams/[id]/expenses/[expenseId].tsx` (détail, avec la correction en ligne) ;
  - `features/team-expenses/api.ts` ;
  - `features/team-expenses/expense-form.tsx` ;
  - `features/team-expenses/expense-row.tsx` ;
  - `features/team-expenses/expense-status.tsx` ;
- modifier `app/(app)/teams/_layout.tsx` et les fichiers de traduction (section `teamExpenses`).

**Interfaces produites** (dans `features/team-expenses/api.ts`) :

```ts
export interface TeamExpenseView { id; teamId; enteredBy; paidBy; title; spentOn; totalCents; categoryId;
  splitMode: SplitMode; status: ExpenseStatus; version; createdAt; beneficiaries: { memberId; shareCents }[];
  items: { label; quantity; unitPriceCents; totalCents; categoryId }[] }
export interface ExpenseDraft { paid_by; title; spent_on; total_cents; category_id; split_mode;
  beneficiaries: { member_id; share_cents?: number }[]; items?: … }
useTeamExpenses(teamId): UseQueryResult<TeamExpenseView[]>      // clé ["team-expenses", teamId]
useTeamExpense(expenseId): UseQueryResult<TeamExpenseView | null>
useCreateExpense(), useUpdateExpense(), useCancelExpense()        // invalident ["team-expenses"]
```

- **Rubrique « Dépenses » de la Team :**
  - total des dépenses non annulées ;
  - bouton « Ajouter une dépense » ;
  - une ligne par dépense : titre, date, « Payé par X », nombre de bénéficiaires, montant et statut (pastille avec icône et texte).
- **Formulaire :**
  - titre, montant (`parseEuros`), date (‹ › jour par jour, jamais après aujourd'hui), catégorie (pastilles, facultative) ;
  - « Qui a payé ? » : pastilles des membres actifs, le compte connecté par défaut ;
  - « Qui participe à cet achat ? » : cases à cocher, tout le monde par défaut ;
  - partage « À parts égales » ou « Personnalisé » ;
  - en partage égal, aperçu des parts calculées par `buildShares` ;
  - en partage personnalisé, un champ montant par bénéficiaire, avec « Reste à répartir : X » en direct ;
  - le bouton n'est actif que lorsque `buildShares` réussit.
- **Détail :**
  - titre, montant, date, catégorie, saisi par, payé par, parts de chacun, statut, version ;
  - « Corriger » et « Annuler la dépense » (avec motif et confirmation), seulement pour ceux qui en ont le droit ;
  - une note « Validation par les participants : étape suivante ».

- [ ] **Vérifications :** types, Biome et compilation web sans erreur dans la console.
- [ ] **Commit.**
