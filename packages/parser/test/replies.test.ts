import { describe, expect, it } from "vitest";
import { parseAmountReply, parseScopeReply } from "../src";

describe("parseAmountReply", () => {
  it.each([
    ["1,20", 120, null],
    ["1.20 €", 120, null],
    ["2", 200, null],
    ["2 euros", 200, null],
    ["deux", 200, null],
    ["deux cinquante", 250, null],
    ["deux euros cinquante", 250, null],
    ["50 centimes", 50, null],
    ["c'est 3,40", 340, null],
    ["Ben 1,10 !", 110, null],
    ["3,40 chacun", 340, "unit"],
    ["1,10 la pièce", 110, "unit"],
    ["3,40 en tout", 340, "total"],
    ["4 euros pour les deux", 400, "total"],
    ["à 1,20", 120, "unit"],
    ["pour 5", 500, "total"],
    ["vingt et un euros", 2100, null],
  ])("« %s » → %i centimes (%s)", (input, cents, scope) => {
    expect(parseAmountReply(input)).toEqual({ cents, scope });
  });

  it.each(["une baguette", "deux croissants à 1,10", "chacun", "", "je sais pas"])(
    "« %s » n'est pas un montant",
    (input) => {
      expect(parseAmountReply(input)).toBeNull();
    },
  );
});

describe("parseScopeReply", () => {
  it.each([
    ["chacun", "unit"],
    ["Chacune.", "unit"],
    ["la pièce", "unit"],
    ["le kilo", "unit"],
    ["en tout", "total"],
    ["au total", "total"],
    ["pour les deux", "total"],
    ["c'est pour les trois croissants", "total"],
    ["ensemble", "total"],
  ])("« %s » → %s", (input, scope) => {
    expect(parseScopeReply(input)).toBe(scope);
  });

  it.each(["une baguette", "1,20", "oui"])("« %s » n'est pas une portée", (input) => {
    expect(parseScopeReply(input)).toBeNull();
  });
});
