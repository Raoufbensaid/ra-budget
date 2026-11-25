import { useRouter } from "expo-router";
import { Bell, CheckCheck } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/ui";
import { type AppNotification, useMarkRead, useNotifications } from "@/features/notifications/api";
import { language } from "@/i18n";
import { formatCents, formatDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

function text(n: AppNotification, t: ReturnType<typeof useTranslation>["t"]): string {
  const title = (n.data.title as string | undefined) ?? "";
  const cents =
    typeof n.data.amount_cents === "number"
      ? n.data.amount_cents
      : typeof n.data.total_cents === "number"
        ? n.data.total_cents
        : null;
  const amount = cents === null ? "" : formatCents(cents, language);
  return t(`notifications.kind.${n.kind}`, {
    title,
    amount,
    team: (n.data.team_name as string | undefined) ?? "",
    from: (n.data.from_name as string | undefined) ?? "",
    to: (n.data.to_name as string | undefined) ?? "",
  });
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  const query = useNotifications();
  const markRead = useMarkRead();
  const list = query.data ?? [];
  const unread = list.filter((n) => n.readAt === null).length;

  const open = (n: AppNotification) => {
    if (n.readAt === null) markRead.mutate([n.id]);
    if (n.kind === "team_invitation") router.push("/teams");
    else if (n.expenseId) router.push(`/teams/${n.teamId}/expenses/${n.expenseId}`);
    else router.push(`/teams/${n.teamId}`);
  };

  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
      }
    >
      {unread > 0 ? (
        <Button
          variant="secondary"
          label={t("notifications.markAll")}
          icon={<CheckCheck size={16} color={c.accent} />}
          loading={markRead.isPending}
          onPress={() => markRead.mutate(null)}
        />
      ) : null}
      {query.isPending ? <ActivityIndicator color={c.accent} /> : null}
      {query.isSuccess && list.length === 0 ? (
        <View style={s.empty}>
          <Bell size={32} color={c.textMuted} />
          <Text style={s.muted}>{t("notifications.empty")}</Text>
        </View>
      ) : null}
      {list.map((n) => (
        <Pressable
          key={n.id}
          onPress={() => open(n)}
          accessibilityRole="button"
          style={({ pressed }) => [s.item, n.readAt === null && s.unread, pressed && s.pressed]}
        >
          {n.readAt === null ? (
            <View style={s.dot} accessibilityLabel={t("notifications.new")} />
          ) : null}
          <View style={s.flex}>
            <Text style={[s.text, n.readAt === null && s.textUnread]}>{text(n, t)}</Text>
            <Text style={s.meta}>
              {formatDate(n.createdAt.slice(0, 10), language, {
                today: t("expense.today"),
                yesterday: t("expense.yesterday"),
              })}
              {" · "}
              {new Date(n.createdAt).toTimeString().slice(0, 5)}
            </Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    page: { padding: space.lg, gap: space.sm, width: "100%", maxWidth: 640, alignSelf: "center" },
    flex: { flex: 1 },
    muted: { color: c.textMuted, fontSize: font.small, textAlign: "center" },
    empty: { alignItems: "center", gap: space.md, padding: space.xxl },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      padding: space.md,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    unread: { borderColor: c.accent },
    pressed: { opacity: 0.7 },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent },
    text: { color: c.text, fontSize: font.small, lineHeight: 20 },
    textUnread: { fontWeight: "700" },
    meta: { color: c.textMuted, fontSize: font.tiny },
  });
