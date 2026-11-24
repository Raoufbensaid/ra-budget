import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import type { TeamMember } from "@/features/teams/api";
import { language } from "@/i18n";
import { formatDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { type HistoryEntry, useExpenseHistory } from "./api";

function describe(
  entry: HistoryEntry,
  nameOf: (id: string | null | undefined) => string,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  const actor = nameOf(entry.actorMember);
  const member = nameOf(entry.data.member_id as string | undefined);
  const version =
    entry.data.version ?? (entry.data.after as { version?: number } | undefined)?.version;
  switch (entry.action) {
    case "expense.created":
      return t("expenseHistory.created", { name: actor });
    case "expense.updated":
      return t("expenseHistory.updated", { name: actor, version });
    case "expense.cancelled":
      return t("expenseHistory.cancelled", { name: actor });
    case "expense.approved":
      return entry.data.via === "owner"
        ? t("expenseHistory.approvedFor", { name: actor, member })
        : t("expenseHistory.approved", { name: member, version });
    case "expense.disputed":
      return t(`expenseHistory.disputed.${entry.data.kind as string}`, { name: member });
    default:
      return null;
  }
}

/** Historique d'une dépense : chaque action avec son auteur et sa date. */
export function HistoryCard({ expenseId, members }: { expenseId: string; members: TeamMember[] }) {
  const { t } = useTranslation();
  const s = styles(useTheme());
  const query = useExpenseHistory(expenseId);
  const nameOf = (id: string | null | undefined) =>
    members.find((m) => m.id === id)?.displayName ?? t("expenseHistory.someone");
  const entries = (query.data ?? [])
    .map((e) => ({ e, text: describe(e, nameOf, t) }))
    .filter((x): x is { e: HistoryEntry; text: string } => x.text !== null);
  if (entries.length === 0) return null;

  return (
    <View style={s.card}>
      <Text style={s.title}>{t("expenseHistory.title")}</Text>
      {entries.map(({ e, text }) => (
        <View key={e.id} style={s.row}>
          <View style={s.dot} />
          <View style={s.flex}>
            <Text style={s.text}>{text}</Text>
            <Text style={s.meta}>
              {formatDate(e.createdAt.slice(0, 10), language, {
                today: t("expense.today"),
                yesterday: t("expense.yesterday"),
              })}
              {" · "}
              {new Date(e.createdAt).toTimeString().slice(0, 5)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    title: { color: c.text, fontSize: font.body, fontWeight: "700" },
    row: { flexDirection: "row", gap: space.md },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent, marginTop: 6 },
    text: { color: c.text, fontSize: font.small },
    meta: { color: c.textMuted, fontSize: font.tiny },
  });
