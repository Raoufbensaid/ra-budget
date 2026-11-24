# Module Team – Conception

Date : 24 novembre 2026. Ce document s'appuie sur le cahier des charges « Module Team – Gestion collaborative des dépenses » et sur les décisions prises le même jour.

## 1. Intention

Permettre à plusieurs personnes (voyage, colocation, sortie) de partager leurs dépenses :
- chaque achat est réparti entre les seules personnes concernées ;
- chaque dépense est validée par des humains ;
- on calcule qui rembourse qui, avec le moins de virements possible ;
- la réception de l'argent est confirmée, y compris par des personnes sans compte.

À la fin, chacun doit voir en un coup d'œil :
- ce qu'il a payé ;
- ce qu'il doit ;
- ce qu'on lui doit ;
- qui doit encore valider ;
- quels remboursements restent à faire.

**Objectifs :** les 20 critères de validation du cahier des charges (section 18).

**Ce que le module ne fait pas :**
- Ra Budget n'exécute aucun paiement ;
- pas de devise autre que l'euro ;
- pas de notifications push du téléphone dans cette version, car elles demandent une version installée de l'application (voir section 9).

**Ce qui serait un échec, même si tout marche techniquement :**
- un calcul faux d'un centime ;
- une dépense validée sans accord humain ;
- une modification d'une dépense validée sans trace ;
- un membre qui voit une autre Team ;
- un lien e-mail réutilisable par quelqu'un d'autre.

## 2. Contraintes

- **Budget : 0 €.** Uniquement des outils déjà en place (Expo, Supabase gratuit, Brevo gratuit) ou gratuits et open source (Tesseract, Cloudflare Pages).
- **Architecture existante :**
  - monorepo pnpm ;
  - logique métier pure dans `packages/*`, testée avec Vitest ;
  - application Expo Router dans `apps/mobile` ;
  - base Supabase avec règles d'accès (RLS) sur toutes les tables et migrations dans `supabase/migrations`.
- **Montants** en centimes entiers partout.
- **Calculs financiers** fixes et reproductibles, sans IA.
- **Secrets** (clé Brevo, clé `service_role`) : saisis par Raouf lui-même, jamais vus par l'assistant.

## 3. Décisions métier

### Décisions de Raouf (24/11/2026)

1. **Invités sans compte : un lien e-mail pour chaque action.**
   - Un invité concerné par une dépense reçoit un lien pour la valider ou la contester.
   - Il reçoit aussi un lien pour valider le bilan final et un autre pour confirmer la réception de son argent.
2. **Budget personnel :** une dépense de Team validée compte dans le budget personnel de chaque membre inscrit, **pour sa part uniquement**. Elle apparaît dans l'onglet Bilan avec la catégorie de la dépense.
3. **Hébergement de la version web :** Cloudflare Pages, gratuit. Il est nécessaire pour que les liens e-mail ouvrent une vraie page.
4. **Liens à usage unique :**
   - chaque lien ne sert qu'une fois et expire au bout de 7 jours ;
   - après une confirmation partielle de réception, un nouveau lien est envoyé pour le reste ;
   - un lien expiré peut être renvoyé.

### Choix de l'assistant, à corriger si besoin

- **Invité sans adresse e-mail :** le créateur de la Team agit à sa place, et l'historique l'indique (« validé par A pour B »).
- **Saisie par un membre pour un autre :** tout membre inscrit peut saisir une dépense et choisir le payeur.
  - Si le payeur n'est pas celui qui saisit, le payeur doit d'abord la confirmer (étape 1) : dans l'application s'il a un compte, par lien s'il est invité.
  - Si celui qui saisit est aussi le payeur, l'enregistrement vaut confirmation de l'étape 1.
- **Validation :** une dépense est « validée » quand le payeur et tous les bénéficiaires ont accepté sa version actuelle. Les non-bénéficiaires n'ont rien à faire.
- **Refus de participer :** il met la dépense en « contestée », comme un signalement d'erreur. Le payeur ou la personne qui a saisi la corrige (en retirant ce bénéficiaire, par exemple), ou annule la dépense.
- **Correction d'une dépense :**
  - elle crée une nouvelle version, dont l'historique garde l'avant et l'après ;
  - toutes les validations sont remises à zéro, et les personnes concernées sont prévenues ;
  - une dépense validée ne se modifie qu'ainsi.
- **Qui peut corriger ou annuler :** la personne qui a saisi ou le payeur, ainsi que le créateur pour les dépenses d'invités.
  - Une dépense validée est annulée par une correction tracée, jamais supprimée.
