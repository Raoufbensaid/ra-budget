import { describe, expect, it } from "vitest";
import { type PurchaseDraft, purchaseDraftSchema } from "../src";

const validDraft: PurchaseDraft = {
  source: "voice",
  merchant: "Lidl",
  date: "2026-11-22",
  currency: "EUR",
  totalPaidCents: null,
  items: [
    {
      rawLabel: "un kilo de tomates",
      name: "tomates",
      quantity: 1,
      unit: "kg",
      unitPriceCents: 350,
      totalPriceCents: 350,
      priceSource: "declared",
      categoryId: "alimentation",
      confidence: 0.95,
    },
  ],
  issues: [],
};

/** Copie du brouillon valide dont le premier article est modifié (valeurs volontairement invalides). */
function withFirstItem(changes: Record<string, unknown>): unknown {
  const [first, ...rest] = validDraft.items;
  return { ...validDraft, items: [{ ...first, ...changes }, ...rest] };
}

describe("purchaseDraftSchema", () => {
  it("accepte un brouillon valide", () => {
    expect(purchaseDraftSchema.parse(validDraft)).toEqual(validDraft);
  });

  it("refuse un montant en flottant (les montants sont en centimes)", () => {
    const draft = withFirstItem({ totalPriceCents: 3.5 });
    expect(purchaseDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("refuse une catégorie inconnue", () => {
    const draft = withFirstItem({ categoryId: "voyage_lune" });
    expect(purchaseDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("refuse une date mal formée", () => {
    expect(purchaseDraftSchema.safeParse({ ...validDraft, date: "22/11/2026" }).success).toBe(
      false,
    );
  });
});
