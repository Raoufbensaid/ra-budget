import { type ParsedReceipt, parseReceiptText } from "@ra/parser";
import * as ImagePicker from "expo-image-picker";
import { Camera, Images, ScanText } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from "react-native";
import { Button, Notice } from "@/components/ui";
import { font, type Palette, radius, space, useTheme } from "@/theme";

export interface ScannedReceipt {
  base64: string;
  mime: string;
  uri: string;
  text: string;
  parsed: ParsedReceipt;
}

/**
 * Photo d'un ticket (appareil photo ou galerie), puis lecture automatique.
 * Le résultat pré-remplit le formulaire : la personne vérifie et corrige.
 */
export function ScanCard({
  recognize,
  scanned,
  onScanned,
}: {
  recognize: (dataUrl: string) => Promise<string>;
  scanned: ScannedReceipt | null;
  onScanned: (receipt: ScannedReceipt) => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: "camera" | "library") => {
    setError(null);
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t(source === "camera" ? "receipts.noCamera" : "receipts.noLibrary"));
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const mime = asset.mimeType && asset.mimeType !== "image/heic" ? asset.mimeType : "image/jpeg";
    setBusy(true);
    try {
      const text = await recognize(`data:${mime};base64,${asset.base64}`);
      onScanned({
        base64: asset.base64,
        mime,
        uri: asset.uri,
        text,
        parsed: parseReceiptText(text),
      });
    } catch {
      setError(t("receipts.ocrFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.header}>
        <ScanText size={20} color={c.accent} />
        <Text style={s.title}>{t("receipts.title")}</Text>
      </View>
      <Text style={s.hint}>{scanned ? t("receipts.checkHint") : t("receipts.hint")}</Text>
      {scanned ? (
        <Image source={{ uri: scanned.uri }} style={s.preview} resizeMode="cover" />
      ) : null}
      {busy ? (
        <View style={s.busy}>
          <ActivityIndicator color={c.accent} />
          <Text style={s.hint}>{t("receipts.reading")}</Text>
        </View>
      ) : (
        <View style={s.actions}>
          {Platform.OS !== "web" ? (
            <View style={s.flex}>
              <Button
                variant="secondary"
                label={t("receipts.camera")}
                icon={<Camera size={16} color={c.accent} />}
                onPress={() => void pick("camera")}
              />
            </View>
          ) : null}
          <View style={s.flex}>
            <Button
              variant="secondary"
              label={t("receipts.library")}
              icon={<Images size={16} color={c.accent} />}
              onPress={() => void pick("library")}
            />
          </View>
        </View>
      )}
      {scanned && scanned.parsed.items.length === 0 ? (
        <Notice text={t("receipts.nothingFound")} />
      ) : null}
      {error ? <Notice tone="error" text={error} /> : null}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    header: { flexDirection: "row", alignItems: "center", gap: space.sm },
    title: { color: c.text, fontSize: font.body, fontWeight: "700" },
    hint: { color: c.textMuted, fontSize: font.small, lineHeight: 20 },
    preview: {
      width: "100%",
      height: 180,
      borderRadius: radius.md,
      backgroundColor: c.surfaceMuted,
    },
    busy: { flexDirection: "row", alignItems: "center", gap: space.md },
    actions: { flexDirection: "row", gap: space.sm },
  });
