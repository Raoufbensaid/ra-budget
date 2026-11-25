/**
 * Page ouverte depuis l'e-mail d'invitation : elle présente la Team, puis la
 * personne se connecte avec l'adresse invitée pour accepter ou refuser
 * (onglet Teams).
 */
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";
import { useLinkView } from "@/features/action-links/api";
import {
  LinkCard,
  LinkLoading,
  LinkPage,
  LinkText,
  LinkUnavailable,
} from "@/features/action-links/link-page";
import { useSession } from "@/features/auth/session-provider";

export default function InviteLinkScreen() {
  const { token = "" } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const signedIn = useSession().session !== null;
  const view = useLinkView(token);
  const screen = <Stack.Screen options={{ title: t("links.brand") }} />;

  if (view.isPending) return <LinkLoading />;
  if (view.isError || !view.data) {
    return (
      <LinkPage title={t("links.unavailable")}>
        {screen}
        <LinkCard>
          <LinkText>{t("links.loadError")}</LinkText>
          <Button variant="secondary" label={t("links.retry")} onPress={() => view.refetch()} />
        </LinkCard>
      </LinkPage>
    );
  }

  const data = view.data;
  if (data.state !== "open" || data.kind !== "accept_invitation") {
    return (
      <>
        {screen}
        <LinkUnavailable
          token={token}
          state={data.state === "open" ? "invalid" : data.state}
          closedText={t("links.invite.closed")}
        />
      </>
    );
  }

  return (
    <LinkPage title={t("links.invite.title", { team: data.team_name ?? "" })}>
      {screen}
      <LinkCard>
        <LinkText>
          {data.inviter
            ? t("links.invite.from", { name: data.inviter })
            : t("links.invite.fromUnknown")}
        </LinkText>
        <LinkText muted>{t("links.invite.howTo", { email: data.email ?? "" })}</LinkText>
        {signedIn ? (
          <Button label={t("links.invite.open")} onPress={() => router.replace("/teams")} />
        ) : (
          <Button label={t("links.invite.signIn")} onPress={() => router.replace("/sign-in")} />
        )}
      </LinkCard>
    </LinkPage>
  );
}
