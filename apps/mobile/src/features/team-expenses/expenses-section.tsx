import { useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import type { Team } from "@/features/teams/api";
import { language } from "@/i18n";
import { formatCents } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { useTeamExpenses } from "./api";
import { ExpenseRow } from "./expense-row";

/** Rubrique « Dépenses » d'une Team : total, bouton d'ajout et liste. */
export function ExpensesSection({ team }: { team: Team }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  const query = useTeamExpenses(team.id);
  const expenses = query.data ?? [];
  const active = expenses.filter((e) => e.status !== "cancelled");
  const total = active.reduce((sum, e) => sum + e.totalCents, 0);
  const nameOf = (id: string) => team.members.find((m) => m.id === id)?.displayName ?? "—";

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.flex}>
          <Text style={s.label}>{t("teamExpenses.total")}</Text>
          <Text style={s.total}>{formatCents(total, language)}</Text>
          <Text style={s.meta}>{t("teamExpenses.count", { count: active.length })}</Text>
        </View>
      </View>
      {team.status === "active" ? (
        <Button
          label={t("teamExpenses.add")}
          icon={<Plus size={18} color={c.onAccent} />}
          onPress={() => router.push(`/teams/${team.id}/expenses/new`)}
        />
      ) : null}
      {query.isPending ? <ActivityIndicator color={c.accent} /> : null}
      {query.isError ? <Text style={s.meta}>{t("teamExpenses.error")}</Text> : null}
      {query.isSuccess && expenses.length === 0 ? (
        <Text style={s.empty}>{t("teamExpenses.empty")}</Text>
      ) : null}
      {expenses.map((e) => (
        <ExpenseRow
          key={e.id}
          expense={e}
          payerName={nameOf(e.paidBy)}
          onPress={() => router.push(`/teams/${team.id}/expenses/${e.id}`)}
        />
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
    header: { flexDirection: "row", alignItems: "flex-end" },
    label: { color: c.textMuted, fontSize: font.small, fontWeight: "600" },
    total: { color: c.text, fontSize: 28, fontWeight: "800", fontVariant: ["tabular-nums"] },
    meta: { color: c.textMuted, fontSize: font.tiny },
    empty: { color: c.textMuted, fontSize: font.small, lineHeight: 20 },
  });
