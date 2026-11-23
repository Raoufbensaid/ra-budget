import { describe, expect, it } from "vitest";
import {
  detectRemark,
  parsePriceQuestion,
  parseUtterance,
  referencePrice,
  suggestProducts,
} from "../src";

const NOW = new Date("2026-11-23T12:00:00");

describe("detectRemark", () => {
  it.each([
    ["j'ai acheté une baguette à 2 euro, elle est trop cher", "expensive"],
    ["c'est pas donné", "expensive"],
    ["hors de prix !", "expensive"],
    ["une baguette à 1 euro, pas chère", "cheap"],
    ["c'était en promo", "cheap"],
    ["une bonne affaire", "cheap"],
    ["trois croissants, délicieux", "liked"],
    ["ils étaient trop bons", "liked"],
    ["pas terrible", "disliked"],
    ["j'ai craqué sur un pull", "regret"],
  ])("« %s » → %s", (text, remark) => {
    expect(detectRemark(text)).toBe(remark);
  });

  it.each(["une baguette à 1,20", "chez Lidl deux croissants", "un pain au chocolat"])(
    "« %s » → aucun commentaire",
    (text) => {
      expect(detectRemark(text)).toBeNull();
    },
  );

  it("le commentaire n'ajoute pas d'article", () => {
    const u = parseUtterance("j'ai acheté une baguette à 2 euro, elle est trop chère", {
      now: NOW,
    });
    expect(u).toMatchObject({
      kind: "add",
      remark: "expensive",
      items: [{ name: "baguette", totalPriceCents: 200 }],
    });
    if (u.kind === "add") expect(u.items).toHaveLength(1);
  });
});

describe("suggestProducts", () => {
  it("propose les produits qui commencent par le fragment", () => {
    expect(suggestProducts("bag")).toEqual(["baguette", "baguette de pain"]);
    expect(suggestProducts("croi")[0]).toBe("croissant");
    expect(suggestProducts("Pâ")).toContain("pâtes");
  });

  it("ne propose rien pour un fragment trop court, un nombre ou un mot complet", () => {
    expect(suggestProducts("b")).toEqual([]);
    expect(suggestProducts("12")).toEqual([]);
    expect(suggestProducts("riz")).toEqual([]);
  });

  it("limite le nombre de suggestions", () => {
    expect(suggestProducts("po", 3)).toHaveLength(3);
  });
});

describe("referencePrice", () => {
  it("donne un prix moyen pour les produits courants", () => {
    expect(referencePrice("baguette")).toEqual({ cents: 110, per: "piece" });
    expect(referencePrice("tomates")).toEqual({ cents: 350, per: "kg" });
    expect(referencePrice("zorglub")).toBeNull();
    expect(referencePrice(null)).toBeNull();
  });
});

describe("parsePriceQuestion", () => {
  it.each([
    ["Tu penses ça coute combien une baguette normal ?", "baguette"],
    ["combien coûte un croissant", "croissant"],
    ["c'est quoi le prix d'un kilo de tomates ?", "tomates"],
    ["quel est le prix moyen du pain au chocolat", "pain au chocolat"],
    ["ça vaut combien un ticket de métro ?", "ticket de métro"],
    ["combien coûte un zorglub ?", null],
  ])("« %s » → %s", (text, name) => {
    expect(parsePriceQuestion(text)).toEqual({ name });
  });

  it.each(["une baguette à 1,20", "combien coûte une baguette à 2 euros", "une baguette"])(
    "« %s » n'est pas une question de prix",
    (text) => {
      expect(parsePriceQuestion(text)).toBeNull();
    },
  );
});
