import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en.json';
import ar from './ar.json';
import fr from './fr.json';
import { dirOf, type Language } from '@/lib/languages';

/** Keep the document's direction in lockstep with the language — including the
 *  INITIAL load (language restored from localStorage), which previously left
 *  dir=ltr and rendered Arabic pages left-anchored.
 *
 *  Direction comes from the language table now, not from `=== 'ar'`: French is
 *  left-to-right, and a test that asks "is it Arabic" happens to give the right
 *  answer for French only by luck. */
function applyDirection(lang: string) {
  document.documentElement.dir = dirOf(lang);
  document.documentElement.lang = lang;
}

i18n.on('languageChanged', applyDirection);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
      fr: { translation: fr },
    },
    fallbackLng: 'en',
    // A missing French key shows the English string rather than the key name.
    // While fr.json is being filled in that is the difference between a gap
    // and a broken screen.
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })
  .then(() => applyDirection(i18n.language));

export default i18n;

export function setLanguage(lang: Language) {
  i18n.changeLanguage(lang); // languageChanged handler applies dir + lang
}
