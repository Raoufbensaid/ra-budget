/**
 * Affiché à la place d'un onglet qui demande un compte (Bilan, Teams,
 * Historique, Profil) quand on utilise Ra Budget sans être connecté.
 */
import { useRouter } from "expo-router";
import { LockKeyhole } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { chooseGuest } from "@/lib/guest";
import { font, type Palette, radius, space, useTheme } from "@/theme";

export function SignInPrompt() {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={s.page}>
        <View style={s.card}>
          <LockKeyhole size={40} color={c.accent} />
          <Text style={s.title} accessibilityRole="header">
            {t("guest.promptTitle")}
          </Text>
          <Text style={s.text}>{t("guest.promptText")}</Text>
          <View style={s.list}>
            {(["history", "dashboard", "teams"] as const).map((key) => (
              <Text key={key} style={s.item}>
                {`• ${t(`guest.benefits.${key}`)}`}
              </Text>
            ))}
          </View>
          <View style={s.actions}>
            <Button label={t("guest.signIn")} onPress={() => router.push("/sign-in")} />
            <Button
              variant="ghost"
              label={t("guest.keepGoing")}
              onPress={() => {
                chooseGuest();
                router.navigate("/");
              }}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
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
    title: { color: c.text, fontSize: font.title, fontWeight: "700", textAlign: "center" },
    text: { color: c.textMuted, fontSize: font.body, lineHeight: 22, textAlign: "center" },
    list: { alignSelf: "stretch", gap: space.xs },
    item: { color: c.text, fontSize: font.small, lineHeight: 20 },
    actions: { alignSelf: "stretch", gap: space.sm, marginTop: space.sm },
  });
