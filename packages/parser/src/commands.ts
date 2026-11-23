/**
 * Commandes de la conversation : total payé (R13), suppression et correction (R12).
 * Elles reçoivent le texte en clé (minuscules, sans accents).
 */
import { lookupProduct } from "./dictionary";
import { parseHead } from "./items";
import { findPrice } from "./price";
import { tokenize } from "./text";
import type { CorrectUtterance, RemoveUtterance, TotalUtterance } from "./types";

/** Articles en tête : un mot entier suivi d'un espace, ou l'élision « l' ». */
const ARTICLE_PREFIX = /^(?:(?:le|la|les|du|des|de la|mon|ma|mes)\s+|l'\s*)+/;

/** Nom normalisé de l'article visé (« les tomates » → « tomates »). */
function targetName(phrase: string): string | null {
  const cleaned = phrase.replace(ARTICLE_PREFIX, "").trim();
  if (!cleaned) return null;
  return lookupProduct(cleaned, null)?.name ?? cleaned;
}

/** La phrase entière est-elle un prix (avec « en tout » éventuel) ? */
function wholePrice(text: string): number | null {
  const keys = tokenize(text);
  const price = findPrice(keys);
  if (!price || price.start !== 0 || price.end !== keys.length) return null;
  return price.cents;
}

export function parseTotal(key: string): TotalUtterance | null {
  const m =
    /^(?:j'ai paye|j'ai donne|le total(?: c'est| est| fait)?|total|ca fait|ca m'a coute|ca me fait|en tout(?: c'est| ca fait)?)\s*:?\s+(.+)$/.exec(
      key,
    );
  if (!m?.[1]) return null;
  const cents = wholePrice(m[1]);
  return cents === null ? null : { kind: "total", totalPaidCents: cents };
}

export function parseRemove(key: string): RemoveUtterance | null {
  const m = /^(?:enleve|supprime|retire|efface|annule)\s+(.+)$/.exec(key);
  const target = m?.[1] ? targetName(m[1]) : null;
  return target ? { kind: "remove", target } : null;
}

export function parseCorrection(key: string): CorrectUtterance | null {
  const lead = /^(?:non|ah non|en fait|pardon|oups|je me suis trompe)[\s,]+/;
  const hasLead = lead.test(key);
  const body = key.replace(lead, "");
  const m = /^(.*?)\s*c'(?:etait|est)\s+(.+)$/.exec(body);
  if (!m || (!hasLead && !key.includes("c'etait"))) return null;

  const before = (m[1] ?? "").trim();
  const after = m[2] ?? "";
  const tokens = tokenize(after);
  const price = findPrice(tokens);
  const headTokens = price ? tokens.slice(0, price.start) : tokens;
  const head = headTokens.length > 0 ? parseHead(headTokens, null) : null;

  const target = targetName(before) ?? head?.name ?? null;
  if (!target) return null;

  const changes: CorrectUtterance["changes"] = {};
  if (price) changes.priceCents = price.cents;
  if (head?.explicitQuantity) changes.quantity = head.quantity;
  if (changes.priceCents === undefined && changes.quantity === undefined) return null;
  return { kind: "correct", target, changes };
}
