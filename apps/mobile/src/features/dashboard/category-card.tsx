import type { CategoryKey, CategoryTotal } from "@ra/insights";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { language } from "@/i18n";
import {
  capitalize,
  categoryLabel,
  describeItem,
  formatCents,
  formatDate,
  formatPercent,
} from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { Card } from "./card";

const MAX_ITEMS = 6;

/** Répartition du mois par catégorie : barres horizontales, détail au toucher. */
export function CategoryCard({ categories }: { categories: CategoryTotal[] }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const [open, setOpen] = useState<CategoryKey | null>(null);
  const max = categories[0]?.cents ?? 0;

  const label = (key: CategoryKey) =>
    key === "unclassified" ? t("dashboard.categories.unclassified") : categoryLabel(key, language);

  return (
    <Card title={t("dashboard.categories.title")}>
      <Text style={s.hint}>{t("dashboard.categories.hint")}</Text>
      {categories.map((cat) => {
        const expanded = open === cat.category;
        return (
          <View key={cat.category} style={s.block}>
            <Pressable
              onPress={() => setOpen(expanded ? null : cat.category)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`${label(cat.category)}, ${formatCents(cat.cents, language)}, ${t(
                "dashboard.categories.share",
                { percent: formatPercent(cat.share, language) },
              )}`}
              style={({ pressed }) => [s.row, pressed && s.pressed]}
            >
              <View style={s.line}>
                <Text style={s.name} numberOfLines={1}>
                  {label(cat.category)}
                </Text>
                <Text style={s.percent}>{formatPercent(cat.share, language)}</Text>
                <Text style={s.amount}>{formatCents(cat.cents, language)}</Text>
                {expanded ? (
                  <ChevronUp size={16} color={c.textMuted} />
                ) : (
                  <ChevronDown size={16} color={c.textMuted} />
                )}
              </View>
              <View style={s.track}>
                <View
                  style={[
                    s.bar,
                    { width: `${max > 0 ? Math.max((cat.cents / max) * 100, 2) : 0}%` },
                  ]}
                />
              </View>
            </Pressable>
            {expanded ? (
              <View style={s.items}>
                {cat.items.slice(0, MAX_ITEMS).map((a) => (
                  <View key={`${a.purchaseId}-${a.item.rawLabel}-${a.cents}`} style={s.itemRow}>
                    <View style={s.flex}>
                      <Text style={s.itemName} numberOfLines={1}>
                        {capitalize(describeItem(a.item, language))}
                      </Text>
                      <Text style={s.itemMeta}>
                        {formatDate(a.purchasedOn, language, {
                          today: t("expense.today"),
                          yesterday: t("expense.yesterday"),
                        })}
                      </Text>
                    </View>
                    <Text style={s.itemPrice}>{formatCents(a.cents, language)}</Text>
                  </View>
                ))}
                {cat.items.length > MAX_ITEMS ? (
                  <Text style={s.itemMeta}>
                    {t("dashboard.categories.more", { count: cat.items.length - MAX_ITEMS })}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    hint: { color: c.textMuted, fontSize: font.tiny, marginTop: -space.sm },
    block: { gap: space.sm },
    row: { gap: space.xs, paddingVertical: space.xs, borderRadius: radius.sm },
    pressed: { opacity: 0.6 },
    line: { flexDirection: "row", alignItems: "center", gap: space.sm },
    name: { color: c.text, fontSize: font.small, fontWeight: "600", flex: 1 },
    percent: { color: c.textMuted, fontSize: font.tiny, fontVariant: ["tabular-nums"] },
    amount: {
      color: c.text,
      fontSize: font.small,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    track: { height: 8, borderRadius: radius.pill, backgroundColor: c.surfaceMuted },
    bar: { height: 8, borderRadius: radius.pill, backgroundColor: c.accent },
    items: {
      gap: space.xs,
      paddingLeft: space.md,
      borderLeftColor: c.border,
      borderLeftWidth: 2,
      marginBottom: space.xs,
    },
    itemRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
    itemName: { color: c.text, fontSize: font.small },
    itemMeta: { color: c.textMuted, fontSize: font.tiny },
    itemPrice: { color: c.text, fontSize: font.small, fontVariant: ["tabular-nums"] },
  });
