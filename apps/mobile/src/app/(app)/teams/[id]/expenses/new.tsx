import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSession } from "@/features/auth/session-provider";
import { useCreateExpense } from "@/features/team-expenses/api";
import { expenseErrorMessage } from "@/features/team-expenses/errors";
import { ExpenseForm } from "@/features/team-expenses/expense-form";
import { myMember, useTeam } from "@/features/teams/api";
import { space, useTheme } from "@/theme";

export default function NewTeamExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const c = useTheme();
  const router = useRouter();
  const userId = useSession().session?.user.id ?? null;
  const team = useTeam(id ?? "");
  const create = useCreateExpense();

  if (!team.data) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  const members = team.data.members.filter((m) => m.status === "active");

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ExpenseForm
        members={members}
        myMemberId={myMember(team.data, userId)?.id}
        submitLabel={t("teamExpenses.form.submit")}
        submitting={create.isPending}
        errorText={create.isError ? expenseErrorMessage(create.error, t) : null}
        onSubmit={(draft) =>
          create.mutate(
            { p_team: team.data?.id ?? "", p_draft: draft },
            { onSuccess: (expenseId) => router.replace(`/teams/${id}/expenses/${expenseId}`) },
          )
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  page: { padding: space.lg, width: "100%", maxWidth: 640, alignSelf: "center" },
});
