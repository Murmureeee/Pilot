// @env all
export { productName as APP_NAME } from "../../package.json";
export const WORKSPACE_QUERY_LENGTH = 512;

export const SUPPORTED_LOCALES = ["zh", "en"] as const;
export const DEFAULT_LOCALE = SUPPORTED_LOCALES[0];
export const LOCALE_DETAILS = {
  zh: { label: "中文", htmlLang: "zh-CN" },
  en: { label: "English", htmlLang: "en" },
} as const satisfies Record<
  (typeof SUPPORTED_LOCALES)[number],
  { label: string; htmlLang: string }
>;
