import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { fr } from "./fr";

export type Language = "fr" | "en";

const deviceLanguage = getLocales()[0]?.languageCode;
export const language: Language = deviceLanguage === "en" ? "en" : "fr";

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: language,
  fallbackLng: "fr",
  interpolation: { escapeValue: false },
});

export default i18n;
