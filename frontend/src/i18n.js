import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";
import zh from "./locales/zh.json";
import hi from "./locales/hi.json";
import ar from "./locales/ar.json";
import bn from "./locales/bn.json";
import pt from "./locales/pt.json";
import ru from "./locales/ru.json";
import fr from "./locales/fr.json";
import ur from "./locales/ur.json";

export const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "es", label: "Espanol" },
  { code: "zh", label: "中文" },
  { code: "hi", label: "हिन्दी" },
  { code: "ar", label: "العربية" },
  { code: "bn", label: "বাংলা" },
  { code: "pt", label: "Portugues" },
  { code: "ru", label: "Русский" },
  { code: "fr", label: "Français" },
  { code: "ur", label: "اردو" },
];

const RESOURCES = {
  en: { translation: en },
  es: { translation: es },
  zh: { translation: zh },
  hi: { translation: hi },
  ar: { translation: ar },
  bn: { translation: bn },
  pt: { translation: pt },
  ru: { translation: ru },
  fr: { translation: fr },
  ur: { translation: ur },
};

if (!i18next.isInitialized) {
  i18next.use(initReactI18next).init({
    resources: RESOURCES,
    lng: typeof window !== "undefined" ? localStorage.getItem("qpp_lang") || "en" : "en",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
      prefix: "{",
      suffix: "}",
    },
    returnNull: false,
    returnEmptyString: false,
  });
}

export function LanguageProvider({ children }) {
  return children;
}

export function useI18n() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.slice(0, 2) || "en";
  const setLang = (nextLang) => {
    const normalized = nextLang?.slice(0, 2) || "en";
    i18n.changeLanguage(normalized);
    if (typeof window !== "undefined") {
      localStorage.setItem("qpp_lang", normalized);
      document.documentElement.setAttribute("lang", normalized);
    }
  };
  return { t, lang, setLang };
}
