import type { MonthKey, MonthTotal } from "@ra/insights";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { language } from "@/i18n";
import { formatCents, formatMonth } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { Card } from "./card";

const CHART_HEIGHT = 120;

/**
 * Total des derniers mois en colonnes. Le mois affiché est plein, les autres
 * plus clairs ; toucher une colonne affiche ce mois.
 */
export function TrendCard({
  totals,
  selected,
  currentMonth,
  onSelect,
}: {
  totals: MonthTotal[];
  selected: MonthKey;
  currentMonth: MonthKey;
  onSelect: (month: MonthKey) => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const max = Math.max(...totals.map((m) => m.cents), 0);
  const withData = totals.filter((m) => m.cents > 0 && m.month !== currentMonth);
  const average =
    withData.length > 0
      ? Math.round(withData.reduce((sum, m) => sum + m.cents, 0) / withData.length)
      : null;

  return (
    <Card title={t("dashboard.trend.title")}>
      <Text style={s.hint}>{t("dashboard.trend.hint")}</Text>
      <View style={s.chart}>
        {totals.map((m) => {
          const active = m.month === selected;
          const height =
            max > 0 ? Math.max((m.cents / max) * CHART_HEIGHT, m.cents > 0 ? 4 : 2) : 2;
          return (
            <Pressable
              key={m.month}
              onPress={() => onSelect(m.month)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${formatMonth(m.month, language)} : ${formatCents(m.cents, language)}`}
              style={s.column}
            >
              <Text style={[s.value, !active && s.valueMuted]} numberOfLines={1}>
                {m.cents > 0 ? formatCents(m.cents, language).replace(/[,.]\d{2}(?=\D*$)/, "") : ""}
              </Text>
              <View style={s.barArea}>
                <View
                  style={[
                    s.bar,
                    { height, backgroundColor: active ? c.accent : c.accentSoft },
                    m.cents === 0 && { backgroundColor: c.surfaceMuted },
                  ]}
                />
              </View>
              <Text style={[s.month, active && s.monthActive]}>
                {formatMonth(m.month, language, { short: true, withYear: false })}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {average !== null ? (
        <Text style={s.average}>
          {t("dashboard.trend.average", { amount: formatCents(average, language) })}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    hint: { color: c.textMuted, fontSize: font.tiny, marginTop: -space.sm },
    chart: { flexDirection: "row", gap: space.sm, alignItems: "flex-end" },
    column: { flex: 1, alignItems: "center", gap: space.xs },
    barArea: { height: CHART_HEIGHT, width: "100%", justifyContent: "flex-end" },
    bar: { width: "100%", borderRadius: radius.sm / 2 },
    value: {
      color: c.text,
      fontSize: 11,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    valueMuted: { color: c.textMuted, fontWeight: "500" },
    month: { color: c.textMuted, fontSize: font.tiny },
    monthActive: { color: c.text, fontWeight: "700" },
    average: { color: c.textMuted, fontSize: font.tiny },
  });
