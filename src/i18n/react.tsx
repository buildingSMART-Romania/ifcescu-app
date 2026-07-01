// React binding for the i18n singleton (./index). Wrap the app in
// <LanguageProvider> and read { lang, setLang, t } via useI18n(). Changing the
// language re-renders every consumer (the context value identity changes), and
// also notifies non-React listeners through the singleton.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getLang, setLang as setLangSingleton, subscribe, t as translate } from "./index";
import type { Lang, I18nKey } from "./types";

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getLang());

  // Mirror singleton → React (covers external setLang callers too).
  useEffect(() => subscribe(() => setLangState(getLang())), []);
  // Reflect on <html lang> for semantics/accessibility.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <Ctx.Provider value={{ lang, setLang: setLangSingleton, t: translate }}>{children}</Ctx.Provider>
  );
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used within a LanguageProvider");
  return v;
}
