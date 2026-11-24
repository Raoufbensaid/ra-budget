import type { TFunction } from "i18next";
import { language } from "@/i18n";
import { formatCents } from "@/lib/format";
import type { TeamMessage } from "./api";

/**
 * Texte d'un message automatique (« Raouf a ajouté Courses · 12,00 € »).
 * `nameOf` donne le nom d'un membre à partir de son identifiant.
 */
export function systemMessageText(
  message: TeamMessage,
  nameOf: (memberId: string | null | undefined) => string,
  t: TFunction,
): string {
  const d = message.data;
  const actor = nameOf(d.actor_member as string | undefined);
  const member = nameOf((d.member_id ?? d.target_id) as string | undefined);
  const title = (d.title as string | undefined) ?? "";
  const amount = typeof d.total_cents === "number" ? formatCents(d.total_cents, language) : "";
  switch (message.event) {
    case "expense.created":
      return t("teamChat.system.created", { name: actor, title, amount });
    case "expense.updated":
      return t("teamChat.system.updated", { name: actor, title, amount });
    case "expense.cancelled":
      return t("teamChat.system.cancelled", { name: actor, title });
    case "expense.disputed":
      return t(`teamChat.system.disputed.${(d.kind as string) ?? "error"}`, {
        name: nameOf(d.member_id as string | undefined),
        title,
      });
    case "expense.status":
      return t("teamChat.system.validated", { title, amount });
    case "member.joined":
      return t("teamChat.system.joined", { name: member });
    case "member.guest_added":
      return t("teamChat.system.guestAdded", { name: actor, member });
    case "member.left":
      return t("teamChat.system.left", { name: member });
    case "member.removed":
      return t("teamChat.system.removed", { name: actor, member });
    default:
      return "";
  }
}
