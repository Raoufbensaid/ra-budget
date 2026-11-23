/**
 * Lecture des nombres français écrits en lettres, de 0 à 999.
 * Un nombre composé tient en UN mot (« soixante-dix », « quatre-vingt-dix-neuf »,
 * « vingt-et-un ») : l'analyse amont recolle « vingt et un » en « vingt-et-un ».
 * Les mots doivent être en minuscules et sans accents.
 */

const UNITS: Record<string, number> = {
  zero: 0,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
};

const TENS: Record<string, number> = {
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
};

interface Partial {
  value: number;
  next: number;
}

/** Renvoie la valeur d'un mot-nombre, ou null si le mot n'est pas un nombre. */
export function parseNumberWord(word: string): number | null {
  const parts = word.split("-").filter(Boolean);
  if (parts.length === 0) return null;
  const result = parseHundreds(parts, 0);
  return result && result.next === parts.length ? result.value : null;
}

/** Nombre écrit en chiffres (« 3 », « 1,2 », « 0.5 »), ou null. */
export function parseNumeric(word: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(word)) return null;
  return Number(word.replace(",", "."));
}

/** Quantité écrite en chiffres ou en lettres. */
export function parseQuantity(word: string | undefined): number | null {
  if (word === undefined) return null;
  return parseNumeric(word) ?? parseNumberWord(word);
}

function parseHundreds(p: string[], i: number): Partial | null {
  let value = 0;
  let j = i;
  const head = p[j];
  if (head === undefined) return null;
  const multiplier = UNITS[head];
  if ((p[j + 1] === "cent" || p[j + 1] === "cents") && multiplier !== undefined) {
    if (multiplier < 2 || multiplier > 9) return null;
    value = multiplier * 100;
    j += 2;
  } else if (head === "cent") {
    value = 100;
    j += 1;
  }
  if (value > 0 && j >= p.length) return { value, next: j };
  const rest = parseBelowHundred(p, j);
  if (!rest) return value > 0 ? { value, next: j } : null;
  return { value: value + rest.value, next: rest.next };
}

function parseBelowHundred(p: string[], i: number): Partial | null {
  const t = p[i];
  if (t === undefined) return null;

  if (t === "quatre" && (p[i + 1] === "vingt" || p[i + 1] === "vingts")) {
    return withTail(80, p, i + 2, true);
  }

  const ten = TENS[t];
  if (ten !== undefined) {
    if (p[i + 1] === "et") {
      const n = p[i + 2];
      if (n === "un" || n === "une") return { value: ten + 1, next: i + 3 };
      if (n === "onze" && ten === 60) return { value: 71, next: i + 3 };
      return null;
    }
    return withTail(ten, p, i + 1, ten === 60);
  }

  if (t === "dix") return withTail(0, p, i, true);

  const unit = UNITS[t];
  return unit === undefined ? null : { value: unit, next: i + 1 };
}

/** Complément après une dizaine : unités, et « dix-sept »… pour soixante et quatre-vingt. */
function withTail(base: number, p: string[], j: number, allowTeens: boolean): Partial {
  const t = p[j];
  if (t === undefined) return { value: base, next: j };
  if (allowTeens) {
    if (t === "dix") {
      const n = UNITS[p[j + 1] ?? ""];
      if (n !== undefined && n >= 7 && n <= 9) return { value: base + 10 + n, next: j + 2 };
      return { value: base + 10, next: j + 1 };
    }
    const u = UNITS[t];
    if (u !== undefined && u >= 1 && u <= 16 && t !== "une")
      return { value: base + u, next: j + 1 };
    return { value: base, next: j };
  }
  const u = UNITS[t];
  if (u !== undefined && u >= 1 && u <= 9 && t !== "une") return { value: base + u, next: j + 1 };
  return { value: base, next: j };
}
