import { useRouter } from "expo-router";
import { ChevronRight, Plus } from "lucide-react-native";
import { useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Notice } from "@/components/ui";
import {
  type ReceivedInvitation,
  type Team,
  useRespondInvitation,
  useTeams,
  visibleMembers,
} from "@/features/teams/api";
import { teamErrorMessage } from "@/features/teams/errors";
import { StatusPill } from "@/features/teams/status-pill";
import { font, type Palette, radius, space, useTheme } from "@/theme";

function InvitationCard({ invitation }: { invitation: ReceivedInvitation }) {
  const { t } = useTranslation();
  const s = styles(useTheme());
  const router = useRouter();
  const respond = useRespondInvitation();
  const [choice, setChoice] = useState<boolean | null>(null);

  const answer = (accept: boolean) => {
    setChoice(accept);
    respond.mutate(
      { p_invitation: invitation.id, p_accept: accept },
      {
        onSuccess: () => {
          if (accept) router.push(`/teams/${invitation.teamId}`);
        },
      },
    );
  };

  return (
    <View style={[s.card, s.invitation]}>
      <View style={s.cardHeader}>
        <Text style={s.icon}>{invitation.teamIcon}</Text>
        <View style={s.flex}>
          <Text style={s.cardTitle} numberOfLines={1}>
            {invitation.teamName}
          </Text>
          <Text style={s.meta}>{t("teams.invitationFrom")}</Text>
        </View>
      </View>
      {respond.isError ? <Notice tone="error" text={teamErrorMessage(respond.error, t)} /> : null}
      <View style={s.actions}>
        <View style={s.flex}>
          <Button
            label={t("teams.join")}
            onPress={() => answer(true)}
            loading={respond.isPending && choice === true}
            disabled={respond.isPending}
          />
        </View>
        <View style={s.flex}>
          <Button
            variant="secondary"
            label={t("teams.decline")}
            onPress={() => answer(false)}
            loading={respond.isPending && choice === false}
            disabled={respond.isPending}
          />
        </View>
      </View>
    </View>
  );
}

function TeamCard({ team }: { team: Team }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  const count = visibleMembers(team).length;
  return (
    <Pressable
      onPress={() => router.push(`/teams/${team.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${team.name}, ${t(`teams.status.${team.status}`)}, ${t("teams.members", { count })}`}
      style={({ pressed }) => [s.card, pressed && s.pressed]}
    >
      <View style={s.cardHeader}>
        <Text style={s.icon}>{team.icon}</Text>
        <View style={[s.flex, s.cardText]}>
          <Text style={s.cardTitle} numberOfLines={1}>
            {team.name}
          </Text>
          <View style={s.row}>
            <StatusPill status={team.status} />
            <Text style={s.meta}>{t("teams.members", { count })}</Text>
          </View>
        </View>
        <ChevronRight size={18} color={c.textMuted} />
      </View>
    </Pressable>
  );
}

export default function TeamsScreen() {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  const query = useTeams();
  const teams = query.data?.teams ?? [];
  const invitations = query.data?.invitations ?? [];

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      >
        <Text style={s.brand}>RA BUDGET</Text>
        <View style={s.titleRow}>
          <Text style={s.title}>{t("teams.title")}</Text>
          {teams.length > 0 ? (
            <Pressable
              onPress={() => router.push("/teams/new")}
              accessibilityRole="button"
              accessibilityLabel={t("teams.create")}
              hitSlop={8}
              style={s.addButton}
            >
              <Plus size={20} color={c.onAccent} />
            </Pressable>
          ) : null}
        </View>
        <Text style={s.subtitle}>{t("teams.subtitle")}</Text>

        {query.isPending ? <ActivityIndicator color={c.accent} /> : null}
        {query.isError ? (
          <View style={s.gap}>
            <Text style={s.meta}>{t("teams.error")}</Text>
            <Button
              variant="secondary"
              label={t("teams.retry")}
              onPress={() => void query.refetch()}
            />
          </View>
        ) : null}

        {invitations.length > 0 ? (
          <View style={s.gap}>
            <Text style={s.section}>{t("teams.invitationsTitle")}</Text>
            {invitations.map((inv) => (
              <InvitationCard key={inv.id} invitation={inv} />
            ))}
          </View>
        ) : null}

        {query.isSuccess && teams.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>👥</Text>
            <Text style={s.emptyTitle}>{t("teams.empty")}</Text>
            <Text style={s.emptyText}>{t("teams.emptyHint")}</Text>
            <Button label={t("teams.create")} onPress={() => router.push("/teams/new")} />
          </View>
        ) : null}

        {teams.map((team) => (
          <TeamCard key={team.id} team={team} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    page: { padding: space.lg, gap: space.lg, width: "100%", maxWidth: 720, alignSelf: "center" },
    flex: { flex: 1 },
    gap: { gap: space.sm },
    row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
    brand: { color: c.accent, fontSize: font.tiny, fontWeight: "700", letterSpacing: 1.2 },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: -space.md,
    },
    title: { color: c.text, fontSize: font.title, fontWeight: "700" },
    subtitle: { color: c.textMuted, fontSize: font.small, lineHeight: 20, marginTop: -space.sm },
    addButton: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    section: { color: c.textMuted, fontSize: font.small, fontWeight: "700" },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    invitation: { borderColor: c.accent, borderWidth: 1 },
    pressed: { opacity: 0.7 },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: space.md },
    cardText: { gap: space.xs },
    icon: { fontSize: 30 },
    cardTitle: { color: c.text, fontSize: font.body, fontWeight: "700" },
    meta: { color: c.textMuted, fontSize: font.tiny },
    actions: { flexDirection: "row", gap: space.sm },
    empty: {
      alignItems: "center",
      gap: space.md,
      padding: space.xl,
      borderRadius: radius.lg,
      borderColor: c.border,
      borderWidth: 1,
      borderStyle: "dashed",
    },
    emptyIcon: { fontSize: 40 },
    emptyTitle: { color: c.text, fontSize: font.body, fontWeight: "700", textAlign: "center" },
    emptyText: { color: c.textMuted, fontSize: font.small, lineHeight: 20, textAlign: "center" },
  });
