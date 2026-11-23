/**
 * Repérage d'un prix dans une suite de mots (clés sans accents).
 *
 * Formats reconnus : « 2,50 », « 2.50 », « 2 € 50 » (issu de « 2€50 »),
 * « 12 euros 50 », « deux euros cinquante », « deux cinquante » (en fin de phrase),
 * « 50 centimes », « 3 balles », et un entier seul après « à » ou « pour ».
 */
import { parseNumberWord } from "./numbers";
import { UNIT_WORDS } from "./units";

/** « unit » : prix introduit par « à » ; « total » : par « pour », « en tout »… */
export type PriceMarker = "unit" | "total" | "none";

export interface PriceMatch {
  cents: number;
  /** Index du premier mot du prix, marqueur « à »/« pour » inclus. */
  start: number;
  /** Index qui suit le dernier mot consommé (suffixes « le kilo », « en tout » inclus). */
  end: number;
  marker: PriceMarker;
  /** Prix au kilo ou au litre (« à 8 € le kilo »). */
  perUnit: boolean;
}

const CURRENCY = new Set(["€", "euro", "euros", "eur", "balle", "balles"]);
const CENT_WORDS = new Set(["centime", "centimes"]);
const PER_UNIT_INTRO = new Set(["le", "la", "du", "par", "au"]);
const PER_UNIT_WORDS = new Set(["kilo", "kg", "kilogramme", "litre", "l"]);
/** Mots qui peuvent suivre un entier seul pour qu'il soit lu comme un prix. */
const AFTER_BARE_INT = new Set(["le", "la", "du", "par", "en", "au"]);
const DECIMAL = /^(\d+)[.,](\d{1,2})$/;

function numberValue(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  return parseNumberWord(word);
}

/** Centimes après la devise : « 12 euros 50 », « deux euros cinquante ». */
function centsAfterCurrency(word: string | undefined): number | null {
  if (word === undefined || word === "un" || word === "une") return null;
  const v = numberValue(word);
  return v !== null && v < 100 ? v : null;
}

function matchAt(keys: string[], i: number): { cents: number; end: number } | null {
  const word = keys[i];
  if (word === undefined) return null;
  const next = keys[i + 1];

  const decimal = DECIMAL.exec(word);
  if (decimal) {
    // « 1,2 kg » est une quantité, pas un prix.
    if (next !== undefined && UNIT_WORDS[next] !== undefined) return null;
    const cents = Number(decimal[1]) * 100 + Number((decimal[2] ?? "").padEnd(2, "0"));
    return { cents, end: next !== undefined && CURRENCY.has(next) ? i + 2 : i + 1 };
  }

  const value = numberValue(word);
  if (value === null) return null;
  const isDigits = /^\d+$/.test(word);

  if (next !== undefined && CENT_WORDS.has(next)) return { cents: value, end: i + 2 };

  if (next !== undefined && CURRENCY.has(next)) {
    const tail = centsAfterCurrency(keys[i + 2]);
    return tail === null
      ? { cents: value * 100, end: i + 2 }
      : { cents: value * 100 + tail, end: i + 3 };
  }

  // « deux cinquante » en fin de phrase (jamais en tête : ce serait une quantité).
  if (!isDigits && i > 0 && i + 2 === keys.length && next !== undefined) {
    const second = parseNumberWord(next);
    if (second !== null && second >= 10 && second <= 99) {
      return { cents: value * 100 + second, end: i + 2 };
    }
  }

  // Entier seul après « à » / « pour » : « un café à 2 ».
  const previous = keys[i - 1];
  if (
    isDigits &&
    (previous === "a" || previous === "pour") &&
    (next === undefined || AFTER_BARE_INT.has(next))
  ) {
    return { cents: value * 100, end: i + 1 };
  }

  return null;
}

/** Cherche le DERNIER prix de la suite de mots (le prix suit en général l'article). */
export function findPrice(keys: string[]): PriceMatch | null {
  for (let i = keys.length - 1; i >= 0; i--) {
    const m = matchAt(keys, i);
    if (!m) continue;

    let { end } = m;
    let start = i;
    let marker: PriceMarker = "none";
    let perUnit = false;

    if (PER_UNIT_INTRO.has(keys[end] ?? "") && PER_UNIT_WORDS.has(keys[end + 1] ?? "")) {
      perUnit = true;
      end += 2;
    }
    const a = keys[end];
    const b = keys[end + 1];
    if (
      (a === "en" && b === "tout") ||
      (a === "au" && b === "total") ||
      (a === "le" && b === "tout")
    ) {
      marker = "total";
      end += 2;
    }
    const before = keys[start - 1];
    if (before === "pour") {
      marker = "total";
      start -= 1;
    } else if (before === "a") {
      if (marker === "none") marker = "unit";
      start -= 1;
    }
    return { cents: m.cents, start, end, marker, perUnit };
  }
  return null;
}
