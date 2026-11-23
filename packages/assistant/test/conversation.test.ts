import { purchaseDraftSchema } from "@ra/core";
import { describe, expect, it } from "vitest";
import {
  type AssistantEvent,
  answerCategory,
  answerScope,
  type Conversation,
  canValidate,
  cartTotals,
  createConversation,
  handleMessage,
  matchCategory,
  removeItem,
  toPurchaseDraft,
  undo,
} from "../src";

const NOW = new Date("2026-11-23T12:00:00");

/** Enchaîne des messages et renvoie la conversation et les derniers événements. */
function say(...messages: string[]): { conv: Conversation; events: AssistantEvent[] } {
  let conv = createConversation();
  let events: AssistantEvent[] = [];
  for (const m of messages) {
    const step = handleMessage(conv, m, { now: NOW });
    conv = step.conversation;
    events = step.events;
  }
  return { conv, events };
}

function item(conv: Conversation, index: number) {
  const found = conv.cart.items[index];
  if (!found) throw new Error(`Pas d'article ${index}`);
  return found;
}

describe("ajout et questions", () => {
  it("ajoute un article complet sans poser de question", () => {
    const { conv, events } = say("une baguette à 1,20");
    expect(events).toEqual([{ kind: "added", itemIds: ["i1"] }]);
    expect(item(conv, 0)).toMatchObject({ name: "baguette", totalPriceCents: 120 });
    expect(conv.question).toBeNull();
    expect(canValidate(conv.cart)).toBe(true);
  });

  it("demande le prix manquant puis accepte un montant seul", () => {
    let { conv } = say("une baguette à 1,20 et deux croissants");
    expect(conv.question).toEqual({ kind: "price", itemId: "i2" });
    expect(canValidate(conv.cart)).toBe(false);

    conv = handleMessage(conv, "1,10 chacun", { now: NOW }).conversation;
    expect(item(conv, 1)).toMatchObject({ unitPriceCents: 110, totalPriceCents: 220 });
    expect(conv.question).toBeNull();
    expect(cartTotals(conv.cart).knownCents).toBe(340);
  });

  it("demande la portée d'un prix ambigu, réponse par texte", () => {
    let { conv } = say("trois croissants 3,30");
    expect(conv.question).toEqual({ kind: "scope", itemId: "i1" });
    conv = handleMessage(conv, "en tout", { now: NOW }).conversation;
    expect(item(conv, 0)).toMatchObject({ totalPriceCents: 330, unitPriceCents: 110 });
    expect(item(conv, 0).ambiguous).toBe(false);
  });

  it("demande la portée d'un prix ambigu, réponse par bouton", () => {
    const { conv } = say("trois croissants 1,10");
    const next = answerScope(conv, "i1", "unit").conversation;
    expect(item(next, 0)).toMatchObject({ unitPriceCents: 110, totalPriceCents: 330 });
  });

  it("une réponse « deux cinquante » à la question du prix", () => {
    const { conv } = say("un kilo de pommes", "deux cinquante");
    expect(item(conv, 0)).toMatchObject({ totalPriceCents: 250, unitPriceCents: 250 });
  });

  it("demande la catégorie d'un produit inconnu", () => {
    let { conv } = say("un zorglub à 4 euros");
    expect(conv.question).toEqual({ kind: "category", itemId: "i1" });
    expect(canValidate(conv.cart)).toBe(true);
    conv = handleMessage(conv, "loisirs", { now: NOW }).conversation;
    expect(item(conv, 0).categoryId).toBe("loisirs");
    expect(conv.question).toBeNull();
  });

  it("catégorie par bouton", () => {
    const { conv } = say("un zorglub à 4 euros");
    const next = answerCategory(conv, "i1", "cadeaux").conversation;
    expect(item(next, 0).categoryId).toBe("cadeaux");
  });

  it("un message qui ne répond pas à la question est traité normalement", () => {
    const { conv } = say("deux croissants", "une baguette à 1,20");
    expect(conv.cart.items).toHaveLength(2);
    expect(conv.question).toEqual({ kind: "price", itemId: "i1" });
  });

  it("phrase incomprise : le panier ne change pas", () => {
    const { conv, events } = say("une baguette à 1,20", "bonjour comment ça va");
    expect(events).toEqual([{ kind: "not_understood" }]);
    expect(conv.cart.items).toHaveLength(1);
    expect(conv.past).toHaveLength(1);
  });
});

describe("prix groupé, magasin et date", () => {
  it("un prix pour plusieurs articles ne demande aucun prix", () => {
    const { conv } = say("une baguette et deux croissants pour 3,40");
    expect(conv.cart.groups).toEqual([{ id: "g1", cents: 340 }]);
    expect(conv.cart.items.every((i) => i.groupId === "g1")).toBe(true);
    expect(conv.question).toBeNull();
    expect(cartTotals(conv.cart)).toMatchObject({ knownCents: 340, complete: true });
  });

  it("retirer tous les articles d'un groupe retire le groupe", () => {
    const { conv } = say("une baguette et deux croissants pour 3,40", "enlève la baguette");
    expect(conv.cart.groups).toHaveLength(1);
    const next = removeItem(conv, "i3").conversation;
    expect(next.cart.items).toHaveLength(0);
    expect(next.cart.groups).toHaveLength(0);
  });

  it("garde le magasin et la date", () => {
    const { conv } = say("hier chez Lidl une baguette à 1,20");
    expect(conv.cart).toMatchObject({ merchant: "Lidl", date: "2026-11-22" });
  });
});

