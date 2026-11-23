/**
 * Extracteur de phrases d'achat en français (saisie vocale ou écrite).
 * 100 % déterministe : aucune IA, aucun appel réseau. Les règles sont documentées
 * et testées dans `test/fixtures.fr.ts`.
 */
import { parseCorrection, parseRemove, parseTotal } from "./commands";
import { extractDate, extractMerchant } from "./context";
import { parseSegment } from "./items";
import { collapseSpaces, normalizeApostrophes, toKey, wordRegex } from "./text";
import type { AddUtterance, ParsedIssue, ParsedItem, ParsedUtterance, ParseOptions } from "./types";

export type * from "./types";

/** Mots parasites retirés avant l'analyse (R11). */
const FILLERS = [
  "je viens d'acheter",
  "je viens de prendre",
  "j'ai(?:\\s+(?:aussi|également|egalement|encore|donc))?(?:\\s+(?:acheté|achete|achetés|achetées|pris|payé|paye|mis|dépensé|depense|claqué))?",
  "euh+",
  "heu+",
  "hum+",
  "bah",
  "ben",
  "alors",
  "voilà",
  "voila",
  "aussi",
  "également",
  "egalement",
  "ensuite",
];

/** Séparateurs d'articles (R7) ; la virgule décimale « 1,20 » est protégée. */
const SEGMENT_SPLIT = /\s*(?:(?<!\d),|,(?!\d))\s*|\s+(?:et|plus|puis|ainsi que)\s+|\s*;\s*/u;

function cleanPunctuation(s: string): string {
  return s.replace(/[?!:«»"()]/g, " ").replace(/(?<!\d)\.|\.(?!\d)/g, " ");
}

/** « vingt et un » → « vingt-et-un », pour lire le nombre d'un seul mot. */
function joinCompoundNumbers(s: string): string {
  return s.replace(
    /(vingt|trente|quarante|cinquante|soixante)\s+et\s+(un|une|onze)/giu,
    "$1-et-$2",
  );
}

function removeFillers(s: string): string {
  let out = s;
  for (const f of FILLERS) out = out.replace(wordRegex(f), " ");
  return out;
}

export function parseUtterance(input: string, options: ParseOptions): ParsedUtterance {
  const text = collapseSpaces(joinCompoundNumbers(cleanPunctuation(normalizeApostrophes(input))));
  if (!text) return { kind: "unknown" };

  const key = toKey(text);
  const command = parseTotal(key) ?? parseRemove(key) ?? parseCorrection(key);
  if (command) return command;

  const { text: withoutDate, date } = extractDate(text, options.now);
  const { text: withoutContext, merchant } = extractMerchant(withoutDate);
  const body = collapseSpaces(removeFillers(withoutContext.toLowerCase()));

  const segments = body
    .split(SEGMENT_SPLIT)
    .map((s) => s.replace(/^(?:et|plus|puis)\s+/, "").trim())
    .filter(Boolean);

  const results = segments.map((s) => parseSegment(s, merchant)).filter((r) => r !== null);
  if (results.length === 0) return { kind: "unknown" };

  // R8 : « une baguette et deux croissants pour 3,40 » → prix global.
  let totalPaidCents: number | null = null;
  const last = results[results.length - 1];
  const grouped =
    results.length >= 2 &&
    last?.price?.marker === "total" &&
    results.slice(0, -1).every((r) => r.price === null);
  if (grouped && last?.price) {
    totalPaidCents = last.price.cents;
    for (const r of results) {
      r.item.unitPriceCents = null;
      r.item.totalPriceCents = null;
      r.issues = r.issues.filter((c) => c !== "MISSING_PRICE");
    }
  }

  const items: ParsedItem[] = results.map((r) => r.item);
  const issues: ParsedIssue[] = results.flatMap((r, itemIndex) =>
    r.issues.map((code) => ({ code, itemIndex })),
  );

  const result: AddUtterance = { kind: "add", items, merchant, date, totalPaidCents, issues };
  return result;
}
