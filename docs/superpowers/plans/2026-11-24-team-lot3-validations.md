# Module Team, étape 3 (validations) : plan de mise en œuvre

> **Pour les agents :** sous-compétence requise : superpowers:executing-plans. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :**

- chaque dépense est validée par son payeur et par tous ses bénéficiaires ;
- chacun peut refuser sa participation, signaler une erreur ou demander une correction, ce qui rend la dépense « contestée » ;
- une correction remet toutes les validations à zéro ;
- tout est tracé : auteur, date, version.

**Architecture :**

- La règle de statut est écrite dans `@ra/team` (testée) et reproduite dans la base, qui fait autorité.
- Les validations sont liées à une **version** de la dépense : celles d'une ancienne version restent dans l'historique, mais ne comptent plus.
- Les invités qui ont un e-mail valideront par lien (étape 6). Les invités sans e-mail sont validés par le créateur, avec `via = 'owner'`.

**Conception :** `docs/superpowers/specs/2026-11-24-team-design.md` (section 3).

## Décisions prises pour cette étape

- **Validation automatique de celui qui saisit :** à chaque création ou correction, la personne qui saisit est réputée valider la version qu'elle enregistre, avec `via = 'app'`. Si c'est le payeur, l'étape 1 est donc faite.
- **Pas d'ordre imposé :** les bénéficiaires peuvent valider avant le payeur. La dépense n'est « validée » que quand tout le monde a validé, et l'écran montre l'étape du payeur en premier.
- **Retrait d'une contestation :** valider après avoir contesté retire la contestation de cette personne (elle passe à `resolved`).
- **Validation pour un invité :** le créateur peut valider ou contester à la place d'un invité **sans e-mail** seulement.

## Points de vigilance

1. **Payeur aussi bénéficiaire :** il n'est compté qu'une fois parmi les validateurs.
2. **Correction après une contestation :** la nouvelle version repart en `pending`, les contestations ouvertes sont résolues avec le motif « corrigée », et les anciennes validations ne comptent plus.
3. **Une personne qui ne participe pas à l'achat** ne peut ni valider ni contester (`not_concerned`).
4. **Valider deux fois la même version** ne crée pas de doublon : la décision est mise à jour, et l'historique garde chaque action.
5. **Dépense annulée, ou Team qui n'est plus active :** valider ou contester est refusé (`expense_cancelled`, `team_locked`).

---

### Task 1: règles de validation dans `@ra/team`

**Fichiers :** créer `packages/team/src/approvals.ts`, modifier `packages/team/src/index.ts`, et ajouter les tests dans `packages/team/test/team.test.ts`.

```ts
export type Decision = "approved" | "refused";
export interface ApprovalRecord { memberId: MemberId; decision: Decision }
requiredApprovers(paidBy: MemberId, beneficiaries: MemberId[]): MemberId[]   // payeur d'abord, sans doublon
approvalState(required: MemberId[], approvals: ApprovalRecord[]):
  { status: "pending" | "validated" | "disputed"; approved: MemberId[]; waiting: MemberId[]; refused: MemberId[] }
```

- [ ] **Tests :**
  - `requiredApprovers("B", ["A", "B"])` donne `["B", "A"]` ;
  - un refus donne `disputed` ;
  - tous ont validé : `validated` ;
  - sinon `pending`, avec la liste `waiting` ;
  - une validation d'un membre qui n'est pas requis est ignorée.
- [ ] **Vérification :** voir échouer les tests, implémenter, puis les voir passer.
- [ ] **Commit.**

### Task 2: validations et contestations dans la base

**Fichiers :**

- créer `supabase/migrations/<horodatage>_team_approvals.sql` ;
- créer `supabase/tests/team_approvals.sql`.

**Tables :**

- **`expense_approvals`** :
  - `id`, `expense_id`, `member_id`, `version` ;
  - `decision` : `approved` ou `refused` ;
  - `acted_by` (le compte qui agit), `via` (`app`, `email` ou `owner`) ;
  - `created_at`, `updated_at` ;
  - unicité sur `(expense_id, member_id, version)`.
