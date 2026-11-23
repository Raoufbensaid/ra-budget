/**
 * Conversation de saisie : chaque message de l'utilisateur modifie le panier,
 * puis l'assistant choisit UNE question à poser s'il manque une information.
 * Indépendant de l'interface et de la langue : l'app traduit les événements.
 */
import { CATEGORY_IDS, CATEGORY_LABELS, type CategoryId } from "@ra/core";
import {
  type AddUtterance,
  detectRemark,
  type PriceScope,
  parseAmountReply,
  parsePriceQuestion,
  parseScopeReply,
  parseUtterance,
  type ReferencePrice,
  type Remark,
  referencePrice,
  toKey,
} from "@ra/parser";
import {
  applyCategory,
  applyPrice,
  applyQuantity,
  type Cart,
  type CartItem,
  cartTotals,
  cloneCart,
  EMPTY_CART,
  findItem,
  needsPrice,
  resolveScope,
} from "./cart";
import { comparePrice, type PriceComparison, remarkTarget } from "./remarks";

function remarkEvent(remark: Remark, items: CartItem[]): AssistantEvent {
  const target = remarkTarget(items, remark);
  return {
    kind: "remark",
    remark,
    itemId: target?.id ?? null,
    comparison: target ? comparePrice(target) : null,
  };
}

/** Question en attente, sur un article précis. */
export interface Question {
  kind: "price" | "scope" | "category";
  itemId: string;
}

/** Ce que l'assistant a compris ou fait (l'app le transforme en phrase). */
export type AssistantEvent =
  | { kind: "added"; itemIds: string[] }
  | { kind: "updated"; itemId: string }
  | { kind: "removed"; label: string }
  | { kind: "total"; cents: number }
  | { kind: "context"; merchant: string | null; date: string | null }
  | { kind: "not_found"; target: string }
  | { kind: "not_understood" }
  | { kind: "undone" }
  | { kind: "nothing_to_undo" }
  | { kind: "total_mismatch"; declaredCents: number; itemsCents: number }
  | { kind: "price_info"; name: string | null; reference: ReferencePrice | null }
  | {
      kind: "remark";
      remark: Remark;
      itemId: string | null;
      comparison: PriceComparison | null;
    };

interface Snapshot {
  cart: Cart;
  question: Question | null;
}

export interface Conversation {
  cart: Cart;
  question: Question | null;
  /** États précédents, pour « Annuler ». */
  past: Snapshot[];
  nextId: number;
}

export interface Step {
  conversation: Conversation;
  events: AssistantEvent[];
}

export function createConversation(): Conversation {
  return { cart: cloneCart(EMPTY_CART), question: null, past: [], nextId: 1 };
}

/** Question suivante : d'abord les prix manquants, puis les ambiguïtés, puis les catégories. */
export function nextQuestion(cart: Cart): Question | null {
  const missing = cart.items.find(needsPrice);
  if (missing) return { kind: "price", itemId: missing.id };
  const ambiguous = cart.items.find((i) => i.ambiguous);
  if (ambiguous) return { kind: "scope", itemId: ambiguous.id };
  const unknown = cart.items.find((i) => i.categoryId === null);
  if (unknown) return { kind: "category", itemId: unknown.id };
  return null;
}

