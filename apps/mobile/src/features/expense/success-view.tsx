import type { PurchaseDraft } from "@ra/core";
import { CircleCheck } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { language } from "@/i18n";
import { capitalize, categoryLabel, describeItem, formatCents, formatDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

interface Props {
  draft: PurchaseDraft;
  sessionCount: number;
  onAgain: () => void;
}

export function SuccessView({ draft, sessionCount, onAgain }: Props) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const total = draft.totalPaidCents ?? 0;
  const when = draft.date
    ? formatDate(draft.date, language, {
        today: t("expense.today"),
        yesterday: t("expense.yesterday"),
      })
    : "";

  return (
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.card}>
        <CircleCheck size={44} color={c.accent} />
        <Text style={s.title}>{t("done.title")}</Text>
        <Text style={s.subtitle}>{[draft.merchant, when].filter(Boolean).join(" · ")}</Text>
        <Text style={s.amount}>{formatCents(total, language)}</Text>
        <View style={s.items}>
          {draft.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: liste figée, jamais réordonnée
            <View key={index} style={s.itemRow}>
              <Text style={s.itemName}>{capitalize(describeItem(item, language))}</Text>
              <Text style={s.itemCategory}>
                {item.categoryId
                  ? categoryLabel(item.categoryId, language)
                  : t("expense.toClassify")}
              </Text>
            </View>
          ))}
        </View>
        <Text style={s.note}>{t("done.note")}</Text>
        <Pressable
          onPress={onAgain}
          accessibilityRole="button"
          style={({ pressed }) => [s.button, pressed && { backgroundColor: c.accentPressed }]}
        >
          <Text style={s.buttonText}>{t("done.again")}</Text>
        </Pressable>
        <Text style={s.note}>{t("done.session", { count: sessionCount })}</Text>
      </View>
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    page: { flexGrow: 1, justifyContent: "center", padding: space.lg },
    card: {
      alignSelf: "center",
      width: "100%",
      maxWidth: 480,
      alignItems: "center",
      gap: space.md,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.xl,
    },
    title: { color: c.text, fontSize: font.title, fontWeight: "700" },
    subtitle: { color: c.textMuted, fontSize: font.small },
    amount: {
      color: c.text,
      fontSize: 36,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    items: { alignSelf: "stretch", gap: space.xs },
    itemRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: space.md,
      paddingVertical: space.sm,
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    itemName: { color: c.text, fontSize: font.body, flexShrink: 1 },
    itemCategory: { color: c.textMuted, fontSize: font.small },
    note: { color: c.textMuted, fontSize: font.tiny, textAlign: "center" },
    button: {
      alignSelf: "stretch",
      backgroundColor: c.accent,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonText: { color: c.onAccent, fontSize: font.body, fontWeight: "700" },
  });
