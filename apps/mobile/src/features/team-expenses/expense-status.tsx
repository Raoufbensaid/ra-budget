import type { ExpenseStatus } from "@ra/team";
import { CircleCheck, CircleX, Hourglass, TriangleExclamationPoint } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { font, type Palette, radius, space, useTheme } from "@/theme";

const ICONS = {
  pending: Hourglass,
  validated: CircleCheck,
  disputed: TriangleExclamationPoint,
  cancelled: CircleX,
} as const;

function tone(status: ExpenseStatus, c: Palette) {
  if (status === "validated") return { fg: c.accent, bg: c.accentSoft };
  if (status === "disputed") return { fg: c.danger, bg: c.warningSoft };
  if (status === "cancelled") return { fg: c.textMuted, bg: c.surfaceMuted };
  return { fg: c.warning, bg: c.warningSoft };
}

/** Statut d'une dépense : couleur, icône et texte. */
export function ExpenseStatusPill({ status }: { status: ExpenseStatus }) {
  const { t } = useTranslation();
  const c = useTheme();
  const { fg, bg } = tone(status, c);
  const Icon = ICONS[status];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Icon size={12} color={fg} />
      <Text style={[styles.text, { color: fg }]}>{t(`teamExpenses.status.${status}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  text: { fontSize: font.tiny, fontWeight: "700" },
});
