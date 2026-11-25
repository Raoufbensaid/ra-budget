import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Notice } from "@/components/ui";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { type LinkState, useLinkResend } from "./api";

/** Mise en page des pages ouvertes depuis un e-mail (sans connexion). */
export function LinkPage({ title, children }: { title?: string; children: ReactNode }) {
  const c = useTheme();
  const s = styles(c);
  const { t } = useTranslation();
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.column}>
          <Text style={s.brand}>{t("links.brand")}</Text>
          {title ? (
            <Text style={s.title} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function LinkCard({ children }: { children: ReactNode }) {
  const s = styles(useTheme());
  return <View style={s.card}>{children}</View>;
}

export function LinkLoading() {
  const c = useTheme();
  return (
    <LinkPage>
      <View style={styles(c).center}>
        <ActivityIndicator color={c.accent} />
      </View>
    </LinkPage>
  );
}

export function LinkText({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const s = styles(useTheme());
  return <Text style={muted ? s.muted : s.text}>{children}</Text>;
}

/**
 * Lien qu'on ne peut plus utiliser : explication, et pour un lien expiré,
 * bouton pour en recevoir un nouveau à l'adresse d'origine.
 */
export function LinkUnavailable({
  token,
  state,
  closedText,
}: {
  token: string;
  state: Exclude<LinkState, "open">;
  closedText?: string;
}) {
  const { t } = useTranslation();
  const resend = useLinkResend(token);
  const result = resend.data;
  return (
    <LinkPage title={t("links.unavailable")}>
      <LinkCard>
        <LinkText>
          {state === "closed" && closedText ? closedText : t(`links.state.${state}`)}
        </LinkText>
        {state === "expired" && !result ? (
          <Button
            label={t("links.resend")}
            loading={resend.isPending}
            onPress={() => resend.mutate()}
          />
        ) : null}
        {result === "sent" ? <Notice text={t("links.resent")} /> : null}
        {result === "too_soon" ? <Notice text={t("links.tooSoon")} /> : null}
        {result === "invalid" || result === "not_expired" ? (
          <Notice tone="error" text={t("links.errors.generic")} />
        ) : null}
        {resend.isError ? <Notice tone="error" text={t("links.errors.generic")} /> : null}
      </LinkCard>
    </LinkPage>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1 },
    scroll: { flexGrow: 1, padding: space.lg },
    column: { width: "100%", maxWidth: 520, alignSelf: "center", gap: space.lg },
    brand: { color: c.accent, fontWeight: "700", letterSpacing: 1, fontSize: font.tiny },
    title: { color: c.text, fontSize: font.title, fontWeight: "700" },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    center: { paddingVertical: space.xxl, alignItems: "center" },
    text: { color: c.text, fontSize: font.body, lineHeight: 22 },
    muted: { color: c.textMuted, fontSize: font.small, lineHeight: 20 },
  });
