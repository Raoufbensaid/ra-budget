/**
 * Dictée vocale dans le navigateur avec la Web Speech API (Chrome, Edge, Safari).
 * Gratuite et sans serveur à nous ; le navigateur peut envoyer l'audio à son éditeur.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Speech } from "./speech";

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeech(): Speech {
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const ref = useRef<Recognition | null>(null);

  useEffect(() => {
    setAvailable(recognitionCtor() !== null);
    return () => ref.current?.stop();
  }, []);

  const stop = useCallback(() => ref.current?.stop(), []);

  const start = useCallback((onText: (text: string, final: boolean) => void) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    ref.current?.stop();
    const rec = new Ctor();
    // L'extracteur ne comprend que le français pour l'instant.
    rec.lang = "fr-FR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        text += r[0].transcript;
        if (r.isFinal) final = true;
      }
      onText(text.trim(), final);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    ref.current = rec;
    setListening(true);
    rec.start();
  }, []);

  return { available, listening, start, stop };
}
