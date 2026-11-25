/**
 * Tableau de bord d'une Team sur une période : total validé, tickets,
 * dépenses par statut, payé et part de chacun, catégories.
 */
import type { CategoryId } from "@ra/core";
import { lastDay, type MonthKey } from "@ra/insights";
import { type DashboardExpense, summarizeTeam, teamMonths } from "@ra/team";
import { CircleAlert, CircleCheck, Hourglass, Receipt } from "lucide-react-native";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TeamExpenseView } from "@/features/team-expenses/api";
import { language } from "@/i18n";
import { capitalize, categoryLabel, formatCents, formatMonth } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

const money = (cents: number) => formatCents(cents, language);

function toDashboard(e: TeamExpenseView): DashboardExpense {
  return {
    id: e.id,
    paidBy: e.paidBy,
    totalCents: e.totalCents,
    status: e.status,
    shares: e.beneficiaries.map((b) => ({ memberId: b.memberId, cents: b.shareCents })),
    spentOn: e.spentOn,
    categoryId: e.categoryId,
    hasReceipt: e.receiptId !== null,
  };
}

function Bar({ ratio, color }: { ratio: number; color: string }) {
  const s = styles(useTheme());
  return (
    <View style={s.track}>
      <View
        style={[
          s.fill,
          { width: `${Math.max(2, Math.round(ratio * 100))}%`, backgroundColor: color },
        ]}
      />
    </View>
  );
}

export function TeamDashboard({
  expenses,
  memberIds,
  nameOf,
  meId,
}: {
  expenses: TeamExpenseView[];
  memberIds: string[];
  nameOf: (id: string) => string;
  meId?: string;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  /** Mois choisi (« AAAA-MM »), ou null pour toute la Team. */
  const [month, setMonth] = useState<string | null>(null);
  const list = useMemo(() => expenses.map(toDashboard), [expenses]);
  const months = useMemo(() => teamMonths(list), [list]);
  const summary = useMemo(
    () =>
      summarizeTeam(
        list,
        memberIds,
        month ? { from: `${month}-01`, to: lastDay(month as MonthKey) } : {},
      ),
    [list, memberIds, month],
  );
  const maxPaid = Math.max(1, ...summary.byMember.map((m) => Math.max(m.paidCents, m.shareCents)));
  const maxCategory = Math.max(1, ...summary.byCategory.map((x) => x.cents));

  const chip = (key: string | null, label: string) => {
    const selected = month === key;
    return (
      <Pressable
        key={key ?? "all"}
        onPress={() => setMonth(key)}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        style={[s.chip, selected && s.chipSelected]}
      >
        <Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={s.card}>
      <Text style={s.title}>{t("settlement.dashboard")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {chip(null, t("teamDashboard.all"))}
        {months.map((m) => chip(m, capitalize(formatMonth(m, language))))}
      </ScrollView>

      <View>
        <Text style={s.muted}>{t("settlement.totalValidated")}</Text>
        <Text style={s.total}>{money(summary.totalCents)}</Text>
      </View>

      <View style={s.stats}>
        <View style={s.stat}>
          <CircleCheck size={16} color={c.accent} />
          <Text style={s.statText}>
            {t("teamDashboard.validated", { count: summary.counts.validated })}
          </Text>
        </View>
        <View style={s.stat}>
          <Hourglass size={16} color={c.warning} />
          <Text style={s.statText}>
            {t("teamDashboard.pending", { count: summary.counts.pending })}
          </Text>
        </View>
        <View style={s.stat}>
          <CircleAlert size={16} color={c.danger} />
          <Text style={s.statText}>
            {t("teamDashboard.disputed", { count: summary.counts.disputed })}
          </Text>
        </View>
        <View style={s.stat}>
          <Receipt size={16} color={c.textMuted} />
          <Text style={s.statText}>{t("teamDashboard.receipts", { count: summary.receipts })}</Text>
        </View>
      </View>

      <Text style={s.section}>{t("teamDashboard.byMember")}</Text>
      <Text style={s.muted}>{t("teamDashboard.byMemberHint")}</Text>
      {summary.byMember.map((m) => (
        <View key={m.memberId} style={s.block}>
          <View style={s.row}>
            <Text style={[s.name, s.flex]}>
              {m.memberId === meId
                ? t("settlement.me", { name: nameOf(m.memberId) })
                : nameOf(m.memberId)}
            </Text>
            <Text style={s.value}>{money(m.paidCents)}</Text>
          </View>
          <Bar ratio={m.paidCents / maxPaid} color={c.accent} />
          <Text style={s.muted}>{t("teamDashboard.share", { amount: money(m.shareCents) })}</Text>
        </View>
      ))}

      {summary.byCategory.length > 0 ? (
        <>
          <Text style={s.section}>{t("teamDashboard.byCategory")}</Text>
          {summary.byCategory.map((x) => (
            <View key={x.categoryId ?? "none"} style={s.block}>
              <View style={s.row}>
                <Text style={[s.name, s.flex]}>
                  {x.categoryId
                    ? categoryLabel(x.categoryId as CategoryId, language)
                    : t("teamExpenses.detail.noCategory")}
                </Text>
                <Text style={s.value}>{money(x.cents)}</Text>
              </View>
              <Bar ratio={x.cents / maxCategory} color={c.accent} />
            </View>
          ))}
        </>
      ) : (
        <Text style={s.muted}>{t("teamDashboard.empty")}</Text>
      )}
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
    chips: { gap: space.sm },
    chip: {
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipSelected: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.text, fontSize: font.small, fontWeight: "600" },
    chipTextSelected: { color: c.onAccent },
    total: { color: c.text, fontSize: 30, fontWeight: "800" },
    muted: { color: c.textMuted, fontSize: font.tiny, lineHeight: 18 },
    stats: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
    stat: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.xs,
      backgroundColor: c.surfaceMuted,
      borderRadius: radius.pill,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
    },
    statText: { color: c.text, fontSize: font.tiny, fontWeight: "600" },
    section: { color: c.text, fontSize: font.small, fontWeight: "700", marginTop: space.xs },
    block: { gap: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: space.md },
    name: { color: c.text, fontSize: font.small, fontWeight: "600" },
    value: { color: c.text, fontSize: font.small, fontWeight: "700" },
    track: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceMuted,
      overflow: "hidden",
    },
    fill: { height: 8, borderRadius: radius.pill },
  });
