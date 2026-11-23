/**
 * État de l'écran « Ajouter une dépense » : conversation avec l'assistant,
 * messages affichés et brouillons validés pendant la session.
 */
import {
  type AssistantEvent,
  answerCategory,
  answerScope,
  type Conversation,
  canValidate,
  createConversation,
  handleMessage,
  type Question,
  removeItem,
  type Step,
  toPurchaseDraft,
  undo,
} from "@ra/assistant";
import type { CategoryId, PurchaseDraft } from "@ra/core";
import type { PriceScope, ReferencePrice } from "@ra/parser";
import type { TFunction } from "i18next";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Language, language } from "@/i18n";
import { describeItem, formatCents, formatDate, isoDate } from "@/lib/format";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Question posée par ce message (seule la dernière reçoit des boutons). */
  question?: Question;
}

function itemOf(conv: Conversation, id: string) {
  return conv.cart.items.find((i) => i.id === id);
}

function eventText(e: AssistantEvent, conv: Conversation, t: TFunction, lang: Language): string {
  switch (e.kind) {
    case "added": {
      const names = e.itemIds
        .map((id) => itemOf(conv, id))
        .filter((i) => i !== undefined)
        .map((i) =>
          i.totalPriceCents !== null && !i.ambiguous && i.groupId === null
            ? `${describeItem(i, lang)} (${formatCents(i.totalPriceCents, lang)})`
            : describeItem(i, lang),
        );
      return t("assistant.added", { items: names.join(", ") });
    }
    case "updated":
      return t("assistant.updated");
    case "removed":
      return t("assistant.removed", { name: e.label });
    case "total":
      return t("assistant.total", { price: formatCents(e.cents, lang) });
    case "context": {
      const parts = [
        e.merchant ? t("assistant.at", { merchant: e.merchant }) : null,
        e.date
          ? formatDate(e.date, lang, {
              today: t("expense.today"),
              yesterday: t("expense.yesterday"),
            }).toLowerCase()
          : null,
      ].filter(Boolean);
      return t("assistant.context", { context: parts.join(", ") });
    }
    case "not_found":
      return t("assistant.notFound", { target: e.target });
    case "not_understood":
      return t("assistant.notUnderstood");
    case "undone":
      return t("assistant.undone");
    case "nothing_to_undo":
      return t("assistant.nothingToUndo");
    case "total_mismatch":
      return t("assistant.mismatch", {
        declared: formatCents(e.declaredCents, lang),
        items: formatCents(e.itemsCents, lang),
      });
    case "remark":
      return remarkText(e, conv, t, lang);
    case "price_info": {
      if (!e.name) return t("priceInfo.unknownProduct");
      if (!e.reference) return t("priceInfo.unknownPrice", { name: e.name });
      return pick(t, "priceInfo.known", {
        name: e.name,
        ref: referenceLabel(e.reference, t, lang),
      });
    }
  }
}

function pick(t: TFunction, key: string, options: Record<string, string> = {}): string {
  const variants = t(key, { returnObjects: true, ...options }) as unknown;
  if (!Array.isArray(variants) || variants.length === 0) return "";
  const chosen = String(variants[Math.floor(Math.random() * variants.length)]);
  return chosen.replace(/\{\{(\w+)\}\}/g, (_, k: string) => options[k] ?? "");
}

/** « 1,10 € », « 3,50 € le kilo ». */
function referenceLabel(ref: ReferencePrice, t: TFunction, lang: Language): string {
  const price = formatCents(ref.cents, lang);
  if (ref.per === "piece") return price;
  return `${price} ${ref.per === "kg" ? t("remark.perKilo") : t("remark.perLitre")}`;
}

/** Réponse à un commentaire, avec le prix moyen quand on peut comparer. */
function remarkText(
  e: Extract<AssistantEvent, { kind: "remark" }>,
  conv: Conversation,
  t: TFunction,
  lang: Language,
): string {
  const item = e.itemId ? itemOf(conv, e.itemId) : undefined;
  if (e.remark === "expensive" || e.remark === "cheap") {
    const c = e.comparison;
    if (!c) return pick(t, `remark.${e.remark}_none`);
    const ref = referenceLabel({ cents: c.referenceCents, per: c.per }, t, lang);
    return pick(t, `remark.${e.remark}_${c.level}`, { ref });
  }
  if (e.remark === "liked") {
    const food = item?.categoryId === "alimentation" || item?.categoryId === "restauration";
    return pick(t, food ? "remark.liked_food" : "remark.liked");
  }
  return pick(t, `remark.${e.remark}`);
}

