/**
 * Dictionnaire des produits courants : nom normalisé → catégorie.
 * Les pluriels simples (-s, -x) sont reconnus automatiquement ; il suffit de lister
 * les synonymes et les formes irrégulières dans `aliases`.
 *
 * À enrichir au fil de l'eau (objectif : environ 300 produits), puis à compléter
 * par les corrections des utilisateurs (règles personnelles en base).
 */
import type { CategoryId } from "@ra/core";
import { toKey } from "./text";

interface ProductEntry {
  name: string;
  category: CategoryId;
  aliases?: string[];
}

const PRODUCTS: ProductEntry[] = [
  // ── Alimentation ──
  { name: "baguette", category: "alimentation", aliases: ["baguette de pain", "tradition"] },
  { name: "pain", category: "alimentation", aliases: ["pain de mie", "pain complet"] },
  { name: "pain au chocolat", category: "alimentation", aliases: ["chocolatine"] },
  { name: "croissant", category: "alimentation" },
  { name: "brioche", category: "alimentation" },
  { name: "tomates", category: "alimentation", aliases: ["tomate"] },
  { name: "cerises", category: "alimentation", aliases: ["cerise"] },
  { name: "pommes", category: "alimentation", aliases: ["pomme"] },
  { name: "pommes de terre", category: "alimentation", aliases: ["patates", "patate"] },
  { name: "carottes", category: "alimentation", aliases: ["carotte"] },
  { name: "bananes", category: "alimentation", aliases: ["banane"] },
  { name: "oranges", category: "alimentation", aliases: ["orange"] },
  { name: "citrons", category: "alimentation", aliases: ["citron"] },
  { name: "fraises", category: "alimentation", aliases: ["fraise"] },
  { name: "raisin", category: "alimentation" },
  { name: "oignons", category: "alimentation", aliases: ["oignon"] },
  { name: "courgettes", category: "alimentation", aliases: ["courgette"] },
  { name: "poireaux", category: "alimentation", aliases: ["poireau"] },
  { name: "salade", category: "alimentation", aliases: ["laitue"] },
  { name: "lait", category: "alimentation", aliases: ["lait demi-écrémé", "lait entier"] },
  { name: "beurre", category: "alimentation" },
  { name: "fromage", category: "alimentation", aliases: ["emmental", "camembert", "comté"] },
  { name: "yaourt", category: "alimentation", aliases: ["yaourts", "yogourt", "yoghourt"] },
  { name: "œufs", category: "alimentation", aliases: ["œuf"] },
  { name: "crème fraîche", category: "alimentation", aliases: ["crème"] },
  { name: "jambon", category: "alimentation" },
  { name: "poulet", category: "alimentation" },
  { name: "steak haché", category: "alimentation", aliases: ["steak"] },
  { name: "viande", category: "alimentation" },
  { name: "poisson", category: "alimentation" },
  { name: "saumon", category: "alimentation" },
  { name: "pâtes", category: "alimentation", aliases: ["spaghetti", "spaghettis"] },
  { name: "riz", category: "alimentation" },
  { name: "farine", category: "alimentation" },
  { name: "sucre", category: "alimentation" },
  { name: "sel", category: "alimentation" },
  { name: "huile", category: "alimentation", aliases: ["huile d'olive"] },
  { name: "chocolat", category: "alimentation", aliases: ["tablette de chocolat"] },
  { name: "biscuits", category: "alimentation", aliases: ["biscuit", "gâteaux", "gâteau"] },
  { name: "céréales", category: "alimentation", aliases: ["céréale"] },
  { name: "confiture", category: "alimentation" },
  { name: "miel", category: "alimentation" },
  { name: "bonbon", category: "alimentation", aliases: ["bonbons"] },
  { name: "chips", category: "alimentation" },

  // ── Boissons ──
  { name: "eau", category: "boissons", aliases: ["eau minérale", "eau gazeuse"] },
  { name: "café", category: "boissons", aliases: ["paquet de café"] },
  { name: "thé", category: "boissons" },
  { name: "jus d'orange", category: "boissons", aliases: ["jus"] },
  { name: "soda", category: "boissons", aliases: ["coca", "cola"] },
  { name: "bière", category: "boissons" },
  { name: "vin", category: "boissons", aliases: ["bouteille de vin"] },
  { name: "sirop", category: "boissons" },

  // ── Restauration ──
  { name: "pizza", category: "restauration" },
  { name: "kebab", category: "restauration" },
  { name: "sandwich", category: "restauration" },
  { name: "burger", category: "restauration", aliases: ["hamburger"] },
  { name: "menu", category: "restauration" },
  { name: "restaurant", category: "restauration", aliases: ["resto"] },

  // ── Hygiène & beauté ──
  { name: "shampoing", category: "hygiene_beaute", aliases: ["shampooing"] },
  { name: "gel douche", category: "hygiene_beaute" },
  { name: "dentifrice", category: "hygiene_beaute" },
  { name: "savon", category: "hygiene_beaute" },
  { name: "déodorant", category: "hygiene_beaute", aliases: ["déo"] },
  { name: "brosse à dents", category: "hygiene_beaute" },
  { name: "papier toilette", category: "hygiene_beaute", aliases: ["papier hygiénique"] },
  { name: "rasoir", category: "hygiene_beaute" },

  // ── Entretien & maison ──
  { name: "lessive", category: "entretien_maison" },
  { name: "liquide vaisselle", category: "entretien_maison", aliases: ["produit vaisselle"] },
  { name: "éponge", category: "entretien_maison" },
  { name: "sacs poubelle", category: "entretien_maison", aliases: ["sac poubelle"] },
  { name: "essuie-tout", category: "entretien_maison", aliases: ["sopalin"] },
  { name: "javel", category: "entretien_maison", aliases: ["eau de javel"] },
  { name: "ampoule", category: "entretien_maison" },

  // ── Santé ──
  { name: "doliprane", category: "sante", aliases: ["paracétamol", "dafalgan", "efferalgan"] },
  { name: "médicament", category: "sante", aliases: ["médicaments"] },
  { name: "pansements", category: "sante", aliases: ["pansement"] },

  // ── Transport ──
  { name: "essence", category: "transport", aliases: ["plein d'essence", "sans plomb"] },
  { name: "gazole", category: "transport", aliases: ["diesel", "gasoil"] },
  { name: "ticket de métro", category: "transport", aliases: ["ticket métro"] },
  { name: "ticket de bus", category: "transport", aliases: ["ticket bus"] },
  { name: "billet de train", category: "transport", aliases: ["train"] },
  { name: "péage", category: "transport" },
  { name: "parking", category: "transport" },
  { name: "taxi", category: "transport", aliases: ["uber", "vtc"] },

  // ── Loisirs ──
  { name: "magazine", category: "loisirs", aliases: ["journal", "revue"] },
  { name: "livre", category: "loisirs" },
  { name: "place de cinéma", category: "loisirs", aliases: ["cinéma", "ciné"] },
  { name: "concert", category: "loisirs", aliases: ["place de concert"] },
  { name: "jeu", category: "loisirs", aliases: ["jeux", "jeu vidéo"] },

  // ── Habillement ──
  { name: "t-shirt", category: "habillement", aliases: ["tee-shirt"] },
  { name: "pantalon", category: "habillement", aliases: ["jean"] },
  { name: "chaussures", category: "habillement", aliases: ["baskets"] },
  { name: "chaussettes", category: "habillement" },
  { name: "pull", category: "habillement" },
  { name: "veste", category: "habillement", aliases: ["manteau"] },

  // ── Enfants ──
  { name: "couches", category: "enfants", aliases: ["couche"] },
  { name: "jouet", category: "enfants" },
  { name: "lait infantile", category: "enfants", aliases: ["lait bébé"] },

  // ── Animaux ──
  {
    name: "croquettes pour chat",
    category: "animaux",
    aliases: ["croquettes pour le chat", "croquettes chat"],
  },
  {
    name: "croquettes pour chien",
    category: "animaux",
    aliases: ["croquettes pour le chien", "croquettes chien"],
  },
  { name: "croquettes", category: "animaux" },
  { name: "litière", category: "animaux" },
  { name: "pâtée", category: "animaux" },

  // ── High-tech ──
  { name: "chargeur", category: "high_tech" },
  { name: "câble", category: "high_tech" },
  { name: "écouteurs", category: "high_tech" },

  // ── Éducation ──
  { name: "cahier", category: "education" },
  { name: "stylo", category: "education" },
  { name: "fournitures scolaires", category: "education", aliases: ["fournitures"] },

  // ── Abonnements ──
  {
    name: "abonnement",
    category: "abonnements",
    aliases: ["netflix", "spotify", "disney+", "deezer", "forfait mobile", "forfait"],
  },

  // ── Cadeaux ──
  { name: "cadeau", category: "cadeaux" },
  { name: "fleurs", category: "cadeaux", aliases: ["bouquet"] },
];

