import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en.json';
import ar from './ar.json';

/** Keep the document's direction in lockstep with the language — including the
 *  INITIAL load (language restored from localStorage), which previously left
 *  dir=ltr and rendered Arabic pages left-anchored. */
function applyDirection(lang: string) {
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
}

i18n.on('languageChanged', applyDirection);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ar: { translation: ar } },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })
  .then(() => applyDirection(i18n.language));

export default i18n;

export function setLanguage(lang: 'en' | 'ar') {
  i18n.changeLanguage(lang); // languageChanged handler applies dir + lang
}
