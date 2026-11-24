# Module Team, étape 4 (discussion et notifications) : plan de mise en œuvre

> **Pour les agents :** sous-compétence requise : superpowers:executing-plans. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :**

- chaque Team a une conversation en temps réel ;
- les événements importants (dépense ajoutée, corrigée, validée, contestée, annulée, arrivée d'un membre) y apparaissent comme messages automatiques ;
- les membres inscrits reçoivent des notifications dans l'application : une cloche avec un compteur et un badge sur l'onglet Teams.

**Architecture :**

- Un seul déclencheur sur `audit_logs` produit les messages automatiques et les notifications. Toute action passe déjà par l'historique, donc aucun événement n'est oublié.
- Les textes sont composés par l'application à partir du type d'événement et de ses données, pour être traduits.
- Les e-mails viendront à l'étape 6, en s'appuyant sur ces mêmes notifications.

**Conception :** sections 7 et 8.

## Décisions

- **Pas de notification pour chaque message de discussion** : ce serait trop bruyant. La conversation se lit dans la Team.
- **Une invitation reçue** est notifiée au compte qui a cette adresse e-mail confirmée. La personne qui invite ne voit pas si ce compte existe, ce qui préserve la correction de l'étape 1.
- **Une Team archivée** devient en lecture seule pour la discussion (`team_locked`).

## Points de vigilance

1. **Personne extérieure à la Team :** elle ne lit pas les messages et ne peut pas en envoyer (`forbidden`).
2. **Message vide ou de plus de 2000 caractères :** refusé (`invalid_message`).
3. **Pas de notification à soi-même :** l'auteur d'une action n'est jamais notifié de sa propre action.
4. **Les invités sans compte** ne reçoivent aucune notification dans l'application (ils n'ont pas de compte).
5. **Marquer comme lu** ne touche que ses propres notifications.

---

### Task 1: messages et notifications dans la base

**Fichiers :**

- `supabase/migrations/<horodatage>_team_messages.sql` ;
- `supabase/tests/team_messages.sql`.

**Tables :**

- **`team_messages`** :
  - `id`, `team_id`, `author_member` (null pour un message automatique) ;
  - `kind` : `text` ou `system` ;
  - `body` (texte d'au plus 2000 caractères ; vide pour un message automatique) ;
  - `event` (type d'action de l'historique, pour un message automatique) ;
  - `expense_id` (null possible), `data` (jsonb), `created_at`.
- **`notifications`** :
  - `id`, `user_id`, `team_id`, `kind` (`approval_requested`, `expense_disputed`, `expense_validated`, `team_invitation`, `expense_corrected`) ;
  - `expense_id` (null possible), `data` (jsonb), `read_at`, `created_at`.

**Déclencheur `audit_logs_fanout` (après ajout dans `audit_logs`) :**

- **Messages automatiques** : `expense.created`, `expense.updated`, `expense.cancelled`, `expense.disputed`, `expense.status` (seulement vers `validated`), `member.joined`, `member.guest_added`, `member.left`, `member.removed`.
- **Notifications** (comptes inscrits seulement, jamais à l'auteur de l'action) :
  - `expense.created` → `approval_requested` aux validateurs inscrits qui n'ont pas encore validé ;
  - `expense.updated` → `expense_corrected` aux validateurs inscrits ;
  - `expense.disputed` → `expense_disputed` à la personne qui a saisi et au payeur ;
  - `expense.status` vers `validated` → `expense_validated` au payeur ;
  - `invitation.sent` → `team_invitation` au compte dont l'e-mail confirmé correspond.

**Fonctions RPC :**

- **`send_message(p_team uuid, p_body text) returns uuid`** : réservée aux membres actifs ; Team non archivée ; erreurs `forbidden`, `team_locked`, `invalid_message`.
- **`mark_notifications_read(p_ids uuid[]) returns void`** : `null` veut dire toutes les notifications ; seulement les siennes.

**Accès :**

- messages lisibles par `is_team_member(team_id)` ;
- notifications lisibles par `user_id = auth.uid()` ;
- aucune écriture directe ;
- temps réel activé sur les deux tables.

- [ ] **Test SQL :**
  - **Mise en place :** A crée une Team, puis invite B (B reçoit une notification `team_invitation`). B rejoint : un message automatique `member.joined` apparaît.
  - **Dépense :** A ajoute une dépense pour A et B. Message `expense.created` ; B reçoit `approval_requested`, A ne reçoit rien.
  - **Validation :** B valide, la dépense devient `validated`. Message automatique, et A (le payeur) reçoit `expense_validated`.
  - **Discussion :** B envoie « Merci ! ». Le message est visible par A, mais pas par C, qui est extérieur à la Team (0 ligne). C reçoit `forbidden` en envoyant ; un message vide donne `invalid_message`.
  - **Lecture :** B marque tout comme lu, ses notifications ont `read_at`. Celles de A ne sont pas touchées.
- [ ] **Vérification :** voir échouer le test, écrire la migration, envoyer, puis voir passer les quatre tests SQL.
- [ ] **Commit.**

### Task 2: discussion dans la Team

**Fichiers :**

- `features/team-chat/api.ts` : `useTeamMessages(teamId)`, qui lit les 100 derniers messages et se met à jour en temps réel, et `useSendMessage()` ;
- `features/team-chat/chat-section.tsx` ;
- `features/team-chat/system-text.ts` : `systemMessageText(event, data, nameOf, t)` ;
- les fichiers de traduction (section `teamChat`) ;
- l'écran de la Team, où la rubrique Discussion affiche `ChatSection`.

**Affichage :**

- mes messages en bulles à droite (couleur d'accent), ceux des autres à gauche avec le nom de l'auteur ;
- les messages automatiques centrés et discrets ; toucher un message lié à une dépense ouvre cette dépense ;
- une zone de saisie en bas avec le bouton Envoyer, désactivée si la Team est archivée.

- [ ] **Vérification :** types, Biome et compilation web. **Commit.**

### Task 3: cloche et notifications

**Fichiers :**

- `features/notifications/api.ts` : `useNotifications()` (temps réel), `useUnreadCount()` et `useMarkRead()` ;
- `app/(app)/teams/notifications.tsx` (liste) ;
- dans la liste des Teams, une cloche avec un compteur dans l'en-tête ;
- dans `(app)/_layout.tsx`, `tabBarBadge` sur l'onglet Teams ;
- les fichiers de traduction (section `notifications`).

**Comportement :**

- toucher une notification la marque comme lue et ouvre la dépense ou la Team concernée ;
- un bouton « Tout marquer comme lu ».

- [ ] **Vérification :** types, Biome et compilation web. **Commit.**