- **Demande de clôture :**
  - possible seulement quand aucune dépense n'est en attente ou contestée ;
  - pendant la validation du bilan, on ne peut plus ajouter de dépense ;
  - une contestation du bilan rouvre la Team (statut « active ») et le bilan est marqué « remplacé ».
- **Remboursement :**
  - le débiteur déclare ce qu'il a envoyé, éventuellement en plusieurs fois ;
  - seul le créancier peut confirmer ce qu'il a reçu, dans l'application ou par lien ;
  - le créancier peut confirmer sans déclaration préalable, puisque c'est lui qui reçoit l'argent ;
  - une déclaration seule ne confirme jamais rien.
- **Fin du parcours :** la Team est « soldée » quand toutes les sommes à recevoir sont confirmées. Elle peut ensuite être archivée, et son historique reste lisible.
- **Rôles :**
  - le créateur (`owner`) ajoute ou retire des membres et des invités, et agit pour les invités sans e-mail ;
  - les membres (`member`) ajoutent des dépenses, valident et discutent ;
  - les invités (`guest`) n'ont pas de compte.
  - Un invité peut plus tard être relié à un compte s'il s'inscrit avec la même adresse e-mail.

## 4. Pistes envisagées

| Sujet | Pistes | Choix |
|---|---|---|
| Règles métier | (a) logique dans l'application et accès direct aux tables ; (b) **fonctions SQL (RPC) qui vérifient chaque transition**, tables en lecture seule pour les clients ; (c) serveur d'API séparé | **(b)** : les règles (somme des parts = total, droits, statuts, historique) sont garanties par la base, même si quelqu'un contourne l'application. Pas de serveur à héberger. |
| Lecture des tickets | (a) API d'OCR payante ; (b) **tesseract.js dans l'application** (fenêtre web cachée sur iPhone, directement sur le web) ; (c) OCR dans une fonction Supabase | **(b)** : gratuit et compatible avec Expo Go. (c) est exclu, car le temps de calcul d'une fonction gratuite est trop court. |
| E-mails | (a) envoyés depuis l'application ; (b) **file d'attente en base, puis une fonction Supabase les envoie par Brevo** | **(b)** : la clé Brevo reste côté serveur, et un e-mail n'est jamais perdu si l'application se ferme. |
| Liens pour les invités | (a) lien de connexion « magique » ; (b) **jeton personnel à usage unique, stocké sous forme d'empreinte (SHA-256), lié à une action précise** | **(b)** : pas de compte à créer, et le droit accordé se limite à une seule action. |
| Temps réel | (a) rafraîchir régulièrement ; (b) **Supabase Realtime** | **(b)** : messages et statuts mis à jour en direct, dans l'offre gratuite. |

## 5. Calculs (paquet `@ra/team`, sans base ni réseau, testé)

- **`splitEqual(total, membres)`** : divise un total à parts égales, au centime près. Les centimes restants sont attribués de façon fixe, dans l'ordre des membres. La somme est toujours égale au total.
- **`validateCustomSplit(total, parts)`** : refuse les parts négatives ou dont la somme diffère du total.
- **`computeBalances(expenses)`** : ne prend que les dépenses validées. Pour chaque membre :
  - payé = somme de ses dépenses en tant que payeur ;
  - part = somme de ses parts ;
  - solde = payé − part.
  La somme des soldes vaut toujours 0.
- **`planRepayments(balances)`** : associe à chaque étape le plus gros débiteur au plus gros créancier, avec un départage fixe.
  - Il produit au plus n − 1 virements.
  - Trouver le minimum absolu est un problème très difficile ; cette méthode est la référence courante.
- **`repaymentProgress(repayment, events)`** : renvoie les montants déclaré, confirmé et restant, et refuse une confirmation supérieure au restant.
- **Lecture des tickets** (`parseReceiptText`) : à partir du texte reconnu, des règles fixes trouvent :
  - le magasin, la date, les lignes article + prix, les quantités (« 2 x 1,20 »), les remises (lignes négatives) et le total ;
  - les écarts : la somme des lignes ne correspond pas au total.
  Le résultat est toujours affiché pour correction.
- **Tests :** les exemples du cahier des charges (12 € pour A et B ; 300/180/120 €), les arrondis (10 € pour 3), les parts personnalisées, les dépenses touchant une partie du groupe et les remboursements partiels.

## 6. Données (Supabase)

