import { useRouter } from "expo-router";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react-native";
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
import {
  purchaseTotal,
  type SavedPurchase,
  useDeletePurchase,
  usePurchases,
} from "@/features/purchases/api";
import { type TeamShare, useTeamShares } from "@/features/team-shares/api";
import { language } from "@/i18n";
import { confirm } from "@/lib/confirm";
import {
  capitalize,
  categoryLabel,
  describeItem,
  formatCents,
  formatDate,
  isoDate,
} from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

/** Une ligne de l'historique : ta dépense, ou ta part d'une dépense de Team. */
type Entry = { kind: "purchase"; purchase: SavedPurchase } | { kind: "team"; share: TeamShare };

function PurchaseCard({ purchase }: { purchase: SavedPurchase }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const [open, setOpen] = useState(false);
  const remove = useDeletePurchase();
  const total = purchaseTotal(purchase);
  const items = purchase.purchase_items;
  const title =
    purchase.merchant ??
    items
      .slice(0, 2)
      .map((i) => capitalize(i.name ?? i.raw_label))
      .join(", ") ??
    t("history.noMerchant");

  return (
    <View style={s.card}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={s.cardHeader}
      >
        <View style={s.flex}>
          <Text style={s.cardTitle} numberOfLines={1}>
            {title || t("history.noMerchant")}
          </Text>
          <Text style={s.meta}>{t("history.items", { count: items.length })}</Text>
        </View>
        <Text style={s.amount}>{formatCents(total, language)}</Text>
        {open ? (
          <ChevronUp size={18} color={c.textMuted} />
        ) : (
          <ChevronDown size={18} color={c.textMuted} />
        )}
      </Pressable>
      {open ? (
        <View style={s.items}>
          {items.map((item) => (
            <View key={item.position} style={s.itemRow}>
              <View style={s.flex}>
                <Text style={s.itemName}>
                  {capitalize(describeItem({ ...item, rawLabel: item.raw_label }, language))}
                </Text>
                <Text style={s.meta}>
                  {item.category_id
                    ? categoryLabel(item.category_id, language)
                    : t("expense.toClassify")}
                </Text>
              </View>
              <Text style={s.itemPrice}>
                {item.total_price_cents !== null
                  ? formatCents(item.total_price_cents, language)
                  : t("expense.included")}
              </Text>
            </View>
          ))}
          <Button
            variant="danger"
            label={t("history.delete")}
            icon={<Trash2 size={16} color={c.danger} />}
            loading={remove.isPending}
            onPress={() =>
              confirm(
                t("history.confirmDelete", { total: formatCents(total, language) }),
                t("history.delete"),
                t("history.cancel"),
                () => remove.mutate(purchase.id),
              )
            }
          />
        </View>
      ) : null}
    </View>
  );
}

