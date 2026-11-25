/**
 * Onglet « Comptes » d'une Team : tableau de bord et soldes en cours, puis
 * clôture (bilan à valider), remboursements et Team soldée.
 */
import { computeBalances, planRepayments, type TeamExpense } from "@ra/team";
import {
  Archive,
  ArrowRight,
  CircleCheck,
  CircleDashed,
  Hourglass,
  Mail,
  PartyPopper,
  TriangleExclamationPoint,
} from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import { useTeamExpenses } from "@/features/team-expenses/api";
import type { Team, TeamMember } from "@/features/teams/api";
import { language } from "@/i18n";
import { confirm } from "@/lib/confirm";
import { formatCents, parseEuros } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import {
  type Repayment,
  type Settlement,
  settlementErrorMessage,
  useApproveSettlement,
  useArchiveTeam,
  useConfirmRepayment,
  useDeclareRepayment,
  useDisputeSettlement,
  useLatestSettlement,
  useRequestSettlement,
} from "./api";

const money = (cents: number) => formatCents(cents, language);

function centsToInput(cents: number): string {
  const text = (cents / 100).toFixed(2);
  return language === "fr" ? text.replace(".", ",") : text;
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  const s = styles(useTheme());
  return (
    <View style={s.card}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/** Une ligne « libellé … valeur ». */
function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const s = styles(useTheme());
  return (
    <View style={s.line}>
      <Text style={[s.lineLabel, strong && s.strong]}>{label}</Text>
      <Text style={[s.lineValue, strong && s.strong]}>{value}</Text>
    </View>
  );
}

/** Solde d'une personne : couleur, signe et texte (jamais la couleur seule). */
function BalanceText({ cents }: { cents: number }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const color = cents > 0 ? c.accent : cents < 0 ? c.danger : c.textMuted;
  const label =
    cents > 0
      ? t("settlement.receives", { amount: money(cents) })
      : cents < 0
        ? t("settlement.owes", { amount: money(-cents) })
        : t("settlement.even");
  return <Text style={[s.balance, { color }]}>{label}</Text>;
}

interface BalanceRow {
  memberId: string;
  paidCents: number;
  shareCents: number;
  balanceCents: number;
}

function BalancesTable({
  rows,
  nameOf,
  meId,
}: {
  rows: BalanceRow[];
  nameOf: (id: string) => string;
  meId?: string;
}) {
  const { t } = useTranslation();
  const s = styles(useTheme());
  return (
    <View style={s.rows}>
      {rows.map((r) => (
        <View key={r.memberId} style={s.balanceRow}>
          <View style={s.flex}>
            <Text style={s.name}>
              {r.memberId === meId
                ? t("settlement.me", { name: nameOf(r.memberId) })
                : nameOf(r.memberId)}
            </Text>
            <Text style={s.muted}>
              {t("settlement.paidShare", { paid: money(r.paidCents), share: money(r.shareCents) })}
            </Text>
          </View>
          <BalanceText cents={r.balanceCents} />
        </View>
      ))}
    </View>
  );
}

function TransfersList({
  transfers,
  nameOf,
}: {
  transfers: { from: string; to: string; amountCents: number }[];
  nameOf: (id: string) => string;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  if (transfers.length === 0) return <Text style={s.muted}>{t("settlement.noTransfer")}</Text>;
  return (
    <View style={s.rows}>
      {transfers.map((tr) => (
        <View key={`${tr.from}-${tr.to}`} style={s.transfer}>
          <Text style={[s.name, s.flex]}>
            {nameOf(tr.from)} <ArrowRight size={14} color={c.textMuted} /> {nameOf(tr.to)}
          </Text>
          <Text style={s.strong}>{money(tr.amountCents)}</Text>
        </View>
      ))}
    </View>
  );
}

// ─────────────────────────── Team active : tableau de bord et demande ───────────────────────────

function LiveAccounts({
  team,
  me,
  nameOf,
  lastDisputed,
}: {
  team: Team;
  me: TeamMember | undefined;
  nameOf: (id: string) => string;
  lastDisputed: Settlement | null;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const expenses = useTeamExpenses(team.id);
  const request = useRequestSettlement();

  if (expenses.isPending) return <ActivityIndicator color={c.accent} />;
  const list = expenses.data ?? [];
  const validated = list.filter((e) => e.status === "validated");
  const open = list.filter((e) => e.status === "pending" || e.status === "disputed").length;
  const total = validated.reduce((sum, e) => sum + e.totalCents, 0);
  const memberIds = team.members
    .filter(
      (m) =>
        m.status === "active" ||
        validated.some(
          (e) => e.paidBy === m.id || e.beneficiaries.some((b) => b.memberId === m.id),
        ),
    )
    .map((m) => m.id);
  const asTeamExpenses: TeamExpense[] = validated.map((e) => ({
    id: e.id,
    paidBy: e.paidBy,
    totalCents: e.totalCents,
    status: e.status,
    shares: e.beneficiaries.map((b) => ({ memberId: b.memberId, cents: b.shareCents })),
  }));
  const balances = computeBalances(memberIds, asTeamExpenses);
  const transfers = planRepayments(balances);
  const mine = balances.find((b) => b.memberId === me?.id);
  const disputedBy = lastDisputed?.approvals.find((a) => a.decision === "refused");

  const ask = () =>
    confirm(
      t("settlement.requestQuestion"),
      t("settlement.request"),
      t("teams.detail.cancel"),
      () => request.mutate({ p_team: team.id }),
    );

  return (
    <View style={s.stack}>
      {disputedBy ? (
        <Notice
          tone="error"
          text={t("settlement.lastDisputed", {
            name: nameOf(disputedBy.memberId),
            reason: disputedBy.reason ?? "",
          })}
        />
      ) : null}
      <Card title={t("settlement.dashboard")}>
        <Line label={t("settlement.totalValidated")} value={money(total)} strong />
        <Line
          label={t("settlement.expenseCount")}
          value={t("settlement.expenseCountValue", { count: validated.length })}
        />
        {open > 0 ? <Line label={t("settlement.openCount")} value={String(open)} /> : null}
        {mine ? (
          <View style={s.mine}>
            <Text style={s.lineLabel}>{t("settlement.myBalance")}</Text>
            <BalanceText cents={mine.balanceCents} />
          </View>
        ) : null}
        <Text style={s.hint}>{t("settlement.liveHint")}</Text>
      </Card>

      <Card title={t("settlement.balancesTitle")}>
        <BalancesTable rows={balances} nameOf={nameOf} meId={me?.id} />
      </Card>

      <Card title={t("settlement.transfersPreview")}>
        <TransfersList
          transfers={transfers.map((tr) => ({
            from: tr.from,
            to: tr.to,
            amountCents: tr.amountCents,
          }))}
          nameOf={nameOf}
        />
      </Card>

      {me ? (
        <Card title={t("settlement.closeTitle")}>
          <Text style={s.hint}>{t("settlement.closeHint")}</Text>
          {open > 0 ? <Notice text={t("settlement.openFirst", { count: open })} /> : null}
          {request.isError ? (
            <Notice tone="error" text={settlementErrorMessage(request.error, t)} />
          ) : null}
          <Button
            label={t("settlement.request")}
            onPress={ask}
            disabled={open > 0}
            loading={request.isPending}
          />
        </Card>
      ) : null}
    </View>
  );
}

// ─────────────────────────── Clôture : bilan à valider ───────────────────────────

function SettlementReview({
  team,
  settlement,
  me,
  nameOf,
  memberOf,
}: {
  team: Team;
  settlement: Settlement;
  me: TeamMember | undefined;
  nameOf: (id: string) => string;
  memberOf: (id: string) => TeamMember | undefined;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const approve = useApproveSettlement();
  const dispute = useDisputeSettlement();
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");
  const isOwner = me?.role === "owner";
  const decisionOf = (id: string) => settlement.approvals.find((a) => a.memberId === id);
  const required = settlement.balances.filter((b) => b.mustApprove);
  const done = required.filter((b) => decisionOf(b.memberId)?.decision === "approved").length;
  const mineRequired = me ? required.some((b) => b.memberId === me.id) : false;
  const iDecided = me ? decisionOf(me.id) : undefined;
  const error = approve.error ?? dispute.error;

  return (
    <View style={s.stack}>
      <Card title={t("settlement.reviewTitle")}>
        <Text style={s.hint}>
          {t("settlement.reviewHint", {
            name: settlement.requestedBy ? nameOf(settlement.requestedBy) : "—",
          })}
        </Text>
        <Line label={t("settlement.totalValidated")} value={money(settlement.totalCents)} strong />
        <Line
          label={t("settlement.expenseCount")}
          value={t("settlement.expenseCountValue", { count: settlement.expenseCount })}
        />
      </Card>
      <Card title={t("settlement.balancesTitle")}>
        <BalancesTable rows={settlement.balances} nameOf={nameOf} meId={me?.id} />
      </Card>
      <Card title={t("settlement.transfersTitle")}>
        <TransfersList
          transfers={settlement.repayments.map((r) => ({
            from: r.fromMember,
            to: r.toMember,
            amountCents: r.amountCents,
          }))}
          nameOf={nameOf}
        />
      </Card>

      <Card title={t("settlement.approvalsTitle", { done, total: required.length })}>
        <View style={s.rows}>
          {required.map((b) => {
            const decision = decisionOf(b.memberId);
            const member = memberOf(b.memberId);
            const viaEmail = member?.role === "guest" && member.email !== null;
            const proxy = isOwner && member?.role === "guest" && member.email === null;
            return (
              <View key={b.memberId} style={s.approvalRow}>
                {decision?.decision === "approved" ? (
                  <CircleCheck size={18} color={c.accent} />
                ) : viaEmail ? (
                  <Mail size={18} color={c.textMuted} />
                ) : (
                  <CircleDashed size={18} color={c.textMuted} />
                )}
                <View style={s.flex}>
                  <Text style={s.name}>{nameOf(b.memberId)}</Text>
                  <Text style={s.muted}>
                    {decision?.decision === "approved"
                      ? t(`settlement.approvedVia.${decision.via}`)
                      : viaEmail
                        ? t("settlement.waitingEmail")
                        : t("settlement.waiting")}
                  </Text>
                </View>
                {proxy && !decision ? (
                  <Button
                    variant="secondary"
                    label={t("settlement.approveFor", { name: nameOf(b.memberId) })}
                    loading={approve.isPending}
                    onPress={() =>
                      approve.mutate({ p_settlement: settlement.id, p_member: b.memberId })
                    }
                  />
                ) : null}
              </View>
            );
          })}
        </View>
        {error ? <Notice tone="error" text={settlementErrorMessage(error, t)} /> : null}
        {mineRequired && !iDecided ? (
          disputing ? (
            <View style={s.stack}>
              <Field
                label={t("settlement.disputeReason")}
                value={reason}
                onChangeText={setReason}
                placeholder={t("settlement.disputePlaceholder")}
                maxLength={500}
                multiline
              />
              <Button
                variant="danger"
                label={t("settlement.disputeSend")}
                disabled={!reason.trim()}
                loading={dispute.isPending}
                onPress={() =>
                  dispute.mutate({
                    p_settlement: settlement.id,
                    p_reason: reason.trim(),
                    p_member: null,
                  })
                }
              />
              <Button
                variant="ghost"
                label={t("teams.detail.cancel")}
                onPress={() => setDisputing(false)}
              />
            </View>
          ) : (
            <View style={s.stack}>
              <Button
                label={t("settlement.approve")}
                loading={approve.isPending}
                onPress={() => approve.mutate({ p_settlement: settlement.id, p_member: null })}
              />
              <Button
                variant="secondary"
                label={t("settlement.dispute")}
                onPress={() => setDisputing(true)}
              />
            </View>
          )
        ) : null}
        <Text style={s.hint}>{t("settlement.lockedHint", { team: team.name })}</Text>
      </Card>
    </View>
  );
}

// ─────────────────────────── Remboursements ───────────────────────────

function AmountForm({
  label,
  maxCents,
  submitLabel,
  loading,
  onSubmit,
  onCancel,
}: {
  label: string;
  maxCents: number;
  submitLabel: string;
  loading: boolean;
  onSubmit: (cents: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const s = styles(useTheme());
  const [text, setText] = useState(centsToInput(maxCents));
  const cents = parseEuros(text);
  const valid = cents !== null && cents > 0 && cents <= maxCents;
  return (
    <View style={s.stack}>
      <Field
        label={label}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={
          text.trim() && !valid
            ? t("settlement.amountInvalid", { max: money(maxCents) })
            : undefined
        }
      />
      <Button
        label={submitLabel}
        disabled={!valid}
        loading={loading}
        onPress={() => cents !== null && onSubmit(cents)}
      />
      <Button variant="ghost" label={t("teams.detail.cancel")} onPress={onCancel} />
    </View>
  );
}

function RepaymentStatusText({ r }: { r: Repayment }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const Icon =
    r.status === "confirmed" ? CircleCheck : r.status === "pending" ? CircleDashed : Hourglass;
  const color =
    r.status === "confirmed" ? c.accent : r.status === "pending" ? c.textMuted : c.warning;
  return (
    <View style={s.statusRow}>
      <Icon size={14} color={color} />
      <Text style={[s.statusText, { color }]}>{t(`settlement.repaymentStatus.${r.status}`)}</Text>
    </View>
  );
}

function RepaymentRow({
  r,
  me,
  nameOf,
  memberOf,
  readOnly,
}: {
  r: Repayment;
  me: TeamMember | undefined;
  nameOf: (id: string) => string;
  memberOf: (id: string) => TeamMember | undefined;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const declare = useDeclareRepayment();
  const confirmIt = useConfirmRepayment();
  const [mode, setMode] = useState<"declare" | "confirm" | null>(null);
  const remaining = r.amountCents - r.confirmedCents;
  const isOwner = me?.role === "owner";
  const from = memberOf(r.fromMember);
  const to = memberOf(r.toMember);
  const proxyFrom = isOwner && from?.role === "guest" && from.email === null;
  const proxyTo = isOwner && to?.role === "guest" && to.email === null;
  const canDeclare = !readOnly && remaining > 0 && (me?.id === r.fromMember || proxyFrom);
  const canConfirm = !readOnly && remaining > 0 && (me?.id === r.toMember || proxyTo);
  const toByEmail = to?.role === "guest" && to.email !== null;
  const error = declare.error ?? confirmIt.error;

  return (
    <View style={s.repayment}>
      <View style={s.transfer}>
        <Text style={[s.name, s.flex]}>
          {nameOf(r.fromMember)} <ArrowRight size={14} color={c.textMuted} /> {nameOf(r.toMember)}
        </Text>
        <Text style={s.strong}>{money(r.amountCents)}</Text>
      </View>
      <RepaymentStatusText r={r} />
      {r.confirmedCents > 0 && remaining > 0 ? (
        <Text style={s.muted}>
          {t("settlement.received", { amount: money(r.confirmedCents), rest: money(remaining) })}
        </Text>
      ) : null}
      {r.declaredCents > r.confirmedCents && remaining > 0 ? (
        <Text style={s.muted}>
          {t("settlement.declaredInfo", {
            name: nameOf(r.fromMember),
            amount: money(r.declaredCents),
          })}
        </Text>
      ) : null}
      {toByEmail && remaining > 0 ? (
        <Text style={s.muted}>{t("settlement.confirmByEmail", { name: nameOf(r.toMember) })}</Text>
      ) : null}
      {error ? <Notice tone="error" text={settlementErrorMessage(error, t)} /> : null}

      {mode === "declare" ? (
        <AmountForm
          label={t("settlement.declareAmount")}
          maxCents={remaining}
          submitLabel={t("settlement.declareSend")}
          loading={declare.isPending}
          onCancel={() => setMode(null)}
          onSubmit={(cents) =>
            declare.mutate(
              { p_repayment: r.id, p_amount: cents, p_member: proxyFrom ? r.fromMember : null },
              { onSuccess: () => setMode(null) },
            )
          }
        />
      ) : mode === "confirm" ? (
        <AmountForm
          label={t("settlement.confirmAmount")}
          maxCents={remaining}
          submitLabel={t("settlement.confirmSend")}
          loading={confirmIt.isPending}
          onCancel={() => setMode(null)}
          onSubmit={(cents) =>
            confirmIt.mutate(
              { p_repayment: r.id, p_amount: cents, p_member: proxyTo ? r.toMember : null },
              { onSuccess: () => setMode(null) },
            )
          }
        />
      ) : (
        <View style={s.stack}>
          {canDeclare ? (
            <Button
              variant="secondary"
              label={
                proxyFrom
                  ? t("settlement.declareFor", { name: nameOf(r.fromMember) })
                  : t("settlement.declare")
              }
              onPress={() => setMode("declare")}
            />
          ) : null}
          {canConfirm ? (
            <Button
              label={
                proxyTo
                  ? t("settlement.confirmFor", { name: nameOf(r.toMember) })
                  : t("settlement.confirm")
              }
              onPress={() => setMode("confirm")}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

function RepaymentsCard({
  settlement,
  me,
  nameOf,
  memberOf,
  readOnly,
}: {
  settlement: Settlement;
  me: TeamMember | undefined;
  nameOf: (id: string) => string;
  memberOf: (id: string) => TeamMember | undefined;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const s = styles(useTheme());
  const done = settlement.repayments.filter((r) => r.status === "confirmed").length;
  return (
    <Card title={t("settlement.repaymentsTitle", { done, total: settlement.repayments.length })}>
      {!readOnly ? <Text style={s.hint}>{t("settlement.repaymentsHint")}</Text> : null}
      {settlement.repayments.map((r) => (
        <RepaymentRow
          key={r.id}
          r={r}
          me={me}
          nameOf={nameOf}
          memberOf={memberOf}
          readOnly={readOnly}
        />
      ))}
    </Card>
  );
}

// ─────────────────────────── Team soldée ───────────────────────────

function SettledCard({ team, me }: { team: Team; me: TeamMember | undefined }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const archive = useArchiveTeam();
  const archived = team.status === "archived";
  return (
    <View style={[s.card, s.settled]}>
      <PartyPopper size={36} color={c.accent} />
      <Text style={s.settledTitle}>{t("settlement.settledTitle")}</Text>
      <Text style={s.hint}>
        {archived ? t("settlement.archivedHint") : t("settlement.settledHint")}
      </Text>
      {archive.isError ? (
        <Notice tone="error" text={settlementErrorMessage(archive.error, t)} />
      ) : null}
      {!archived && me?.role === "owner" ? (
        <Button
          variant="secondary"
          label={t("settlement.archive")}
          icon={<Archive size={16} color={c.text} />}
          loading={archive.isPending}
          onPress={() =>
            confirm(
              t("settlement.archiveQuestion"),
              t("settlement.archive"),
              t("teams.detail.cancel"),
              () => archive.mutate({ p_team: team.id }),
            )
          }
        />
      ) : null}
    </View>
  );
}

// ─────────────────────────── Onglet ───────────────────────────

export function AccountsSection({ team, me }: { team: Team; me: TeamMember | undefined }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const query = useLatestSettlement(team.id);
  const memberOf = (id: string) => team.members.find((m) => m.id === id);
  const nameOf = (id: string) => memberOf(id)?.displayName ?? t("teamChat.someone");

  if (query.isPending) return <ActivityIndicator color={c.accent} />;
  if (query.isError) {
    return (
      <View style={s.stack}>
        <Notice tone="error" text={t("settlement.loadError")} />
      </View>
    );
  }
  const settlement = query.data ?? null;

  if (team.status === "active") {
    return (
      <LiveAccounts
        team={team}
        me={me}
        nameOf={nameOf}
        lastDisputed={settlement?.status === "superseded" ? settlement : null}
      />
    );
  }
  if (!settlement) {
    return (
      <View style={s.stack}>
        <Notice text={t("settlement.loadError")} />
      </View>
    );
  }
  if (team.status === "closing") {
    return (
      <SettlementReview
        team={team}
        settlement={settlement}
        me={me}
        nameOf={nameOf}
        memberOf={memberOf}
      />
    );
  }
  const finished = team.status === "settled" || team.status === "archived";
  return (
    <View style={s.stack}>
      {finished ? <SettledCard team={team} me={me} /> : null}
      {!finished ? (
        <View style={s.banner}>
          <TriangleExclamationPoint size={16} color={c.warning} />
          <Text style={[s.hint, s.flex]}>{t("settlement.settlingHint")}</Text>
        </View>
      ) : null}
      <RepaymentsCard
        settlement={settlement}
        me={me}
        nameOf={nameOf}
        memberOf={memberOf}
        readOnly={finished}
      />
      <Card title={t("settlement.balancesTitle")}>
        <BalancesTable rows={settlement.balances} nameOf={nameOf} meId={me?.id} />
      </Card>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    stack: { gap: space.md },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    cardTitle: { color: c.text, fontSize: font.body, fontWeight: "700" },
    line: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
    lineLabel: { color: c.textMuted, fontSize: font.small, flexShrink: 1 },
    lineValue: { color: c.text, fontSize: font.small },
    strong: { color: c.text, fontWeight: "700", fontSize: font.body },
    hint: { color: c.textMuted, fontSize: font.small, lineHeight: 20 },
    muted: { color: c.textMuted, fontSize: font.tiny, lineHeight: 18 },
    name: { color: c.text, fontSize: font.small, fontWeight: "600" },
    balance: { fontSize: font.small, fontWeight: "700", textAlign: "right" },
    rows: { gap: space.sm },
    balanceRow: { flexDirection: "row", alignItems: "center", gap: space.md },
    transfer: { flexDirection: "row", alignItems: "center", gap: space.md },
    mine: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: c.surfaceMuted,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
    approvalRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
    repayment: {
      gap: space.xs,
      paddingTop: space.sm,
      borderTopColor: c.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    statusRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
    statusText: { fontSize: font.tiny, fontWeight: "700" },
    settled: { alignItems: "center" },
    settledTitle: { color: c.text, fontSize: font.title, fontWeight: "700", textAlign: "center" },
    banner: {
      flexDirection: "row",
      gap: space.sm,
      alignItems: "flex-start",
      backgroundColor: c.warningSoft,
      borderRadius: radius.md,
      padding: space.md,
    },
  });
