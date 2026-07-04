import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "ifc-app-theme";

/** Light/dark theme stored on <html data-theme> and persisted to localStorage. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(KEY) as Theme) || "light";
    } catch {
      return "light"; // storage blocked (private mode / locked-down profile)
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch { /* storage blocked — theme stays session-only */ }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  return [theme, toggle];
}