/** Ta part d'une dépense de Team validée ; un appui ouvre la dépense. */
function TeamShareCard({ share }: { share: TeamShare }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/teams/${share.teamId}/expenses/${share.expenseId}`)}
      accessibilityRole="button"
      style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }]}
    >
      <View style={s.cardHeader}>
        <Text style={s.teamIcon}>{share.teamIcon}</Text>
        <View style={s.flex}>
          <Text style={s.cardTitle} numberOfLines={1}>
            {share.title}
          </Text>
          <Text style={s.meta}>
            {t("history.teamShare", {
              team: share.teamName,
              total: formatCents(share.totalCents, language),
            })}
          </Text>
        </View>
        <Text style={s.amount}>{formatCents(share.shareCents, language)}</Text>
      </View>
    </Pressable>
  );
}

function HistoryScreenContent() {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const query = usePurchases();
  const sharesQuery = useTeamShares();
  const purchases = query.data ?? [];
  const shares = sharesQuery.data ?? [];

  const monthTotal = useMemo(() => {
    const month = isoDate(new Date()).slice(0, 7);
    const own = purchases
      .filter((p) => p.purchased_on.startsWith(month))
      .reduce((sum, p) => sum + purchaseTotal(p), 0);
    const team = shares
      .filter((sh) => sh.spentOn.startsWith(month))
      .reduce((sum, sh) => sum + sh.shareCents, 0);
    return own + team;
  }, [purchases, shares]);

  // Regroupement par jour, du plus récent au plus ancien.
  const days = useMemo(() => {
    const map = new Map<string, Entry[]>();
    const add = (day: string, entry: Entry) => map.set(day, [...(map.get(day) ?? []), entry]);
    for (const p of purchases) add(p.purchased_on, { kind: "purchase", purchase: p });
    for (const sh of shares) add(sh.spentOn, { kind: "team", share: sh });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [purchases, shares]);

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => {
              void query.refetch();
              void sharesQuery.refetch();
            }}
          />
        }
      >
        <Text style={s.brand}>RA BUDGET</Text>
        <Text style={s.title}>{t("history.title")}</Text>

        <View style={s.summary}>
          <Text style={s.summaryLabel}>{t("history.month")}</Text>
          <Text style={s.summaryAmount}>{formatCents(monthTotal, language)}</Text>
        </View>

        {query.isPending ? <ActivityIndicator color={c.accent} /> : null}
        {query.isError ? (
          <View style={s.gap}>
            <Text style={s.meta}>{t("history.error")}</Text>
            <Button
              variant="secondary"
              label={t("history.retry")}
              onPress={() => query.refetch()}
            />
          </View>
        ) : null}
        {query.isSuccess && purchases.length === 0 && shares.length === 0 ? (
          <Text style={s.empty}>{t("history.empty")}</Text>
        ) : null}

        {days.map(([day, list]) => (
          <View key={day} style={s.gap}>
            <Text style={s.dayLabel}>
              {formatDate(day, language, {
                today: t("expense.today"),
                yesterday: t("expense.yesterday"),
              })}
            </Text>
            {list.map((entry) =>
              entry.kind === "purchase" ? (
                <PurchaseCard key={entry.purchase.id} purchase={entry.purchase} />
              ) : (
                <TeamShareCard key={`team-${entry.share.expenseId}`} share={entry.share} />
              ),
            )}
          </View>
        ))}
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
    flex: { flex: 1 },
    teamIcon: { fontSize: 22 },
    gap: { gap: space.sm },
    brand: {
      color: c.accent,
      fontSize: font.tiny,
      fontWeight: "700",
      letterSpacing: 1.2,
    },
    title: { color: c.text, fontSize: font.title, fontWeight: "700", marginTop: -space.md },
    summary: {
      backgroundColor: c.accent,
      borderRadius: radius.lg,
      padding: space.xl,
      gap: space.xs,
    },
    summaryLabel: { color: c.onAccent, fontSize: font.small, fontWeight: "600", opacity: 0.85 },
    summaryAmount: {
      color: c.onAccent,
      fontSize: 34,
      fontWeight: "800",
      fontVariant: ["tabular-nums"],
    },
    empty: { color: c.textMuted, fontSize: font.body, lineHeight: 22 },
    dayLabel: {
      color: c.textMuted,
      fontSize: font.small,
      fontWeight: "700",
      textTransform: "capitalize",
    },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: space.sm },
    cardTitle: { color: c.text, fontSize: font.body, fontWeight: "600" },
    meta: { color: c.textMuted, fontSize: font.tiny },
    amount: {
      color: c.text,
      fontSize: font.body,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    items: { gap: space.sm },
    itemRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      paddingVertical: space.xs,
      borderTopColor: c.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    itemName: { color: c.text, fontSize: font.small },
    itemPrice: { color: c.text, fontSize: font.small, fontVariant: ["tabular-nums"] },
  });

/** Sans compte : invitation à se connecter. */
export default function HistoryScreen() {
  const { session } = useSession();
  return session ? <HistoryScreenContent /> : <SignInPrompt />;
}
