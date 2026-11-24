import { type BudgetLevel, budgetStatus, type MonthKey } from "@ra/insights";
import { CircleCheck, Pencil, TriangleExclamationPoint } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Field, Notice } from "@/components/ui";
import { language } from "@/i18n";
import { formatCents, formatPercent, parseEuros } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";
import { useBudget, useSetBudget } from "./api";
import { Card } from "./card";

function centsToInput(cents: number): string {
  const euros = cents / 100;
  const text = Number.isInteger(euros) ? String(euros) : euros.toFixed(2);
  return language === "fr" ? text.replace(".", ",") : text;
}

function levelColor(level: BudgetLevel, c: Palette): string {
  if (level === "over") return c.danger;
  if (level === "watch") return c.warning;
  return c.accent;
}

/** Budget mensuel : jauge, reste à dépenser et réglage du montant. */
export function BudgetCard({
  month,
  spentCents,
  today,
}: {
  month: MonthKey;
  spentCents: number;
  today: string;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const budget = useBudget();
  const setBudget = useSetBudget();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);

  const startEditing = () => {
    setInput(budget.data ? centsToInput(budget.data) : "");
    setInvalid(false);
    setEditing(true);
  };

  const save = (cents: number | null) => {
    setBudget.mutate(cents, { onSuccess: () => setEditing(false) });
  };

  const submit = () => {
    const cents = parseEuros(input);
    if (cents === null) {
      setInvalid(true);
      return;
    }
    save(cents);
  };

  if (budget.isPending) return null;

  if (editing) {
    return (
      <Card title={t("dashboard.budget.title")}>
        <Field
          label={t("dashboard.budget.amount")}
          value={input}
          onChangeText={(v) => {
            setInput(v);
            setInvalid(false);
          }}
          placeholder={t("dashboard.budget.placeholder")}
          keyboardType="decimal-pad"
          inputMode="decimal"
          autoFocus
          onSubmitEditing={submit}
          error={invalid ? t("dashboard.budget.invalid") : undefined}
        />
        {setBudget.isError ? <Notice tone="error" text={t("dashboard.budget.saveError")} /> : null}
        <View style={s.actions}>
          <View style={s.flex}>
            <Button
              label={t("dashboard.budget.save")}
              onPress={submit}
              loading={setBudget.isPending}
            />
          </View>
          <View style={s.flex}>
            <Button
              variant="secondary"
              label={t("dashboard.budget.cancel")}
              onPress={() => setEditing(false)}
            />
          </View>
        </View>
        {budget.data ? (
          <Button variant="ghost" label={t("dashboard.budget.remove")} onPress={() => save(null)} />
        ) : null}
      </Card>
    );
  }

  if (!budget.data) {
    return (
      <Card title={t("dashboard.budget.title")}>
        <Text style={s.text}>{t("dashboard.budget.none")}</Text>
        <Button variant="secondary" label={t("dashboard.budget.set")} onPress={startEditing} />
      </Card>
    );
  }

  const status = budgetStatus(budget.data, spentCents, month, today);
  const color = levelColor(status.level, c);
  const fill = Math.min(status.used, 1);
  const finished = month < today.slice(0, 7);
  const showToday = !finished && status.timeElapsed > 0 && status.timeElapsed < 1;
  const Icon = status.level === "ok" ? CircleCheck : TriangleExclamationPoint;
  const statusText =
    status.level === "over"
      ? t("dashboard.budget.over", { amount: formatCents(-status.remainingCents, language) })
      : t(status.level === "ok" ? "dashboard.budget.ok" : "dashboard.budget.watch");

  return (
    <Card
      title={t("dashboard.budget.title")}
      action={
        <Pressable
          onPress={startEditing}
          accessibilityRole="button"
          accessibilityLabel={t("dashboard.budget.edit")}
          hitSlop={12}
          style={s.edit}
        >
          <Pencil size={14} color={c.accent} />
          <Text style={s.editText}>{t("dashboard.budget.edit")}</Text>
        </Pressable>
      }
    >
      <View style={s.amounts}>
        <Text style={s.spent}>{formatCents(spentCents, language)}</Text>
        <Text style={s.of}>
          {t("dashboard.budget.of", { amount: formatCents(status.budgetCents, language) })}
        </Text>
      </View>

      <View
        style={s.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(status.used * 100) }}
      >
        <View style={[s.fill, { width: `${fill * 100}%`, backgroundColor: color }]} />
        {showToday ? (
          <View style={[s.todayMark, { left: `${status.timeElapsed * 100}%` }]} />
        ) : null}
      </View>
      {showToday ? (
        <Text
          style={[s.todayLabel, { paddingLeft: `${Math.min(status.timeElapsed, 0.85) * 100}%` }]}
        >
          {t("dashboard.budget.today")}
        </Text>
      ) : null}

      {finished ? (
        <Text style={s.text}>
          {t("dashboard.budget.finished", { percent: formatPercent(status.used, language) })}
        </Text>
      ) : (
        <>
          <View style={s.status}>
            <Icon size={16} color={color} />
            <Text style={s.statusText}>{statusText}</Text>
          </View>
          {status.remainingCents >= 0 ? (
            <Text style={s.text}>
              {t("dashboard.budget.left", {
                amount: formatCents(status.remainingCents, language),
              })}
              {status.perDayLeftCents !== null && status.remainingCents > 0
                ? ` ${t("dashboard.budget.perDayLeft", {
                    amount: formatCents(status.perDayLeftCents, language),
                  })}`
                : ""}
            </Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    actions: { flexDirection: "row", gap: space.sm },
    text: { color: c.textMuted, fontSize: font.small, lineHeight: 20 },
    edit: { flexDirection: "row", alignItems: "center", gap: space.xs },
    editText: { color: c.accent, fontSize: font.small, fontWeight: "600" },
    amounts: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
    spent: { color: c.text, fontSize: 26, fontWeight: "800", fontVariant: ["tabular-nums"] },
    of: { color: c.textMuted, fontSize: font.small, fontVariant: ["tabular-nums"] },
    track: {
      height: 12,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceMuted,
      overflow: "hidden",
    },
    fill: { height: "100%", borderRadius: radius.pill },
    todayMark: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: 2,
      marginLeft: -1,
      backgroundColor: c.text,
      opacity: 0.6,
    },
    todayLabel: { color: c.textMuted, fontSize: font.tiny, marginTop: -space.sm },
    status: { flexDirection: "row", alignItems: "center", gap: space.xs },
    statusText: { color: c.text, fontSize: font.small, fontWeight: "600" },
  });
