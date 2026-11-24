import { Archive, CircleCheck, CircleDot, Hourglass, Wallet } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import type { TeamStatus } from "./api";

const ICONS = {
  active: CircleDot,
  closing: Hourglass,
  settling: Wallet,
  settled: CircleCheck,
  archived: Archive,
} as const;

function tone(status: TeamStatus, c: Palette): { fg: string; bg: string } {
  if (status === "closing" || status === "settling") return { fg: c.warning, bg: c.warningSoft };
  if (status === "archived") return { fg: c.textMuted, bg: c.surfaceMuted };
  return { fg: c.accent, bg: c.accentSoft };
}

/** Statut d'une Team : couleur, icône et texte (jamais la couleur seule). */
export function StatusPill({ status }: { status: TeamStatus }) {
  const { t } = useTranslation();
  const c = useTheme();
  const { fg, bg } = tone(status, c);
  const Icon = ICONS[status];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Icon size={12} color={fg} />
      <Text style={[styles.text, { color: fg }]}>{t(`teams.status.${status}`)}</Text>
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
