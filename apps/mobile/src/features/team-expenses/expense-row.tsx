import { ChevronRight } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { language } from "@/i18n";
import { formatCents, formatDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import type { TeamExpenseView } from "./api";
import { ExpenseStatusPill } from "./expense-status";

/** Une dépense dans la liste : titre, date, payeur, bénéficiaires, montant, statut. */
export function ExpenseRow({
  expense,
  payerName,
  onPress,
}: {
  expense: TeamExpenseView;
  payerName: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const cancelled = expense.status === "cancelled";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      <View style={[s.flex, s.text]}>
        <Text style={[s.title, cancelled && s.struck]} numberOfLines={1}>
          {expense.title}
        </Text>
        <Text style={s.meta} numberOfLines={1}>
          {formatDate(expense.spentOn, language, {
            today: t("expense.today"),
            yesterday: t("expense.yesterday"),
          })}
          {" · "}
          {t("teamExpenses.paidBy", { name: payerName })}
          {" · "}
          {t("teamExpenses.beneficiaries", { count: expense.beneficiaries.length })}
        </Text>
        <ExpenseStatusPill status={expense.status} />
      </View>
      <Text style={[s.amount, cancelled && s.struck]}>
        {formatCents(expense.totalCents, language)}
      </Text>
      <ChevronRight size={18} color={c.textMuted} />
    </Pressable>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      paddingVertical: space.sm,
      borderRadius: radius.sm,
    },
    pressed: { opacity: 0.6 },
    text: { gap: 3 },
    title: { color: c.text, fontSize: font.body, fontWeight: "600" },
    meta: { color: c.textMuted, fontSize: font.tiny },
    amount: {
      color: c.text,
      fontSize: font.body,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    struck: { textDecorationLine: "line-through", color: c.textMuted },
  });
