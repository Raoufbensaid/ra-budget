import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import { useCreateTeam } from "@/features/teams/api";
import { teamErrorMessage } from "@/features/teams/errors";
import { TEAM_ICONS } from "@/features/teams/icons";
import { font, type Palette, radius, space, useTheme } from "@/theme";

export default function NewTeamScreen() {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  const create = useCreateTeam();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(TEAM_ICONS[0] ?? "👥");

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      { p_name: name.trim(), p_icon: icon },
      { onSuccess: (id) => router.replace(`/teams/${id}`) },
    );
  };

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Field
        label={t("teams.new.name")}
        value={name}
        onChangeText={setName}
        placeholder={t("teams.new.namePlaceholder")}
        maxLength={60}
        autoFocus
        autoCapitalize="sentences"
        onSubmitEditing={submit}
      />
      <View style={s.gap}>
        <Text style={s.label}>{t("teams.new.icon")}</Text>
        <View style={s.icons}>
          {TEAM_ICONS.map((emoji) => {
            const selected = emoji === icon;
            return (
              <Pressable
                key={emoji}
                onPress={() => setIcon(emoji)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={emoji}
                style={[s.icon, selected && s.iconSelected]}
              >
                <Text style={s.emoji}>{emoji}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {create.isError ? <Notice tone="error" text={teamErrorMessage(create.error, t)} /> : null}
      <Button
        label={t("teams.new.submit")}
        onPress={submit}
        loading={create.isPending}
        disabled={!name.trim()}
      />
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    page: { padding: space.lg, gap: space.lg, width: "100%", maxWidth: 560, alignSelf: "center" },
    gap: { gap: space.sm },
    label: { color: c.text, fontSize: font.small, fontWeight: "600" },
    icons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
    icon: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    iconSelected: { borderColor: c.accent, borderWidth: 2, backgroundColor: c.accentSoft },
    emoji: { fontSize: 26 },
  });
