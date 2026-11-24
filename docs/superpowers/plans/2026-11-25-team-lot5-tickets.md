# Module Team, étape 5 (tickets) : plan de mise en œuvre

> **Pour les agents :** sous-compétence requise : superpowers:executing-plans. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :**

- photographier un ticket ou le choisir dans la galerie ;
- le lire automatiquement : magasin, date, articles, quantités, prix, remises, total ;
- afficher le résultat dans un formulaire où tout se corrige ;
- enregistrer la dépense avec la photo, conservée dans un espace privé réservé aux membres de la Team.

**Architecture :**

- **Reconnaissance du texte : Tesseract** (`tesseract.js` 5.1.1, gratuit, open source), chargé depuis le CDN jsDelivr à la version exacte, avec la langue `fra`. Le texte est lu sur l'appareil, sans serveur :
  - sur iPhone, dans une `WebView` cachée (`react-native-webview`, inclus dans Expo Go) ;
  - sur le web, directement dans la page.
- **Analyse du texte :** des règles fixes dans `@ra/parser` (`parseReceiptText`), testées.
- **Stockage des photos :** le stockage Supabase `receipts` est privé. Le chemin est `<team_id>/<uuid>.jpg`. Les membres de la Team sont les seuls à pouvoir lire et déposer.
- **Base :** la table `receipts` relie la photo à la Team. `create_expense` accepte `receipt_id`.
- **Validation humaine :** rien n'est validé automatiquement. Le formulaire pré-rempli doit être enregistré par la personne, puis validé par les participants comme à l'étape 3.

**Décision :** pas de notification « Analyse terminée ». La lecture se fait sur l'appareil, en quelques secondes, sous les yeux de la personne.

## Points de vigilance

1. **Ligne de quantité** du type `2 x 1,20` suivie de `2,40` : un seul article, de quantité 2, avec un prix unitaire de 120 et un total de 240.
2. **Lignes à ignorer :** TVA, CB, CARTE, RENDU, ESPÈCES, SOUS-TOTAL, numéros de téléphone ou SIRET. Ce ne sont pas des articles.
3. **Remise** (« REMISE », « PROMO », « BON ») : un montant négatif, même si le signe « - » a été mal lu.
4. **Somme des articles différente du total lu :** un avertissement apparaît, et un bouton permet de reprendre la somme. Rien n'est corrigé en silence.
5. **Photo d'une autre Team :** impossible à lire ou à rattacher. Il faut être membre de la Team du chemin, sinon `forbidden`.

---

### Task 1: `parseReceiptText` dans `@ra/parser`

**Fichiers :** créer `packages/parser/src/receipt.ts`, l'exporter dans `packages/parser/src/index.ts`, et ajouter les tests dans `packages/parser/test/receipt.test.ts`.

```ts
export interface ReceiptLine { label: string; quantity: number; unitPriceCents: number | null; totalCents: number }
export interface ParsedReceipt { merchant: string | null; date: string | null /* AAAA-MM-JJ */;
  items: ReceiptLine[]; totalCents: number | null; itemsSumCents: number; mismatch: boolean }
parseReceiptText(text: string): ParsedReceipt
```

- [ ] **Tests :**
  - **Ticket type** (CARREFOUR, `12/11/2026`, BANANES 3,00, `2 x 1,20` LAIT 2,40, PAIN 1,50, GATEAUX 4,00, TOTAL 10,90) : 4 articles, le lait en quantité 2 avec un prix unitaire de 120 et un total de 240, un total de 1090, pas d'écart, la date `2026-11-12` et le magasin « Carrefour ».
  - **Remise :** « REMISE FIDELITE 1,00 » donne -100.
  - **Lignes TVA, CB et RENDU :** ignorées.
  - **Total absent :** `totalCents` vaut null.
  - **Écart entre la somme et le total :** `mismatch` vaut true.
  - **Date sur deux chiffres :** `05-03-26` donne `2026-03-05`.
- [ ] **Vérification :** les tests échouent, on implémente, puis ils passent.
- [ ] **Commit.**

### Task 2: stockage et table des tickets

**Fichiers :**

- `supabase/migrations/<horodatage>_team_receipts.sql` ;
- `supabase/tests/team_receipts.sql`.

- **Espace de stockage :**
  - `storage.buckets` `receipts` : privé, 5 Mo au plus, types `image/jpeg`, `image/png` et `image/webp` ;
  - règles sur `storage.objects` (`bucket_id = 'receipts'`) : lecture et dépôt seulement si `is_team_member(((storage.foldername(name))[1])::uuid)` ; ni modification ni suppression par les clients.
- **Table `receipts` :**
  - `id`, `team_id`, `uploaded_by` (membre), `storage_path` (unique), `ocr_text` (au plus 20 000 caractères), `created_at` ;
  - lecture par les membres de la Team ;
  - aucune écriture directe.
- **Fonction `create_receipt(p_team uuid, p_path text, p_ocr_text text) returns uuid`** :
  - réservée à un membre actif ;
  - le chemin doit commencer par `<p_team>/` et finir par `.jpg`, `.png` ou `.webp` ;
  - erreurs : `forbidden`, `invalid_receipt`.
- **`create_expense`** : un `receipt_id` facultatif dans le brouillon. Il doit appartenir à la même Team, sinon `invalid_receipt`.
- **`expenses.receipt_id`** : clé étrangère vers `receipts`, avec `on delete set null`.

- [ ] **Test SQL :**
  - A crée un ticket et une dépense avec `receipt_id` : le lien est bien enregistré ;
  - un chemin d'une autre Team donne `invalid_receipt` ;
  - C, extérieur, ne voit aucun ticket et `create_receipt` lui répond `forbidden` ;
  - un `receipt_id` d'une autre Team dans `create_expense` donne `invalid_receipt`.
- [ ] **Vérification :** voir échouer le test, écrire la migration, envoyer, puis voir passer tous les tests SQL.
- [ ] **Commit.**

### Task 3: photo, lecture et correction dans l'application

**Fichiers :**

- dépendances : `expo-image-picker` et `react-native-webview`, installées avec `expo install` ;
- créer :
  - `features/receipts/ocr.tsx` : `useOcr()` renvoie `{ recognize(dataUrl): Promise<string>, element }`. `element` est la WebView cachée à placer dans l'écran ;
  - `features/receipts/ocr.web.tsx` : charge le script de Tesseract dans la page ;
  - `features/receipts/api.ts` : `uploadReceipt(teamId, base64, mime)` renvoie le chemin, `createReceipt()`, `useReceiptUrl(path)` (URL signée valable 1 h) ;
  - `features/receipts/scan-card.tsx` : boutons « Prendre une photo » et « Choisir dans la galerie », état « Lecture du ticket… », aperçu de la photo ;
- modifier :
  - `features/team-expenses/expense-form.tsx` :
    - propriété `prefill` (titre, date, total, articles) ;
    - éditeur d'articles (libellé, quantité, prix) avec ajout et suppression ;
    - avertissement « Les articles font X, le total Y », avec un bouton « Utiliser la somme des articles » ;
  - `app/(app)/teams/[id]/expenses/new.tsx` :
    - la carte de scan en haut, puis le formulaire pré-rempli ;
    - à l'enregistrement, dans l'ordre : envoi de la photo, `create_receipt`, puis `create_expense` avec `receipt_id` ;
  - détail de la dépense : affichage de la photo du ticket si elle existe ;
  - fichiers de traduction (section `receipts`).

- [ ] **Vérification :** types, Biome et compilation web sans erreur. **Commit.**
