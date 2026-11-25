import { Stack, useLocalSearchParams } from "expo-router";
import { Pencil, XCircle } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import { useSession } from "@/features/auth/session-provider";
import { ReceiptPhoto } from "@/features/receipts/receipt-photo";
import {
  canEditExpense,
  useCancelExpense,
  useTeamExpense,
  useUpdateExpense,
} from "@/features/team-expenses/api";
import { ApprovalsCard } from "@/features/team-expenses/approvals-card";
import { expenseErrorMessage } from "@/features/team-expenses/errors";
import { ExpenseForm } from "@/features/team-expenses/expense-form";
import { ExpenseStatusPill } from "@/features/team-expenses/expense-status";
import { HistoryCard } from "@/features/team-expenses/history-card";
import { myMember, useTeam } from "@/features/teams/api";
import { language } from "@/i18n";
import { confirm } from "@/lib/confirm";
import { capitalize, categoryLabel, formatCents, formatDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

function InfoRow({ label, value }: { label: string; value: string }) {
  const s = styles(useTheme());
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

export default function TeamExpenseScreen() {
  const { id, expenseId } = useLocalSearchParams<{ id: string; expenseId: string }>();
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const userId = useSession().session?.user.id ?? null;
  const team = useTeam(id ?? "");
  const query = useTeamExpense(expenseId ?? "");
  const update = useUpdateExpense();
  const cancel = useCancelExpense();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const expense = query.data;
  if (query.isPending || !team.data) {
    return (
      <View style={[s.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (!expense) {
    return (
      <View style={[s.center, { backgroundColor: c.background }]}>
        <Text style={s.muted}>{t("teamExpenses.notFound")}</Text>
      </View>
    );
  }

  const me = myMember(team.data, userId);
  const isOwner = me?.role === "owner";
  const editable = team.data.status === "active" && canEditExpense(expense, me?.id, isOwner);
  const nameOf = (memberId: string) =>
    team.data?.members.find((m) => m.id === memberId)?.displayName ?? "—";
  const date = formatDate(expense.spentOn, language, {
    today: t("expense.today"),
    yesterday: t("expense.yesterday"),
  });

  // Bénéficiaires qui ont quitté la Team : on ne peut plus leur attribuer une part.
  const gone = expense.beneficiaries.filter(
    (b) => team.data?.members.find((m) => m.id === b.memberId)?.status !== "active",
  );

  if (editing) {
    return (
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: t("teamExpenses.edit") }} />
        <Notice text={t("teamExpenses.editHint")} />
        {gone.map((b) => (
          <Notice
            key={b.memberId}
            tone="error"
            text={t("teamExpenses.formerMember", {
              name: team.data?.members.find((m) => m.id === b.memberId)?.displayName ?? "—",
              amount: formatCents(b.shareCents, language),
            })}
          />
        ))}
        <ExpenseForm
          members={team.data.members.filter((m) => m.status === "active")}
          myMemberId={me?.id}
          initial={expense}
          submitLabel={t("teamExpenses.saveChanges")}
          submitting={update.isPending}
          errorText={update.isError ? expenseErrorMessage(update.error, t) : null}
          onSubmit={(draft) =>
            update.mutate(
              { p_expense: expense.id, p_draft: draft },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
        <Button
          variant="ghost"
          label={t("teams.detail.cancel")}
          onPress={() => setEditing(false)}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: expense.title }} />

      <View style={s.hero}>
        <Text style={s.title}>{expense.title}</Text>
        <Text style={s.amount}>{formatCents(expense.totalCents, language)}</Text>
        <ExpenseStatusPill status={expense.status} />
      </View>

      {expense.receiptId ? <ReceiptPhoto receiptId={expense.receiptId} /> : null}

      <ApprovalsCard
        expense={expense}
        members={team.data.members}
        myMemberId={me?.id}
        isOwner={isOwner}
        active={team.data.status === "active" && expense.status !== "cancelled"}
        canEdit={editable}
        onEdit={() => setEditing(true)}
      />

      <View style={s.card}>
        <InfoRow label={t("teamExpenses.detail.date")} value={capitalize(date)} />
        <InfoRow label={t("teamExpenses.detail.paidBy")} value={nameOf(expense.paidBy)} />
        <InfoRow label={t("teamExpenses.detail.enteredBy")} value={nameOf(expense.enteredBy)} />
        <InfoRow
          label={t("teamExpenses.detail.category")}
          value={
            expense.categoryId
              ? categoryLabel(expense.categoryId, language)
              : t("teamExpenses.detail.noCategory")
          }
        />
        <InfoRow
          label={t("teamExpenses.detail.split")}
          value={t(`teamExpenses.form.mode.${expense.splitMode}`)}
        />
        <InfoRow label={t("teamExpenses.detail.version")} value={String(expense.version)} />
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>{t("teamExpenses.detail.shares")}</Text>
        {expense.beneficiaries.map((b) => (
          <View key={b.memberId} style={s.shareRow}>
            <Text style={[s.flex, s.shareName]}>
              {nameOf(b.memberId)}
              {b.memberId === me?.id ? ` ${t("teams.member.you")}` : ""}
            </Text>
            <Text style={s.shareAmount}>{formatCents(b.shareCents, language)}</Text>
          </View>
        ))}
      </View>

      {expense.items.length > 0 ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>{t("teamExpenses.detail.items")}</Text>
          {expense.items.map((item) => (
            <View key={item.position} style={s.shareRow}>
              <Text style={[s.flex, s.shareName]} numberOfLines={1}>
                {item.quantity !== 1 ? `${item.quantity} × ` : ""}
                {item.label}
              </Text>
              <Text style={s.shareAmount}>{formatCents(item.totalCents, language)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {editable ? (
        cancelling ? (
          <View style={s.card}>
            <Field
              label={t("teamExpenses.cancelReason")}
              value={reason}
              onChangeText={setReason}
              placeholder={t("teamExpenses.cancelReasonPlaceholder")}
              maxLength={500}
            />
            {cancel.isError ? (
              <Notice tone="error" text={expenseErrorMessage(cancel.error, t)} />
            ) : null}
            <Button
              variant="danger"
              label={t("teamExpenses.cancelConfirm")}
              loading={cancel.isPending}
              onPress={() =>
                confirm(
                  t("teamExpenses.cancelQuestion", { title: expense.title }),
                  t("teamExpenses.cancelConfirm"),
                  t("teams.detail.cancel"),
                  () =>
                    cancel.mutate(
                      { p_expense: expense.id, p_reason: reason },
                      { onSuccess: () => setCancelling(false) },
                    ),
                )
              }
            />
            <Button
              variant="ghost"
              label={t("teams.detail.cancel")}
              onPress={() => setCancelling(false)}
            />
          </View>
        ) : (
          <View style={s.actions}>
            <View style={s.flex}>
              <Button
                variant="secondary"
                label={t("teamExpenses.edit")}
                icon={<Pencil size={16} color={c.accent} />}
                onPress={() => setEditing(true)}
              />
            </View>
            <View style={s.flex}>
              <Button
                variant="danger"
                label={t("teamExpenses.cancelAction")}
                icon={<XCircle size={16} color={c.danger} />}
                onPress={() => setCancelling(true)}
              />
            </View>
          </View>
        )
      ) : null}
      <HistoryCard expenseId={expense.id} members={team.data.members} />
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
    page: { padding: space.lg, gap: space.lg, width: "100%", maxWidth: 640, alignSelf: "center" },
    flex: { flex: 1 },
    muted: { color: c.textMuted, fontSize: font.small, lineHeight: 20 },
    hero: { gap: space.xs },
    title: { color: c.text, fontSize: font.title, fontWeight: "800" },
    amount: { color: c.text, fontSize: 34, fontWeight: "800", fontVariant: ["tabular-nums"] },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.sm,
    },
    cardTitle: { color: c.text, fontSize: font.body, fontWeight: "700" },
    infoRow: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
    infoLabel: { color: c.textMuted, fontSize: font.small },
    infoValue: {
      color: c.text,
      fontSize: font.small,
      fontWeight: "600",
      flexShrink: 1,
      textAlign: "right",
    },
    shareRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
    shareName: { color: c.text, fontSize: font.body },
    shareAmount: {
      color: c.text,
      fontSize: font.body,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    actions: { flexDirection: "row", gap: space.sm },
  });
