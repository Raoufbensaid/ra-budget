import { describe, expect, it } from "vitest";
import { parseReceiptText } from "../src";

const TICKET = `
CARREFOUR MARKET
12 RUE DE LA PAIX 75002 PARIS
TEL 01 23 45 67 89
12/11/2026 18:42

BANANES                3,00 €
2 x 1,20
LAIT DEMI-ECREME       2,40 €
PAIN                   1,50 €
GATEAUX                4,00 €
SOUS-TOTAL            10,90
TOTAL                 10,90 €
CB                    10,90
TVA 5,5%               0,57
RENDU                  0,00
MERCI DE VOTRE VISITE
`;

describe("lecture d'un ticket", () => {
  const r = parseReceiptText(TICKET);

  it("trouve le magasin et la date", () => {
    expect(r.merchant).toBe("Carrefour Market");
    expect(r.date).toBe("2026-11-12");
  });

  it("trouve les articles, avec la quantité sur la ligne précédente", () => {
    expect(r.items).toEqual([
      { label: "Bananes", quantity: 1, unitPriceCents: 300, totalCents: 300 },
      { label: "Lait demi-ecreme", quantity: 2, unitPriceCents: 120, totalCents: 240 },
      { label: "Pain", quantity: 1, unitPriceCents: 150, totalCents: 150 },
      { label: "Gateaux", quantity: 1, unitPriceCents: 400, totalCents: 400 },
    ]);
  });

  it("trouve le total et vérifie la somme", () => {
    expect(r.totalCents).toBe(1090);
    expect(r.itemsSumCents).toBe(1090);
    expect(r.mismatch).toBe(false);
  });

  it("lit une quantité sur la même ligne", () => {
    const q = parseReceiptText("YAOURTS 4 X 0,50 2,00\nTOTAL 2,00");
    expect(q.items).toEqual([
      { label: "Yaourts", quantity: 4, unitPriceCents: 50, totalCents: 200 },
    ]);
  });

  it("compte une remise en négatif, même sans signe moins", () => {
    const d = parseReceiptText("CAFE 5,00\nREMISE FIDELITE 1,00\nTOTAL 4,00");
    expect(d.items.map((i) => i.totalCents)).toEqual([500, -100]);
    expect(d.mismatch).toBe(false);
  });

  it("signale un écart entre les articles et le total", () => {
    const m = parseReceiptText("CAFE 5,00\nTOTAL 7,00");
    expect(m.mismatch).toBe(true);
    expect(m.itemsSumCents).toBe(500);
  });

  it("n'invente pas de total s'il n'est pas lisible", () => {
    const n = parseReceiptText("CAFE 5,00");
    expect(n.totalCents).toBeNull();
    expect(n.mismatch).toBe(false);
  });

  it("comprend une date sur deux chiffres", () => {
    expect(parseReceiptText("Le 05-03-26 a 10h").date).toBe("2026-03-05");
  });

  it("renvoie un résultat vide pour un texte illisible", () => {
    expect(parseReceiptText("~~ ## ~~")).toEqual({
      merchant: null,
      date: null,
      items: [],
      totalCents: null,
      itemsSumCents: 0,
      mismatch: false,
    });
  });
});