export interface ProductMatch {
  name: string;
  categoryId: CategoryId;
}

/** Forme « singulier » approximative : retire le -s / -x final des mots de plus de 3 lettres. */
function singularKey(key: string): string {
  return key
    .split(" ")
    .map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w))
    .join(" ");
}

const INDEX = new Map<string, ProductEntry>();
for (const entry of PRODUCTS) {
  for (const form of [entry.name, ...(entry.aliases ?? [])]) {
    const key = toKey(form);
    if (!INDEX.has(key)) INDEX.set(key, entry);
    const singular = singularKey(key);
    if (!INDEX.has(singular)) INDEX.set(singular, entry);
  }
}

/**
 * Cherche un produit. Le magasin sert de contexte : « deux places » au cinéma
 * sont des places de cinéma.
 */
export function lookupProduct(phrase: string, merchant: string | null): ProductMatch | null {
  const key = toKey(phrase);
  if (!key) return null;

  if (/^places?$/.test(key) && merchant && /cin[eé]ma/i.test(merchant)) {
    return { name: "place de cinéma", categoryId: "loisirs" };
  }

  const entry = find(key);
  if (entry) return { name: entry.name, categoryId: entry.category };

  // R14 : début de phrase connu (« vin rouge » → vin, « abonnement netflix » → abonnement).
  // On garde le libellé complet, plus précis, et on reprend la catégorie.
  const words = key.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const prefix = find(words.slice(0, n).join(" "));
    if (prefix) return { name: phrase.trim().toLowerCase(), categoryId: prefix.category };
  }
  return null;
}

