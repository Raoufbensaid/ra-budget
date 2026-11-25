/**
 * Sans compte : après la validation, résumé des dépenses de la session
 * (total, graphique par catégorie, liste). Rien n'est enregistré : tout
 * disparaît à la fermeture de l'application.
 */
import type { PurchaseDraft } from "@ra/core";
import { categoryTotals, type InsightPurchase, purchaseTotal } from "@ra/insights";
import { useRouter } from "expo-router";
import { CircleCheck, CloudOff } from "lucide-react-native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { Card } from "@/features/dashboard/card";
import { CategoryCard } from "@/features/dashboard/category-card";
import { language } from "@/i18n";
import { capitalize, formatCents, formatDate, isoDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

function toInsight(draft: PurchaseDraft, index: number): InsightPurchase {
  return {
    id: `session-${index}`,
    merchant: draft.merchant,
    purchasedOn: draft.date ?? isoDate(new Date()),
    totalPaidCents: draft.totalPaidCents,
    items: draft.items.map((i) => ({
      rawLabel: i.rawLabel,
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      totalPriceCents: i.totalPriceCents,
      categoryId: i.categoryId,
    })),
  };
}

export function GuestSummary({
  drafts,
  onAgain,
}: {
  drafts: PurchaseDraft[];
  onAgain: () => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  const purchases = useMemo(() => drafts.map(toInsight), [drafts]);
  const categories = useMemo(() => categoryTotals(purchases), [purchases]);
  const total = purchases.reduce((sum, p) => sum + purchaseTotal(p), 0);

  return (
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.head}>
        <CircleCheck size={40} color={c.accent} />
        <Text style={s.title}>{t("guest.summaryTitle")}</Text>
        <Text style={s.total}>{formatCents(total, language)}</Text>
        <Text style={s.muted}>{t("guest.summaryCount", { count: drafts.length })}</Text>
      </View>

      <View style={s.banner}>
        <CloudOff size={18} color={c.warning} />
        <Text style={[s.bannerText, s.flex]}>{t("guest.notSaved")}</Text>
      </View>

      <CategoryCard categories={categories} />

      <Card title={t("guest.listTitle")}>
        {purchases.map((p) => (
          <View key={p.id} style={s.row}>
            <View style={s.flex}>
              <Text style={s.name} numberOfLines={1}>
                {p.merchant ??
                  p.items
                    .slice(0, 2)
                    .map((i) => capitalize(i.name ?? i.rawLabel))
                    .join(", ")}
              </Text>
              <Text style={s.muted}>
                {capitalize(
                  formatDate(p.purchasedOn, language, {
                    today: t("expense.today"),
                    yesterday: t("expense.yesterday"),
                  }),
                )}
              </Text>
            </View>
            <Text style={s.amount}>{formatCents(purchaseTotal(p), language)}</Text>
          </View>
        ))}
      </Card>

      <View style={s.actions}>
        <Button label={t("done.again")} onPress={onAgain} />
        <Button
          variant="secondary"
          label={t("guest.createAccount")}
          onPress={() => router.push("/sign-in")}
        />
      </View>
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    page: {
      padding: space.lg,
      gap: space.lg,
      width: "100%",
      maxWidth: 560,
      alignSelf: "center",
    },
    flex: { flex: 1 },
    head: { alignItems: "center", gap: space.xs, paddingTop: space.lg },
    title: { color: c.text, fontSize: font.title, fontWeight: "700", textAlign: "center" },
    total: { color: c.text, fontSize: 36, fontWeight: "800" },
    muted: { color: c.textMuted, fontSize: font.small },
    banner: {
      flexDirection: "row",
      gap: space.sm,
      alignItems: "flex-start",
      backgroundColor: c.warningSoft,
      borderRadius: radius.md,
      padding: space.md,
    },
    bannerText: { color: c.text, fontSize: font.small, lineHeight: 20 },
    row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs },
    name: { color: c.text, fontSize: font.small, fontWeight: "600" },
    amount: { color: c.text, fontSize: font.body, fontWeight: "700" },
    actions: { gap: space.sm },
  });
