/**
 * Réponses courtes aux questions de l'assistant :
 * - un montant seul (« 1,20 », « 2 euros », « deux cinquante », « 3,40 chacun ») ;
 * - la portée d'un prix (« chacun », « en tout », « pour les deux »).
 */
import { parseNumberWord } from "./numbers";
import { findPrice } from "./price";
import { prepareInput, toKey, tokenize } from "./text";

export type PriceScope = "unit" | "total";

export interface AmountReply {
  cents: number;
  /** Portée dite explicitement, sinon null. */
  scope: PriceScope | null;
}

/** Mots de portée en FIN de réponse (la clé est précédée d'une espace avant le test). */
const UNIT_SCOPE =
  /\s(?:chacun|chacune|chaque|la piece|piece|l'unite|par piece|par personne|l'un|l'une|le kilo|le litre|au kilo|au litre)$/;
const TOTAL_SCOPE =
  /\s(?:en tout|au total|total|le tout|ensemble|pour (?:les|tous les|toutes les)(?: \S+){1,2}|pour tout|tout compris)$/;
const LEADS =
  /^(?:(?:ben|bah|euh|alors|oui|non|c'est|c'etait|ca fait|ca faisait|ca coute|ca coutait|ca m'a coute|il coute|elle coute|ils coutent|elles coutent|il coutait|elle coutait)\s+)+/;

function clean(input: string): string {
  return toKey(prepareInput(input)).replace(LEADS, "");
}

function digitsOrWord(word: string | undefined): number | null {
  if (word === undefined) return null;
  if (/^\d+$/.test(word)) return Number(word);
  return parseNumberWord(word);
}

/** Retire le mot de portée final : renvoie la portée et le reste de la clé. */
function splitScope(key: string): { scope: PriceScope | null; rest: string } {
  const padded = ` ${key}`;
  const unit = UNIT_SCOPE.exec(padded);
  if (unit) return { scope: "unit", rest: padded.slice(0, unit.index).trim() };
  const total = TOTAL_SCOPE.exec(padded);
  if (total) return { scope: "total", rest: padded.slice(0, total.index).trim() };
  return { scope: null, rest: key };
}

/** Portée seule : « chacun », « en tout », « pour les deux ». */
export function parseScopeReply(input: string): PriceScope | null {
  const { scope, rest } = splitScope(clean(input));
  return rest === "" ? scope : null;
}

/** Montant seul, avec une portée éventuelle. Renvoie null si la réponse n'est pas un montant. */
export function parseAmountReply(input: string): AmountReply | null {
  let key = clean(input);
  let scope: PriceScope | null = null;

  const marker = /^(a|pour)\s+/.exec(key);
  if (marker) {
    scope = marker[1] === "a" ? "unit" : "total";
    key = key.slice(marker[0].length);
  }
  const split = splitScope(key);
  if (split.scope) {
    scope = split.scope;
    key = split.rest;
  }

  const tokens = tokenize(key);
  if (tokens.length === 0) return null;

  // « 2 » ou « deux » seul : des euros.
  if (tokens.length === 1) {
    const v = digitsOrWord(tokens[0]);
    if (v !== null) return { cents: v * 100, scope };
  }
  // « deux cinquante » : euros et centimes en lettres.
  if (tokens.length === 2 && !/^\d+$/.test(tokens[1] ?? "")) {
    const euros = digitsOrWord(tokens[0]);
    const cents = digitsOrWord(tokens[1]);
    if (euros !== null && cents !== null && cents >= 10 && cents <= 99) {
      return { cents: euros * 100 + cents, scope };
    }
  }

  const price = findPrice(tokens);
  if (!price || price.start !== 0 || price.end !== tokens.length) return null;
  return { cents: price.cents, scope };
}
