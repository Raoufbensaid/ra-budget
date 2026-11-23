import type { Conversation } from "@ra/assistant";
import { CATEGORY_IDS, type CategoryId } from "@ra/core";
import type { PriceScope } from "@ra/parser";
import { type ComponentRef, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { language } from "@/i18n";
import { categoryLabel } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import type { ChatMessage } from "./use-expense-chat";

interface Props {
  messages: ChatMessage[];
  conv: Conversation;
  onScope: (itemId: string, scope: PriceScope, label: string) => void;
  onCategory: (itemId: string, categoryId: CategoryId, label: string) => void;
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useTheme();
  const s = styles(c);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.chip, pressed && { backgroundColor: c.accentSoft }]}
    >
      <Text style={s.chipText}>{label}</Text>
    </Pressable>
  );
}

export function ChatList({ messages, conv, onScope, onCategory }: Props) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const active = conv.question;
  const activeItem = active ? conv.cart.items.find((i) => i.id === active.itemId) : undefined;

  useEffect(() => {
    if (messages.length > 0) scroll.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const lastQuestionId = [...messages].reverse().find((m) => m.question)?.id;
  const unitChip =
    activeItem?.unit === "piece"
      ? t("assistant.chipEach")
      : t("assistant.chipPer", {
          per:
            activeItem?.unit === "kg" || activeItem?.unit === "g"
              ? t("assistant.kilo")
              : t("assistant.litre"),
        });

  return (
    <ScrollView
      ref={scroll}
      style={s.list}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
    >
      {messages.map((m) => {
        const showChips =
          m.id === lastQuestionId &&
          active !== null &&
          m.question?.itemId === active.itemId &&
          m.question.kind === active.kind &&
          activeItem !== undefined;
        return (
          <View key={m.id} style={m.role === "user" ? s.rowUser : s.rowAssistant}>
            <View style={[s.bubble, m.role === "user" ? s.bubbleUser : s.bubbleAssistant]}>
              <Text style={m.role === "user" ? s.textUser : s.textAssistant}>{m.text}</Text>
            </View>
            {showChips && active?.kind === "scope" && activeItem ? (
              <View style={s.chips}>
                <Chip label={unitChip} onPress={() => onScope(active.itemId, "unit", unitChip)} />
                <Chip
                  label={t("assistant.chipTotal")}
                  onPress={() => onScope(active.itemId, "total", t("assistant.chipTotal"))}
                />
              </View>
            ) : null}
            {showChips && active?.kind === "category" ? (
              <View style={s.chips}>
                {CATEGORY_IDS.map((id) => {
                  const label = categoryLabel(id, language);
                  return (
                    <Chip
                      key={id}
                      label={label}
                      onPress={() => onCategory(active.itemId, id, label)}
                    />
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    list: { flex: 1 },
    content: { padding: space.lg, gap: space.md },
    rowUser: { alignItems: "flex-end" },
    rowAssistant: { alignItems: "flex-start", gap: space.sm },
    bubble: {
      maxWidth: "85%",
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderRadius: radius.lg,
    },
    bubbleUser: { backgroundColor: c.accent, borderBottomRightRadius: space.xs },
    bubbleAssistant: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderBottomLeftRadius: space.xs,
    },
    textUser: { color: c.onAccent, fontSize: font.body, lineHeight: 22 },
    textAssistant: { color: c.text, fontSize: font.body, lineHeight: 22 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, maxWidth: 560 },
    chip: {
      borderColor: c.accent,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
    chipText: { color: c.accent, fontSize: font.small, fontWeight: "600" },
  });
