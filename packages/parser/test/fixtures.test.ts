/**
 * Vérifie la COHÉRENCE des cas de test eux-mêmes (avant même d'implémenter
 * l'extracteur) : identifiants uniques, catégories valides, totaux justes.
 */
import { CATEGORY_IDS } from "@ra/core";
import { describe, expect, it } from "vitest";
import { type ExpectedItem, FIXTURES } from "./fixtures.fr";

/** Quantité exprimée dans l'unité de prix (g → kg, cl/ml → l). */
function priceQuantity(i: ExpectedItem): number {
  if (i.unit === "g") return i.quantity / 1000;
  if (i.unit === "cl") return i.quantity / 100;
  if (i.unit === "ml") return i.quantity / 1000;
  return i.quantity;
}

describe("cas de test de l'extracteur", () => {
  it("ont des identifiants uniques", () => {
    const ids = FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const f of FIXTURES) {
    if (f.expected.kind !== "add") continue;
    const expected = f.expected;

    it(`${f.id} : catégories valides et totaux cohérents`, () => {
      expect(expected.items.length).toBeGreaterThan(0);
      for (const i of expected.items) {
        if (i.categoryId !== null) expect(CATEGORY_IDS).toContain(i.categoryId);
        for (const cents of [i.unitPriceCents, i.totalPriceCents]) {
          if (cents !== null) expect(Number.isInteger(cents)).toBe(true);
        }
        if (i.unitPriceCents !== null && i.totalPriceCents !== null) {
          expect(Math.round(priceQuantity(i) * i.unitPriceCents)).toBe(i.totalPriceCents);
        }
      }
      for (const issue of expected.issues) {
        if (issue.itemIndex !== undefined) {
          expect(issue.itemIndex).toBeLessThan(expected.items.length);
        }
      }
    });
  }
});
