/**
 * Tests de comportement de l'extracteur, pilotés par les cas de `fixtures.fr.ts`.
 *
 * Développement guidé par les tests : chaque règle est activée en ajoutant son
 * préfixe dans ENABLED_RULES, puis implémentée jusqu'à ce que ses cas passent.
 * Les règles non encore activées apparaissent comme « todo ».
 */
import { describe, expect, it } from "vitest";
import { parseUtterance } from "../src";
import { FIXTURES, REFERENCE_DATE } from "./fixtures.fr";

const ENABLED_RULES = new Set<string>([
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
  "R6",
  "R7",
  "R8",
  "R9",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
  "R17",
]);

describe("parseUtterance (fr)", () => {
  for (const f of FIXTURES) {
    const title = `${f.id} : « ${f.input} »`;
    if (!ENABLED_RULES.has(f.rule)) {
      it.todo(title);
      continue;
    }
    it(title, () => {
      expect(parseUtterance(f.input, { now: REFERENCE_DATE })).toMatchObject(f.expected);
    });
  }
});
