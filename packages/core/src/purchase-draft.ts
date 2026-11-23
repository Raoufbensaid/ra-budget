import { z } from "zod";
import { CATEGORY_IDS } from "./categories";

/**
 * BROUILLON D'ACHAT : format commun produit par TOUTES les méthodes d'ajout
 * (ticket OCR, photo, code-barres, voix, texte, saisie manuelle, PDF).
 * Il passe ensuite par la même chaîne : normalisation → catégorisation →
 * validation par l'utilisateur → enregistrement.
 *
 * Règle : tous les montants sont en CENTIMES (entiers). Jamais de flottants
 * pour de l'argent (0.1 + 0.2 !== 0.3).
 */

export const PURCHASE_SOURCES = [
  "receipt_ocr",
  "photo_items",
  "barcode",
  "voice",
  "text",
  "manual",
  "pdf",
] as const;

/** D'où vient le prix : permet au coach de pondérer la fiabilité des données. */
export const PRICE_SOURCES = ["receipt", "declared", "estimated", "barcode_db"] as const;

export const UNITS = ["piece", "kg", "g", "l", "cl", "ml"] as const;

export const DRAFT_ISSUE_CODES = [
  /** Aucun prix donné pour l'article. */
  "MISSING_PRICE",
  /** Impossible de savoir si le prix est unitaire ou total. */
  "AMBIGUOUS_PRICE_SCOPE",
  /** Produit non reconnu par le dictionnaire. */
  "UNKNOWN_PRODUCT",
  /** La somme des articles ne correspond pas au total payé. */
  "TOTAL_MISMATCH",
  /** Extraction peu sûre, à faire confirmer. */
  "LOW_CONFIDENCE",
] as const;

export const centsSchema = z.number().int().nonnegative();

export const draftItemSchema = z.object({
  /** Libellé tel qu'exprimé ou lu (« baguette », « BQT LAIT 1/2 ECR »). */
  rawLabel: z.string().min(1),
  /** Nom normalisé du produit (« baguette », « lait demi-écrémé »), si reconnu. */
  name: z.string().min(1).nullable(),
  quantity: z.number().positive(),
  unit: z.enum(UNITS),
  /** Prix pour 1 unité (1 pièce, 1 kg, 1 l…), en centimes. */
  unitPriceCents: centsSchema.nullable(),
  /** Prix total de la ligne, en centimes. */
  totalPriceCents: centsSchema.nullable(),
  priceSource: z.enum(PRICE_SOURCES),
  categoryId: z.enum(CATEGORY_IDS).nullable(),
  /** Confiance de l'extraction, entre 0 et 1. */
  confidence: z.number().min(0).max(1),
});

export const draftIssueSchema = z.object({
  code: z.enum(DRAFT_ISSUE_CODES),
  /** Index de l'article concerné, absent si le problème porte sur tout l'achat. */
  itemIndex: z.number().int().nonnegative().optional(),
});

export const purchaseDraftSchema = z.object({
  source: z.enum(PURCHASE_SOURCES),
  merchant: z.string().min(1).nullable(),
  /** Date d'achat au format AAAA-MM-JJ. */
  date: z.iso.date().nullable(),
  currency: z.literal("EUR"),
  /** Total réellement payé, en centimes, s'il est connu. */
  totalPaidCents: centsSchema.nullable(),
  items: z.array(draftItemSchema),
  issues: z.array(draftIssueSchema),
});

export type PurchaseSource = (typeof PURCHASE_SOURCES)[number];
export type PriceSource = (typeof PRICE_SOURCES)[number];
export type Unit = (typeof UNITS)[number];
export type DraftIssueCode = (typeof DRAFT_ISSUE_CODES)[number];
export type DraftItem = z.infer<typeof draftItemSchema>;
export type DraftIssue = z.infer<typeof draftIssueSchema>;
export type PurchaseDraft = z.infer<typeof purchaseDraftSchema>;
