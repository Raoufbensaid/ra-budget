import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { font, type Palette, radius, space, useTheme } from "@/theme";

/** Carte du tableau de bord : un titre, une action facultative et un contenu. */
export function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const s = styles(useTheme());
  return (
    <View style={s.card}>
      <View style={s.header}>
        <Text style={s.title} accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { color: c.text, fontSize: font.body, fontWeight: "700", flex: 1 },
  });
