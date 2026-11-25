import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSession } from "@/features/auth/session-provider";
import { createReceipt, discardReceipt, uploadReceipt } from "@/features/receipts/api";
import { useOcr } from "@/features/receipts/ocr";
import { ScanCard, type ScannedReceipt } from "@/features/receipts/scan-card";
import type { ExpenseDraft } from "@/features/team-expenses/api";
import { expenseErrorMessage } from "@/features/team-expenses/errors";
import { ExpenseForm, type ExpensePrefill } from "@/features/team-expenses/expense-form";
import { myMember, useTeam } from "@/features/teams/api";
import { supabase } from "@/lib/supabase";
import { space, useTheme } from "@/theme";

export default function NewTeamExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamId = id ?? "";
  const { t } = useTranslation();
  const c = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const userId = useSession().session?.user.id ?? null;
  const team = useTeam(teamId);
  const ocr = useOcr();
  const [scanned, setScanned] = useState<ScannedReceipt | null>(null);
  const [scanCount, setScanCount] = useState(0);

  // Enregistrement : photo du ticket (si scannée), puis dépense rattachée.
  const save = useMutation({
    mutationFn: async (draft: ExpenseDraft): Promise<string> => {
      let receiptId: string | null = null;
      let path: string | null = null;
      try {
        if (scanned) {
          path = await uploadReceipt(teamId, scanned.base64, scanned.mime);
          receiptId = await createReceipt(teamId, path, scanned.text);
        }
        const { data, error } = await supabase.rpc("create_expense", {
          p_team: teamId,
          p_draft: receiptId ? { ...draft, receipt_id: receiptId } : draft,
        });
        if (error) throw error;
        return data as string;
      } catch (e) {
        // La dépense n'est pas enregistrée : on ne garde pas sa photo.
        if (path) await discardReceipt(path, receiptId);
        throw e;
      }
    },
    onSuccess: (expenseId) => {
      void client.invalidateQueries({ queryKey: ["team-expenses"] });
      router.replace(`/teams/${teamId}/expenses/${expenseId}`);
    },
  });

  if (!team.data) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  const members = team.data.members.filter((m) => m.status === "active");
  const prefill: ExpensePrefill | null = scanned
    ? {
        title: scanned.parsed.merchant,
        spentOn: scanned.parsed.date,
        totalCents: scanned.parsed.totalCents ?? scanned.parsed.itemsSumCents,
        items: scanned.parsed.items,
      }
    : null;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {ocr.element}
      <ScanCard
        recognize={ocr.recognize}
        scanned={scanned}
        onScanned={(receipt) => {
          setScanned(receipt);
          setScanCount((n) => n + 1);
        }}
      />
      <ExpenseForm
        // Un nouveau ticket recrée le formulaire avec les valeurs lues.
        key={scanCount}
        members={members}
        myMemberId={myMember(team.data, userId)?.id}
        prefill={prefill}
        submitLabel={t("teamExpenses.form.submit")}
        submitting={save.isPending}
        errorText={save.isError ? expenseErrorMessage(save.error, t) : null}
        onSubmit={(draft) => save.mutate(draft)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  page: { padding: space.lg, gap: space.lg, width: "100%", maxWidth: 640, alignSelf: "center" },
});
