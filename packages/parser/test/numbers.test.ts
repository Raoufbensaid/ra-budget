import { describe, expect, it } from "vitest";
import { parseNumberWord } from "../src/numbers";

describe("parseNumberWord", () => {
  const cases: [string, number][] = [
    ["zero", 0],
    ["un", 1],
    ["une", 1],
    ["seize", 16],
    ["dix-sept", 17],
    ["vingt", 20],
    ["vingt-et-un", 21],
    ["vingt-deux", 22],
    ["soixante-dix", 70],
    ["soixante-et-onze", 71],
    ["soixante-dix-neuf", 79],
    ["quatre-vingt", 80],
    ["quatre-vingts", 80],
    ["quatre-vingt-un", 81],
    ["quatre-vingt-dix", 90],
    ["quatre-vingt-dix-neuf", 99],
    ["cent", 100],
    ["cent-cinquante", 150],
    ["deux-cents", 200],
    ["trois-cent-vingt", 320],
  ];
  for (const [word, value] of cases) {
    it(`« ${word} » = ${value}`, () => expect(parseNumberWord(word)).toBe(value));
  }

  for (const word of ["baguette", "et", "vingt-et", "un-cent", ""]) {
    it(`« ${word} » n'est pas un nombre`, () => expect(parseNumberWord(word)).toBeNull());
  }
});