const SKIP_CATEGORY =
  /^(?:passe|passer|suivant|je (?:ne )?sais pas|j'en sais rien|aucune idee|autre|other|skip)$/;

function words(s: string): string {
  return toKey(s)
    .split(" ")
    .map((w) => (w.length > 3 ? w.replace(/[sx]$/, "") : w))
    .join(" ");
}

/** Mots courants qui ne sont pas des noms de catégorie. */
const CATEGORY_ALIASES: Record<string, CategoryId> = {
  resto: "restauration",
  restaurant: "restauration",
  course: "alimentation",
  "le course": "alimentation",
  "les course": "alimentation",
  bouffe: "alimentation",
  nourriture: "alimentation",
  pharmacie: "sante",
  vetement: "habillement",
  essence: "transport",
  carburant: "transport",
  maison: "entretien_maison",
  sortie: "loisirs",
};

/** Catégorie dite en toutes lettres (« alimentation », « resto », « loisirs »). */
export function matchCategory(text: string): CategoryId | null {
  const t = words(text.replace(/[.!?]/g, ""));
  if (!t) return null;
  if (SKIP_CATEGORY.test(toKey(text.replace(/[.!?]/g, "")))) return "autre";
  const alias = CATEGORY_ALIASES[t];
  if (alias) return alias;
  for (const id of CATEGORY_IDS) {
    const labels = [CATEGORY_LABELS[id].fr, CATEGORY_LABELS[id].en, id.replace("_", " ")].map(
      words,
    );
    if (labels.some((l) => l === t || (t.length >= 4 && l.startsWith(t)))) return id;
  }
  return null;
}

/** Applique une modification à l'article visé et enchaîne la question suivante. */
function commit(
  conv: Conversation,
  cart: Cart,
  events: AssistantEvent[],
  nextId = conv.nextId,
): Step {
  const before = cartTotals(conv.cart);
  const after = cartTotals(cart);
  const out = [...events];
  const totalChanged = events.some((e) => e.kind === "total");
  if (after.mismatch && (!before.mismatch || totalChanged) && cart.declaredTotalCents !== null) {
    out.push({
      kind: "total_mismatch",
      declaredCents: cart.declaredTotalCents,
      itemsCents: after.knownCents,
    });
  }
  return {
    conversation: {
      cart,
      question: nextQuestion(cart),
      past: [...conv.past, { cart: conv.cart, question: conv.question }],
      nextId,
    },
    events: out,
  };
}

function replaceItem(cart: Cart, item: CartItem): Cart {
  const next = cloneCart(cart);
  next.items = next.items.map((i) => (i.id === item.id ? item : i));
  return next;
}

/** Réponse à la question en attente, ou null si le message n'y répond pas. */
function answerPending(conv: Conversation, text: string): Step | null {
  const q = conv.question;
  const item = q ? conv.cart.items.find((i) => i.id === q.itemId) : undefined;
  if (!q || !item) return null;

  let updated: CartItem | null = null;
  if (q.kind === "price" || q.kind === "scope") {
    const amount = parseAmountReply(text);
    if (amount) updated = applyPrice(item, amount.cents, amount.scope);
    else if (q.kind === "scope") {
      const scope = parseScopeReply(text);
      if (scope) updated = resolveScope(item, scope);
    }
  } else {
    const category = matchCategory(text);
    if (category) updated = applyCategory(item, category);
  }
  if (!updated) return null;
  return commit(conv, replaceItem(conv.cart, updated), [{ kind: "updated", itemId: item.id }]);
}

function addItems(conv: Conversation, utterance: AddUtterance): Step {
  const cart = cloneCart(conv.cart);
  let nextId = conv.nextId;
  const parsed = utterance.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.name !== null);

  const groupId = utterance.totalPaidCents !== null && parsed.length > 0 ? `g${nextId++}` : null;
  if (groupId !== null && utterance.totalPaidCents !== null) {
    cart.groups.push({ id: groupId, cents: utterance.totalPaidCents });
  }

  const added: CartItem[] = parsed.map(({ item, index }) => ({
    ...item,
    id: `i${nextId++}`,
    ambiguous: utterance.issues.some(
      (issue) => issue.code === "AMBIGUOUS_PRICE_SCOPE" && issue.itemIndex === index,
    ),
    groupId: item.totalPriceCents === null && groupId !== null ? groupId : null,
  }));
  cart.items.push(...added);
  if (utterance.merchant !== null) cart.merchant = utterance.merchant;
  if (utterance.date !== null) cart.date = utterance.date;

  const events: AssistantEvent[] = [];
  if (added.length > 0) {
    events.push({ kind: "added", itemIds: added.map((i) => i.id) });
    if (utterance.remark) events.push(remarkEvent(utterance.remark, added));
  } else if (utterance.merchant !== null || utterance.date !== null) {
    events.push({ kind: "context", merchant: utterance.merchant, date: utterance.date });
  } else {
    return { conversation: conv, events: [{ kind: "not_understood" }] };
  }
  return commit(conv, cart, events, nextId);
}

