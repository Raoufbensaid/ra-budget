import { Mail, UserPlus } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { type TeamMember, useAddGuest, useInviteMember, useUpdateGuest } from "./api";
import { teamErrorMessage } from "./errors";

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const s = styles(useTheme());
  return (
    <View style={s.panel}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.hint}>{hint}</Text>
      {children}
    </View>
  );
}

/** Inviter une personne qui a (ou aura) un compte Ra Budget. */
export function InviteForm({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const c = useTheme();
  const invite = useInviteMember();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = () => {
    const value = email.trim();
    if (!value) return;
    setSentTo(null);
    invite.mutate(
      { p_team: teamId, p_email: value },
      {
        onSuccess: () => {
          setSentTo(value.toLowerCase());
          setEmail("");
        },
      },
    );
  };

  return (
    <Panel title={t("teams.add.inviteTitle")} hint={t("teams.add.inviteHint")}>
      <Field
        label={t("teams.add.email")}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setSentTo(null);
        }}
        placeholder={t("teams.add.emailPlaceholder")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        onSubmitEditing={submit}
      />
      {invite.isError ? <Notice tone="error" text={teamErrorMessage(invite.error, t)} /> : null}
      {sentTo ? <Notice text={t("teams.add.invited", { email: sentTo })} /> : null}
      <Button
        variant="secondary"
        label={t("teams.add.invite")}
        icon={<Mail size={16} color={c.accent} />}
        onPress={submit}
        loading={invite.isPending}
        disabled={!email.trim()}
      />
    </Panel>
  );
}

/**
 * Ajouter un participant sans compte, ou modifier un invité existant
 * (quand `guest` est fourni).
 */
export function GuestForm({
  teamId,
  guest,
  onDone,
}: {
  teamId: string;
  guest?: TeamMember;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const add = useAddGuest();
  const update = useUpdateGuest();
  const mutation = guest ? update : add;
  const [name, setName] = useState(guest?.displayName ?? "");
  const [email, setEmail] = useState(guest?.email ?? "");
  const [added, setAdded] = useState<string | null>(null);

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const e = email.trim() || null;
    setAdded(null);
    if (guest) {
      update.mutate({ p_member: guest.id, p_name: n, p_email: e }, { onSuccess: () => onDone?.() });
    } else {
      add.mutate(
        { p_team: teamId, p_name: n, p_email: e },
        {
          onSuccess: () => {
            setAdded(n);
            setName("");
            setEmail("");
          },
        },
      );
    }
  };

  return (
    <Panel
      title={
        guest ? t("teams.add.editGuest", { name: guest.displayName }) : t("teams.add.guestTitle")
      }
      hint={t("teams.add.guestHint")}
    >
      <Field
        label={t("teams.add.guestName")}
        value={name}
        onChangeText={setName}
        placeholder={t("teams.add.guestNamePlaceholder")}
        maxLength={60}
        autoCapitalize="words"
      />
      <Field
        label={t("teams.add.guestEmail")}
        value={email}
        onChangeText={setEmail}
        placeholder={t("teams.add.emailPlaceholder")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={submit}
      />
      {mutation.isError ? <Notice tone="error" text={teamErrorMessage(mutation.error, t)} /> : null}
      {added ? <Notice text={t("teams.add.guestAdded", { name: added })} /> : null}
      <View style={styles(c).actions}>
        <View style={styles(c).flex}>
          <Button
            variant="secondary"
            label={guest ? t("teams.detail.save") : t("teams.add.addGuest")}
            icon={guest ? undefined : <UserPlus size={16} color={c.accent} />}
            onPress={submit}
            loading={mutation.isPending}
            disabled={!name.trim()}
          />
        </View>
        {guest ? (
          <View style={styles(c).flex}>
            <Button variant="ghost" label={t("teams.detail.cancel")} onPress={() => onDone?.()} />
          </View>
        ) : null}
      </View>
    </Panel>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    actions: { flexDirection: "row", gap: space.sm },
    panel: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    title: { color: c.text, fontSize: font.body, fontWeight: "700" },
    hint: { color: c.textMuted, fontSize: font.tiny, lineHeight: 18, marginTop: -space.sm },
  });
