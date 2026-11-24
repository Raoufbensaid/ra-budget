import type { ReactElement } from "react";
import { OCR_LANGUAGE, TESSERACT_URL } from "./tesseract";

interface TesseractWorker {
  recognize: (image: string) => Promise<{ data: { text: string } }>;
}

declare global {
  interface Window {
    Tesseract?: { createWorker: (lang: string) => Promise<TesseractWorker> };
  }
}

let workerPromise: Promise<TesseractWorker> | null = null;

function loadWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = new Promise<void>((resolve, reject) => {
      if (window.Tesseract) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = TESSERACT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("tesseract_unavailable"));
      document.head.appendChild(script);
    }).then(() => {
      if (!window.Tesseract) throw new Error("tesseract_unavailable");
      return window.Tesseract.createWorker(OCR_LANGUAGE);
    });
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Lecture du texte d'une image sur le web : Tesseract tourne dans la page. */
export function useOcr(): {
  element: ReactElement | null;
  recognize: (dataUrl: string) => Promise<string>;
} {
  return {
    element: null,
    recognize: async (dataUrl: string) => {
      const worker = await loadWorker();
      const result = await worker.recognize(dataUrl);
      return result.data.text;
    },
  };
}
