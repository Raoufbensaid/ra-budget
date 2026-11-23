/**
 * Dictée vocale : indisponible dans Expo Go (le micro passera par le serveur
 * Whisper plus tard). La version web est dans `speech.web.ts`.
 */
export interface Speech {
  available: boolean;
  listening: boolean;
  start: (onText: (text: string, final: boolean) => void) => void;
  stop: () => void;
}

export function useSpeech(): Speech {
  return { available: false, listening: false, start: () => {}, stop: () => {} };
}
