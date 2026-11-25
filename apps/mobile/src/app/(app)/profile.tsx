import { LogOut } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, Notice } from "@/components/ui";
import { authErrorMessage } from "@/features/auth/auth-errors";
import { useSession } from "@/features/auth/session-provider";
import { DisplayNameCard } from "@/features/profile/display-name-card";
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
  /** Code de vérification demandé si la connexion date de plus de 24 h. */
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  const savePassword = async () => {
    if (!password) return;
    setBusy(true);
    setMessage(null);
    const nonce = needsCode ? code.replace(/\s/g, "") : undefined;
    const { error } = await supabase.auth.updateUser({ password, nonce });
    if (error?.code === "reauthentication_needed") {
      // Connexion trop ancienne : on vérifie que c'est bien toi avec un code par e-mail.
      const { error: sendError } = await supabase.auth.reauthenticate();
      setBusy(false);
      if (sendError) {
        setMessage({ text: authErrorMessage(sendError, t), tone: "error" });
        return;
      }
      setNeedsCode(true);
      setCode("");
      setMessage({
        text: t("profile.confirmWithCode", { email: session?.user.email ?? "" }),
        tone: "info",
      });
      return;
    }
    setBusy(false);
    if (error?.code === "reauthentication_not_valid") {
      setMessage({ text: t("auth.errors.badCode"), tone: "error" });
    } else if (error) {
      setMessage({ text: authErrorMessage(error, t), tone: "error" });
    } else {
      setPassword("");
      setCode("");
      setNeedsCode(false);
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

        <DisplayNameCard />

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
          {needsCode ? (
            <Field
              label={t("auth.code")}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={10}
              onSubmitEditing={savePassword}
            />
          ) : null}
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
