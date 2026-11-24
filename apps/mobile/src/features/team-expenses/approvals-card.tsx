import { approvalState, requiredApprovers } from "@ra/team";
import { CircleCheck, Hourglass, TriangleExclamationPoint } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import type { TeamMember } from "@/features/teams/api";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import {
  type ExpenseDispute,
  type TeamExpenseView,
  useApproveExpense,
  useDisputeExpense,
} from "./api";
import { expenseErrorMessage } from "./errors";

type DisputeKind = ExpenseDispute["kind"];

/**
 * Validations d'une dépense : qui a validé, qui attend, qui conteste, et les
 * actions possibles pour la personne connectée (et pour le créateur, au nom
 * des invités sans e-mail).
 */
export function ApprovalsCard({
  expense,
  members,
  myMemberId,
  isOwner,
  active,
  canEdit,
  onEdit,
}: {
  expense: TeamExpenseView;
  members: TeamMember[];
  myMemberId: string | undefined;
  isOwner: boolean;
  /** Team active et dépense non annulée. */
  active: boolean;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const approve = useApproveExpense();
  const dispute = useDisputeExpense();
  const [kind, setKind] = useState<DisputeKind | null>(null);
  const [reason, setReason] = useState("");

  const required = requiredApprovers(
    expense.paidBy,
    expense.beneficiaries.map((b) => b.memberId),
  );
  const state = approvalState(required, expense.approvals);
  const memberOf = (id: string) => members.find((m) => m.id === id);
  const nameOf = (id: string) => memberOf(id)?.displayName ?? "—";
  const viaOf = (id: string) => expense.approvals.find((a) => a.memberId === id)?.via;
  const iAmRequired = myMemberId !== undefined && required.includes(myMemberId);
  const myDecision = expense.approvals.find((a) => a.memberId === myMemberId)?.decision;
  const openDisputes = expense.disputes.filter((d) => d.status === "open");
  const error = approve.error ?? dispute.error;

  const sendDispute = () => {
    if (!kind) return;
    dispute.mutate(
      {
        p_expense: expense.id,
        p_version: expense.version,
        p_kind: kind,
        p_reason: reason.trim(),
        p_member: null,
      },
      {
        onSuccess: () => {
          setKind(null);
          setReason("");
        },
      },
    );
  };

  return (
    <View style={s.card}>
      <Text style={s.title}>{t("approvals.title")}</Text>
      <Text style={s.hint}>
        {state.status === "validated"
          ? t("approvals.allDone")
          : state.status === "disputed"
            ? t("approvals.disputedHint")
            : t("approvals.waitingCount", { count: state.waiting.length })}
      </Text>

      {required.map((id, index) => {
        const approved = state.approved.includes(id);
        const refused = state.refused.includes(id);
        const Icon = approved ? CircleCheck : refused ? TriangleExclamationPoint : Hourglass;
        const color = approved ? c.accent : refused ? c.danger : c.warning;
        const member = memberOf(id);
        const via = viaOf(id);
        const guestWithoutEmail = member?.role === "guest" && !member.email;
        return (
          <View key={id} style={s.row}>
            <Icon size={18} color={color} />
            <View style={s.flex}>
              <Text style={s.name}>
                {nameOf(id)}
                {id === myMemberId ? ` ${t("teams.member.you")}` : ""}
              </Text>
              <Text style={s.meta}>
                {index === 0 ? `${t("approvals.payerStep")} · ` : ""}
                {approved
                  ? via === "owner"
                    ? t("approvals.approvedByOwner")
                    : via === "email"
                      ? t("approvals.approvedByEmail")
                      : t("approvals.approved")
                  : refused
                    ? t("approvals.refused")
                    : member?.role === "guest" && member.email
                      ? t("approvals.waitingEmail")
                      : t("approvals.waiting")}
              </Text>
            </View>
            {active && isOwner && guestWithoutEmail && !approved ? (
              <Button
                variant="ghost"
                label={t("approvals.approveFor", { name: nameOf(id) })}
                loading={approve.isPending}
                onPress={() =>
                  approve.mutate({
                    p_expense: expense.id,
                    p_version: expense.version,
                    p_member: id,
                  })
                }
              />
            ) : null}
          </View>
        );
      })}

      {openDisputes.length > 0 ? (
        <View style={s.disputes}>
          {openDisputes.map((d) => (
            <View key={d.id} style={s.dispute}>
              <Text style={s.disputeTitle}>
                {t(`approvals.kind.${d.kind}`, { name: nameOf(d.memberId) })}
              </Text>
              {d.reason ? <Text style={s.disputeReason}>« {d.reason} »</Text> : null}
            </View>
          ))}
          {canEdit ? (
            <Button variant="secondary" label={t("approvals.correct")} onPress={onEdit} />
          ) : null}
        </View>
      ) : null}

      {error ? <Notice tone="error" text={expenseErrorMessage(error, t)} /> : null}

      {active && iAmRequired ? (
        kind ? (
          <View style={s.form}>
            <Field
              label={
                kind === "refuse" ? t("approvals.reasonOptional") : t("approvals.reasonRequired")
              }
              value={reason}
              onChangeText={setReason}
              placeholder={t(`approvals.placeholder.${kind}`)}
              maxLength={500}
              multiline
            />
            <Button
              variant="danger"
              label={t(`approvals.send.${kind}`)}
              loading={dispute.isPending}
              disabled={kind !== "refuse" && !reason.trim()}
              onPress={sendDispute}
            />
            <Button
              variant="ghost"
              label={t("teams.detail.cancel")}
              onPress={() => setKind(null)}
            />
          </View>
        ) : (
          <View style={s.actions}>
            {myDecision !== "approved" ? (
              <Button
                label={t("approvals.approve")}
                loading={approve.isPending}
                onPress={() =>
                  approve.mutate({
                    p_expense: expense.id,
                    p_version: expense.version,
                    p_member: null,
                  })
                }
              />
            ) : null}
            {myMemberId !== expense.paidBy ? (
              <Button
                variant="secondary"
                label={t("approvals.refuse")}
                onPress={() => setKind("refuse")}
              />
            ) : null}
            <Button
              variant="secondary"
              label={t("approvals.reportError")}
              onPress={() => setKind("error")}
            />
            <Button
              variant="ghost"
              label={t("approvals.askCorrection")}
              onPress={() => setKind("correction")}
            />
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    title: { color: c.text, fontSize: font.body, fontWeight: "700" },
    hint: { color: c.textMuted, fontSize: font.small, marginTop: -space.sm },
    row: { flexDirection: "row", alignItems: "center", gap: space.md },
    name: { color: c.text, fontSize: font.body, fontWeight: "600" },
    meta: { color: c.textMuted, fontSize: font.tiny },
    disputes: {
      gap: space.sm,
      padding: space.md,
      borderRadius: radius.md,
      backgroundColor: c.warningSoft,
    },
    dispute: { gap: 2 },
    disputeTitle: { color: c.text, fontSize: font.small, fontWeight: "700" },
    disputeReason: { color: c.text, fontSize: font.small, fontStyle: "italic" },
    form: { gap: space.sm },
    actions: { gap: space.sm },
  });
