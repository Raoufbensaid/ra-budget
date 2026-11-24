import type { ReactElement } from "react";
import { asOcrMessage, OCR_HTML } from "./tesseract";

interface Pending {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

/**
 * Cadre de lecture isolé : « sandbox » sans allow-same-origin, donc sans
 * accès au stockage ni à la session de l'application. Créé une seule fois.
 */
let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
const pending = new Map<string, Pending>();

function getFrame(): Promise<HTMLIFrameElement> {
  if (!ready) {
    ready = new Promise<void>((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("aria-hidden", "true");
      iframe.title = "ocr";
      iframe.style.cssText = "position:absolute;width:1px;height:1px;border:0;opacity:0;";
      iframe.srcdoc = OCR_HTML;
      window.addEventListener("message", (event) => {
        // Seuls les messages du cadre de lecture sont pris en compte.
        if (event.source !== iframe.contentWindow) return;
        const message = asOcrMessage(event.data);
        if (!message) return;
        if (message.ready) {
          resolve();
          return;
        }
        const waiting = message.id ? pending.get(message.id) : undefined;
        if (!waiting || !message.id) return;
        pending.delete(message.id);
        if (message.error !== undefined) waiting.reject(new Error(message.error));
        else waiting.resolve(message.text ?? "");
      });
      document.body.appendChild(iframe);
      frame = iframe;
    });
  }
  return ready.then(() => frame as HTMLIFrameElement);
}

/** Lecture du texte d'une image sur le web, dans un cadre isolé. */
export function useOcr(): {
  element: ReactElement | null;
  recognize: (dataUrl: string) => Promise<string>;
} {
  return {
    element: null,
    recognize: async (dataUrl: string) => {
      const iframe = await getFrame();
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        // Le cadre a une origine opaque : « * » est la seule cible possible.
        iframe.contentWindow?.postMessage({ type: "recognize", id, dataUrl }, "*");
      });
    },
  };
}
