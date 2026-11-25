/**
 * Pages ouvertes depuis un e-mail par un invité : valider le bilan de la
 * Team, ou confirmer ce qu'il a reçu (montant modifiable pour un paiement
 * partiel).
 */
import { ArrowRight, CheckCircle2 } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import { language } from "@/i18n";
import { formatCents, parseEuros } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { type LinkView, linkErrorMessage, useLinkAct } from "./api";
import { LinkCard, LinkPage, LinkText } from "./link-page";

const money = (cents: number) => formatCents(cents, language);

function balanceLabel(cents: number, t: ReturnType<typeof useTranslation>["t"]): string {
  if (cents > 0) return t("settlement.receives", { amount: money(cents) });
  if (cents < 0) return t("settlement.owes", { amount: money(-cents) });
  return t("settlement.even");
}

function Done({ title }: { title: string }) {
  const { t } = useTranslation();
  const c = useTheme();
  return (
    <LinkPage title={title}>
      <LinkCard>
        <View style={{ alignItems: "center", paddingVertical: space.sm }}>
          <CheckCircle2 size={40} color={c.accent} />
        </View>
        <LinkText muted>{t("links.expense.doneHint")}</LinkText>
      </LinkCard>
    </LinkPage>
  );
}

export function SettlementLink({ token, data }: { token: string; data: LinkView }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const act = useLinkAct(token);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<"approve" | "dispute" | null>(null);
  const settlement = data.settlement;

  if (done) return <Done title={t(`links.settlement.done.${done}`)} />;
  if (!settlement) return null;

  const mine = settlement.my_balance_cents;
  const myColor = mine > 0 ? c.accent : mine < 0 ? c.danger : c.textMuted;
  const intro = `${t("links.expense.hello", { name: data.member_name ?? "" })} ${t("links.settlement.intro", { team: data.team_name ?? "" })}`;

  return (
    <LinkPage title={t("links.settlement.title", { team: data.team_name ?? "" })}>
      <LinkText>{intro}</LinkText>
      <LinkCard>
        <View style={s.row}>
          <Text style={s.label}>{t("settlement.totalValidated")}</Text>
          <Text style={s.value}>{money(settlement.total_cents)}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>{t("settlement.expenseCount")}</Text>
          <Text style={s.value}>
            {t("settlement.expenseCountValue", { count: settlement.expense_count })}
          </Text>
        </View>
        <View style={s.highlight}>
          <Text style={s.label}>{t("settlement.myBalance")}</Text>
          <Text style={[s.strong, { color: myColor }]}>{balanceLabel(mine, t)}</Text>
        </View>
      </LinkCard>

      <LinkCard>
        <Text style={s.section}>{t("settlement.balancesTitle")}</Text>
        {settlement.balances.map((b, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: liste figée (les noms peuvent se répéter)
          <View key={`b${i}`} style={s.row}>
            <View style={s.flex}>
              <Text style={s.name}>
                {b.is_me ? t("links.expense.me", { name: b.name }) : b.name}
              </Text>
              <Text style={s.muted}>
                {t("settlement.paidShare", {
                  paid: money(b.paid_cents),
                  share: money(b.share_cents),
                })}
              </Text>
            </View>
            <Text style={s.value}>{balanceLabel(b.balance_cents, t)}</Text>
          </View>
        ))}
      </LinkCard>

      <LinkCard>
        <Text style={s.section}>{t("settlement.transfersTitle")}</Text>
        {settlement.transfers.length === 0 ? (
          <Text style={s.muted}>{t("settlement.noTransfer")}</Text>
        ) : (
          settlement.transfers.map((tr, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: liste figée, jamais réordonnée
            <View key={`t${i}`} style={s.row}>
              <Text style={[s.name, s.flex, tr.involves_me && { color: c.accent }]}>
                {tr.from} <ArrowRight size={14} color={c.textMuted} /> {tr.to}
              </Text>
              <Text style={s.value}>{money(tr.amount_cents)}</Text>
            </View>
          ))
        )}
      </LinkCard>

      {act.isError ? <Notice tone="error" text={linkErrorMessage(act.error, t)} /> : null}

      {disputing ? (
        <LinkCard>
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
            label={t("links.settlement.disputeSend")}
            disabled={!reason.trim()}
            loading={act.isPending}
            onPress={() =>
              act.mutate(
                { action: "dispute", reason: reason.trim() },
                { onSuccess: () => setDone("dispute") },
              )
            }
          />
          <Button
            variant="ghost"
            label={t("teams.detail.cancel")}
            onPress={() => setDisputing(false)}
          />
        </LinkCard>
      ) : (
        <View style={s.actions}>
          <Button
            label={t("settlement.approve")}
            loading={act.isPending}
            onPress={() =>
              act.mutate({ action: "approve" }, { onSuccess: () => setDone("approve") })
            }
          />
          <Button
            variant="secondary"
            label={t("settlement.dispute")}
            onPress={() => setDisputing(true)}
          />
        </View>
      )}
      <LinkText muted>{t("links.settlement.oneUse")}</LinkText>
    </LinkPage>
  );
}

