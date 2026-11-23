/**
 * Mise en forme des montants, des dates et des articles. Écrite à la main plutôt
 * qu'avec Intl pour un rendu identique sur Hermes (iOS, Android) et sur le web.
 */
import { CATEGORY_LABELS, type CategoryId, type Unit } from "@ra/core";
import type { Language } from "@/i18n";

export function formatCents(cents: number, lang: Language): string {
  const euros = Math.floor(Math.abs(cents) / 100);
  const rest = String(Math.abs(cents) % 100).padStart(2, "0");
  const sign = cents < 0 ? "-" : "";
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, lang === "fr" ? " " : ",");
  return lang === "fr" ? `${sign}${grouped},${rest} €` : `${sign}€${grouped}.${rest}`;
}

const MONTHS = {
  fr: [
    "janv.",
    "févr.",
    "mars",
    "avr.",
    "mai",
    "juin",
    "juil.",
    "août",
    "sept.",
    "oct.",
    "nov.",
    "déc.",
  ],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** AAAA-MM-JJ de la date locale. */
export function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function formatDate(
  iso: string,
  lang: Language,
  labels: { today: string; yesterday: string },
): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (iso === isoDate(today)) return labels.today;
  if (iso === isoDate(yesterday)) return labels.yesterday;
  const [y, m, d] = iso.split("-").map(Number);
  const month = MONTHS[lang][(m ?? 1) - 1] ?? "";
  const year = y !== today.getFullYear() ? ` ${y}` : "";
  return lang === "fr" ? `${d} ${month}${year}` : `${month} ${d}${year}`;
}

export function categoryLabel(id: CategoryId, lang: Language): string {
  return CATEGORY_LABELS[id][lang];
}

const UNIT_LABELS: Record<Unit, string> = {
  piece: "",
  kg: "kg",
  g: "g",
  l: "l",
  cl: "cl",
  ml: "ml",
};

function formatQuantity(q: number, lang: Language): string {
  const s = Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000);
  return lang === "fr" ? s.replace(".", ",") : s;
}

/** Pluriel simple du premier mot (« place de cinéma » → « places de cinéma »). */
function pluralize(name: string): string {
  const [first = "", ...rest] = name.split(" ");
  const plural = /[sxz]$/.test(first)
    ? first
    : /(?:eau|eu)$/.test(first)
      ? `${first}x`
      : `${first}s`;
  return [plural, ...rest].join(" ");
}

export interface ItemLike {
  name: string | null;
  rawLabel: string;
  quantity: number;
  unit: Unit;
}

/** « baguette », « 2 croissants », « 1,5 kg de pommes ». */
export function describeItem(item: ItemLike, lang: Language): string {
  const name = item.name ?? item.rawLabel;
  if (item.unit !== "piece") {
    const of = lang === "fr" ? (/^[aeiouyhéèêœ]/i.test(name) ? "d'" : "de ") : "of ";
    return `${formatQuantity(item.quantity, lang)} ${UNIT_LABELS[item.unit]} ${of}${name}`;
  }
  if (item.quantity === 1) return name;
  return `${formatQuantity(item.quantity, lang)} ${lang === "fr" ? pluralize(name) : name}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