export function questionText(q: Question, conv: Conversation, t: TFunction, lang: Language) {
  const item = itemOf(conv, q.itemId);
  if (!item) return "";
  const label = describeItem(item, lang);
  if (q.kind === "price") return t("assistant.askPrice", { item: label });
  if (q.kind === "category")
    return t("assistant.askCategory", { name: item.name ?? item.rawLabel });
  const price = formatCents(item.totalPriceCents ?? 0, lang);
  if (item.unit === "piece") return t("assistant.askScopeUnit", { price, item: label });
  const per = item.unit === "kg" || item.unit === "g" ? t("assistant.kilo") : t("assistant.litre");
  return t("assistant.askScopeMeasure", { price, item: label, per });
}

let messageCounter = 0;
/** Identifiant unique, même après un rechargement du module (le compteur repart alors à 0). */
const nextId = () => `m${Date.now().toString(36)}-${++messageCounter}`;

export function useExpenseChat() {
  const { t } = useTranslation();
  const [conv, setConv] = useState<Conversation>(createConversation);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { id: "welcome", role: "assistant", text: t("expense.welcome") },
  ]);
  const [saved, setSaved] = useState<PurchaseDraft[]>([]);
  const [lastSaved, setLastSaved] = useState<PurchaseDraft | null>(null);
  const usedVoice = useRef(false);

  /** Applique une étape : nouveaux messages de l'assistant, puis sa question. */
  const apply = useCallback(
    (step: Step, userText?: string) => {
      const next = step.conversation;
      const out: ChatMessage[] = [];
      if (userText) out.push({ id: nextId(), role: "user", text: userText });
      // Tous les événements d'une étape forment UN message, plus naturel.
      const said = step.events.map((e) => eventText(e, next, t, language)).filter(Boolean);
      if (said.length > 0) out.push({ id: nextId(), role: "assistant", text: said.join(" ") });
      const q = next.question;
      const changed = next !== conv;
      const answeredAside = step.events.some((e) => e.kind === "price_info" || e.kind === "remark");
      // Après une réponse « à côté », on repose la question en attente.
      if (q && (changed || answeredAside)) {
        out.push({
          id: nextId(),
          role: "assistant",
          text: questionText(q, next, t, language),
          question: q,
        });
      } else if (!q && changed && canValidate(next.cart) && conv.question !== null) {
        out.push({ id: nextId(), role: "assistant", text: t("assistant.complete") });
      }
      setConv(next);
      setMessages((m) => [...m, ...out]);
    },
    [conv, t],
  );

  const send = useCallback(
    (text: string, viaVoice = false) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (viaVoice) usedVoice.current = true;
      apply(handleMessage(conv, trimmed, { now: new Date() }), trimmed);
    },
    [apply, conv],
  );

  const chooseScope = useCallback(
    (itemId: string, scope: PriceScope, label: string) =>
      apply(answerScope(conv, itemId, scope), label),
    [apply, conv],
  );

  const chooseCategory = useCallback(
    (itemId: string, categoryId: CategoryId, label: string) =>
      apply(answerCategory(conv, itemId, categoryId), label),
    [apply, conv],
  );

  const remove = useCallback((itemId: string) => apply(removeItem(conv, itemId)), [apply, conv]);
  const undoLast = useCallback(() => apply(undo(conv)), [apply, conv]);

  const validate = useCallback(() => {
    if (!canValidate(conv.cart)) return;
    const draft = toPurchaseDraft(conv.cart, {
      source: usedVoice.current ? "voice" : "text",
      today: isoDate(new Date()),
    });
    setSaved((s) => [...s, draft]);
    setLastSaved(draft);
  }, [conv]);

  const restart = useCallback(() => {
    usedVoice.current = false;
    setConv(createConversation());
    setMessages([{ id: nextId(), role: "assistant", text: t("expense.welcome") }]);
    setLastSaved(null);
  }, [t]);

  return {
    conv,
    messages,
    saved,
    lastSaved,
    canValidate: canValidate(conv.cart),
    send,
    chooseScope,
    chooseCategory,
    remove,
    undoLast,
    validate,
    restart,
  };
}