- **`expense_disputes`** :
  - `id`, `expense_id`, `member_id`, `version` ;
  - `kind` : `refuse`, `error` ou `correction` ;
  - `reason` (texte, au plus 500 caractères) ;
  - `status` : `open` ou `resolved` ;
  - `created_at`, `resolved_at`, `resolved_by`, `resolution`.

**Fonctions :**

- **`refresh_expense_status(p_expense)`**, interne : recalcule `pending`, `validated` ou `disputed` à partir des validations de la version courante, sauf si la dépense est `cancelled`.
- **`record_approval(p_expense, p_member, p_decision, p_via)`**, interne : enregistre ou met à jour la décision, trace l'action, puis appelle `refresh_expense_status`.
- **`approve_expense(p_expense uuid, p_member uuid default null) returns void`** :
  - `p_member` vide veut dire « moi » ;
  - pour quelqu'un d'autre, il faut être le créateur, et la personne doit être un invité sans e-mail ;
  - résout les contestations ouvertes de ce membre.
- **`dispute_expense(p_expense uuid, p_kind text, p_reason text, p_member uuid default null) returns void`** : enregistre un refus et une contestation ouverte, et la dépense passe à `disputed`. Un motif est obligatoire pour `error` et `correction`.
- **`create_expense` et `update_expense`** :
  - elles enregistrent la validation automatique de la personne qui saisit ;
  - `update_expense` résout les contestations ouvertes (motif « corrigée ») ;
  - ensuite, le statut est recalculé.
- **Codes d'erreur :** `forbidden`, `not_concerned`, `expense_cancelled`, `team_locked`, `reason_required`, `invalid_kind`.
- **Accès :** les membres de la Team peuvent lire ces tables, personne ne peut y écrire directement. Les deux tables sont ajoutées à la publication en temps réel.

- [ ] **Test SQL :**
  - **Mise en place :** A crée une Team avec B (inscrit), Dana (invitée sans e-mail) et Eve (invitée avec e-mail).
  - **Saisie par le payeur :** A saisit une dépense payée par A pour A et B. Elle est `pending`, car A a validé et B attend. B valide : `validated`.
  - **Contestation :** une dépense payée par A pour A, B et Dana ; B la conteste (`error`) : `disputed`. Une contestation sans motif donne `reason_required`.
  - **Correction :** A corrige, ce qui donne la version 2 en `pending` ; la contestation de B est `resolved` et les validations de la version 1 ne comptent plus.
  - **Validation pour un invité :** A valide pour Dana, enregistré `via = 'owner'`. Pour Eve, c'est refusé (`forbidden`), car elle a un e-mail et validera par lien.
  - **Validation finale :** B valide : `validated`.
  - **Personne non concernée :** C, membre de la Team mais pas bénéficiaire, qui valide : `not_concerned`.
  - **Dépense annulée :** valider une dépense annulée donne `expense_cancelled`.
- [ ] **Vérification :** voir échouer le test, écrire la migration, faire le `--dry-run` puis l'envoi. Le test passe, et les tests `team_core` et `team_expenses` passent toujours.
- [ ] **Commit.**

### Task 3: écrans de validation

**Fichiers :**

- `features/team-expenses/api.ts` : ajouter `approvals` et `disputes` à la lecture ; mutations `useApproveExpense` et `useDisputeExpense` ; `useExpenseHistory(expenseId)`, qui lit `audit_logs` où `target_id = expenseId` ;
- créer `features/team-expenses/approvals-card.tsx` ;
- modifier l'écran de détail et les fichiers de traduction.

**Carte « Validations » :**

- Une ligne par validateur requis, le payeur en premier avec la mention « Étape 1 : le payeur confirme ». Chaque ligne indique un état, avec une icône et un texte : validé, en attente ou contesté.
- **Pour moi :** les boutons « Je valide », « Je refuse ma participation » et « Signaler une erreur », ce dernier avec un motif obligatoire.
- **Pour le créateur :** « Valider pour X » ou « Contester pour X » sur les invités sans e-mail.
- **Contestations ouvertes :** qui, quel type, quel motif. La personne qui a saisi la dépense voit l'invitation « Corriger la dépense ».

**Carte « Historique » :** une ligne par action (création, correction en vN, validation, contestation, annulation), avec l'auteur et la date.

- [ ] **Vérification :** types, Biome et compilation web sans erreur.
- [ ] **Commit.**
