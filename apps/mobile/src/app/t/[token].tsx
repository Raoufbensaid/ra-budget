/**
 * Page ouverte depuis un e-mail par un invité sans compte : il voit la dépense
 * qui le concerne et la valide ou la conteste. Le lien ne sert qu'une fois.
 */
import { Stack, useLocalSearchParams } from "expo-router";
import { CheckCircle2 } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import {
  type DisputeKind,
  type LinkExpense,
  linkErrorMessage,
  useLinkAct,
  useLinkView,
} from "@/features/action-links/api";
import {
  LinkCard,
  LinkLoading,
  LinkPage,
  LinkText,
  LinkUnavailable,
} from "@/features/action-links/link-page";
import { RepaymentLink, SettlementLink } from "@/features/action-links/settlement-link";
import { language } from "@/i18n";
import { capitalize, categoryLabel, formatCents, formatDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const s = styles(useTheme());
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, strong && s.strong]}>{value}</Text>
    </View>
  );
}

function ExpenseSummary({ expense }: { expense: LinkExpense }) {
  const { t } = useTranslation();
  const s = styles(useTheme());
  const money = (cents: number | undefined) => formatCents(cents ?? 0, language);
  return (
    <LinkCard>
      <Text style={s.expenseTitle}>{expense.title}</Text>
      <Row label={t("links.expense.total")} value={money(expense.total_cents)} />
      {expense.spent_on ? (
        <Row
          label={t("teamExpenses.detail.date")}
          value={capitalize(
            formatDate(expense.spent_on, language, {
              today: t("expense.today"),
              yesterday: t("expense.yesterday"),
            }),
          )}
        />
      ) : null}
      {expense.payer ? <Row label={t("teamExpenses.detail.paidBy")} value={expense.payer} /> : null}
      {expense.entered_by ? (
        <Row label={t("teamExpenses.detail.enteredBy")} value={expense.entered_by} />
      ) : null}
      <Row
        label={t("teamExpenses.detail.category")}
        value={
          expense.category_id
            ? categoryLabel(expense.category_id, language)
            : t("teamExpenses.detail.noCategory")
        }
      />
      <View style={s.highlight}>
        <Row label={t("links.expense.myShare")} value={money(expense.my_share_cents)} strong />
      </View>

      {expense.beneficiaries && expense.beneficiaries.length > 0 ? (
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t("teamExpenses.detail.shares")}</Text>
          {expense.beneficiaries.map((b, i) => (
            <Row
              // biome-ignore lint/suspicious/noArrayIndexKey: liste figée (les noms peuvent se répéter)
              key={`b${i}`}
              label={b.is_me ? t("links.expense.me", { name: b.name }) : b.name}
              value={money(b.share_cents)}
            />
          ))}
        </View>
      ) : null}

      {expense.items && expense.items.length > 0 ? (
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t("teamExpenses.detail.items")}</Text>
          {expense.items.map((item, i) => (
            <Row
              // biome-ignore lint/suspicious/noArrayIndexKey: liste figée, jamais réordonnée
              key={`i${i}`}
              label={item.quantity !== 1 ? `${item.label} ×${item.quantity}` : item.label}
              value={money(item.total_cents)}
            />
          ))}
        </View>
      ) : null}
    </LinkCard>
  );
}

export default function ActionLinkScreen() {
  const { token = "" } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const view = useLinkView(token);
  const act = useLinkAct(token);
  const [kind, setKind] = useState<DisputeKind | null>(null);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<"approve" | "dispute" | null>(null);

  const screen = <Stack.Screen options={{ title: t("links.brand") }} />;

  if (done) {
    return (
      <LinkPage title={t(`links.expense.done.${done}`)}>
        {screen}
        <LinkCard>
          <View style={s.doneIcon}>
            <CheckCircle2 size={40} color={c.accent} />
          </View>
          <LinkText muted>{t("links.expense.doneHint")}</LinkText>
        </LinkCard>
      </LinkPage>
    );
  }
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
  if (data.state === "open" && data.kind === "approve_settlement") {
    return (
      <>
        {screen}
        <SettlementLink token={token} data={data} />
      </>
    );
  }
  if (data.state === "open" && data.kind === "confirm_repayment") {
    return (
      <>
        {screen}
        <RepaymentLink token={token} data={data} />
      </>
    );
  }
  if (data.state !== "open" || data.kind !== "approve_expense" || !data.expense) {
    return (
      <>
        {screen}
        <LinkUnavailable
          token={token}
          state={data.state === "open" ? "invalid" : data.state}
          closedText={
            data.kind === "approve_settlement"
              ? t("links.settlement.closed")
              : data.kind === "confirm_repayment"
                ? t("links.repayment.closed")
                : t("links.expense.closed")
          }
        />
      </>
    );
  }

  const expense = data.expense;
  const greeting = `${t("links.expense.hello", { name: data.member_name ?? "" })} ${t("links.expense.intro", { team: data.team_name ?? "" })}`;
  const run = (action: "approve" | "dispute") =>
    act.mutate(
      action === "approve" ? { action } : { action, kind: kind ?? "error", reason: reason.trim() },
      { onSuccess: () => setDone(action) },
    );

  return (
    <LinkPage title={t("links.expense.title", { team: data.team_name ?? "" })}>
      {screen}
      <LinkText>{greeting}</LinkText>
      <ExpenseSummary expense={expense} />

      {act.isError ? <Notice tone="error" text={linkErrorMessage(act.error, t)} /> : null}

      {kind ? (
        <LinkCard>
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
            loading={act.isPending}
            disabled={kind !== "refuse" && !reason.trim()}
            onPress={() => run("dispute")}
          />
          <Button variant="ghost" label={t("teams.detail.cancel")} onPress={() => setKind(null)} />
        </LinkCard>
      ) : (
        <View style={s.actions}>
          <Button
            label={t("approvals.approve")}
            loading={act.isPending}
            onPress={() => run("approve")}
          />
          {!expense.i_paid ? (
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
      )}
      <LinkText muted>{t("links.expense.oneUse")}</LinkText>
    </LinkPage>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
    rowLabel: { color: c.textMuted, fontSize: font.small, flexShrink: 1 },
    rowValue: { color: c.text, fontSize: font.small, textAlign: "right" },
    strong: { fontWeight: "700", fontSize: font.body },
    expenseTitle: { color: c.text, fontSize: font.body, fontWeight: "700" },
    highlight: {
      backgroundColor: c.accentSoft,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
    section: { gap: space.xs, marginTop: space.xs },
    sectionTitle: { color: c.text, fontSize: font.small, fontWeight: "600" },
    actions: { gap: space.sm },
    doneIcon: { alignItems: "center", paddingVertical: space.sm },
  });
