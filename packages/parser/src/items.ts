/**
 * Analyse d'un SEGMENT d'achat (« deux croissants à 1,10 ») en article structuré,
 * et application des règles de prix R0 à R6.
 */
import type { CategoryId, Unit } from "@ra/core";
import { lookupProduct } from "./dictionary";
import { parseQuantity } from "./numbers";
import { findPrice, type PriceMatch } from "./price";
import { joinTokens, stripAccents, tokenize } from "./text";
import type { ParsedIssue, ParsedItem } from "./types";
import { priceQuantity, UNIT_WORDS } from "./units";

const ARTICLES = new Set(["du", "de", "des", "le", "la", "les", "l'", "d'", "mon", "ma", "mes"]);
const OF = new Set(["de", "d'", "des", "du"]);
/** Contenants ignorés : « un paquet de café » = du café. */
const CONTAINERS = new Set([
  "plein",
  "paquet",
  "paquets",
  "boite",
  "boites",
  "sachet",
  "sachets",
  "pot",
  "pots",
  "bouteille",
  "bouteilles",
  "canette",
  "canettes",
  "tablette",
  "tablettes",
  "barquette",
  "barquettes",
  "filet",
  "sac",
  "brique",
  "briques",
  "tranche",
  "tranches",
]);
/** Lots vendus d'un seul prix (R6). */
const LOTS = new Set(["pack", "lot"]);

export interface Head {
  quantity: number;
  /** La quantité a été dite explicitement (« trois croissants »). */
  explicitQuantity: boolean;
  unit: Unit;
  /** Lot vendu d'un seul prix : douzaine, pack, lot. */
  isLot: boolean;
  /** Nom normalisé (dictionnaire) ou libellé brut, null si aucun produit n'est dit. */
  name: string | null;
  categoryId: CategoryId | null;
  known: boolean;
}

function elideOf(name: string): string {
  return /^[aeiouyhéèêœ]/i.test(name) ? `d'${name}` : `de ${name}`;
}

/** Quantité, unité, conditionnement et produit : « un kilo de tomates », « deux places ». */
export function parseHead(raw: string[], merchant: string | null): Head | null {
  const keys = raw.map((t) => stripAccents(t));
  let i = 0;
  let quantity = 1;
  let explicitQuantity = false;
  let unit: Unit = "piece";
  let isLot = false;

  if ((keys[0] === "un" || keys[0] === "une") && keys[1] === "douzaine") {
    quantity = 12;
    explicitQuantity = true;
    isLot = true;
    i = 2;
  } else {
    const n = parseQuantity(keys[0]);
    if (n !== null) {
      quantity = n;
      explicitQuantity = keys[0] !== "un" && keys[0] !== "une";
      i = 1;
    } else {
      while (i < keys.length && ARTICLES.has(keys[i] ?? "")) i++;
    }
  }

  const unitWord = UNIT_WORDS[keys[i] ?? ""];
  if (i > 0 && unitWord !== undefined) {
    unit = unitWord;
    i++;
  }

  // Lot : « un pack de 6 bouteilles d'eau ».
  let lot: { word: string; count: number | null; container: string | null } | null = null;
  if (LOTS.has(keys[i] ?? "")) {
    const word = raw[i] ?? "pack";
    i++;
    while (OF.has(keys[i] ?? "")) i++;
    const count = parseQuantity(keys[i]);
    if (count !== null) i++;
    const container = CONTAINERS.has(keys[i] ?? "") ? (raw[i] ?? null) : null;
    if (container) i++;
    lot = { word, count, container };
    isLot = true;
  } else if (CONTAINERS.has(keys[i] ?? "") && OF.has(keys[i + 1] ?? "")) {
    i++;
  }
  while (OF.has(keys[i] ?? "")) i++;

  const phrase = joinTokens(raw.slice(i));
  if (!phrase && !explicitQuantity && unit === "piece" && !lot) return null;

  const match = phrase ? lookupProduct(phrase, merchant) : null;
  let name = match?.name ?? (phrase || null);
  if (lot && name) {
    const parts = [lot.word, elideOf(name), lot.count, lot.container].filter((p) => p !== null);
    name = parts.join(" ");
  }
  return {
    quantity,
    explicitQuantity,
    unit,
    isLot,
    name,
    categoryId: match?.categoryId ?? null,
    known: match !== null,
  };
}

