import { router } from "expo-router";
import { Undo2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CartPanel } from "@/features/expense/cart-panel";
import { ChatList } from "@/features/expense/chat-list";
import { Composer } from "@/features/expense/composer";
import { SuccessView } from "@/features/expense/success-view";
import { useExpenseChat } from "@/features/expense/use-expense-chat";
import { language } from "@/i18n";
import { formatDate, isoDate } from "@/lib/format";
import { font, type Palette, radius, space, useTheme } from "@/theme";

/** Au-delà de cette largeur, le panier s'affiche à côté de la conversation. */
const WIDE = 900;

export default function AddExpenseScreen() {
  const { t } = useTranslation();
  const c = useTheme();
  const s = styles(c);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const chat = useExpenseChat();
  const { cart } = chat.conv;

  if (chat.lastSaved) {
    return (
      <SafeAreaView style={s.screen}>
        <SuccessView
          draft={chat.lastSaved}
          sessionCount={chat.saved.length}
          onAgain={chat.restart}
          onHistory={() => {
            chat.restart();
            router.navigate("/history");
          }}
        />
      </SafeAreaView>
    );
  }

  const date = formatDate(cart.date ?? isoDate(new Date()), language, {
    today: t("expense.today"),
    yesterday: t("expense.yesterday"),
  });

  const panel = (
    <CartPanel
      cart={cart}
      canValidate={chat.canValidate}
      onRemove={chat.remove}
      onValidate={chat.validate}
      saving={chat.saving}
      saveFailed={chat.saveFailed}
      collapsible={!wide}
    />
  );

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={s.flex} behavior="padding">
        <View style={[s.frame, wide && s.frameWide]}>
          <View style={s.header}>
            <View style={s.flex}>
              <Text style={s.brand}>Ra Budget</Text>
              <Text style={s.title}>{t("expense.title")}</Text>
            </View>
            <Pressable
              onPress={chat.undoLast}
              disabled={chat.conv.past.length === 0}
              accessibilityRole="button"
              accessibilityLabel={t("expense.undo")}
              style={({ pressed }) => [
                s.undo,
                chat.conv.past.length === 0 && { opacity: 0.35 },
                pressed && { backgroundColor: c.surfaceMuted },
              ]}
            >
              <Undo2 size={18} color={c.text} />
              <Text style={s.undoText}>{t("expense.undo")}</Text>
            </Pressable>
          </View>
          <View style={s.context}>
            <Text style={s.contextPill}>{date}</Text>
            {cart.merchant ? <Text style={s.contextPill}>{cart.merchant}</Text> : null}
          </View>

          {wide ? (
            <View style={s.columns}>
              <View style={s.chatColumn}>
                <ChatList
                  messages={chat.messages}
                  conv={chat.conv}
                  onScope={chat.chooseScope}
                  onCategory={chat.chooseCategory}
                />
                <Composer onSend={chat.send} />
              </View>
              {panel}
            </View>
          ) : (
            <>
              {panel}
              <ChatList
                messages={chat.messages}
                conv={chat.conv}
                onScope={chat.chooseScope}
                onCategory={chat.chooseCategory}
              />
              <Composer onSend={chat.send} />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    flex: { flex: 1 },
    frame: { flex: 1, width: "100%", alignSelf: "center" },
    frameWide: { maxWidth: 1200, paddingHorizontal: space.xl, paddingBottom: space.xl },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      gap: space.md,
    },
    brand: {
      color: c.accent,
      fontSize: font.tiny,
      fontWeight: "700",
      letterSpacing: 1.2,
      textTransform: "uppercase",
    },
    title: { color: c.text, fontSize: font.title, fontWeight: "700" },
    undo: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.xs,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.pill,
    },
    undoText: { color: c.text, fontSize: font.small, fontWeight: "600" },
    context: {
      flexDirection: "row",
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      paddingBottom: space.md,
    },
    contextPill: {
      color: c.textMuted,
      backgroundColor: c.surfaceMuted,
      fontSize: font.tiny,
      fontWeight: "600",
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.pill,
      overflow: "hidden",
    },
    columns: { flex: 1, flexDirection: "row", gap: space.xl },
    chatColumn: {
      flex: 1,
      backgroundColor: c.background,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
  });