function removeFromCart(cart: Cart, id: string): Cart {
  const next = cloneCart(cart);
  next.items = next.items.filter((i) => i.id !== id);
  next.groups = next.groups.filter((g) => next.items.some((i) => i.groupId === g.id));
  return next;
}

export interface MessageOptions {
  now: Date;
}

/** Traite un message de l'utilisateur (tapé ou dicté). */
export function handleMessage(conv: Conversation, text: string, options: MessageOptions): Step {
  // « Ça coûte combien une baguette ? » : on répond sans toucher au panier.
  const asked = parsePriceQuestion(text);
  if (asked) {
    return {
      conversation: conv,
      events: [{ kind: "price_info", name: asked.name, reference: referencePrice(asked.name) }],
    };
  }

  const pending = answerPending(conv, text);
  if (pending) return pending;

  const utterance = parseUtterance(text, { now: options.now });
  switch (utterance.kind) {
    case "add":
      return addItems(conv, utterance);
    case "total": {
      const cart = cloneCart(conv.cart);
      cart.declaredTotalCents = utterance.totalPaidCents;
      return commit(conv, cart, [{ kind: "total", cents: utterance.totalPaidCents }]);
    }
    case "remove": {
      const item = findItem(conv.cart, utterance.target);
      if (!item)
        return { conversation: conv, events: [{ kind: "not_found", target: utterance.target }] };
      return commit(conv, removeFromCart(conv.cart, item.id), [
        { kind: "removed", label: item.name ?? item.rawLabel },
      ]);
    }
    case "correct": {
      const item = findItem(conv.cart, utterance.target);
      if (!item)
        return { conversation: conv, events: [{ kind: "not_found", target: utterance.target }] };
      let updated = item;
      if (utterance.changes.quantity !== undefined) {
        updated = applyQuantity(updated, utterance.changes.quantity);
      }
      if (utterance.changes.priceCents !== undefined) {
        updated = applyPrice(updated, utterance.changes.priceCents, null);
      }
      return commit(conv, replaceItem(conv.cart, updated), [{ kind: "updated", itemId: item.id }]);
    }
    default: {
      // Commentaire seul après un ajout : « elle était trop chère ».
      const remark = detectRemark(text);
      const last = conv.cart.items[conv.cart.items.length - 1];
      if (remark && last) return { conversation: conv, events: [remarkEvent(remark, [last])] };
      return { conversation: conv, events: [{ kind: "not_understood" }] };
    }
  }
}

/** Réponse par bouton à la question de portée (« chacun » / « en tout »). */
export function answerScope(conv: Conversation, itemId: string, scope: PriceScope): Step {
  const item = conv.cart.items.find((i) => i.id === itemId);
  if (!item) return { conversation: conv, events: [] };
  return commit(conv, replaceItem(conv.cart, resolveScope(item, scope)), [
    { kind: "updated", itemId },
  ]);
}

/** Réponse par bouton à la question de catégorie. */
export function answerCategory(conv: Conversation, itemId: string, categoryId: CategoryId): Step {
  const item = conv.cart.items.find((i) => i.id === itemId);
  if (!item) return { conversation: conv, events: [] };
  return commit(conv, replaceItem(conv.cart, applyCategory(item, categoryId)), [
    { kind: "updated", itemId },
  ]);
}

/** Suppression depuis le panier (bouton corbeille). */
export function removeItem(conv: Conversation, itemId: string): Step {
  const item = conv.cart.items.find((i) => i.id === itemId);
  if (!item) return { conversation: conv, events: [] };
  return commit(conv, removeFromCart(conv.cart, itemId), [
    { kind: "removed", label: item.name ?? item.rawLabel },
  ]);
}

/** Revient à l'état d'avant le dernier changement. */
export function undo(conv: Conversation): Step {
  const previous = conv.past[conv.past.length - 1];
  if (!previous) return { conversation: conv, events: [{ kind: "nothing_to_undo" }] };
  return {
    conversation: { ...conv, ...previous, past: conv.past.slice(0, -1) },
    events: [{ kind: "undone" }],
  };
}
