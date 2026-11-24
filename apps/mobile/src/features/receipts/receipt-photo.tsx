import { ReceiptText } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { useReceiptUrl } from "./api";

/** Photo du ticket d'une dépense (adresse temporaire), agrandie au toucher. */
export function ReceiptPhoto({ receiptId }: { receiptId: string }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const url = useReceiptUrl(receiptId);
  const [large, setLarge] = useState(false);

  return (
    <View style={s.card}>
      <View style={s.header}>
        <ReceiptText size={18} color={c.accent} />
        <Text style={s.title}>{t("receipts.photo")}</Text>
      </View>
      {url.isPending ? <ActivityIndicator color={c.accent} /> : null}
      {url.isError || (url.isSuccess && !url.data) ? (
        <Text style={s.muted}>{t("receipts.photoUnavailable")}</Text>
      ) : null}
      {url.data ? (
        <Pressable
          onPress={() => setLarge((v) => !v)}
          accessibilityRole="imagebutton"
          accessibilityLabel={t(large ? "receipts.photoSmaller" : "receipts.photoLarger")}
        >
          <Image
            source={{ uri: url.data }}
            style={[s.image, large && s.imageLarge]}
            resizeMode="contain"
          />
        </Pressable>
      ) : null}
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
    header: { flexDirection: "row", alignItems: "center", gap: space.sm },
    title: { color: c.text, fontSize: font.body, fontWeight: "700" },
    muted: { color: c.textMuted, fontSize: font.small },
    image: { width: "100%", height: 200, borderRadius: radius.md, backgroundColor: c.surfaceMuted },
    imageLarge: { height: 520 },
  });
