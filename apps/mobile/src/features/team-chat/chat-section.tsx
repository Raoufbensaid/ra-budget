import { useRouter } from "expo-router";
import { SendHorizontal } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Notice } from "@/components/ui";
import type { Team } from "@/features/teams/api";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { type TeamMessage, useSendMessage, useTeamMessages } from "./api";
import { systemMessageText } from "./system-text";

function time(iso: string): string {
  const d = new Date(iso);
  const day = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${day} ${d.toTimeString().slice(0, 5)}`;
}

/** Rubrique « Discussion » d'une Team : messages, messages automatiques et saisie. */
export function ChatSection({ team, myMemberId }: { team: Team; myMemberId: string | undefined }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  const query = useTeamMessages(team.id);
  const send = useSendMessage(team.id);
  const [text, setText] = useState("");
  const locked = team.status === "archived";
  const nameOf = (id: string | null | undefined) =>
    team.members.find((m) => m.id === id)?.displayName ?? t("teamChat.someone");

  const submit = () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate(body, { onSuccess: () => setText("") });
  };

  const renderMessage = (m: TeamMessage) => {
    if (m.kind === "system") {
      const content = (
        <Text style={s.systemText}>
          {systemMessageText(m, nameOf, t)} · {time(m.createdAt)}
        </Text>
      );
      return m.expenseId ? (
        <Pressable
          key={m.id}
          onPress={() => router.push(`/teams/${team.id}/expenses/${m.expenseId}`)}
          accessibilityRole="link"
          style={s.system}
        >
          {content}
        </Pressable>
      ) : (
        <View key={m.id} style={s.system}>
          {content}
        </View>
      );
    }
    const mine = m.authorMember === myMemberId;
    return (
      <View key={m.id} style={[s.bubbleRow, mine && s.bubbleRowMine]}>
        <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}>
          {!mine ? <Text style={s.author}>{nameOf(m.authorMember)}</Text> : null}
          <Text style={[s.body, mine && s.bodyMine]}>{m.body}</Text>
          <Text style={[s.time, mine && s.timeMine]}>{time(m.createdAt)}</Text>
        </View>
      </View>
    );
  };

  const messages = query.data ?? [];

  return (
    <View style={s.card}>
      {query.isPending ? <ActivityIndicator color={c.accent} /> : null}
      {query.isError ? <Text style={s.muted}>{t("teamChat.error")}</Text> : null}
      {query.isSuccess && messages.length === 0 ? (
        <Text style={s.muted}>{t("teamChat.empty")}</Text>
      ) : null}
      <View style={s.list}>{messages.map(renderMessage)}</View>

      {send.isError ? <Notice tone="error" text={t("teamChat.sendError")} /> : null}
      {locked ? (
        <Text style={s.muted}>{t("teamChat.locked")}</Text>
      ) : (
        <View style={s.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("teamChat.placeholder")}
            placeholderTextColor={c.textMuted}
            multiline
            maxLength={2000}
            autoCorrect
            spellCheck
            autoCapitalize="sentences"
            accessibilityLabel={t("teamChat.placeholder")}
            style={s.input}
          />
          <Pressable
            onPress={submit}
            disabled={!text.trim() || send.isPending}
            accessibilityRole="button"
            accessibilityLabel={t("teamChat.send")}
            style={[s.send, (!text.trim() || send.isPending) && s.sendDisabled]}
          >
            <SendHorizontal size={20} color={c.onAccent} />
          </Pressable>
        </View>
      )}
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
      padding: space.md,
      gap: space.md,
    },
    muted: { color: c.textMuted, fontSize: font.small, lineHeight: 20, textAlign: "center" },
    list: { gap: space.sm },
    system: { alignSelf: "center", maxWidth: "90%", paddingVertical: space.xs },
    systemText: { color: c.textMuted, fontSize: font.tiny, textAlign: "center" },
    bubbleRow: { flexDirection: "row" },
    bubbleRowMine: { justifyContent: "flex-end" },
    bubble: {
      maxWidth: "80%",
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.md,
      gap: 2,
    },
    bubbleMine: { backgroundColor: c.accent, borderBottomRightRadius: 4 },
    bubbleOther: { backgroundColor: c.surfaceMuted, borderBottomLeftRadius: 4 },
    author: { color: c.accent, fontSize: font.tiny, fontWeight: "700" },
    body: { color: c.text, fontSize: font.body, lineHeight: 21 },
    bodyMine: { color: c.onAccent },
    time: { color: c.textMuted, fontSize: 10, alignSelf: "flex-end" },
    timeMine: { color: c.onAccent, opacity: 0.8 },
    composer: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      color: c.text,
      fontSize: font.body,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      backgroundColor: c.background,
    },
    send: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sendDisabled: { opacity: 0.4 },
  });
