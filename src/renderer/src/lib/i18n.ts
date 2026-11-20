// @env browser
import { createInstance } from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../../../shared/constants";
import type { Locale } from "../../../shared/contract";
import { EN_MESSAGES } from "./locales/en";

const LOCALE_STORAGE_KEY = "pi-locale";
const i18n = createInstance();
void i18n.use(initReactI18next).init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  resources: {
    zh: { translation: {} },
    en: { translation: EN_MESSAGES },
  } satisfies Record<Locale, { translation: Record<string, string> }>,
  initAsync: false,
  keySeparator: false,
  nsSeparator: false,
  interpolation: {
    prefix: "{",
    suffix: "}",
    escapeValue: false,
    skipOnVariables: true,
  },
  react: { useSuspense: false },
});

function asLocale(value: string | null): Locale {
  return SUPPORTED_LOCALES.find((locale) => locale === value) ?? DEFAULT_LOCALE;
}

export function restoreLocale(): void {
  void i18n.changeLanguage(asLocale(localStorage.getItem(LOCALE_STORAGE_KEY)));
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

export function currentLocale(): Locale {
  return asLocale(i18n.language);
}

export function useLocale(): Locale {
  return asLocale(useTranslation().i18n.language);
}

export function t(text: string, locale: Locale, args?: readonly (string | number)[]): string {
  return i18n.t(text, {
    lng: locale,
    defaultValue: text,
    replace: Object.fromEntries(args?.map((value, index) => [index, value]) ?? []),
    skipInterpolation: args === undefined,
  });
}

export function displayProviderName(
  provider: { id: string; name: string },
  locale: Locale,
): string {
  return provider.id === "faux-default" && provider.name === "Faux 测试"
    ? t(provider.name, locale)
    : provider.name;
}

export function localizeError(message: string, locale: Locale): string {
  return t(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""), locale);
}
