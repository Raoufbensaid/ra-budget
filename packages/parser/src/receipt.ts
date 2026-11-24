/**
 * Lecture du texte d'un ticket de caisse (tel que reconnu par Tesseract) :
 * magasin, date, articles, quantités, remises et total. Règles fixes et
 * prudentes : en cas de doute, une ligne est ignorée plutôt qu'inventée, et
 * le résultat est toujours présenté pour correction.
 */

export interface ReceiptLine {
  label: string;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number;
}

export interface ParsedReceipt {
  merchant: string | null;
  /** AAAA-MM-JJ */
  date: string | null;
  items: ReceiptLine[];
  totalCents: number | null;
  itemsSumCents: number;
  /** Vrai si un total est lu et que la somme des articles ne lui correspond pas. */
  mismatch: boolean;
}

/** Prix en fin de ligne : « 3,00 », « -1.00 € », « 2,40 EUR A » (lettre de TVA). */
const PRICE_END = /(-?)\s*(\d{1,6})[.,](\d{2})\s*(?:€|EUR)?\s*[A-Z]?\s*$/i;
/** Ligne de quantité seule : « 2 x 1,20 ». */
const QTY_ONLY = /^(\d{1,4}(?:[.,]\d{1,3})?)\s*[xX*]\s*(\d{1,6})[.,](\d{2})\s*(?:€|EUR)?$/i;
/** Quantité dans le libellé : « YAOURTS 4 X 0,50 ». */
const QTY_INLINE = /(\d{1,4}(?:[.,]\d{1,3})?)\s*[xX*]\s*(\d{1,6})[.,](\d{2})/;
const TOTAL = /^(?:TOTAL(?:\s+TTC)?|NET\s+A\s+PAYER|A\s+PAYER|MONTANT(?:\s+DU)?)\b/i;
const SKIP =
  /\b(?:SOUS[- ]?TOTAL|TVA|CB|CARTE|RENDU|ESP[EÈ]CES|MONNAIE|TICKET|SIRET|TEL|T[EÉ]L[EÉ]PHONE|HT|TTC|PAIEMENT|VISA|MASTERCARD|CH[EÈ]QUE|AVOIR|ARTICLES?|MERCI)\b/i;
const DISCOUNT = /\b(?:REMISE|R[EÉ]DUC(?:TION)?|PROMO(?:TION)?|BON|COUPON|RABAIS)\b/i;
const DATE = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/;

function cents(euros: string, decimals: string): number {
  return Number(euros) * 100 + Number(decimals);
}

function parseQuantity(text: string): number {
  return Number(text.replace(",", "."));
}

/** « LAIT DEMI-ECREME » → « Lait demi-ecreme ». */
function cleanLabel(text: string): string {
  const t = text.replace(/[€*]+/g, " ").replace(/\s+/g, " ").trim();
  const lower = t.toLocaleLowerCase("fr");
  return lower.charAt(0).toLocaleUpperCase("fr") + lower.slice(1);
}

/** « CARREFOUR MARKET » → « Carrefour Market ». */
function titleCase(text: string): string {
  return text
    .toLocaleLowerCase("fr")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase("fr") + w.slice(1))
    .join(" ");
}

function findDate(text: string): string | null {
  const m = DATE.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const merchantLine = lines
    .slice(0, 3)
    .find((l) => /[A-Za-zÀ-ÿ]{3,}/.test(l) && !PRICE_END.test(l) && !SKIP.test(l) && !DATE.test(l));

  const items: ReceiptLine[] = [];
  let totalCents: number | null = null;
  let pending: { quantity: number; unitPriceCents: number } | null = null;

  for (const line of lines) {
    const qtyOnly = QTY_ONLY.exec(line);
    if (qtyOnly) {
      pending = {
        quantity: parseQuantity(qtyOnly[1] ?? "1"),
        unitPriceCents: cents(qtyOnly[2] ?? "0", qtyOnly[3] ?? "0"),
      };
      continue;
    }
    const price = PRICE_END.exec(line);
    if (!price) {
      continue;
    }
    const amount = cents(price[2] ?? "0", price[3] ?? "0");
    const before = line.slice(0, price.index);

    if (TOTAL.test(line) && !/SOUS[- ]?TOTAL/i.test(line)) {
      totalCents = amount;
      pending = null;
      continue;
    }
    if (SKIP.test(line)) {
      pending = null;
      continue;
    }

    let label = before;
    let quantity = 1;
    let unitPriceCents: number | null = amount;
    const inline = QTY_INLINE.exec(before);
    if (inline) {
      quantity = parseQuantity(inline[1] ?? "1");
      unitPriceCents = cents(inline[2] ?? "0", inline[3] ?? "0");
      label = before.slice(0, inline.index) + before.slice(inline.index + inline[0].length);
    } else if (pending) {
      quantity = pending.quantity;
      unitPriceCents = pending.unitPriceCents;
    }
    pending = null;

    const cleaned = cleanLabel(label);
    if (!/[A-Za-zÀ-ÿ]{2,}/.test(cleaned)) continue;
    const negative = price[1] === "-" || DISCOUNT.test(cleaned);
    const totalItem = negative ? -amount : amount;
    items.push({
      label: cleaned,
      quantity,
      unitPriceCents: negative ? -Math.abs(unitPriceCents ?? amount) : unitPriceCents,
      totalCents: totalItem,
    });
  }

  const itemsSumCents = items.reduce((s, i) => s + i.totalCents, 0);
  return {
    merchant: merchantLine ? titleCase(merchantLine) : null,
    date: findDate(text),
    items,
    totalCents,
    itemsSumCents,
    mismatch: totalCents !== null && items.length > 0 && itemsSumCents !== totalCents,
  };
}
