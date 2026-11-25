import {
  compareToPrevious,
  firstDay,
  lastDay,
  type MonthKey,
  monthlyTotals,
  monthOf,
  shiftMonth,
  summarizeMonth,
} from "@ra/insights";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { Button } from "@/components/ui";
import { useSession } from "@/features/auth/session-provider";
import { usePurchasesBetween } from "@/features/dashboard/api";
import { BudgetCard } from "@/features/dashboard/budget-card";
import { CategoryCard } from "@/features/dashboard/category-card";
import { SummaryCard } from "@/features/dashboard/summary-card";
import { TopProductsCard } from "@/features/dashboard/top-products-card";
import { TrendCard } from "@/features/dashboard/trend-card";
import { language } from "@/i18n";
import { capitalize, formatMonth, isoDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

const TREND_MONTHS = 6;

function DashboardScreenContent() {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const today = isoDate(new Date());
  const currentMonth = monthOf(today);
  const [month, setMonth] = useState<MonthKey>(currentMonth);

  // Les 6 mois qui finissent par le mois affiché (le précédent sert à la comparaison).
  const query = usePurchasesBetween(
    firstDay(shiftMonth(month, -(TREND_MONTHS - 1))),
    lastDay(month),
  );
  const purchases = query.data;

  const view = useMemo(() => {
    if (!purchases) return null;
    return {
      summary: summarizeMonth(purchases, month, today),
      comparison: compareToPrevious(purchases, month, today),
      totals: monthlyTotals(purchases, month, TREND_MONTHS),
    };
  }, [purchases, month, today]);

  const canGoNext = month < currentMonth;
  const monthName = formatMonth(month, language);

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      >
        <Text style={s.brand}>RA BUDGET</Text>
        <Text style={s.title}>{t("dashboard.title")}</Text>

        <View style={s.switcher}>
          <Pressable
            onPress={() => setMonth(shiftMonth(month, -1))}
            accessibilityRole="button"
            accessibilityLabel={t("dashboard.previousMonth")}
            hitSlop={8}
            style={({ pressed }) => [s.arrow, pressed && s.pressed]}
          >
            <ChevronLeft size={20} color={c.text} />
          </Pressable>
          <Text style={s.monthLabel} accessibilityRole="header">
            {capitalize(formatMonth(month, language, { withYear: true }))}
          </Text>
          <Pressable
            onPress={() => setMonth(shiftMonth(month, 1))}
            disabled={!canGoNext}
            accessibilityRole="button"
            accessibilityLabel={t("dashboard.nextMonth")}
            accessibilityState={{ disabled: !canGoNext }}
            hitSlop={8}
            style={({ pressed }) => [s.arrow, !canGoNext && s.disabled, pressed && s.pressed]}
          >
            <ChevronRight size={20} color={c.text} />
          </Pressable>
        </View>

        {query.isPending ? <ActivityIndicator color={c.accent} /> : null}
        {query.isError && !view ? (
          <View style={s.gap}>
            <Text style={s.muted}>{t("dashboard.error")}</Text>
            <Button
              variant="secondary"
              label={t("dashboard.retry")}
              onPress={() => void query.refetch()}
            />
          </View>
        ) : null}

        {view ? (
          <>
            <SummaryCard summary={view.summary} comparison={view.comparison} />
            <BudgetCard month={month} spentCents={view.summary.totalCents} today={today} />
            {view.summary.byCategory.length > 0 ? (
              <CategoryCard key={month} categories={view.summary.byCategory} />
            ) : (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>{t("dashboard.empty", { month: monthName })}</Text>
                {month === currentMonth ? (
                  <Text style={s.muted}>{t("dashboard.emptyHint")}</Text>
                ) : null}
              </View>
            )}
            <TrendCard
              totals={view.totals}
              selected={month}
              currentMonth={currentMonth}
              onSelect={setMonth}
            />
            {view.summary.topProducts.length > 1 ? (
              <TopProductsCard products={view.summary.topProducts} />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    page: {
      padding: space.lg,
      gap: space.lg,
      width: "100%",
      maxWidth: 720,
      alignSelf: "center",
    },
    gap: { gap: space.sm },
    brand: { color: c.accent, fontSize: font.tiny, fontWeight: "700", letterSpacing: 1.2 },
    title: { color: c.text, fontSize: font.title, fontWeight: "700", marginTop: -space.md },
    switcher: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.pill,
      padding: space.xs,
    },
    arrow: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { backgroundColor: c.surfaceMuted },
    disabled: { opacity: 0.3 },
    monthLabel: { color: c.text, fontSize: font.body, fontWeight: "700" },
    muted: { color: c.textMuted, fontSize: font.small, lineHeight: 20 },
    empty: {
      gap: space.xs,
      padding: space.lg,
      borderRadius: radius.lg,
      borderColor: c.border,
      borderWidth: 1,
      borderStyle: "dashed",
    },
    emptyTitle: { color: c.text, fontSize: font.body, fontWeight: "600" },
  });

/** Sans compte : invitation à se connecter. */
export default function DashboardScreen() {
  const { session } = useSession();
  return session ? <DashboardScreenContent /> : <SignInPrompt />;
}
