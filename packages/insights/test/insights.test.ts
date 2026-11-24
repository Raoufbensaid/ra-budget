import { describe, expect, it } from "vitest";
import {
  allocatePurchase,
  budgetStatus,
  compareToPrevious,
  daysInMonth,
  distribute,
  type InsightItem,
  type InsightPurchase,
  monthlyTotals,
  shiftMonth,
  summarizeMonth,
} from "../src";

function item(
  name: string,
  cents: number | null,
  categoryId: InsightItem["categoryId"] = "alimentation",
): InsightItem {
  return {
    rawLabel: name,
    name,
    quantity: 1,
    unit: "piece",
    totalPriceCents: cents,
    categoryId,
  };
}

let seq = 0;
function purchase(
  purchasedOn: string,
  items: InsightItem[],
  totalPaidCents: number | null = null,
): InsightPurchase {
  seq++;
  return { id: `p${seq}`, merchant: null, purchasedOn, totalPaidCents, items };
}

describe("mois", () => {
  it("décale les mois en passant les années", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
    expect(shiftMonth("2026-03", -14)).toBe("2025-01");
  });

  it("compte les jours du mois, années bissextiles comprises", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-11")).toBe(30);
  });
});

describe("répartition d'une dépense", () => {
  it("répartit sans perdre de centime", () => {
    expect(distribute(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(distribute(0, [5, 5])).toEqual([0, 0]);
    const parts = distribute(999, [3, 7, 11]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(999);
  });

  it("garde les prix quand le total correspond", () => {
    const p = purchase("2026-11-02", [item("pain", 110), item("savon", 250, "hygiene_beaute")]);
    expect(allocatePurchase(p).map((a) => a.cents)).toEqual([110, 250]);
  });

  it("applique une remise au prorata des prix", () => {
    const p = purchase("2026-11-02", [item("a", 600), item("b", 400)], 900);
    expect(allocatePurchase(p).map((a) => a.cents)).toEqual([540, 360]);
  });

  it("donne l'écart aux articles sans prix", () => {
    const p = purchase("2026-11-02", [item("a", 300), item("b", null), item("c", null)], 1000);
    expect(allocatePurchase(p).map((a) => a.cents)).toEqual([300, 350, 350]);
  });

  it("partage à parts égales quand aucun prix n'est connu", () => {
    const p = purchase("2026-11-02", [item("a", null), item("b", null)], 500);
    expect(allocatePurchase(p).map((a) => a.cents)).toEqual([250, 250]);
  });

  it("classe les articles sans catégorie dans « non classé »", () => {
    const p = purchase("2026-11-02", [item("truc", 200, null)]);
    expect(allocatePurchase(p)[0]?.category).toBe("unclassified");
  });
});

describe("résumé du mois", () => {
  const purchases = [
    purchase("2026-11-02", [item("baguette", 110), item("pizza", 1200, "restauration")]),
    purchase("2026-11-10", [item("baguette", 120), item("shampoing", 450, "hygiene_beaute")]),
    purchase("2026-11-20", [item("essence", 6000, "transport")], 6000),
    purchase("2026-10-15", [item("cinéma", 1100, "loisirs")]),
  ];

  const s = summarizeMonth(purchases, "2026-11", "2026-11-20");

  it("calcule le total et le nombre de dépenses du mois", () => {
    expect(s.totalCents).toBe(110 + 1200 + 120 + 450 + 6000);
    expect(s.purchaseCount).toBe(3);
  });

  it("trie les catégories et leurs parts", () => {
    expect(s.byCategory.map((c) => c.category)).toEqual([
      "transport",
      "restauration",
      "hygiene_beaute",
      "alimentation",
    ]);
    const sum = s.byCategory.reduce((x, c) => x + c.cents, 0);
    expect(sum).toBe(s.totalCents);
    expect(s.byCategory[0]?.share).toBeCloseTo(6000 / s.totalCents);
  });

  it("regroupe les produits achetés plusieurs fois", () => {
    const baguette = s.topProducts.find((p) => p.key === "baguette");
    expect(baguette).toMatchObject({ cents: 230, times: 2 });
    expect(s.topProducts[0]?.key).toBe("essence");
  });

  it("calcule la moyenne par jour et l'estimation de fin de mois", () => {
    expect(s.elapsedDays).toBe(20);
    expect(s.dailyAverageCents).toBe(Math.round(s.totalCents / 20));
    expect(s.projectionCents).toBe(Math.round((s.totalCents / 20) * 30));
    expect(s.daily[1]).toBe(1310);
    expect(s.daily).toHaveLength(30);
  });

  it("n'estime pas la fin d'un mois terminé", () => {
    const past = summarizeMonth(purchases, "2026-10", "2026-11-20");
    expect(past.projectionCents).toBeNull();
    expect(past.elapsedDays).toBe(31);
  });

  it("gère un mois vide", () => {
    const empty = summarizeMonth(purchases, "2026-08", "2026-11-20");
    expect(empty.totalCents).toBe(0);
    expect(empty.byCategory).toEqual([]);
    expect(empty.dailyAverageCents).toBe(0);
  });
});

describe("comparaison avec le mois précédent", () => {
  const purchases = [
    purchase("2026-10-05", [item("a", 1000)]),
    purchase("2026-10-25", [item("b", 5000)]),
    purchase("2026-11-03", [item("c", 1500)]),
  ];

  it("compare le mois en cours à la même date du mois précédent", () => {
    const c = compareToPrevious(purchases, "2026-11", "2026-11-10");
    expect(c).toMatchObject({
      currentCents: 1500,
      previousCents: 1000,
      deltaCents: 500,
      sameDay: true,
    });
    expect(c.ratio).toBeCloseTo(0.5);
  });

  it("compare un mois terminé au mois précédent entier", () => {
    const c = compareToPrevious(purchases, "2026-11", "2026-12-02");
    expect(c.previousCents).toBe(6000);
    expect(c.sameDay).toBe(false);
  });

  it("n'a pas de pourcentage si le mois précédent est vide", () => {
    expect(compareToPrevious(purchases, "2026-10", "2026-11-10").ratio).toBeNull();
  });
});

describe("évolution sur plusieurs mois", () => {
  it("renvoie les mois du plus ancien au plus récent, mois vides compris", () => {
    const totals = monthlyTotals(
      [purchase("2026-10-05", [item("a", 1000)]), purchase("2026-11-03", [item("b", 200)])],
      "2026-11",
      3,
    );
    expect(totals).toEqual([
      { month: "2026-09", cents: 0 },
      { month: "2026-10", cents: 1000 },
      { month: "2026-11", cents: 200 },
    ]);
  });
});

describe("budget", () => {
  it("est « ok » quand on dépense moins vite que le temps passe", () => {
    const b = budgetStatus(60000, 20000, "2026-11", "2026-11-15");
    expect(b.level).toBe("ok");
    expect(b.remainingCents).toBe(40000);
    expect(b.perDayLeftCents).toBe(Math.floor(40000 / 16));
  });

  it("prévient quand on dépense plus vite que le temps passe", () => {
    expect(budgetStatus(60000, 45000, "2026-11", "2026-11-10").level).toBe("watch");
  });

  it("signale un dépassement", () => {
    const b = budgetStatus(60000, 61000, "2026-11", "2026-11-28");
    expect(b.level).toBe("over");
    expect(b.remainingCents).toBe(-1000);
    expect(b.perDayLeftCents).toBe(0);
  });

  it("ne donne pas de reste par jour pour un mois terminé", () => {
    expect(budgetStatus(60000, 30000, "2026-10", "2026-11-10").perDayLeftCents).toBeNull();
  });
});
