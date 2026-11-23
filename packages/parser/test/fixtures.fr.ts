/**
 * CAS DE TEST DE L'EXTRACTEUR (français) — À VALIDER AVANT IMPLÉMENTATION.
 *
 * Date de référence de tous les tests : lundi 23 novembre 2026.
 *
 * RÈGLES PROPOSÉES (chaque cas indique la règle qu'il illustre) :
 *  R1  « à X » après un article compté → X est le prix UNITAIRE (total = quantité × X).
 *  R2  « pour X », « X en tout », « X au total » → X est le prix TOTAL de la ligne.
 *  R3  Prix sans préposition et quantité > 1 (« deux cafés 3,40 ») → on suppose un
 *      TOTAL, mais on signale AMBIGUOUS_PRICE_SCOPE pour confirmation.
 *  R4  Poids/volume : « à X le kilo / le litre » → prix au kilo/litre. Sinon le prix
 *      est le total de la ligne ; si la quantité n'est pas exactement 1 kg / 1 l,
 *      on signale AMBIGUOUS_PRICE_SCOPE.
 *  R5  Formats de prix : « 2,50 », « 2.50 », « 2€50 », « 2 euros 50 »,
 *      « deux euros cinquante », « deux cinquante », « 50 centimes », « 3 balles ».
 *  R6  Quantités : chiffres, nombres en lettres, « une douzaine » (12).
 *      Un conditionnement (« une douzaine », « un pack de 6 ») se paie d'un seul prix :
 *      « à X » est alors le prix du lot entier, pas d'une pièce.
 *  R0  (général) Le prix unitaire est déduit du total seulement si la division tombe
 *      juste au centime ; sinon il reste null.
 *  R7  Plusieurs articles dans une phrase (« et », « , », « plus »).
 *  R8  Prix global pour plusieurs articles → totalPaidCents, prix des lignes à null,
 *      sans MISSING_PRICE.
 *  R9  Article sans prix → MISSING_PRICE (l'assistant relancera).
 *  R10 Contexte : magasin (« chez Lidl », « au Carrefour », « à la boulangerie »)
 *      et date (« hier », « avant-hier », « samedi », « le 15 novembre »).
 *      Sans date → null (l'application utilisera aujourd'hui).
 *  R11 Mots parasites ignorés : « j'ai acheté », « j'ai pris », « euh », « aussi »…
 *  R12 Corrections et suppressions d'un article déjà saisi.
 *  R13 Annonce du total payé.
 *  R14 Catégorisation par dictionnaire, y compris hors alimentation. Si seul le début
 *      du libellé est connu (« vin rouge »), on garde le libellé complet et on reprend
 *      la catégorie du produit connu.
 *  R15 Phrase hors sujet → unknown.
 *  R16 Produit absent du dictionnaire → catégorie null + UNKNOWN_PRODUCT.
 *  R17 Produit placé après le prix (« deux euros de bonbons », « 50 euros d'essence »).
 */
import type { CategoryId, Unit } from "@ra/core";
import type { AddUtterance, ParsedIssue, ParsedItem, ParsedUtterance } from "../src";

export const REFERENCE_DATE = new Date("2026-11-23T12:00:00");

export type ExpectedItem = Pick<
  ParsedItem,
  "name" | "quantity" | "unit" | "unitPriceCents" | "totalPriceCents" | "categoryId"
>;

export type ExpectedAdd = Omit<AddUtterance, "items"> & { items: ExpectedItem[] };
export type ExpectedUtterance = ExpectedAdd | Exclude<ParsedUtterance, AddUtterance>;

export interface ParserFixture {
  id: string;
  rule: string;
  input: string;
  expected: ExpectedUtterance;
}

function item(
  name: string | null,
  quantity: number,
  unit: Unit,
  unitPriceCents: number | null,
  totalPriceCents: number | null,
  categoryId: CategoryId | null,
): ExpectedItem {
  return { name, quantity, unit, unitPriceCents, totalPriceCents, categoryId };
}

