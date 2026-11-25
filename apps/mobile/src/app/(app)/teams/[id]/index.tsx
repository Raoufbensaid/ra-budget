import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { LogOut, MailX, Pencil, Trash2 } from "lucide-react-native";
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
import { Button, Field, Notice } from "@/components/ui";
import { useSession } from "@/features/auth/session-provider";
import { ChatSection } from "@/features/team-chat/chat-section";
import { ExpensesSection } from "@/features/team-expenses/expenses-section";
import { AccountsSection } from "@/features/team-settlement/accounts-section";
import {
  myMember,
  type Team,
  useCancelInvitation,
  useDeleteTeam,
  useLeaveTeam,
  useRemoveMember,
  useTeam,
  useUpdateTeam,
  visibleMembers,
} from "@/features/teams/api";
import { teamErrorMessage } from "@/features/teams/errors";
import { TEAM_ICONS } from "@/features/teams/icons";
import { GuestForm, InviteForm } from "@/features/teams/member-forms";
import { MemberRow } from "@/features/teams/member-row";
import { StatusPill } from "@/features/teams/status-pill";
import { language } from "@/i18n";
import { confirm } from "@/lib/confirm";
import { formatDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

type Section = "members" | "chat" | "expenses" | "accounts";

function RenameForm({ team, onDone }: { team: Team; onDone: () => void }) {
  const { t } = useTranslation();
  const s = styles(useTheme());
  const update = useUpdateTeam();
  const [name, setName] = useState(team.name);
  const [icon, setIcon] = useState(team.icon);
  const submit = () =>
    update.mutate({ p_team: team.id, p_name: name.trim(), p_icon: icon }, { onSuccess: onDone });
  return (
    <View style={s.card}>
      <Field
        label={t("teams.new.name")}
        value={name}
        onChangeText={setName}
        maxLength={60}
        onSubmitEditing={submit}
      />
      <View style={s.icons}>
        {TEAM_ICONS.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => setIcon(emoji)}
            accessibilityRole="radio"
            accessibilityState={{ selected: emoji === icon }}
            accessibilityLabel={emoji}
            style={[s.iconChoice, emoji === icon && s.iconChoiceSelected]}
          >
            <Text style={s.iconChoiceText}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
      {update.isError ? <Notice tone="error" text={teamErrorMessage(update.error, t)} /> : null}
      <View style={s.actions}>
        <View style={s.flex}>
          <Button
            label={t("teams.detail.save")}
            onPress={submit}
            loading={update.isPending}
            disabled={!name.trim()}
          />
        </View>
        <View style={s.flex}>
          <Button variant="secondary" label={t("teams.detail.cancel")} onPress={onDone} />
        </View>
      </View>
    </View>
  );
}

export default function TeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  const userId = useSession().session?.user.id ?? null;
  const query = useTeam(id ?? "");
  const removeMember = useRemoveMember();
  const cancelInvitation = useCancelInvitation();
  const leave = useLeaveTeam();
  const remove = useDeleteTeam();
  const [section, setSection] = useState<Section>("expenses");
  const [renaming, setRenaming] = useState(false);
  const [editingGuest, setEditingGuest] = useState<string | null>(null);

  const team = query.data;

  if (query.isPending) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (!team) {
    return (
      <View style={s.center}>
        <Text style={s.muted}>{t("teams.detail.notFound")}</Text>
      </View>
    );
  }

  const me = myMember(team, userId);
  const isOwner = me?.role === "owner";
  const editable = team.status === "active";
  const members = visibleMembers(team);
  const owner = team.members.find((m) => m.role === "owner");
  const actionError = removeMember.error ?? cancelInvitation.error ?? leave.error ?? remove.error;

  return (
    <ScrollView
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      // Le champ en cours de saisie reste visible au-dessus du clavier (iOS ;
      // Android redimensionne déjà l'écran).
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
      }
    >
      <Stack.Screen options={{ title: team.name }} />

      {renaming ? (
        <RenameForm team={team} onDone={() => setRenaming(false)} />
      ) : (
        <View style={s.header}>
          <Text style={s.bigIcon}>{team.icon}</Text>
          <View style={[s.flex, s.headerText]}>
            <Text style={s.teamName}>{team.name}</Text>
            <StatusPill status={team.status} />
            <Text style={s.muted}>
              {t("teams.detail.createdBy", {
                name: owner?.displayName ?? "—",
                date: formatDate(team.createdAt.slice(0, 10), language, {
                  today: t("expense.today"),
                  yesterday: t("expense.yesterday"),
                }),
              })}
            </Text>
          </View>
          {isOwner && editable ? (
            <Pressable
              onPress={() => setRenaming(true)}
              accessibilityRole="button"
              accessibilityLabel={t("teams.detail.rename")}
              hitSlop={10}
            >
              <Pencil size={18} color={c.accent} />
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={s.tabs} accessibilityRole="tablist">
        {(["members", "chat", "expenses", "accounts"] as const).map((key) => (
          <Pressable
            key={key}
            onPress={() => setSection(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === key }}
            style={[s.tab, section === key && s.tabActive]}
          >
            <Text style={[s.tabText, section === key && s.tabTextActive]}>
              {t(`teams.detail.sections.${key}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      {section === "expenses" ? (
        <ExpensesSection team={team} />
      ) : section === "chat" ? (
        <ChatSection team={team} myMemberId={me?.id} />
      ) : section === "accounts" ? (
        <AccountsSection team={team} me={me} />
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>{t("teams.detail.membersTitle")}</Text>
            {members.map((m) =>
              editingGuest === m.id ? (
                <GuestForm
                  key={m.id}
                  teamId={team.id}
                  guest={m}
                  onDone={() => setEditingGuest(null)}
                />
              ) : (
                <MemberRow
                  key={m.id}
                  member={m}
                  isMe={m.id === me?.id}
                  onEdit={
                    isOwner && editable && m.role === "guest"
                      ? () => setEditingGuest(m.id)
                      : undefined
                  }
                  onRemove={
                    isOwner && editable && m.role !== "owner"
                      ? () =>
                          confirm(
                            t("teams.member.confirmRemove", { name: m.displayName }),
                            t("teams.detail.yes"),
                            t("teams.detail.cancel"),
                            () => removeMember.mutate({ p_member: m.id }),
                          )
                      : undefined
                  }
                />
              ),
            )}
            {team.invitations.length > 0 ? (
              <View style={s.invitations}>
                <Text style={s.subTitle}>{t("teams.detail.invitedTitle")}</Text>
                {team.invitations.map((inv) => (
                  <View key={inv.id} style={s.invitationRow}>
                    <Text style={[s.muted, s.flex]} numberOfLines={1}>
                      {t("teams.detail.invitedEmail", { email: inv.email })}
                    </Text>
                    {isOwner ? (
                      <Pressable
                        onPress={() =>
                          confirm(
                            t("teams.detail.confirmCancelInvitation", { email: inv.email }),
                            t("teams.detail.yes"),
                            t("teams.detail.cancel"),
                            () => cancelInvitation.mutate({ p_invitation: inv.id }),
                          )
                        }
                        accessibilityRole="button"
                        accessibilityLabel={t("teams.detail.cancelInvitation", {
                          email: inv.email,
                        })}
                        hitSlop={10}
                      >
                        <MailX size={16} color={c.danger} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
            {actionError ? <Notice tone="error" text={teamErrorMessage(actionError, t)} /> : null}
          </View>

          {isOwner && editable ? (
            <>
              <InviteForm teamId={team.id} />
              <GuestForm teamId={team.id} />
            </>
          ) : null}

          {isOwner ? (
            <Button
              variant="danger"
              label={t("teams.detail.delete")}
              icon={<Trash2 size={16} color={c.danger} />}
              loading={remove.isPending}
              onPress={() =>
                confirm(
                  t("teams.detail.confirmDelete", { name: team.name }),
                  t("teams.detail.delete"),
                  t("teams.detail.cancel"),
                  () =>
                    remove.mutate(
                      { p_team: team.id },
                      { onSuccess: () => router.replace("/teams") },
                    ),
                )
              }
            />
          ) : me ? (
            <Button
              variant="danger"
              label={t("teams.detail.leave")}
              icon={<LogOut size={16} color={c.danger} />}
              loading={leave.isPending}
              onPress={() =>
                confirm(
                  t("teams.detail.confirmLeave", { name: team.name }),
                  t("teams.detail.leave"),
                  t("teams.detail.cancel"),
                  () =>
                    leave.mutate(
                      { p_team: team.id },
                      { onSuccess: () => router.replace("/teams") },
                    ),
                )
              }
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    page: { padding: space.lg, gap: space.lg, width: "100%", maxWidth: 720, alignSelf: "center" },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: space.xl,
      backgroundColor: c.background,
    },
    flex: { flex: 1 },
    muted: { color: c.textMuted, fontSize: font.small, lineHeight: 20 },
    header: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
    headerText: { gap: space.xs },
    bigIcon: { fontSize: 44 },
    teamName: { color: c.text, fontSize: font.title, fontWeight: "800" },
    tabs: {
      flexDirection: "row",
      backgroundColor: c.surfaceMuted,
      borderRadius: radius.pill,
      padding: space.xs,
      gap: space.xs,
    },
    tab: { flex: 1, paddingVertical: space.sm, borderRadius: radius.pill, alignItems: "center" },
    tabActive: { backgroundColor: c.surface },
    tabText: { color: c.textMuted, fontSize: font.small, fontWeight: "600" },
    tabTextActive: { color: c.text, fontWeight: "700" },
    soon: {
      padding: space.lg,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: c.border,
    },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    cardTitle: { color: c.text, fontSize: font.body, fontWeight: "700" },
    subTitle: { color: c.textMuted, fontSize: font.tiny, fontWeight: "700" },
    invitations: {
      gap: space.sm,
      paddingTop: space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    invitationRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
    actions: { flexDirection: "row", gap: space.sm },
    icons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
    iconChoice: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: c.border,
    },
    iconChoiceSelected: { borderColor: c.accent, borderWidth: 2, backgroundColor: c.accentSoft },
    iconChoiceText: { fontSize: 22 },
  });
