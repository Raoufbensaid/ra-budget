import type { CategoryId, Unit } from "@ra/core";

export interface InsightItem {
  rawLabel: string;
  name: string | null;
  quantity: number;
  unit: Unit;
  totalPriceCents: number | null;
  categoryId: CategoryId | null;
}

export interface InsightPurchase {
  id: string;
  merchant: string | null;
  purchasedOn: string;
  totalPaidCents: number | null;
  items: InsightItem[];
}

/** Catégorie d'un article, ou « non classé » s'il n'en a pas. */
export type CategoryKey = CategoryId | "unclassified";

export interface AllocatedItem {
  purchaseId: string;
  purchasedOn: string;
  item: InsightItem;
  category: CategoryKey;
  /** Part de la dépense attribuée à cet article, en centimes. */
  cents: number;
}

/** Total d'une dépense : total payé s'il est connu, sinon somme des articles. */
export function purchaseTotal(p: InsightPurchase): number {
  return p.totalPaidCents ?? p.items.reduce((s, i) => s + (i.totalPriceCents ?? 0), 0);
}

/**
 * Répartit `total` centimes proportionnellement aux `weights`, en entiers, sans
 * perdre un centime (méthode du plus fort reste).
 */
export function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (sum <= 0)
    return distribute(
      total,
      weights.map(() => 1),
    );
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let left = total - parts.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left--;
  }
  return parts;
}

/**
 * Attribue le total d'une dépense à ses articles, pour que la somme par
 * catégorie retombe exactement sur ce qui a été payé :
 * - sans écart : chaque article garde son prix ;
 * - total payé plus élevé et articles sans prix : l'écart est partagé entre
 *   les articles sans prix ;
 * - sinon (remise, arrondi…) : l'écart est réparti au prorata des prix.
 */
export function allocatePurchase(p: InsightPurchase): AllocatedItem[] {
  const total = purchaseTotal(p);
  const priced = p.items.map((i) => i.totalPriceCents ?? 0);
  const known = priced.reduce((s, x) => s + x, 0);
  const unpriced = p.items
    .map((i, index) => (i.totalPriceCents === null ? index : -1))
    .filter((i) => i >= 0);

  let cents: number[];
  if (p.items.length === 0) {
    cents = [];
  } else if (total === known) {
    cents = priced;
  } else if (total > known && unpriced.length > 0) {
    const extra = distribute(
      total - known,
      unpriced.map(() => 1),
    );
    cents = [...priced];
    unpriced.forEach((index, k) => {
      cents[index] = extra[k] ?? 0;
    });
  } else {
    cents = distribute(total, known > 0 ? priced : p.items.map(() => 1));
  }

  return p.items.map((item, index) => ({
    purchaseId: p.id,
    purchasedOn: p.purchasedOn,
    item,
    category: item.categoryId ?? "unclassified",
    cents: cents[index] ?? 0,
  }));
}
