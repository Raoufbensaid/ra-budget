import type { Comparison, MonthSummary } from "@ra/insights";
import { shiftMonth } from "@ra/insights";
import { TrendingDown, TrendingUp } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { language } from "@/i18n";
import { formatCents, formatMonth, formatPercent } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

/** Grand total du mois, comparaison avec le mois précédent et rythme de dépense. */
export function SummaryCard({
  summary,
  comparison,
}: {
  summary: MonthSummary;
  comparison: Comparison;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const month = formatMonth(summary.month, language);
  const previous = formatMonth(shiftMonth(summary.month, -1), language);

  let compareText: string;
  if (comparison.previousCents === 0) {
    compareText = t("dashboard.noPrevious", { month: previous });
  } else if (comparison.deltaCents === 0) {
    compareText = t("dashboard.same", { month: previous });
  } else if (comparison.ratio !== null && Math.abs(comparison.ratio) < 10) {
    compareText = t(comparison.deltaCents > 0 ? "dashboard.more" : "dashboard.less", {
      percent: formatPercent(Math.abs(comparison.ratio), language),
      month: previous,
    });
  } else {
    compareText = t("dashboard.moreAmount", {
      amount: formatCents(comparison.deltaCents, language),
      month: previous,
    });
  }
  if (comparison.sameDay && comparison.previousCents > 0) {
    compareText = `${compareText} ${t("dashboard.sameDay")}`;
  }
  const Trend = comparison.deltaCents > 0 ? TrendingUp : TrendingDown;

  return (
    <View style={s.card}>
      <Text style={s.label}>{t("dashboard.spentIn", { month })}</Text>
      <Text style={s.amount} accessibilityRole="summary">
        {formatCents(summary.totalCents, language)}
      </Text>
      <View style={s.row}>
        {comparison.previousCents > 0 && comparison.deltaCents !== 0 ? (
          <Trend size={16} color={c.onAccent} />
        ) : null}
        <Text style={s.line}>{compareText}</Text>
      </View>
      {summary.purchaseCount > 0 ? (
        <Text style={s.meta}>
          {t("dashboard.purchases", { count: summary.purchaseCount })}
          {" · "}
          {t("dashboard.perDay", {
            amount: formatCents(summary.dailyAverageCents, language),
          })}
        </Text>
      ) : null}
      {summary.projectionCents !== null && summary.elapsedDays >= 5 ? (
        <Text style={s.meta}>
          {t("dashboard.projection", {
            amount: formatCents(summary.projectionCents, language),
          })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.accent, borderRadius: radius.lg, padding: space.xl, gap: space.xs },
    label: {
      color: c.onAccent,
      fontSize: font.small,
      fontWeight: "600",
      opacity: 0.85,
    },
    amount: {
      color: c.onAccent,
      fontSize: 34,
      fontWeight: "800",
      fontVariant: ["tabular-nums"],
    },
    row: { flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: space.xs },
    line: { color: c.onAccent, fontSize: font.small, fontWeight: "600", flexShrink: 1 },
    meta: { color: c.onAccent, fontSize: font.tiny, opacity: 0.85 },
  });