describe("corrections, suppressions, total, annulation", () => {
  it("corrige un prix", () => {
    const { conv, events } = say("une baguette à 1,20", "non, la baguette c'était 1,10");
    expect(events).toEqual([{ kind: "updated", itemId: "i1" }]);
    expect(item(conv, 0).totalPriceCents).toBe(110);
  });

  it("corrige une quantité en gardant le prix unitaire", () => {
    const { conv } = say("deux croissants à 1,10", "en fait c'était trois croissants");
    expect(item(conv, 0)).toMatchObject({ quantity: 3, unitPriceCents: 110, totalPriceCents: 330 });
  });

  it("supprime un article au pluriel", () => {
    const { conv, events } = say("un kilo de tomates à 3 euros", "enlève les tomates");
    expect(events).toEqual([{ kind: "removed", label: "tomates" }]);
    expect(conv.cart.items).toHaveLength(0);
  });

  it("signale un article introuvable", () => {
    const { events } = say("une baguette à 1,20", "enlève les tomates");
    expect(events).toEqual([{ kind: "not_found", target: "tomates" }]);
  });

  it("signale un total qui ne correspond pas", () => {
    const { conv, events } = say("une baguette à 1,20", "j'ai payé 2 euros");
    expect(events).toContainEqual({ kind: "total_mismatch", declaredCents: 200, itemsCents: 120 });
    expect(cartTotals(conv.cart).mismatch).toBe(true);
  });

  it("annule le dernier changement", () => {
    const { conv } = say("une baguette à 1,20", "deux croissants à 1,10");
    const step = undo(conv);
    expect(step.events).toEqual([{ kind: "undone" }]);
    expect(step.conversation.cart.items).toHaveLength(1);
    expect(undo(undo(step.conversation).conversation).events).toEqual([
      { kind: "nothing_to_undo" },
    ]);
  });
});

describe("brouillon d'achat", () => {
  it("produit un brouillon valide avec la date du jour par défaut", () => {
    const { conv } = say("chez Lidl une baguette à 1,20 et deux croissants à 1,10");
    const draft = toPurchaseDraft(conv.cart, { source: "text", today: "2026-11-23" });
    expect(purchaseDraftSchema.parse(draft)).toEqual(draft);
    expect(draft).toMatchObject({
      source: "text",
      merchant: "Lidl",
      date: "2026-11-23",
      totalPaidCents: 340,
      issues: [],
    });
    expect(draft.items.every((i) => i.priceSource === "declared")).toBe(true);
  });

  it("le total déclaré l'emporte et l'écart est signalé", () => {
    const { conv } = say("une baguette à 1,20", "j'ai payé 2 euros");
    const draft = toPurchaseDraft(conv.cart, { source: "voice", today: "2026-11-23" });
    expect(draft.totalPaidCents).toBe(200);
    expect(draft.issues).toContainEqual({ code: "TOTAL_MISMATCH" });
  });
});

describe("matchCategory", () => {
  it.each([
    ["alimentation", "alimentation"],
    ["Loisirs", "loisirs"],
    ["resto", "restauration"],
    ["les courses", "alimentation"],
    ["truc", null],
    ["restauration", "restauration"],
    ["santé", "sante"],
    ["High-tech", "high_tech"],
    ["groceries", "alimentation"],
    ["je sais pas", "autre"],
    ["anim", "animaux"],
    ["animaux", "animaux"],
  ])("« %s » → %s", (text, expected) => {
    expect(matchCategory(text)).toBe(expected);
  });
});

describe("commentaires", () => {
  it("répond à « trop cher » en comparant au prix moyen", () => {
    const { events } = say("j'ai acheté une baguette à 2 euro, elle est trop cher");
    expect(events).toEqual([
      { kind: "added", itemIds: ["i1"] },
      {
        kind: "remark",
        remark: "expensive",
        itemId: "i1",
        comparison: { referenceCents: 110, per: "piece", paidCents: 200, level: "above" },
      },
    ]);
  });

  it("compare au kilo", () => {
    const { events } = say("2 kilos de tomates pour 5 euros, pas cher");
    expect(events[1]).toMatchObject({
      remark: "cheap",
      comparison: { paidCents: 250, level: "below" },
    });
  });

  it("vise l'article le plus cher par rapport à la moyenne", () => {
    const { events } = say("une baguette à 1,10 et un croissant à 3 euros, trop cher");
    expect(events[1]).toMatchObject({ remark: "expensive", itemId: "i2" });
  });

  it("produit inconnu : commentaire sans comparaison", () => {
    const { events } = say("un zorglub à 4 euros, délicieux");
    expect(events[1]).toEqual({ kind: "remark", remark: "liked", itemId: "i1", comparison: null });
  });

  it("commentaire seul après l'ajout, sans modifier le panier", () => {
    const { conv, events } = say("une baguette à 2 euros", "elle était vraiment trop chère");
    expect(events).toEqual([
      {
        kind: "remark",
        remark: "expensive",
        itemId: "i1",
        comparison: { referenceCents: 110, per: "piece", paidCents: 200, level: "above" },
      },
    ]);
    expect(conv.past).toHaveLength(1);
  });
});

describe("questions de prix", () => {
  it("donne le prix moyen sans modifier le panier", () => {
    const { conv, events } = say("Tu penses ça coute combien une baguette normal ?");
    expect(events).toEqual([
      { kind: "price_info", name: "baguette", reference: { cents: 110, per: "piece" } },
    ]);
    expect(conv.cart.items).toHaveLength(0);
    expect(conv.past).toHaveLength(0);
  });

  it("produit sans prix moyen connu", () => {
    const { events } = say("combien coûte un zorglub ?");
    expect(events).toEqual([{ kind: "price_info", name: null, reference: null }]);
  });

  it("la question en attente reste posée", () => {
    const { conv } = say("deux croissants", "ça coûte combien un croissant ?");
    expect(conv.question).toEqual({ kind: "price", itemId: "i1" });
  });
});
