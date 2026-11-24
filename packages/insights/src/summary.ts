import {
  type AllocatedItem,
  allocatePurchase,
  type CategoryKey,
  type InsightPurchase,
  purchaseTotal,
} from "./allocate";
import { dayOf, daysInMonth, elapsedDays, type MonthKey, monthOf, shiftMonth } from "./months";

export interface CategoryTotal {
  category: CategoryKey;
  cents: number;
  /** Part du total du mois, entre 0 et 1. */
  share: number;
  /** Articles de cette catégorie, du plus cher au moins cher. */
  items: AllocatedItem[];
}

export interface TopProduct {
  /** Nom normalisé du produit (sert de clé). */
  key: string;
  label: string;
  cents: number;
  /** Nombre d'achats de ce produit dans le mois. */
  times: number;
}

export interface MonthSummary {
  month: MonthKey;
  totalCents: number;
  purchaseCount: number;
  byCategory: CategoryTotal[];
  topProducts: TopProduct[];
  /** Dépenses jour par jour (index 0 = le 1er du mois). */
  daily: number[];
  /** Jours écoulés pris en compte (tout le mois s'il est terminé). */
  elapsedDays: number;
  /** Moyenne par jour écoulé, en centimes. */
  dailyAverageCents: number;
  /** Estimation de fin de mois au rythme actuel ; null si le mois est fini. */
  projectionCents: number | null;
}

function inMonth(purchases: InsightPurchase[], month: MonthKey): InsightPurchase[] {
  return purchases.filter((p) => monthOf(p.purchasedOn) === month);
}

function productKey(item: AllocatedItem["item"]): string {
  return (item.name ?? item.rawLabel).trim().toLocaleLowerCase("fr");
}

export function summarizeMonth(
  purchases: InsightPurchase[],
  month: MonthKey,
  today: string,
): MonthSummary {
  const list = inMonth(purchases, month);
  const allocated = list.flatMap(allocatePurchase);
  const totalCents = list.reduce((s, p) => s + purchaseTotal(p), 0);

  const byKey = new Map<CategoryKey, AllocatedItem[]>();
  for (const a of allocated) byKey.set(a.category, [...(byKey.get(a.category) ?? []), a]);
  // Dépenses sans article (cas rare) : comptées comme « non classé ».
  const orphan = list.filter((p) => p.items.length === 0).reduce((s, p) => s + purchaseTotal(p), 0);

  const byCategory: CategoryTotal[] = [...byKey.entries()]
    .map(([category, items]) => {
      const cents =
        items.reduce((s, a) => s + a.cents, 0) + (category === "unclassified" ? orphan : 0);
      return {
        category,
        cents,
        share: totalCents > 0 ? cents / totalCents : 0,
        items: [...items].sort((a, b) => b.cents - a.cents),
      };
    })
    .filter((c) => c.cents > 0);
  if (orphan > 0 && !byKey.has("unclassified")) {
    byCategory.push({
      category: "unclassified",
      cents: orphan,
      share: totalCents > 0 ? orphan / totalCents : 0,
      items: [],
    });
  }
  byCategory.sort((a, b) => b.cents - a.cents);

  const products = new Map<string, TopProduct>();
  for (const a of allocated) {
    if (a.cents <= 0) continue;
    const key = productKey(a.item);
    const prev = products.get(key);
    products.set(key, {
      key,
      label: a.item.name ?? a.item.rawLabel,
      cents: (prev?.cents ?? 0) + a.cents,
      times: (prev?.times ?? 0) + 1,
    });
  }
  const topProducts = [...products.values()]
    .sort((a, b) => b.cents - a.cents || b.times - a.times)
    .slice(0, 5);

  const daily = Array.from({ length: daysInMonth(month) }, () => 0);
  for (const p of list) {
    const d = dayOf(p.purchasedOn) - 1;
    daily[d] = (daily[d] ?? 0) + purchaseTotal(p);
  }

  const elapsed = elapsedDays(month, today);
  const isCurrent = monthOf(today) === month;
  return {
    month,
    totalCents,
    purchaseCount: list.length,
    byCategory,
    topProducts,
    daily,
    elapsedDays: elapsed,
    dailyAverageCents: elapsed > 0 ? Math.round(totalCents / elapsed) : 0,
    projectionCents:
      isCurrent && elapsed > 0 ? Math.round((totalCents / elapsed) * daysInMonth(month)) : null,
  };
}

export interface Comparison {
  currentCents: number;
  previousCents: number;
  /** Écart en centimes (positif = plus de dépenses que le mois précédent). */
  deltaCents: number;
  /** Écart relatif, ou null si le mois précédent est à zéro. */
  ratio: number | null;
  /** Vrai si on compare à la même date du mois précédent (mois en cours). */
  sameDay: boolean;
}

/**
 * Compare un mois au précédent. Pour le mois en cours, on compare à la même
 * date du mois précédent : sinon le mois en cours paraîtrait toujours moins cher.
 */
export function compareToPrevious(
  purchases: InsightPurchase[],
  month: MonthKey,
  today: string,
): Comparison {
  const previous = shiftMonth(month, -1);
  const sameDay = monthOf(today) === month;
  const limit = sameDay ? Math.min(dayOf(today), daysInMonth(previous)) : 31;
  const total = (list: InsightPurchase[]) => list.reduce((s, p) => s + purchaseTotal(p), 0);
  const currentCents = total(inMonth(purchases, month));
  const previousCents = total(
    inMonth(purchases, previous).filter((p) => dayOf(p.purchasedOn) <= limit),
  );
  const deltaCents = currentCents - previousCents;
  return {
    currentCents,
    previousCents,
    deltaCents,
    ratio: previousCents > 0 ? deltaCents / previousCents : null,
    sameDay,
  };
}

export interface MonthTotal {
  month: MonthKey;
  cents: number;
}

/** Totaux des `count` mois qui finissent par `lastMonth`, du plus ancien au plus récent. */
export function monthlyTotals(
  purchases: InsightPurchase[],
  lastMonth: MonthKey,
  count = 6,
): MonthTotal[] {
  return Array.from({ length: count }, (_, i) => {
    const month = shiftMonth(lastMonth, i - count + 1);
    return {
      month,
      cents: inMonth(purchases, month).reduce((s, p) => s + purchaseTotal(p), 0),
    };
  });
}
