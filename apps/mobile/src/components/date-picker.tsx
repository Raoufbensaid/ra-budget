/**
 * Calendrier pour choisir une date (« AAAA-MM-JJ »), sur iPhone et Android.
 * Android ouvre sa fenêtre de calendrier ; iPhone affiche un calendrier dans
 * une feuille en bas de l'écran.
 */
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { Button } from "@/components/ui";
import { isoDate } from "@/lib/format";
import { type Palette, radius, space, useTheme } from "@/theme";

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1);
}

export function DatePicker({
  value,
  max,
  open,
  onChange,
  onClose,
}: {
  value: string;
  /** Date la plus tardive possible (« AAAA-MM-JJ »). */
  max?: string;
  open: boolean;
  onChange: (iso: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const [draft, setDraft] = useState(() => toDate(value));
  // À chaque ouverture, le calendrier repart de la date affichée.
  useEffect(() => {
    if (open) setDraft(toDate(value));
  }, [open, value]);
  if (!open) return null;

  if (Platform.OS === "android") {
    return (
      <DateTimePicker
        value={toDate(value)}
        mode="date"
        maximumDate={max ? toDate(max) : undefined}
        onChange={(event: DateTimePickerEvent, date?: Date) => {
          onClose();
          if (event.type === "set" && date) onChange(isoDate(date));
        }}
      />
    );
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable
        style={s.backdrop}
        onPress={onClose}
        accessibilityLabel={t("teams.detail.cancel")}
      />
      <View style={s.sheet}>
        <DateTimePicker
          value={draft}
          mode="date"
          display="inline"
          maximumDate={max ? toDate(max) : undefined}
          onChange={(_event: DateTimePickerEvent, date?: Date) => date && setDraft(date)}
          accentColor={c.accent}
        />
        <Button
          label={t("datePicker.choose")}
          onPress={() => {
            onChange(isoDate(draft));
            onClose();
          }}
        />
        <Button variant="ghost" label={t("teams.detail.cancel")} onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: space.lg,
      paddingBottom: space.xxl,
      gap: space.sm,
    },
  });
