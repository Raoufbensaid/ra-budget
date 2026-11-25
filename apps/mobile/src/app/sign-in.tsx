/**
 * Connexion : par code reçu par e-mail (sans mot de passe) ou par mot de passe.
 * Les codes à 6 chiffres fonctionnent partout (Expo Go, web), contrairement aux liens.
 */
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, Notice } from "@/components/ui";
import { authErrorMessage, isEmailNotConfirmed } from "@/features/auth/auth-errors";
import { chooseGuest } from "@/lib/guest";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { font, type Palette, radius, space, useTheme } from "@/theme";

type Mode = "code" | "password";
/** « email » : connexion par code ; « signup » : confirmation d'un compte créé avec mot de passe. */
type CodeStep = { email: string; type: "email" | "signup" } | null;

export default function SignInScreen() {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);

  const [mode, setMode] = useState<Mode>("code");
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeStep, setCodeStep] = useState<CodeStep>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const cleanEmail = email.trim().toLowerCase();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(authErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      if (!cleanEmail) throw { code: "validation_failed" };
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setCode("");
      setCodeStep({ email: cleanEmail, type: "email" });
      setInfo(t("auth.codeSent", { email: cleanEmail }));
    });

  const verifyCode = () =>
    run(async () => {
      if (!codeStep) return;
      const token = code.replace(/\s/g, "");
      if (!token) {
        setError(t("auth.errors.codeRequired"));
        return;
      }
      const { error } = await supabase.auth.verifyOtp({
        email: codeStep.email,
        token,
        type: codeStep.type,
      });
      if (error) throw error;
      // La session arrive par onAuthStateChange : la navigation suit toute seule.
    });

  const resend = () =>
    run(async () => {
      if (!codeStep) return;
      const { error } =
        codeStep.type === "signup"
          ? await supabase.auth.resend({ type: "signup", email: codeStep.email })
          : await supabase.auth.signInWithOtp({ email: codeStep.email });
      if (error) throw error;
      setInfo(t("auth.codeSent", { email: codeStep.email }));
    });

  const submitPassword = () =>
    run(async () => {
      if (!cleanEmail) {
        setError(t("auth.errors.emailRequired"));
        return;
      }
      if (!password) {
        setError(t("auth.errors.passwordRequired"));
        return;
      }
      if (creating) {
        const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password });
        if (error) throw error;
        if (!data.session) {
          setCode("");
          setCodeStep({ email: cleanEmail, type: "signup" });
          setInfo(t("auth.confirmSignUp", { email: cleanEmail }));
        }
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (isEmailNotConfirmed(error)) {
        await supabase.auth.resend({ type: "signup", email: cleanEmail });
        setCode("");
        setCodeStep({ email: cleanEmail, type: "signup" });
        setInfo(t("auth.confirmSignUp", { email: cleanEmail }));
        return;
      }
      if (error) throw error;
    });

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setCodeStep(null);
  };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView style={s.flex} behavior="padding">
        <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
          <View style={s.card}>
            <Text style={s.brand}>RA BUDGET</Text>
            <Text style={s.tagline}>{t("auth.tagline")}</Text>

            {!supabaseConfigured ? <Notice tone="error" text={t("auth.notConfigured")} /> : null}

            {codeStep ? (
              <View style={s.form}>
                {info ? <Notice text={info} /> : null}
                <Field
                  label={t("auth.code")}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={10}
                  autoFocus
                  onSubmitEditing={verifyCode}
                  style={s.codeInput}
                />
                {error ? <Notice tone="error" text={error} /> : null}
                <Button label={t("auth.verify")} onPress={verifyCode} loading={busy} />
                <View style={s.row}>
                  <Button
                    variant="ghost"
                    label={t("auth.resend")}
                    onPress={resend}
                    disabled={busy}
                  />
                  <Button
                    variant="ghost"
                    label={t("auth.changeEmail")}
                    onPress={() => {
                      setCodeStep(null);
                      setInfo(null);
                      setError(null);
                    }}
                  />
                </View>
              </View>
            ) : (
              <View style={s.form}>
                <View style={s.segment}>
                  {(["code", "password"] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => switchMode(m)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: mode === m }}
                      style={[s.segmentItem, mode === m && s.segmentActive]}
                    >
                      <Text style={[s.segmentText, mode === m && s.segmentTextActive]}>
                        {m === "code" ? t("auth.modeCode") : t("auth.modePassword")}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Field
                  label={t("auth.email")}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t("auth.emailPlaceholder")}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={mode === "code" ? sendCode : undefined}
                />

                {mode === "password" ? (
                  <Field
                    label={t("auth.password")}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    textContentType={creating ? "newPassword" : "password"}
                    autoComplete={creating ? "new-password" : "current-password"}
                    autoCapitalize="none"
                    onSubmitEditing={submitPassword}
                  />
                ) : null}
                {mode === "password" && creating ? (
                  <Text style={s.hint}>{t("auth.passwordHint")}</Text>
                ) : null}

                {error ? <Notice tone="error" text={error} /> : null}
                {info ? <Notice text={info} /> : null}

                {mode === "code" ? (
                  <Button label={t("auth.sendCode")} onPress={sendCode} loading={busy} />
                ) : (
                  <>
                    <Button
                      label={creating ? t("auth.signUp") : t("auth.signIn")}
                      onPress={submitPassword}
                      loading={busy}
                    />
                    <Button
                      variant="ghost"
                      label={creating ? t("auth.toSignIn") : t("auth.toSignUp")}
                      onPress={() => {
                        setCreating((v) => !v);
                        setError(null);
                      }}
                    />
                    {!creating ? (
                      <Button
                        variant="ghost"
                        label={t("auth.forgot")}
                        onPress={() => {
                          switchMode("code");
                          setInfo(t("auth.forgotHelp"));
                        }}
                      />
                    ) : null}
                  </>
                )}
              </View>
            )}
            <Button
              variant="ghost"
              label={t("guest.continue")}
              onPress={() => {
                chooseGuest();
                router.replace("/");
              }}
            />
            <Text style={s.guestHint}>{t("guest.continueHint")}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    guestHint: {
      color: c.textMuted,
      fontSize: font.tiny,
      textAlign: "center",
      marginTop: -space.xs,
    },
    screen: { flex: 1, backgroundColor: c.background },
    flex: { flex: 1 },
    page: { flexGrow: 1, justifyContent: "center", padding: space.lg },
    card: {
      width: "100%",
      maxWidth: 440,
      alignSelf: "center",
      gap: space.lg,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.xl,
    },
    brand: { color: c.accent, fontSize: font.title, fontWeight: "800", letterSpacing: 2 },
    tagline: { color: c.textMuted, fontSize: font.body, marginTop: -space.sm },
    form: { gap: space.md },
    segment: {
      flexDirection: "row",
      backgroundColor: c.surfaceMuted,
      borderRadius: radius.md,
      padding: space.xs,
    },
    segmentItem: {
      flex: 1,
      alignItems: "center",
      paddingVertical: space.sm,
      borderRadius: radius.sm,
    },
    segmentActive: { backgroundColor: c.surface },
    segmentText: { color: c.textMuted, fontSize: font.small, fontWeight: "600" },
    segmentTextActive: { color: c.text },
    hint: { color: c.textMuted, fontSize: font.tiny, marginTop: -space.xs },
    codeInput: { fontSize: 24, letterSpacing: 6, textAlign: "center", fontWeight: "700" },
    row: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap" },
  });
