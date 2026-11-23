/**
 * Panier de la conversation : articles en cours de saisie, prix groupés,
 * magasin, date et total déclaré. Toutes les fonctions sont pures.
 */
import type { CategoryId, DraftIssue, PurchaseDraft, PurchaseSource } from "@ra/core";
import { type ParsedItem, type PriceScope, priceQuantity, toKey } from "@ra/parser";

export interface CartItem extends ParsedItem {
  id: string;
  /** Prix donné sans savoir s'il est unitaire ou total : à faire préciser. */
  ambiguous: boolean;
  /** Article payé avec d'autres d'un seul prix (« … pour 3,40 »). */
  groupId: string | null;
}

/** Prix global de plusieurs articles. */
export interface PriceGroup {
  id: string;
  cents: number;
}

export interface Cart {
  items: CartItem[];
  groups: PriceGroup[];
  merchant: string | null;
  /** AAAA-MM-JJ, null = aujourd'hui. */
  date: string | null;
  /** Total annoncé par l'utilisateur (« j'ai payé 23,45 »). */
  declaredTotalCents: number | null;
}

export const EMPTY_CART: Cart = {
  items: [],
  groups: [],
  merchant: null,
  date: null,
  declaredTotalCents: null,
};

export function cloneCart(cart: Cart): Cart {
  return {
    ...cart,
    items: cart.items.map((i) => ({ ...i })),
    groups: cart.groups.map((g) => ({ ...g })),
  };
}

/** L'article a-t-il besoin d'un prix ? */
export function needsPrice(item: CartItem): boolean {
  return item.groupId === null && item.totalPriceCents === null;
}

/** Prix unitaire déduit du total, seulement si la division tombe juste au centime. */
function deriveUnitPrice(totalCents: number, qty: number): number | null {
  if (qty <= 0) return null;
  const unit = Math.round(totalCents / qty);
  return unit * qty === totalCents ? unit : null;
}

/**
 * Applique un prix à un article. Sans portée explicite : quantité 1 → total ;
 * sinon le prix est gardé comme total mais marqué ambigu (l'assistant demandera).
 */
export function applyPrice(item: CartItem, cents: number, scope: PriceScope | null): CartItem {
  const qty = priceQuantity(item.quantity, item.unit);
  const effective: PriceScope | "ambiguous" = scope ?? (qty === 1 ? "total" : "ambiguous");
  if (effective === "unit") {
    return {
      ...item,
      unitPriceCents: cents,
      totalPriceCents: Math.round(qty * cents),
      ambiguous: false,
      groupId: null,
    };
  }
  return {
    ...item,
    unitPriceCents: deriveUnitPrice(cents, qty),
    totalPriceCents: cents,
    ambiguous: effective === "ambiguous",
    groupId: null,
  };
}

/** Lève l'ambiguïté : le prix déjà saisi était unitaire ou total. */
export function resolveScope(item: CartItem, scope: PriceScope): CartItem {
  if (item.totalPriceCents === null) return item;
  return applyPrice(item, item.totalPriceCents, scope);
}

/** Nouvelle quantité : on garde le prix unitaire s'il est connu, sinon le total. */
export function applyQuantity(item: CartItem, quantity: number): CartItem {
  const updated = { ...item, quantity };
  const qty = priceQuantity(quantity, item.unit);
  if (item.unitPriceCents !== null && !item.ambiguous) {
    updated.totalPriceCents = Math.round(qty * item.unitPriceCents);
  } else if (item.totalPriceCents !== null) {
    updated.unitPriceCents = deriveUnitPrice(item.totalPriceCents, qty);
  }
  return updated;
}

export function applyCategory(item: CartItem, categoryId: CategoryId): CartItem {
  return { ...item, categoryId, confidence: Math.max(item.confidence, 0.9) };
}

function singular(word: string): string {
  return word.length > 3 ? word.replace(/[sx]$/, "") : word;
}

function nameKey(s: string): string {
  return toKey(s).split(" ").map(singular).join(" ");
}

/** Dernier article qui correspond au nom visé (« tomates » → « tomate »). */
export function findItem(cart: Cart, target: string): CartItem | null {
  const t = nameKey(target);
  if (!t) return null;
  const candidates = [...cart.items].reverse();
  const label = (i: CartItem) => nameKey(i.name ?? i.rawLabel);
  return (
    candidates.find((i) => label(i) === t) ??
    candidates.find((i) => label(i).startsWith(`${t} `) || label(i).endsWith(` ${t}`)) ??
    candidates.find((i) => label(i).includes(t) || t.includes(label(i))) ??
    null
  );
}

export interface CartTotals {
  /** Somme des articles et des prix groupés connus. */
  knownCents: number;
  /** Tous les prix sont connus et sans ambiguïté. */
  complete: boolean;
  /** Total annoncé différent de la somme des articles. */
  mismatch: boolean;
}

export function cartTotals(cart: Cart): CartTotals {
  const items = cart.items.filter((i) => i.groupId === null);
  const usedGroups = cart.groups.filter((g) => cart.items.some((i) => i.groupId === g.id));
  const knownCents =
    items.reduce((sum, i) => sum + (i.totalPriceCents ?? 0), 0) +
    usedGroups.reduce((sum, g) => sum + g.cents, 0);
  const complete = cart.items.length > 0 && cart.items.every((i) => !needsPrice(i) && !i.ambiguous);
  const mismatch =
    complete && cart.declaredTotalCents !== null && cart.declaredTotalCents !== knownCents;
  return { knownCents, complete, mismatch };
}

/** Le panier peut être validé : au moins un article, tous les prix connus. */
export function canValidate(cart: Cart): boolean {
  return cartTotals(cart).complete;
}

export interface DraftOptions {
  source: Extract<PurchaseSource, "voice" | "text">;
  /** Date du jour AAAA-MM-JJ, utilisée si aucune date n'a été dite. */
  today: string;
}

/** Produit le brouillon d'achat commun à toutes les méthodes d'ajout. */
export function toPurchaseDraft(cart: Cart, options: DraftOptions): PurchaseDraft {
  const totals = cartTotals(cart);
  const issues: DraftIssue[] = [];
  cart.items.forEach((item, itemIndex) => {
    if (needsPrice(item)) issues.push({ code: "MISSING_PRICE", itemIndex });
    if (item.ambiguous) issues.push({ code: "AMBIGUOUS_PRICE_SCOPE", itemIndex });
    if (item.categoryId === null) issues.push({ code: "UNKNOWN_PRODUCT", itemIndex });
  });
  if (totals.mismatch) issues.push({ code: "TOTAL_MISMATCH" });

  return {
    source: options.source,
    merchant: cart.merchant,
    date: cart.date ?? options.today,
    currency: "EUR",
    totalPaidCents: cart.declaredTotalCents ?? (totals.complete ? totals.knownCents : null),
    items: cart.items.map((i) => ({
      rawLabel: i.rawLabel,
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      unitPriceCents: i.unitPriceCents,
      totalPriceCents: i.totalPriceCents,
      priceSource: "declared",
      categoryId: i.categoryId,
      confidence: i.confidence,
    })),
    issues,
  };
}
