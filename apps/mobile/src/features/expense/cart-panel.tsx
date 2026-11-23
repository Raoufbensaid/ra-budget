import { type Cart, type CartItem, cartTotals } from "@ra/assistant";
import type { TFunction } from "i18next";
import { ChevronDown, ChevronUp, ShoppingBasket, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { language } from "@/i18n";
import { capitalize, categoryLabel, describeItem, formatCents } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

interface Props {
  cart: Cart;
  canValidate: boolean;
  onRemove: (itemId: string) => void;
  onValidate: () => void;
  /** Sur téléphone : panneau repliable au-dessus de la conversation. */
  collapsible: boolean;
}

function unitPriceLabel(item: CartItem, t: TFunction): string | null {
  if (item.unitPriceCents === null || item.ambiguous) return null;
  const price = formatCents(item.unitPriceCents, language);
  if (item.unit === "piece") return item.quantity > 1 ? t("expense.each", { price }) : null;
  return item.unit === "kg" || item.unit === "g"
    ? t("expense.perKilo", { price })
    : t("expense.perLitre", { price });
}

function ItemRow({ item, onRemove }: { item: CartItem; onRemove: () => void }) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const unitPrice = unitPriceLabel(item, t);
  const name = capitalize(describeItem(item, language));

  let price: { text: string; tone: "normal" | "warning" | "muted" };
  if (item.groupId !== null) price = { text: t("expense.included"), tone: "muted" };
  else if (item.totalPriceCents === null)
    price = { text: t("expense.priceMissing"), tone: "warning" };
  else if (item.ambiguous) price = { text: t("expense.priceToConfirm"), tone: "warning" };
  else price = { text: formatCents(item.totalPriceCents, language), tone: "normal" };

  return (
    <View style={s.row}>
      <View style={s.rowMain}>
        <Text style={s.itemName} numberOfLines={2}>
          {name}
        </Text>
        <View style={s.rowMeta}>
          {item.categoryId ? (
            <Text style={s.pill}>{categoryLabel(item.categoryId, language)}</Text>
          ) : (
            <Text style={[s.pill, s.pillWarning]}>{t("expense.toClassify")}</Text>
          )}
          {unitPrice ? <Text style={s.meta}>{unitPrice}</Text> : null}
        </View>
      </View>
      <Text
        style={[
          s.price,
          price.tone === "warning" && { color: c.warning },
          price.tone === "muted" && { color: c.textMuted, fontWeight: "400" },
        ]}
      >
        {price.text}
      </Text>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("expense.remove", { name })}
        style={({ pressed }) => [s.iconButton, pressed && { opacity: 0.5 }]}
      >
        <Trash2 size={18} color={c.textMuted} />
      </Pressable>
    </View>
  );
}

export function CartPanel({ cart, canValidate, onRemove, onValidate, collapsible }: Props) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const [open, setOpen] = useState(false);
  const totals = cartTotals(cart);
  const count = cart.items.length;
  const expanded = !collapsible || open;
  const groups = cart.groups.filter((g) => cart.items.some((i) => i.groupId === g.id));

  return (
    <View style={[s.panel, collapsible ? s.panelCompact : s.panelSide]}>
      <Pressable
        disabled={!collapsible || count === 0}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole={collapsible ? "button" : undefined}
        accessibilityLabel={
          collapsible ? (open ? t("expense.hideCart") : t("expense.showCart")) : undefined
        }
        style={s.header}
      >
        <ShoppingBasket size={20} color={c.accent} />
        <Text style={s.headerTitle}>
          {count === 0 ? t("expense.cart") : t("expense.items", { count })}
        </Text>
        <Text style={s.headerTotal}>{formatCents(totals.knownCents, language)}</Text>
        {collapsible && count > 0 ? (
          open ? (
            <ChevronUp size={20} color={c.textMuted} />
          ) : (
            <ChevronDown size={20} color={c.textMuted} />
          )
        ) : null}
      </Pressable>

      {expanded ? (
        <ScrollView
          style={collapsible ? s.listCompact : s.list}
          contentContainerStyle={s.listContent}
        >
          {count === 0 ? <Text style={s.empty}>{t("expense.cartEmpty")}</Text> : null}
          {cart.items.map((item) => (
            <ItemRow key={item.id} item={item} onRemove={() => onRemove(item.id)} />
          ))}
          {groups.map((g) => (
            <View key={g.id} style={s.groupRow}>
              <Text style={s.meta}>{t("expense.grouped")}</Text>
              <Text style={s.price}>{formatCents(g.cents, language)}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {expanded && cart.declaredTotalCents !== null ? (
        <View style={s.totalRow}>
          <Text style={[s.meta, totals.mismatch && { color: c.warning }]}>{t("expense.paid")}</Text>
          <Text style={[s.price, totals.mismatch && { color: c.warning }]}>
            {formatCents(cart.declaredTotalCents, language)}
          </Text>
        </View>
      ) : null}

      {expanded || canValidate ? (
        <Pressable
          onPress={onValidate}
          disabled={!canValidate}
          accessibilityRole="button"
          style={({ pressed }) => [
            s.validate,
            !canValidate && s.validateDisabled,
            pressed && { backgroundColor: c.accentPressed },
          ]}
        >
          <Text style={[s.validateText, !canValidate && { color: c.textMuted }]}>
            {t("expense.validate")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    panel: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    panelCompact: { marginHorizontal: space.lg, marginBottom: space.sm },
    panelSide: { width: 360, alignSelf: "stretch" },
    header: { flexDirection: "row", alignItems: "center", gap: space.sm },
    headerTitle: { flex: 1, color: c.text, fontSize: font.body, fontWeight: "600" },
    headerTotal: {
      color: c.text,
      fontSize: font.body,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    list: { flex: 1 },
    listCompact: { maxHeight: 260 },
    listContent: { gap: space.xs },
    empty: { color: c.textMuted, fontSize: font.small, paddingVertical: space.sm },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      paddingVertical: space.sm,
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowMain: { flex: 1, gap: space.xs },
    rowMeta: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
    itemName: { color: c.text, fontSize: font.body },
    meta: { color: c.textMuted, fontSize: font.tiny },
    pill: {
      color: c.accent,
      backgroundColor: c.accentSoft,
      fontSize: font.tiny,
      fontWeight: "600",
      paddingHorizontal: space.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      overflow: "hidden",
    },
    pillWarning: { color: c.warning, backgroundColor: c.warningSoft },
    price: {
      color: c.text,
      fontSize: font.body,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
    },
    iconButton: { padding: space.xs },
    groupRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: space.sm,
      paddingRight: 34,
    },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingRight: 34 },
    validate: {
      backgroundColor: c.accent,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    validateDisabled: { backgroundColor: c.surfaceMuted },
    validateText: { color: c.onAccent, fontSize: font.body, fontWeight: "700" },
  });
