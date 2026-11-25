import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { useSession } from "@/features/auth/session-provider";
import { useTheme } from "@/theme";

function TeamsLayoutContent() {
  const { t } = useTranslation();
  const c = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.accent,
        headerTitleStyle: { color: c.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.background },
        headerBackTitle: t("tabs.teams"),
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ title: t("teams.new.title") }} />
      <Stack.Screen name="notifications" options={{ title: t("notifications.title") }} />
      <Stack.Screen name="[id]/index" options={{ title: "" }} />
      <Stack.Screen name="[id]/expenses/new" options={{ title: t("teamExpenses.add") }} />
      <Stack.Screen name="[id]/expenses/[expenseId]" options={{ title: "" }} />
    </Stack>
  );
}

/** Sans compte : invitation à se connecter. */
export default function TeamsLayout() {
  const { session } = useSession();
  return session ? <TeamsLayoutContent /> : <SignInPrompt />;
}
