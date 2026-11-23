import type { Unit } from "@ra/core";

/** Mots d'unité de mesure (clés sans accents). */
export const UNIT_WORDS: Record<string, Unit> = {
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogramme: "kg",
  kilogrammes: "kg",
  g: "g",
  gr: "g",
  gramme: "g",
  grammes: "g",
  l: "l",
  litre: "l",
  litres: "l",
  cl: "cl",
  centilitre: "cl",
  centilitres: "cl",
  ml: "ml",
  millilitre: "ml",
  millilitres: "ml",
};

/** Quantité exprimée dans l'unité de prix : grammes → kilos, cl et ml → litres. */
export function priceQuantity(quantity: number, unit: Unit): number {
  if (unit === "g" || unit === "ml") return quantity / 1000;
  if (unit === "cl") return quantity / 100;
  return quantity;
}