Toutes les tables ont la RLS activée. Les lectures sont permises aux membres de la Team, via une fonction `is_team_member(team_id)`. Les écritures passent uniquement par des fonctions RPC, à part l'envoi de messages, qui se fait par ajout simple avec contrôle.

| Table | Rôle |
|---|---|
| `teams` | nom, icône (emoji), créateur, statut : `active` (active), `closing` (bilan en validation), `settling` (remboursements en cours), `settled` (soldée), `archived` (archivée) |
| `team_members` | participant : `user_id` (vide pour un invité), nom affiché, e-mail facultatif, rôle `owner`/`member`/`guest`, statut `invited`/`active`/`removed` |
| `team_invitations` | invitation d'une personne avec compte : e-mail, invité par, empreinte du jeton, expiration, acceptation |
| `team_messages` | conversation : auteur (membre), texte, type `text`/`system`, lien facultatif vers une dépense |
| `receipts` | ticket : photo (stockage privé `receipts/<team>/<id>.jpg`), texte reconnu, état de la lecture, ajouté par |
| `expenses` | dépense : saisie par (membre), payée par (membre), magasin, date, total, catégorie, mode de partage `equal`/`custom`, statut `pending`/`validated`/`disputed`/`cancelled`, numéro de version |
| `receipt_items` | articles de la dépense : libellé, quantité, prix unitaire, total, catégorie |
| `expense_beneficiaries` | part de chaque bénéficiaire, en centimes (somme = total, vérifiée par la RPC) |
| `expense_approvals` | acceptation ou refus d'un membre pour une version donnée : auteur réel, via `app`/`email`/`owner`, date |
| `expense_disputes` | contestation : membre, motif, état ouverte ou résolue, résolution |
| `team_settlements` | bilan : demandé par, statut `pending`/`approved`/`superseded`, copie figée des dépenses incluses |
| `settlement_balances` | payé, part et solde de chaque membre dans le bilan |
| `settlement_approvals` | validation du bilan par chaque participant (même règle que pour les dépenses) |
| `repayments` | virement à faire : de, vers, montant |
| `repayment_events` | déclaration du débiteur ou confirmation du créancier : montant, auteur, via, date |
| `action_tokens` | liens e-mail : empreinte, objet (`approve_expense`, `approve_settlement`, `confirm_repayment`, `accept_invitation`), membre, cible, expiration, utilisation |
| `notifications` | notifications dans l'application : destinataire (compte), Team, type, données, lu le |
| `email_outbox` | e-mails à envoyer (lisibles par le serveur seulement) ; le lien en clair est effacé après l'envoi |
| `audit_logs` | historique : auteur (compte et/ou membre), action, cible, données avant/après, date. Ajout seulement : ni modification ni suppression, même par les fonctions. |

Les notions demandées à la section 15 sont bien distinctes :
- **saisi par** : `expenses.entered_by` ;
- **payé par** : `expenses.paid_by` ;
- **bénéficiaires** : `expense_beneficiaries` ;
- **validateurs** : `expense_approvals.member_id` et `acted_by` ;
- **destinataire d'un remboursement** : `repayments.to_member`.

**Photos des tickets :** espace de stockage privé, dont les règles limitent la lecture et l'ajout aux membres de la Team.

**Pages publiques des liens :** deux fonctions RPC accessibles sans compte.
- `token_view(token)` montre uniquement ce que l'action concerne.
- `token_act(token, …)` vérifie l'empreinte, l'expiration et l'usage unique, enregistre l'action avec « via e-mail » et invalide le jeton.

**Données personnelles (RGPD) :**
- l'e-mail d'un invité n'est visible que par les membres de sa Team ;
- le créateur peut l'effacer ;
- la suppression d'une Team efface ses photos et ses invités.

## 7. E-mails et notifications

- **Dans l'application :** une table `notifications`, une cloche avec un compteur, et une mise à jour en temps réel.
- **E-mails :**
  - les fonctions RPC ajoutent les e-mails à `email_outbox` ;
  - un déclencheur de la base (`pg_net`) appelle la fonction Supabase `send-emails`, qui envoie par l'API Brevo (300 par jour gratuits) avec la clé saisie par Raouf ;
  - modèles en français, dans le style de l'e-mail de code existant.
- **Événements notifiés** : les 12 de la section 12 du cahier des charges.
  - Les membres inscrits sont notifiés dans l'application, et aussi par e-mail pour l'invitation, la validation demandée, le bilan et les remboursements.
  - Les invités sont toujours notifiés par e-mail, avec le lien d'action.

## 8. Interface

**Nouvel onglet « Teams »** (5 onglets en tout).

