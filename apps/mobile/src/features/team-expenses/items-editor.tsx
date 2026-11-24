import { Plus, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { language } from "@/i18n";
import { parseEuros } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

/** Ligne d'article en cours de saisie (textes tels que tapés). */
export interface ItemDraft {
  key: string;
  label: string;
  quantity: string;
  /** Prix total de la ligne ; « -1,00 » pour une remise. */
  price: string;
}

let counter = 0;
export function newItemKey(): string {
  counter += 1;
  return `i${Date.now().toString(36)}-${counter}`;
}

export function centsToText(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const text = (Math.abs(cents) / 100).toFixed(2).replace(/\.00$/, "");
  return sign + (language === "fr" ? text.replace(".", ",") : text);
}

/** Prix d'une ligne en centimes (négatif accepté pour une remise), ou null. */
export function parseItemPrice(text: string): number | null {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const cents = parseEuros(negative ? trimmed.slice(1) : trimmed);
  if (cents === null) return null;
  return negative ? -cents : cents;
}

export function parseItemQuantity(text: string): number | null {
  if (text.trim() === "") return 1;
  const q = Number(text.replace(",", "."));
  return Number.isFinite(q) && q > 0 && q < 10000 ? q : null;
}

/** Une ligne est valable si son libellé est rempli et son prix et sa quantité lisibles. */
export function isItemValid(item: ItemDraft): boolean {
  return (
    item.label.trim().length > 0 &&
    parseItemPrice(item.price) !== null &&
    parseItemQuantity(item.quantity) !== null
  );
}

/** Articles du ticket : libellé, quantité, prix ; ajout et suppression de lignes. */
export function ItemsEditor({
  items,
  onChange,
}: {
  items: ItemDraft[];
  onChange: (items: ItemDraft[]) => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const update = (key: string, patch: Partial<ItemDraft>) =>
    onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  return (
    <View style={s.wrap}>
      <Text style={s.label}>{t("receipts.items")}</Text>
      {items.length > 0 ? (
        <View style={s.headerRow}>
          <Text style={[s.head, s.flex]}>{t("receipts.itemLabel")}</Text>
          <Text style={[s.head, s.qtyCol]}>{t("receipts.itemQty")}</Text>
          <Text style={[s.head, s.priceCol]}>{t("receipts.itemPrice")}</Text>
          <View style={s.removeCol} />
        </View>
      ) : null}
      {items.map((item) => {
        const bad = item.label.trim().length > 0 && !isItemValid(item);
        return (
          <View key={item.key} style={s.row}>
            <TextInput
              value={item.label}
              onChangeText={(v) => update(item.key, { label: v })}
              placeholder={t("receipts.itemLabelPlaceholder")}
              placeholderTextColor={c.textMuted}
              maxLength={120}
              accessibilityLabel={t("receipts.itemLabel")}
              style={[s.input, s.flex]}
            />
            <TextInput
              value={item.quantity}
              onChangeText={(v) => update(item.key, { quantity: v })}
              placeholder="1"
              placeholderTextColor={c.textMuted}
              keyboardType="decimal-pad"
              inputMode="decimal"
              accessibilityLabel={t("receipts.itemQty")}
              style={[s.input, s.qtyCol, s.right]}
            />
            <TextInput
              value={item.price}
              onChangeText={(v) => update(item.key, { price: v })}
              placeholder="0,00"
              placeholderTextColor={c.textMuted}
              keyboardType="numbers-and-punctuation"
              accessibilityLabel={t("receipts.itemPrice")}
              style={[s.input, s.priceCol, s.right, bad && { borderColor: c.danger }]}
            />
            <Pressable
              onPress={() => onChange(items.filter((i) => i.key !== item.key))}
              accessibilityRole="button"
              accessibilityLabel={t("receipts.removeItem", { label: item.label })}
              hitSlop={8}
              style={s.removeCol}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>
        );
      })}
      <Pressable
        onPress={() =>
          onChange([...items, { key: newItemKey(), label: "", quantity: "", price: "" }])
        }
        accessibilityRole="button"
        style={s.add}
      >
        <Plus size={16} color={c.accent} />
        <Text style={s.addText}>{t("receipts.addItem")}</Text>
      </Pressable>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: space.sm },
    flex: { flex: 1 },
    label: { color: c.text, fontSize: font.small, fontWeight: "600" },
    headerRow: { flexDirection: "row", gap: space.xs },
    head: { color: c.textMuted, fontSize: font.tiny },
    row: { flexDirection: "row", alignItems: "center", gap: space.xs },
    input: {
      color: c.text,
      fontSize: font.small,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      backgroundColor: c.surface,
      minHeight: 36,
    },
    qtyCol: { width: 48 },
    priceCol: { width: 76 },
    right: { textAlign: "right" },
    removeCol: { width: 24, alignItems: "center" },
    add: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingVertical: space.xs },
    addText: { color: c.accent, fontSize: font.small, fontWeight: "600" },
  });
