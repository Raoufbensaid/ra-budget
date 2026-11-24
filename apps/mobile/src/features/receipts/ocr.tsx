import { type ComponentType, type ReactElement, type Ref, useCallback, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";
import { asOcrMessage, OCR_HTML } from "./tesseract";

/** Ce dont on se sert de la WebView (ses types ne suivent pas encore React 19). */
interface WebViewHandle {
  injectJavaScript: (script: string) => void;
}
const HiddenWebView = WebView as unknown as ComponentType<
  WebViewProps & { ref?: Ref<WebViewHandle> }
>;

interface Pending {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

/**
 * Lecture du texte d'une image sur iPhone et Android : Tesseract tourne dans
 * une fenêtre web cachée. `element` doit être placé dans l'écran.
 */
export function useOcr(): {
  element: ReactElement;
  recognize: (dataUrl: string) => Promise<string>;
} {
  const webview = useRef<WebViewHandle>(null);
  const pending = useRef(new Map<string, Pending>());
  const ready = useRef<Promise<void> | null>(null);
  const markReady = useRef<() => void>(() => {});
  if (!ready.current) {
    ready.current = new Promise((resolve) => {
      markReady.current = resolve;
    });
  }

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    const message = asOcrMessage(parsed);
    if (!message) return;
    if (message.ready) {
      markReady.current();
      return;
    }
    const waiting = message.id ? pending.current.get(message.id) : undefined;
    if (!waiting || !message.id) return;
    pending.current.delete(message.id);
    if (message.error !== undefined) waiting.reject(new Error(message.error));
    else waiting.resolve(message.text ?? "");
  }, []);

  const recognize = useCallback(async (dataUrl: string) => {
    await ready.current;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise<string>((resolve, reject) => {
      pending.current.set(id, { resolve, reject });
      webview.current?.injectJavaScript(
        `window.recognize(${JSON.stringify(id)}, ${JSON.stringify(dataUrl)}); true;`,
      );
    });
  }, []);

  const element = (
    <HiddenWebView
      ref={webview}
      source={{ html: OCR_HTML, baseUrl: "https://localhost/" }}
      // Page locale seulement : aucune navigation vers un autre site.
      originWhitelist={["about:*", "https://localhost"]}
      onShouldStartLoadWithRequest={(request) =>
        request.url === "about:blank" || request.url.startsWith("https://localhost")
      }
      onMessage={onMessage}
      javaScriptEnabled
      style={styles.hidden}
    />
  );

  return { element, recognize };
}

const styles = StyleSheet.create({
  hidden: { width: 1, height: 1, opacity: 0, position: "absolute" },
});
