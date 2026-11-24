import type { TopProduct } from "@ra/insights";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { language } from "@/i18n";
import { capitalize, formatCents } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { Card } from "./card";

/** Les produits qui ont coûté le plus dans le mois. */
export function TopProductsCard({ products }: { products: TopProduct[] }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  return (
    <Card title={t("dashboard.top.title")}>
      {products.map((p, index) => (
        <View key={p.key} style={s.row}>
          <View style={s.rank}>
            <Text style={s.rankText}>{index + 1}</Text>
          </View>
          <View style={s.flex}>
            <Text style={s.name} numberOfLines={1}>
              {capitalize(p.label)}
            </Text>
            <Text style={s.meta}>{t("dashboard.top.times", { count: p.times })}</Text>
          </View>
          <Text style={s.amount}>{formatCents(p.cents, language)}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    row: { flexDirection: "row", alignItems: "center", gap: space.md },
    rank: {
      width: 26,
      height: 26,
      borderRadius: radius.pill,
      backgroundColor: c.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    rankText: { color: c.accent, fontSize: font.tiny, fontWeight: "800" },
    name: { color: c.text, fontSize: font.small, fontWeight: "600" },
    meta: { color: c.textMuted, fontSize: font.tiny },
    amount: {
      color: c.text,
      fontSize: font.small,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
  });
