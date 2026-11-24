import { Alert, Platform } from "react-native";

/** Confirmation avant une action importante (Alert n'existe pas sur le web). */
export function confirm(message: string, ok: string, cancel: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if (window.confirm(message)) onConfirm();
    return;
  }
  Alert.alert(message, undefined, [
    { text: cancel, style: "cancel" },
    { text: ok, style: "destructive", onPress: onConfirm },
  ]);
}
