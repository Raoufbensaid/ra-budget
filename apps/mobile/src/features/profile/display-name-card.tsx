/**
 * Pseudo affiché aux autres membres des Teams. Le changer le met à jour dans
 * le profil et dans toutes les Teams (fonction set_display_name).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import { useSession } from "@/features/auth/session-provider";
import { supabase } from "@/lib/supabase";
import { type Palette, radius, space, useTheme } from "@/theme";

function useDisplayName() {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ["profile", userId, "display-name"],
    enabled: userId !== null,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return (data?.display_name as string | null | undefined) ?? "";
    },
  });
}

function useSetDisplayName() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.rpc("set_display_name", { p_name: name });
      if (error) throw error;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["profile"] });
      void client.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

export function DisplayNameCard() {
  const { t } = useTranslation();
  const s = styles(useTheme());
  const current = useDisplayName();
  const save = useSetDisplayName();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (current.data !== undefined) setName(current.data);
  }, [current.data]);

  const clean = name.trim();
  const changed = clean.length > 0 && clean !== (current.data ?? "");
  const submit = () => {
    if (!changed) return;
    setSaved(false);
    save.mutate(clean, { onSuccess: () => setSaved(true) });
  };

  return (
    <View style={s.card}>
      <Field
        label={t("profile.displayName")}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setSaved(false);
        }}
        placeholder={t("profile.displayNamePlaceholder")}
        maxLength={60}
        autoCapitalize="words"
        onSubmitEditing={submit}
      />
      {save.isError ? <Notice tone="error" text={t("profile.displayNameError")} /> : null}
      {saved ? <Notice text={t("profile.displayNameSaved")} /> : null}
      <Button
        variant="secondary"
        label={t("profile.saveDisplayName")}
        onPress={submit}
        loading={save.isPending}
        disabled={!changed}
      />
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
  });