- **Liste des Teams :** une carte par Team avec son icône, son nom, son statut en pastille, son solde personnel (« On te doit 42 € » ou « Tu dois 18 € ») et un badge pour les actions en attente.
- **Créer une Team :** nom et icône, puis ajout des participants (un e-mail pour une personne avec compte, ou un nom et un e-mail facultatif pour un invité).
- **Écran d'une Team :** l'en-tête montre l'icône, le nom, le statut et les membres. Trois onglets internes :
  - **Discussion :** conversation en temps réel. Les messages automatiques (« B a ajouté Courses 12 € ») ouvrent la dépense concernée.
  - **Dépenses :**
    - liste avec payeur, bénéficiaires, montant, date et statut (attente, validée, contestée) ;
    - bouton « Ajouter », à partir d'une photo, de la galerie ou d'une saisie manuelle ;
    - filtre par période.
  - **Comptes :**
    - tableau de bord : total, payé par chacun, catégories, nombre de tickets, dépenses par statut, parts, à recevoir et à rembourser ;
    - suivi des remboursements ;
    - bouton « Demander la clôture ».
- **Ajouter une dépense :**
  - lecture du ticket ;
  - correction des articles et du total ;
  - « Qui a payé ? » ;
  - « Qui participe à cet achat ? » : cases à cocher, et partage égal ou personnalisé avec le reste affiché en direct ;
  - confirmation.
- **Détail d'une dépense :**
  - photo du ticket, articles, parts de chacun ;
  - état de chaque validation (« A a validé », « C attend ») ;
  - boutons Accepter, Refuser, Signaler une erreur ;
  - historique des versions.
- **Bilan :** soldes, virements proposés, validation de chacun, puis remboursements avec « J'ai envoyé… » et « J'ai reçu… » (montant modifiable pour un paiement partiel).
- **Écran final :** « Tout est réglé ! Votre Team est soldée. »
- **Pages publiques** (sans connexion) :
  - `/t/<jeton>` : récapitulatif et bouton d'action ;
  - `/invite/<jeton>` : rejoindre une Team après connexion.
- **Style :** même identité que le reste de l'application (thèmes, jetons, cartes, pastilles). Chaque statut a une couleur **et** une icône et un texte.

## 9. Risques

- **Qualité de lecture des tickets :** Tesseract est moyen sur les tickets froissés ou peu contrastés. L'écran de correction est donc central, et la saisie manuelle reste toujours possible.
- **Notifications push :** elles ne sont pas fiables dans Expo Go. Il y aura donc des notifications dans l'application et par e-mail, et le push viendra avec une version installée (gratuite, compte Expo).
- **Quotas gratuits :** Brevo envoie 300 e-mails par jour, Supabase stocke 1 Go et permet 200 connexions en temps réel. C'est suffisant au début ; il faudra le signaler au passage à l'échelle.
- **Mise en ligne web :** Cloudflare Pages demande un compte créé par Raouf. Tant que ce n'est pas fait, les liens ne marchent qu'en local.
- **Taille du module :** il est livré par étapes, chacune testée avant la suivante.

## 10. Étapes de livraison

1. **Socle :**
   - paquet `@ra/team` (calculs et tests) ;
   - tables, règles d'accès et historique ;
   - créer une Team, ajouter des invités et des membres ;
   - onglet Teams.
2. **Dépenses :** saisie manuelle, payeur et saisie distincts, bénéficiaires, partage égal ou personnalisé, liste et détail.
3. **Validations :** validation, refus, contestation, corrections en versions, remise à zéro des validations, historique.
4. **Discussion et notifications dans l'application :** temps réel, messages automatiques, cloche.
5. **Tickets :** photo ou galerie, stockage privé, Tesseract, lecture du texte, écran de correction.
6. **E-mails et liens :**
   - invitations des personnes avec compte ;
   - fonction d'envoi Brevo ;
   - jetons et pages publiques pour les invités ;
   - mise en ligne sur Cloudflare Pages.
7. **Bilan et remboursements :** demande de clôture, bilan figé, validation de tous, virements, déclarations, confirmations partielles, Team soldée puis archivée.
8. **Finitions :**
   - parts de Team dans le budget personnel ;
   - tableau de bord de la Team par période ;
   - vérification des 20 scénarios du cahier des charges ;
   - revue de sécurité.

## 11. Laissé à la personne qui développe

Les noms exacts des colonnes et des fonctions, le découpage des écrans en composants, le texte des messages et la mise en page fine. Tout cela suit les conventions existantes du projet.
