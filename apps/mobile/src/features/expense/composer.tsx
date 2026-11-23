import { suggestProducts } from "@ra/parser";
import { ArrowUp, Mic, Square } from "lucide-react-native";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSpeech } from "@/lib/speech";
import { font, type Palette, radius, space, useTheme } from "@/theme";

interface Props {
  onSend: (text: string, viaVoice: boolean) => void;
}

export function Composer({ onSend }: Props) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const [text, setText] = useState("");
  const speech = useSpeech();

  const submit = (value = text, viaVoice = false) => {
    if (!value.trim()) return;
    onSend(value, viaVoice);
    setText("");
  };

  // Auto-complétion : produits qui commencent par le mot en cours de frappe.
  const fragment = /(\S+)$/.exec(text)?.[1] ?? "";
  const suggestions = useMemo(
    () => (speech.listening ? [] : suggestProducts(fragment)),
    [fragment, speech.listening],
  );
  const complete = (name: string) => {
    setText(`${text.slice(0, text.length - fragment.length)}${name} `);
  };

  const toggleMic = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    speech.start((spoken, final) => {
      setText(spoken);
      if (final) submit(spoken, true);
    });
  };

  return (
    <View style={s.wrapper}>
      {suggestions.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.suggestions}
        >
          {suggestions.map((name) => (
            <Pressable
              key={name}
              onPress={() => complete(name)}
              accessibilityRole="button"
              accessibilityLabel={t("expense.suggestion", { name })}
              style={({ pressed }) => [s.suggestion, pressed && { backgroundColor: c.accentSoft }]}
            >
              <Text style={s.suggestionText}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={s.bar}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => submit()}
          placeholder={speech.listening ? t("expense.listening") : t("expense.placeholder")}
          placeholderTextColor={c.textMuted}
          returnKeyType="send"
          submitBehavior="submit"
          autoCorrect
          spellCheck
          autoCapitalize="sentences"
          style={s.input}
          accessibilityLabel={t("expense.placeholder")}
        />
        {speech.available ? (
          <Pressable
            onPress={toggleMic}
            accessibilityRole="button"
            accessibilityLabel={speech.listening ? t("expense.stopMic") : t("expense.mic")}
            style={({ pressed }) => [
              s.round,
              s.roundSecondary,
              speech.listening && { backgroundColor: c.warningSoft },
              pressed && { opacity: 0.7 },
            ]}
          >
            {speech.listening ? (
              <Square size={18} color={c.warning} fill={c.warning} />
            ) : (
              <Mic size={20} color={c.accent} />
            )}
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => submit()}
          disabled={!text.trim()}
          accessibilityRole="button"
          accessibilityLabel={t("expense.send")}
          style={({ pressed }) => [
            s.round,
            { backgroundColor: text.trim() ? c.accent : c.surfaceMuted },
            pressed && { backgroundColor: c.accentPressed },
          ]}
        >
          <ArrowUp size={20} color={text.trim() ? c.onAccent : c.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    wrapper: {
      borderTopColor: c.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      backgroundColor: c.background,
    },
    suggestions: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm },
    suggestion: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.pill,
      paddingHorizontal: space.md,
      paddingVertical: 6,
    },
    suggestionText: { color: c.text, fontSize: font.small },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    input: {
      flex: 1,
      minHeight: 46,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg,
      color: c.text,
      fontSize: font.body,
    },
    round: {
      width: 46,
      height: 46,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    roundSecondary: { backgroundColor: c.accentSoft },
  });