export function RepaymentLink({ token, data }: { token: string; data: LinkView }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const act = useLinkAct(token);
  const repayment = data.repayment;
  const remaining = repayment?.remaining_cents ?? 0;
  const [text, setText] = useState(
    (remaining / 100).toFixed(2).replace(".", language === "fr" ? "," : "."),
  );
  const [done, setDone] = useState<number | null>(null);

  if (done !== null) {
    return (
      <Done
        title={
          done >= remaining
            ? t("links.repayment.doneAll")
            : t("links.repayment.donePartial", { rest: money(remaining - done) })
        }
      />
    );
  }
  if (!repayment) return null;

  const cents = parseEuros(text);
  const valid = cents !== null && cents > 0 && cents <= remaining;
  const intro = `${t("links.expense.hello", { name: data.member_name ?? "" })} ${t("links.repayment.intro", { team: data.team_name ?? "", name: repayment.from_name, amount: money(repayment.amount_cents) })}`;

  return (
    <LinkPage title={t("links.repayment.title", { name: repayment.from_name })}>
      <LinkText>{intro}</LinkText>
      <LinkCard>
        <View style={s.row}>
          <Text style={s.label}>{t("links.repayment.total")}</Text>
          <Text style={s.value}>{money(repayment.amount_cents)}</Text>
        </View>
        {repayment.confirmed_cents > 0 ? (
          <View style={s.row}>
            <Text style={s.label}>{t("links.repayment.already")}</Text>
            <Text style={s.value}>{money(repayment.confirmed_cents)}</Text>
          </View>
        ) : null}
        <View style={s.highlight}>
          <Text style={s.label}>{t("links.repayment.remaining")}</Text>
          <Text style={s.strong}>{money(remaining)}</Text>
        </View>
        {repayment.declared_cents > repayment.confirmed_cents ? (
          <Text style={s.muted}>
            {t("settlement.declaredInfo", {
              name: repayment.from_name,
              amount: money(repayment.declared_cents),
            })}
          </Text>
        ) : null}
      </LinkCard>

      <LinkCard>
        <Field
          label={t("settlement.confirmAmount")}
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          inputMode="decimal"
          error={
            text.trim() && !valid
              ? t("settlement.amountInvalid", { max: money(remaining) })
              : undefined
          }
        />
        {act.isError ? <Notice tone="error" text={linkErrorMessage(act.error, t)} /> : null}
        <Button
          label={t("settlement.confirmSend")}
          disabled={!valid}
          loading={act.isPending}
          onPress={() =>
            cents !== null &&
            act.mutate(
              { action: "confirm", amountCents: cents },
              { onSuccess: () => setDone(cents) },
            )
          }
        />
        <LinkText muted>{t("links.repayment.hint")}</LinkText>
      </LinkCard>
    </LinkPage>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: space.md,
    },
    label: { color: c.textMuted, fontSize: font.small, flexShrink: 1 },
    value: { color: c.text, fontSize: font.small, textAlign: "right" },
    strong: { color: c.text, fontSize: font.body, fontWeight: "700" },
    name: { color: c.text, fontSize: font.small, fontWeight: "600" },
    muted: { color: c.textMuted, fontSize: font.tiny, lineHeight: 18 },
    section: { color: c.text, fontSize: font.small, fontWeight: "700" },
    highlight: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: c.accentSoft,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
    actions: { gap: space.sm },
  });
