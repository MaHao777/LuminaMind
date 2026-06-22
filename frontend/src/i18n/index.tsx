import { createContext, ReactNode, useContext, useMemo } from "react";

import { messages, type LanguageId, type MessageKey } from "./messages";

type TranslationParams = Record<string, number | string>;

type I18nContextValue = {
  language: LanguageId;
  t: (key: MessageKey, params?: TranslationParams) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function translate(language: LanguageId, key: MessageKey, params: TranslationParams = {}) {
  const template: string = messages[language][key] ?? messages.en[key] ?? key;
  return Object.entries(params).reduce<string>(
    (text, [paramKey, value]) => text.split(`{${paramKey}}`).join(String(value)),
    template,
  );
}

type Props = {
  children: ReactNode;
  language: LanguageId;
};

export function I18nProvider({ children, language }: Props) {
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      t: (key, params) => translate(language, key, params),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

export type { LanguageId };