function add(
  items: ExpectedItem[],
  extra: Partial<Omit<ExpectedAdd, "kind" | "items">> = {},
): ExpectedAdd {
  return {
    kind: "add",
    items,
    merchant: null,
    date: null,
    totalPaidCents: null,
    issues: [] as ParsedIssue[],
    remark: null,
    ...extra,
  };
}

export const FIXTURES: ParserFixture[] = [
  // ── R1 : prix unitaire avec « à » ────────────────────────────────────────
  {
    id: "R1-01",
    rule: "R1",
    input: "J'ai acheté une baguette à 1,20 €",
    expected: add([item("baguette", 1, "piece", 120, 120, "alimentation")]),
  },
  {
    id: "R1-02",
    rule: "R1",
    input: "deux croissants à 1,10",
    expected: add([item("croissant", 2, "piece", 110, 220, "alimentation")]),
  },
  {
    id: "R1-03",
    rule: "R1",
    input: "3 yaourts à 0,80 euro",
    expected: add([item("yaourt", 3, "piece", 80, 240, "alimentation")]),
  },

  // ── R2 : prix total ──────────────────────────────────────────────────────
  {
    id: "R2-01",
    rule: "R2",
    input: "deux baguettes pour 2,40",
    expected: add([item("baguette", 2, "piece", 120, 240, "alimentation")]),
  },
  {
    id: "R2-02",
    rule: "R2",
    input: "quatre bières 6 euros en tout",
    expected: add([item("bière", 4, "piece", 150, 600, "boissons")]),
  },

  // ── R3 : ambiguïté unitaire / total ──────────────────────────────────────
  {
    id: "R3-01",
    rule: "R3",
    input: "deux cafés 3,40",
    expected: add([item("café", 2, "piece", 170, 340, "boissons")], {
      issues: [{ code: "AMBIGUOUS_PRICE_SCOPE", itemIndex: 0 }],
    }),
  },
  {
    id: "R3-02",
    rule: "R3",
    input: "un café 1,80",
    expected: add([item("café", 1, "piece", 180, 180, "boissons")]),
  },

  // ── R4 : poids et volumes ────────────────────────────────────────────────
  {
    id: "R4-01",
    rule: "R4",
    input: "un kilo de tomates à 3,50 €",
    expected: add([item("tomates", 1, "kg", 350, 350, "alimentation")]),
  },
  {
    id: "R4-02",
    rule: "R4",
    input: "500 g de cerises à 8 € le kilo",
    expected: add([item("cerises", 500, "g", 800, 400, "alimentation")]),
  },
  {
    id: "R4-03",
    rule: "R4",
    input: "500 grammes de cerises à 4 euros",
    expected: add([item("cerises", 500, "g", 800, 400, "alimentation")], {
      issues: [{ code: "AMBIGUOUS_PRICE_SCOPE", itemIndex: 0 }],
    }),
  },
  {
    id: "R4-04",
    rule: "R4",
    input: "deux litres de lait à 1,05 le litre",
    expected: add([item("lait", 2, "l", 105, 210, "alimentation")]),
  },
  {
    id: "R4-05",
    rule: "R4",
    input: "1,2 kg de pommes pour 3,60",
    expected: add([item("pommes", 1.2, "kg", 300, 360, "alimentation")]),
  },

  // ── R5 : formats de prix ─────────────────────────────────────────────────
  {
    id: "R5-01",
    rule: "R5",
    input: "une baguette 1.20",
    expected: add([item("baguette", 1, "piece", 120, 120, "alimentation")]),
  },
  {
    id: "R5-02",
    rule: "R5",
    input: "un shampoing 4€99",
    expected: add([item("shampoing", 1, "piece", 499, 499, "hygiene_beaute")]),
  },
  {
    id: "R5-03",
    rule: "R5",
    input: "une lessive à 12 euros 50",
    expected: add([item("lessive", 1, "piece", 1250, 1250, "entretien_maison")]),
  },
  {
    id: "R5-04",
    rule: "R5",
    input: "un fromage à deux euros cinquante",
    expected: add([item("fromage", 1, "piece", 250, 250, "alimentation")]),
  },
  {
    id: "R5-05",
    rule: "R5",
    input: "un pain au chocolat deux cinquante",
    expected: add([item("pain au chocolat", 1, "piece", 250, 250, "alimentation")]),
  },
  {
    id: "R5-06",
    rule: "R5",
    input: "un bonbon à 50 centimes",
    expected: add([item("bonbon", 1, "piece", 50, 50, "alimentation")]),
  },
  {
    id: "R5-07",
    rule: "R5",
    input: "un magazine 3 balles",
    expected: add([item("magazine", 1, "piece", 300, 300, "loisirs")]),
  },
  {
    id: "R5-08",
    rule: "R5",
    input: "un plein d'essence à soixante-dix euros",
    expected: add([item("essence", 1, "piece", 7000, 7000, "transport")]),
  },
  {
    id: "R5-09",
    rule: "R5",
    input: "une pizza à 12 €",
    expected: add([item("pizza", 1, "piece", 1200, 1200, "restauration")]),
  },

  // ── R6 : quantités et conditionnements ───────────────────────────────────
  {
    id: "R6-01",
    rule: "R6",
    input: "une douzaine d'œufs à 3,20",
    expected: add([item("œufs", 12, "piece", null, 320, "alimentation")]),
  },
  {
    id: "R6-02",
    rule: "R6",
    input: "un pack de 6 bouteilles d'eau à 3 €",
    expected: add([item("pack d'eau 6 bouteilles", 1, "piece", 300, 300, "boissons")]),
  },
  {
    id: "R6-03",
    rule: "R6",
    input: "dix tickets de métro pour 19,10",
    expected: add([item("ticket de métro", 10, "piece", 191, 1910, "transport")]),
  },

  // ── R7 : plusieurs articles ──────────────────────────────────────────────
  {
    id: "R7-01",
    rule: "R7",
    input: "une baguette à 1,20 et deux croissants à 1,10",
    expected: add([
      item("baguette", 1, "piece", 120, 120, "alimentation"),
      item("croissant", 2, "piece", 110, 220, "alimentation"),
    ]),
  },
  {
    id: "R7-02",
    rule: "R7",
    input: "du lait à 1,05, des pâtes à 0,90 et un shampoing à 3,50",
    expected: add([
      item("lait", 1, "piece", 105, 105, "alimentation"),
      item("pâtes", 1, "piece", 90, 90, "alimentation"),
      item("shampoing", 1, "piece", 350, 350, "hygiene_beaute"),
    ]),
  },
  {
    id: "R7-03",
    rule: "R7",
    input: "un Doliprane 2,18 plus des croquettes pour le chat 15 euros",
    expected: add([
      item("doliprane", 1, "piece", 218, 218, "sante"),
      item("croquettes pour chat", 1, "piece", 1500, 1500, "animaux"),
    ]),
  },

  // ── R8 : prix global ─────────────────────────────────────────────────────
  {
    id: "R8-01",
    rule: "R8",
    input: "une baguette et deux croissants pour 3,40",
    expected: add(
      [
        item("baguette", 1, "piece", null, null, "alimentation"),
        item("croissant", 2, "piece", null, null, "alimentation"),
      ],
      { totalPaidCents: 340 },
    ),
  },

  // ── R9 : prix manquant ───────────────────────────────────────────────────
  {
    id: "R9-01",
    rule: "R9",
    input: "j'ai pris des carottes",
    expected: add([item("carottes", 1, "piece", null, null, "alimentation")], {
      issues: [{ code: "MISSING_PRICE", itemIndex: 0 }],
    }),
  },
  {
    id: "R9-02",
    rule: "R9",
    input: "une baguette à 1,20 et deux croissants",
    expected: add(
      [
        item("baguette", 1, "piece", 120, 120, "alimentation"),
        item("croissant", 2, "piece", null, null, "alimentation"),
      ],
      { issues: [{ code: "MISSING_PRICE", itemIndex: 1 }] },
    ),
  },

  // ── R10 : magasin et date ────────────────────────────────────────────────
  {
    id: "R10-01",
    rule: "R10",
    input: "hier chez Lidl un kilo de tomates à 3,50",
    expected: add([item("tomates", 1, "kg", 350, 350, "alimentation")], {
      merchant: "Lidl",
      date: "2026-11-22",
    }),
  },
  {
    id: "R10-02",
    rule: "R10",
    input: "au Carrefour avant-hier, du lait 1,05",
    expected: add([item("lait", 1, "piece", 105, 105, "alimentation")], {
      merchant: "Carrefour",
      date: "2026-11-21",
    }),
  },
  {
    id: "R10-03",
    rule: "R10",
    input: "samedi à la boulangerie une baguette 1,20",
    expected: add([item("baguette", 1, "piece", 120, 120, "alimentation")], {
      merchant: "Boulangerie",
      date: "2026-11-21",
    }),
  },
  {
    id: "R10-04",
    rule: "R10",
    input: "le 15 novembre au cinéma, deux places à 11,50",
    expected: add([item("place de cinéma", 2, "piece", 1150, 2300, "loisirs")], {
      merchant: "Cinéma",
      date: "2026-11-15",
    }),
  },

  // ── R11 : mots parasites ─────────────────────────────────────────────────
  {
    id: "R11-01",
    rule: "R11",
    input: "euh j'ai aussi acheté, euh, une salade à 1 euro",
    expected: add([item("salade", 1, "piece", 100, 100, "alimentation")]),
  },
  {
    id: "R11-02",
    rule: "R11",
    input: "je viens d'acheter un ticket de bus 2 €",
    expected: add([item("ticket de bus", 1, "piece", 200, 200, "transport")]),
  },

  // ── R12 : corrections et suppressions ────────────────────────────────────
  {
    id: "R12-01",
    rule: "R12",
    input: "non, la baguette c'était 1,10",
    expected: { kind: "correct", target: "baguette", changes: { priceCents: 110 } },
  },
  {
    id: "R12-02",
    rule: "R12",
    input: "en fait c'était trois croissants",
    expected: { kind: "correct", target: "croissant", changes: { quantity: 3 } },
  },
  {
    id: "R12-03",
    rule: "R12",
    input: "enlève les tomates",
    expected: { kind: "remove", target: "tomates" },
  },
  {
    id: "R12-04",
    rule: "R12",
    input: "supprime le lait",
    expected: { kind: "remove", target: "lait" },
  },

  // ── R13 : total payé ─────────────────────────────────────────────────────
  {
    id: "R13-01",
    rule: "R13",
    input: "j'ai payé 23,45 en tout",
    expected: { kind: "total", totalPaidCents: 2345 },
  },
  {
    id: "R13-02",
    rule: "R13",
    input: "le total c'est 47 euros 80",
    expected: { kind: "total", totalPaidCents: 4780 },
  },

  // ── R14 : catégorisation par début de libellé ───────────────────────────
  {
    id: "R14-01",
    rule: "R14",
    input: "un abonnement Netflix 13,49",
    expected: add([item("abonnement netflix", 1, "piece", 1349, 1349, "abonnements")]),
  },
  {
    id: "R14-02",
    rule: "R14",
    input: "une bouteille de vin rouge à 8,99",
    expected: add([item("vin rouge", 1, "piece", 899, 899, "boissons")]),
  },

  // ── R15 : hors sujet ─────────────────────────────────────────────────────
  { id: "R15-01", rule: "R15", input: "bonjour", expected: { kind: "unknown" } },
  { id: "R15-02", rule: "R15", input: "quel temps fait-il ?", expected: { kind: "unknown" } },

  // ── R16 : produit inconnu ────────────────────────────────────────────────
  {
    id: "R16-01",
    rule: "R16",
    input: "un truc bizarre à 5 euros",
    expected: add([item("truc bizarre", 1, "piece", 500, 500, null)], {
      issues: [{ code: "UNKNOWN_PRODUCT", itemIndex: 0 }],
    }),
  },

  // ── R17 : produit après le prix ──────────────────────────────────────────
  {
    id: "R17-01",
    rule: "R17",
    input: "j'ai mis 50 euros d'essence",
    expected: add([item("essence", 1, "piece", 5000, 5000, "transport")]),
  },
  {
    id: "R17-02",
    rule: "R17",
    input: "deux euros de bonbons",
    expected: add([item("bonbon", 1, "piece", 200, 200, "alimentation")]),
  },
];