function find(key: string): ProductEntry | undefined {
  return INDEX.get(key) ?? INDEX.get(singularKey(key));
}

/** Formes proposées à l'auto-complétion : noms d'abord, puis synonymes. */
const SUGGESTIONS: { key: string; label: string }[] = [
  ...PRODUCTS.map((p) => ({ key: toKey(p.name), label: p.name })),
  ...PRODUCTS.flatMap((p) => (p.aliases ?? []).map((a) => ({ key: toKey(a), label: a }))),
];

/**
 * Produits qui commencent par le début de mot tapé (« bag » → « baguette »).
 * Rien en dessous de 2 lettres ; les formes déjà complètes ne sont pas proposées.
 */
export function suggestProducts(fragment: string, limit = 4): string[] {
  const key = toKey(fragment);
  if (key.length < 2 || /\d/.test(key)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const matches = SUGGESTIONS.filter((s) => s.key.startsWith(key) && s.key !== key);
  for (const s of matches.sort((a, b) => a.key.length - b.key.length)) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    out.push(s.label);
    if (out.length >= limit) break;
  }
  return out;
}

/** Produit du dictionnaire cité quelque part dans la phrase (le plus long l'emporte). */
export function findProductMention(text: string): ProductMatch | null {
  const words = toKey(text).split(" ").filter(Boolean);
  for (let size = Math.min(4, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const entry = find(words.slice(i, i + size).join(" "));
      if (entry) return { name: entry.name, categoryId: entry.category };
    }
  }
  return null;
}
