import { CATEGORY_IDS, type CategoryId } from "@ra/core";
import { buildShares, type SplitMode } from "@ra/team";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import type { TeamMember } from "@/features/teams/api";
import { language } from "@/i18n";
import { categoryLabel, formatCents, formatDate, isoDate, parseEuros } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import type { ExpenseDraft, TeamExpenseView } from "./api";

function shiftDay(iso: string, delta: number): string {
  const [y = 2000, m = 1, d = 1] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + delta));
}

function centsToText(cents: number): string {
  const text = (cents / 100).toFixed(2).replace(/\.00$/, "");
  return language === "fr" ? text.replace(".", ",") : text;
}

/** Part tapée par l'utilisateur : vide = 0, sinon un montant valable, sinon NaN. */
function parseShare(text: string): number {
  if (text.trim() === "") return 0;
  return parseEuros(text) ?? Number.NaN;
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const s = styles(useTheme());
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[s.chip, selected && s.chipSelected]}
    >
      <Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Formulaire d'une dépense de Team : quoi, combien, quand, qui a payé, qui
 * participe et comment on partage. Sert à l'ajout et à la correction.
 */
export function ExpenseForm({
  members,
  myMemberId,
  initial,
  submitLabel,
  submitting,
  errorText,
  onSubmit,
}: {
  members: TeamMember[];
  myMemberId: string | undefined;
  initial?: TeamExpenseView;
  submitLabel: string;
  submitting: boolean;
  errorText: string | null;
  onSubmit: (draft: ExpenseDraft) => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const today = isoDate(new Date());

  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(initial ? centsToText(initial.totalCents) : "");
  const [date, setDate] = useState(initial?.spentOn ?? today);
  const [category, setCategory] = useState<CategoryId | null>(initial?.categoryId ?? null);
  const [payer, setPayer] = useState(initial?.paidBy ?? myMemberId ?? members[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>(
    initial ? initial.beneficiaries.map((b) => b.memberId) : members.map((m) => m.id),
  );
  const [mode, setMode] = useState<SplitMode>(initial?.splitMode ?? "equal");
  const [custom, setCustom] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (initial?.beneficiaries ?? []).map((b) => [b.memberId, centsToText(b.shareCents)]),
    ),
  );

  const totalCents = parseEuros(amount);
  // Bénéficiaires dans l'ordre des membres, pour un partage stable.
  const beneficiaries = members.map((m) => m.id).filter((id) => selected.includes(id));
  const customCents: Record<string, number> = Object.fromEntries(
    beneficiaries.map((id) => [id, parseShare(custom[id] ?? "")]),
  );
  const result =
    totalCents === null ? null : buildShares(totalCents, beneficiaries, mode, customCents);
  const shares = result && "shares" in result ? result.shares : null;
  const shareOf = (id: string) => shares?.find((sh) => sh.memberId === id)?.cents;
  const customSum = beneficiaries.reduce(
    (sum, id) => sum + (Number.isNaN(customCents[id]) ? 0 : (customCents[id] ?? 0)),
    0,
  );
  const remaining = (totalCents ?? 0) - customSum;
  const canSubmit = title.trim().length > 0 && shares !== null && payer !== "";

  const toggle = (id: string) =>
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const submit = () => {
    if (!canSubmit || !shares || totalCents === null) return;
    onSubmit({
      paid_by: payer,
      title: title.trim(),
      spent_on: date,
      total_cents: totalCents,
      category_id: category,
      split_mode: mode,
      beneficiaries: shares.map((sh) => ({
        member_id: sh.memberId,
        ...(mode === "custom" ? { share_cents: sh.cents } : {}),
      })),
      items: initial?.items.map((i) => ({
        label: i.label,
        quantity: i.quantity,
        unit_price_cents: i.unitPriceCents,
        total_cents: i.totalCents,
        category_id: i.categoryId,
      })),
    });
  };

  return (
    <View style={s.form}>
      <Field
        label={t("teamExpenses.form.title")}
        value={title}
        onChangeText={setTitle}
        placeholder={t("teamExpenses.form.titlePlaceholder")}
        maxLength={80}
        autoCapitalize="sentences"
      />
      <Field
        label={t("teamExpenses.form.amount")}
        value={amount}
        onChangeText={setAmount}
        placeholder="12,50"
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={amount.trim() && totalCents === null ? t("teamExpenses.form.badAmount") : undefined}
      />

      <View style={s.group}>
        <Text style={s.label}>{t("teamExpenses.form.date")}</Text>
        <View style={s.dateRow}>
          <Pressable
            onPress={() => setDate(shiftDay(date, -1))}
            accessibilityRole="button"
            accessibilityLabel={t("teamExpenses.form.previousDay")}
            style={s.dateArrow}
          >
            <ChevronLeft size={20} color={c.text} />
          </Pressable>
          <Text style={s.dateText}>
            {formatDate(date, language, {
              today: t("expense.today"),
              yesterday: t("expense.yesterday"),
            })}
          </Text>
          <Pressable
            onPress={() => setDate(shiftDay(date, 1))}
            disabled={date >= today}
            accessibilityRole="button"
            accessibilityLabel={t("teamExpenses.form.nextDay")}
            accessibilityState={{ disabled: date >= today }}
            style={[s.dateArrow, date >= today && s.disabled]}
          >
            <ChevronRight size={20} color={c.text} />
          </Pressable>
        </View>
      </View>

      <View style={s.group}>
        <Text style={s.label}>{t("teamExpenses.form.category")}</Text>
        <View style={s.chips}>
          {CATEGORY_IDS.map((id) => (
            <Chip
              key={id}
              label={categoryLabel(id, language)}
              selected={category === id}
              onPress={() => setCategory(category === id ? null : id)}
            />
          ))}
        </View>
      </View>

      <View style={s.group}>
        <Text style={s.label}>{t("teamExpenses.form.payer")}</Text>
        <View style={s.chips}>
          {members.map((m) => (
            <Chip
              key={m.id}
              label={
                m.id === myMemberId
                  ? t("teamExpenses.form.me", { name: m.displayName })
                  : m.displayName
              }
              selected={payer === m.id}
              onPress={() => setPayer(m.id)}
            />
          ))}
        </View>
      </View>

      <View style={s.group}>
        <Text style={s.label}>{t("teamExpenses.form.who")}</Text>
        <View style={s.segment}>
          {(["equal", "custom"] as const).map((key) => (
            <Pressable
              key={key}
              onPress={() => setMode(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === key }}
              style={[s.segmentItem, mode === key && s.segmentActive]}
            >
              <Text style={[s.segmentText, mode === key && s.segmentTextActive]}>
                {t(`teamExpenses.form.mode.${key}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        {members.map((m) => {
          const on = selected.includes(m.id);
          const share = shareOf(m.id);
          return (
            <View key={m.id} style={s.benRow}>
              <Pressable
                onPress={() => toggle(m.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={m.displayName}
                style={s.benToggle}
              >
                <View style={[s.box, on && s.boxOn]}>
                  {on ? <Check size={14} color={c.onAccent} /> : null}
                </View>
                <Text style={[s.benName, !on && s.muted]} numberOfLines={1}>
                  {m.displayName}
                </Text>
              </Pressable>
              {on && mode === "custom" ? (
                <TextInput
                  value={custom[m.id] ?? ""}
                  onChangeText={(v) => setCustom((x) => ({ ...x, [m.id]: v }))}
                  placeholder="0"
                  placeholderTextColor={c.textMuted}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  accessibilityLabel={t("teamExpenses.form.shareOf", { name: m.displayName })}
                  style={[
                    s.shareInput,
                    Number.isNaN(customCents[m.id]) && { borderColor: c.danger },
                  ]}
                />
              ) : on && share !== undefined ? (
                <Text style={s.share}>{formatCents(share, language)}</Text>
              ) : null}
            </View>
          );
        })}
        {mode === "custom" && totalCents !== null ? (
          <Text style={[s.remaining, remaining !== 0 && { color: c.warning }]}>
            {remaining === 0
              ? t("teamExpenses.form.balanced")
              : remaining > 0
                ? t("teamExpenses.form.remaining", { amount: formatCents(remaining, language) })
                : t("teamExpenses.form.over", { amount: formatCents(-remaining, language) })}
          </Text>
        ) : null}
        {beneficiaries.length === 0 ? (
          <Text style={[s.remaining, { color: c.warning }]}>{t("teamExpenses.form.nobody")}</Text>
        ) : null}
      </View>

      {errorText ? <Notice tone="error" text={errorText} /> : null}
      <Button label={submitLabel} onPress={submit} loading={submitting} disabled={!canSubmit} />
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    form: { gap: space.lg },
    group: { gap: space.sm },
    label: { color: c.text, fontSize: font.small, fontWeight: "600" },
    muted: { color: c.textMuted },
    disabled: { opacity: 0.3 },
    dateRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      padding: space.xs,
    },
    dateArrow: { padding: space.sm },
    dateText: {
      color: c.text,
      fontSize: font.body,
      fontWeight: "600",
      textTransform: "capitalize",
    },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
    chip: {
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    chipSelected: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.text, fontSize: font.small },
    chipTextSelected: { color: c.onAccent, fontWeight: "700" },
    segment: {
      flexDirection: "row",
      backgroundColor: c.surfaceMuted,
      borderRadius: radius.pill,
      padding: space.xs,
      gap: space.xs,
    },
    segmentItem: {
      flex: 1,
      alignItems: "center",
      paddingVertical: space.sm,
      borderRadius: radius.pill,
    },
    segmentActive: { backgroundColor: c.surface },
    segmentText: { color: c.textMuted, fontSize: font.small, fontWeight: "600" },
    segmentTextActive: { color: c.text, fontWeight: "700" },
    benRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
    benToggle: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md },
    box: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    boxOn: { backgroundColor: c.accent, borderColor: c.accent },
    benName: { color: c.text, fontSize: font.body, flexShrink: 1 },
    share: { color: c.text, fontSize: font.body, fontWeight: "600", fontVariant: ["tabular-nums"] },
    shareInput: {
      width: 96,
      textAlign: "right",
      color: c.text,
      fontSize: font.body,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      backgroundColor: c.surface,
    },
    remaining: { color: c.accent, fontSize: font.small, fontWeight: "600" },
  });
