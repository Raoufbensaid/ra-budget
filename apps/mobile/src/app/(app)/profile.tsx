import { LogOut } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, Notice } from "@/components/ui";
import { authErrorMessage } from "@/features/auth/auth-errors";
import { useSession } from "@/features/auth/session-provider";
import { supabase } from "@/lib/supabase";
import { font, type Palette, radius, space, useTheme } from "@/theme";

export default function ProfileScreen() {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const { session } = useSession();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);

  const savePassword = async () => {
    if (!password) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setMessage({ text: authErrorMessage(error, t), tone: "error" });
    else {
      setPassword("");
      setMessage({ text: t("profile.passwordSaved"), tone: "info" });
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Text style={s.brand}>RA BUDGET</Text>
        <Text style={s.title}>{t("profile.title")}</Text>

        <View style={s.card}>
          <Text style={s.section}>{t("profile.account")}</Text>
          <Text style={s.email}>{session?.user.email}</Text>
        </View>

        <View style={s.card}>
          <Field
            label={t("profile.newPassword")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            autoCapitalize="none"
            onSubmitEditing={savePassword}
          />
          <Text style={s.hint}>{t("auth.passwordHint")}</Text>
          {message ? <Notice text={message.text} tone={message.tone} /> : null}
          <Button
            variant="secondary"
            label={t("profile.setPassword")}
            onPress={savePassword}
            loading={busy}
            disabled={!password}
          />
        </View>

        <Button
          variant="danger"
          label={t("profile.signOut")}
          icon={<LogOut size={18} color={c.danger} />}
          onPress={() => supabase.auth.signOut()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    page: { padding: space.lg, gap: space.lg, width: "100%", maxWidth: 560, alignSelf: "center" },
    brand: { color: c.accent, fontSize: font.tiny, fontWeight: "700", letterSpacing: 1.2 },
    title: { color: c.text, fontSize: font.title, fontWeight: "700", marginTop: -space.md },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    section: { color: c.textMuted, fontSize: font.small, fontWeight: "600" },
    email: { color: c.text, fontSize: font.body, fontWeight: "600" },
    hint: { color: c.textMuted, fontSize: font.tiny, marginTop: -space.xs },
  });