/** Prix unitaire déduit du total, seulement si la division tombe juste au centime (R0). */
function deriveUnitPrice(totalCents: number, qty: number): number | null {
  if (qty <= 0) return null;
  const unit = Math.round(totalCents / qty);
  return Math.abs(unit * qty - totalCents) < 1e-6 ? unit : null;
}

export interface Prices {
  unitPriceCents: number | null;
  totalPriceCents: number | null;
  ambiguous: boolean;
  /** Prix au kilo connu mais quantité inconnue. */
  incomplete: boolean;
}

/** Règles R1 à R6 : unitaire ou total selon le marqueur, l'unité et le conditionnement. */
export function applyPriceRules(head: Head, price: PriceMatch): Prices {
  const qty = priceQuantity(head.quantity, head.unit);
  const measured = head.unit !== "piece";
  const cents = price.cents;
  const asTotal = (ambiguous: boolean): Prices => ({
    unitPriceCents: deriveUnitPrice(cents, qty),
    totalPriceCents: cents,
    ambiguous,
    incomplete: false,
  });

  if (price.perUnit) {
    if (!measured) {
      return { unitPriceCents: cents, totalPriceCents: null, ambiguous: false, incomplete: true };
    }
    return {
      unitPriceCents: cents,
      totalPriceCents: Math.round(qty * cents),
      ambiguous: false,
      incomplete: false,
    };
  }
  if (price.marker === "total") return asTotal(false);
  if (measured) return asTotal(qty !== 1);
  if (head.isLot || qty === 1) return asTotal(false);
  if (price.marker === "unit") {
    return {
      unitPriceCents: cents,
      totalPriceCents: Math.round(qty * cents),
      ambiguous: false,
      incomplete: false,
    };
  }
  return asTotal(true);
}

export interface SegmentResult {
  item: ParsedItem;
  price: PriceMatch | null;
  issues: ParsedIssue["code"][];
}

/** Analyse un segment. Renvoie null s'il ne contient ni produit connu ni prix. */
export function parseSegment(segment: string, merchant: string | null): SegmentResult | null {
  const raw = tokenize(segment);
  if (raw.length === 0) return null;
  const keys = raw.map((t) => stripAccents(t));
  const price = findPrice(keys);

  let headTokens = price ? raw.slice(0, price.start) : raw;
  // R17 : « deux euros de bonbons », « 50 euros d'essence » : le produit suit le prix.
  if (price && (headTokens.length === 0 || OF.has(keys[price.end] ?? ""))) {
    const after = raw.slice(price.end);
    if (after.length > 0) headTokens = after;
  }
  const head = parseHead(headTokens, merchant);

  if (!price && (!head || !head.known)) return null;

  const base: Head = head ?? {
    quantity: 1,
    explicitQuantity: false,
    unit: "piece",
    isLot: false,
    name: null,
    categoryId: null,
    known: false,
  };

  const issues: ParsedIssue["code"][] = [];
  let unitPriceCents: number | null = null;
  let totalPriceCents: number | null = null;
  if (price) {
    const p = applyPriceRules(base, price);
    unitPriceCents = p.unitPriceCents;
    totalPriceCents = p.totalPriceCents;
    if (p.ambiguous) issues.push("AMBIGUOUS_PRICE_SCOPE");
    if (p.incomplete) issues.push("LOW_CONFIDENCE");
  } else {
    issues.push("MISSING_PRICE");
  }
  if (!base.known) issues.push("UNKNOWN_PRODUCT");

  const confidence = !base.known ? 0.5 : issues.length > 0 ? 0.7 : 0.9;
  return {
    item: {
      rawLabel: joinTokens(headTokens) || segment,
      name: base.name,
      quantity: base.quantity,
      unit: base.unit,
      unitPriceCents,
      totalPriceCents,
      categoryId: base.categoryId,
      confidence,
    },
    price,
    issues,
  };
}
