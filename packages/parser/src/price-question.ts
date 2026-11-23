/**
 * Questions sur le prix d'un produit : « ça coûte combien une baguette ? »,
 * « quel est le prix d'un croissant ? ». L'assistant y répond avec le prix moyen.
 */
import { findProductMention } from "./dictionary";
import { prepareInput, toKey, wordRegex } from "./text";

const ASKS_PRICE = wordRegex(
  [
    "combien (?:ca )?(?:coute|coutent|vaut|valent|coutait|ca fait)",
    "(?:coute|coutent|vaut|valent|coutait) combien",
    "quel (?:est le |serait le )?prix",
    "c'est quoi le prix",
    "prix (?:moyen|normal|habituel)",
    "combien (?:je devrais|on devrait|il faut) payer",
    "combien pour (?:un|une|des|le|la|les)",
  ].join("|"),
  "iu",
);

export interface PriceQuestion {
  /** Nom du produit (dictionnaire), ou null si la question ne cite pas de produit connu. */
  name: string | null;
}

/** Question de prix sans montant dedans, sinon null. */
export function parsePriceQuestion(input: string): PriceQuestion | null {
  const key = toKey(prepareInput(input));
  if (/\d/.test(key) || !ASKS_PRICE.test(key)) return null;
  return { name: findProductMention(key)?.name ?? null };
}
