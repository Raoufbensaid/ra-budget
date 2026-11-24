import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { font, type Palette, radius, space, useTheme } from "@/theme";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
}: ButtonProps) {
  const c = useTheme();
  const s = styles(c);
  const inactive = disabled || loading;
  const textColor =
    variant === "primary"
      ? c.onAccent
      : variant === "danger"
        ? c.danger
        : variant === "ghost"
          ? c.accent
          : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        s.button,
        variant === "primary" && { backgroundColor: c.accent },
        variant === "secondary" && s.secondary,
        variant === "danger" && s.secondary,
        variant === "ghost" && s.ghost,
        pressed && variant === "primary" && { backgroundColor: c.accentPressed },
        pressed && variant !== "primary" && { opacity: 0.6 },
        inactive && { opacity: 0.5 },
      ]}
    >
      {loading ? <ActivityIndicator color={textColor} /> : icon}
      <Text style={[s.label, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
}

export function Field({ label, error, style, ...props }: FieldProps) {
  const c = useTheme();
  const s = styles(c);
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={c.textMuted}
        style={[s.input, error ? { borderColor: c.danger } : null, style]}
        {...props}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export function Notice({ text, tone = "info" }: { text: string; tone?: "info" | "error" }) {
  const c = useTheme();
  const s = styles(c);
  return (
    <Text
      style={[
        s.notice,
        tone === "error"
          ? { color: c.danger, backgroundColor: c.warningSoft }
          : { color: c.text, backgroundColor: c.accentSoft },
      ]}
    >
      {text}
    </Text>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: space.sm,
      minHeight: 50,
      paddingHorizontal: space.lg,
      borderRadius: radius.md,
    },
    secondary: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
    },
    ghost: { backgroundColor: "transparent", minHeight: 40 },
    label: { fontSize: font.body, fontWeight: "700" },
    field: { gap: space.xs },
    fieldLabel: { color: c.textMuted, fontSize: font.small, fontWeight: "600" },
    input: {
      minHeight: 50,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: space.lg,
      color: c.text,
      fontSize: font.body,
    },
    error: { color: c.danger, fontSize: font.tiny },
    notice: {
      fontSize: font.small,
      lineHeight: 20,
      padding: space.md,
      borderRadius: radius.md,
      overflow: "hidden",
    },
  });
