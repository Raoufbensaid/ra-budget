/**
 * Réponse aux commentaires de l'utilisateur : on compare le prix payé au prix
 * moyen indicatif du produit, quand il est connu.
 */
import { priceQuantity, type ReferencePrice, type Remark, referencePrice } from "@ra/parser";
import type { CartItem } from "./cart";

export interface PriceComparison {
  referenceCents: number;
  per: ReferencePrice["per"];
  /** Prix payé ramené à la même unité que la référence. */
  paidCents: number;
  level: "above" | "normal" | "below";
}

/** Prix payé comparé au prix moyen, ou null si on ne peut pas comparer. */
export function comparePrice(item: CartItem): PriceComparison | null {
  const ref = referencePrice(item.name);
  if (!ref || item.ambiguous || item.groupId !== null) return null;

  let paid: number | null = null;
  if (ref.per === "piece" && item.unit === "piece") {
    paid = item.unitPriceCents ?? (item.quantity === 1 ? item.totalPriceCents : null);
  } else if (ref.per === "kg" && (item.unit === "kg" || item.unit === "g")) {
    paid = item.unitPriceCents;
  } else if (ref.per === "l" && (item.unit === "l" || item.unit === "cl" || item.unit === "ml")) {
    paid = item.unitPriceCents;
  }
  if ((paid === null || paid === 0) && item.totalPriceCents !== null && ref.per !== "piece") {
    const qty = priceQuantity(item.quantity, item.unit);
    paid = qty > 0 && item.unit !== "piece" ? Math.round(item.totalPriceCents / qty) : null;
  }
  if (paid === null || paid <= 0) return null;

  const ratio = paid / ref.cents;
  const level = ratio >= 1.2 ? "above" : ratio <= 0.85 ? "below" : "normal";
  return { referenceCents: ref.cents, per: ref.per, paidCents: paid, level };
}

/** Article visé par le commentaire : le plus cher (ou le moins cher) par rapport à la moyenne. */
export function remarkTarget(items: CartItem[], remark: Remark): CartItem | null {
  if (items.length === 0) return null;
  if (remark === "expensive" || remark === "cheap") {
    const compared = items
      .map((item) => ({ item, c: comparePrice(item) }))
      .filter((x): x is { item: CartItem; c: PriceComparison } => x.c !== null);
    if (compared.length > 0) {
      const ratio = (x: { c: PriceComparison }) => x.c.paidCents / x.c.referenceCents;
      compared.sort((a, b) => (remark === "expensive" ? ratio(b) - ratio(a) : ratio(a) - ratio(b)));
      return compared[0]?.item ?? null;
    }
  }
  return items[items.length - 1] ?? null;
}
