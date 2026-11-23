/**
 * Extraction du CONTEXTE d'un achat : date et magasin.
 * Chaque fonction renvoie la valeur trouvée et le texte débarrassé du passage reconnu.
 */
import { capitalize, wordRegex } from "./text";

const MONTHS: Record<string, number> = {
  janvier: 0,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11,
};

/** Index JavaScript (getDay) : dimanche = 0. */
const WEEKDAYS: Record<string, number> = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

const MONTH_PATTERN =
  "janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre";

export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
}

function plain(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function extractDate(text: string, now: Date): { text: string; date: string | null } {
  // 1. Date explicite : « le 15 novembre », « le 1er mars 2026 ».
  const explicit = wordRegex(
    `(?:le\\s+)?(1er|premier|\\d{1,2})\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?`,
    "iu",
  );
  const m = explicit.exec(text);
  if (m) {
    const day = /^\d+$/.test(m[1] ?? "") ? Number(m[1]) : 1;
    const month = MONTHS[plain(m[2] ?? "")] ?? 0;
    let year = m[3] ? Number(m[3]) : now.getFullYear();
    let date = new Date(year, month, day);
    if (!m[3] && date > now) {
      year -= 1;
      date = new Date(year, month, day);
    }
    return { text: text.replace(m[0], " "), date: formatDate(date) };
  }

  // 2. Dates relatives, dans l'ordre (« avant-hier » avant « hier »).
  const relative: [string, number][] = [
    ["avant[- ]hier", 2],
    ["hier", 1],
    ["aujourd'hui|ce matin|ce midi|ce soir|tout à l'heure|tout a l'heure", 0],
  ];
  for (const [pattern, days] of relative) {
    const r = wordRegex(pattern, "iu").exec(text);
    if (r) return { text: text.replace(r[0], " "), date: formatDate(daysBefore(now, days)) };
  }

  // 3. Jour de la semaine : le plus récent (aujourd'hui compris).
  const w = wordRegex(
    "(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?:\\s+dernier)?",
    "iu",
  ).exec(text);
  if (w) {
    const target = WEEKDAYS[plain(w[1] ?? "")] ?? now.getDay();
    const back = (now.getDay() - target + 7) % 7;
    return { text: text.replace(w[0], " "), date: formatDate(daysBefore(now, back)) };
  }

  return { text, date: null };
}

/** Types de commerces reconnus même sans majuscule (« à la boulangerie »). */
const SHOP_TYPES =
  "boulangerie|pharmacie|cin[ée]ma|march[ée]|boucherie|bar|restaurant|resto|supermarch[ée]|" +
  "tabac|primeur|kiosque|fromagerie|poissonnerie|p[âa]tisserie|station-service|librairie";

const NAME_WORD = "[\\p{L}\\p{N}&'-]+";
const CAPITALIZED_WORD = "\\p{Lu}[\\p{L}\\p{N}&'-]*";

export function extractMerchant(text: string): { text: string; merchant: string | null } {
  // « à la boulangerie », « au cinéma », « chez le boucher »…
  const shop = wordRegex(
    `(?:au|aux|[àa] la|[àa] l'|chez le|chez la|chez l')\\s*(${SHOP_TYPES})`,
    "iu",
  ).exec(text);
  if (shop?.[1]) return { text: text.replace(shop[0], " "), merchant: capitalize(shop[1]) };

  // « chez Lidl », « chez lidl », « chez Super U ».
  const chez = new RegExp(
    `(?<![\\p{L}])[Cc]hez\\s+(${NAME_WORD}(?:\\s+${CAPITALIZED_WORD})*)`,
    "u",
  ).exec(text);
  if (chez?.[1]) return { text: text.replace(chez[0], " "), merchant: capitalize(chez[1]) };

  // « au Carrefour », « à l'Intermarché », « à Leclerc » : nom propre avec majuscule.
  const proper = new RegExp(
    `(?<![\\p{L}])(?:[Aa]ux?|[ÀàAa] la|[ÀàAa] l'|[Àà])\\s*(${CAPITALIZED_WORD}(?:\\s+${CAPITALIZED_WORD})*)`,
    "u",
  ).exec(text);
  if (proper?.[1]) return { text: text.replace(proper[0], " "), merchant: proper[1] };

  return { text, merchant: null };
}
