import { Pencil, UserMinus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import type { TeamMember } from "./api";

/** Initiales d'un nom (« Dana Lopez » → « DL »). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}

/** Une ligne de membre : avatar, nom, rôle ou statut, et actions du créateur. */
export function MemberRow({
  member,
  isMe,
  onEdit,
  onRemove,
}: {
  member: TeamMember;
  isMe: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const detail =
    member.status === "invited"
      ? t("teams.member.invited")
      : member.role === "owner"
        ? t("teams.member.owner")
        : member.role === "guest"
          ? member.email
            ? t("teams.member.guestWithEmail", { email: member.email })
            : t("teams.member.guest")
          : t("teams.member.member");

  return (
    <View style={s.row}>
      <View style={[s.avatar, member.role === "guest" && s.avatarGuest]}>
        <Text style={[s.initials, member.role === "guest" && s.initialsGuest]}>
          {initials(member.displayName)}
        </Text>
      </View>
      <View style={s.flex}>
        <Text style={s.name} numberOfLines={1}>
          {member.displayName}
          {isMe ? ` ${t("teams.member.you")}` : ""}
        </Text>
        <Text style={s.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {onEdit ? (
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={t("teams.member.edit", { name: member.displayName })}
          hitSlop={10}
          style={s.action}
        >
          <Pencil size={16} color={c.textMuted} />
        </Pressable>
      ) : null}
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={t("teams.member.remove", { name: member.displayName })}
          hitSlop={10}
          style={s.action}
        >
          <UserMinus size={16} color={c.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    row: { flexDirection: "row", alignItems: "center", gap: space.md },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: c.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarGuest: {
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
      borderStyle: "dashed",
    },
    initials: { color: c.accent, fontSize: font.small, fontWeight: "800" },
    initialsGuest: { color: c.textMuted },
    name: { color: c.text, fontSize: font.body, fontWeight: "600" },
    detail: { color: c.textMuted, fontSize: font.tiny },
    action: { padding: space.xs },
  });
