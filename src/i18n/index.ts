// Framework-agnostic i18n singleton. React components use ./react (useI18n), but
// plain modules (viewer/pivot, viewer/measure, viewer/model) import `t` directly,
// so the current language lives here, outside React. The React layer subscribes to
// re-render on change.
import { ro } from "./ro";
import { en } from "./en";
import type { Lang, I18nKey } from "./types";

export type { Lang, I18nKey } from "./types";

const KEY = "ifc-app-lang";
const dicts: Record<Lang, unknown> = { ro, en };

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "ro") return v;
  } catch {
    /* localStorage unavailable (SSR/tests) — fall back to default */
  }
  return "ro";
}

// Read synchronously at module load so non-React code running before React mounts
// (and the very first render) already uses the persisted language.
let current: Lang = initialLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore persistence failures */
  }
  listeners.forEach((fn) => fn());
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lookup(dict: unknown, key: string): string | undefined {
  const v = key
    .split(".")
    .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);
  return typeof v === "string" ? v : undefined;
}

/** Translate a key in the current language, with optional {token} interpolation. */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const raw = lookup(dicts[current], key) ?? lookup(dicts.ro, key) ?? key;
  return params ? raw.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "")) : raw;
}
