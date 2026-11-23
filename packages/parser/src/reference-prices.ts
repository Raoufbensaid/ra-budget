/**
 * Prix moyens INDICATIFS en France (fin 2026), fixés à la main pour comparer un prix
 * dit par l'utilisateur. À remplacer plus tard par les prix réels d'Open Prices.
 * Clé : nom normalisé du dictionnaire.
 */
export interface ReferencePrice {
  cents: number;
  /** Prix d'une pièce, d'un kilo ou d'un litre. */
  per: "piece" | "kg" | "l";
}

const piece = (cents: number): ReferencePrice => ({ cents, per: "piece" });
const kg = (cents: number): ReferencePrice => ({ cents, per: "kg" });
const litre = (cents: number): ReferencePrice => ({ cents, per: "l" });

export const REFERENCE_PRICES: Record<string, ReferencePrice> = {
  baguette: piece(110),
  pain: piece(200),
  "pain au chocolat": piece(130),
  croissant: piece(120),
  brioche: piece(300),
  tomates: kg(350),
  cerises: kg(800),
  pommes: kg(280),
  "pommes de terre": kg(180),
  carottes: kg(180),
  bananes: kg(220),
  oranges: kg(280),
  citrons: kg(400),
  fraises: kg(800),
  raisin: kg(400),
  oignons: kg(220),
  courgettes: kg(300),
  poireaux: kg(300),
  salade: piece(130),
  lait: litre(110),
  beurre: piece(250),
  œufs: piece(35),
  poulet: kg(1100),
  "steak haché": kg(1400),
  saumon: kg(2500),
  pâtes: piece(150),
  farine: kg(120),
  sucre: kg(140),
  eau: litre(40),
  "jus d'orange": litre(250),
  soda: litre(180),
  pizza: piece(1200),
  kebab: piece(800),
  sandwich: piece(550),
  burger: piece(1000),
  menu: piece(1100),
  dentifrice: piece(250),
  "gel douche": piece(300),
  shampoing: piece(400),
  savon: piece(200),
  déodorant: piece(400),
  essence: litre(185),
  gazole: litre(175),
  "ticket de métro": piece(250),
  "ticket de bus": piece(200),
  "place de cinéma": piece(1200),
  doliprane: piece(250),
};

export function referencePrice(name: string | null): ReferencePrice | null {
  return name ? (REFERENCE_PRICES[name] ?? null) : null;
}
