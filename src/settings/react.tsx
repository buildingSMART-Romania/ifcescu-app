// React binding for the settings singleton (./index). Wrap the app in
// <SettingsProvider> and read { settings, update } via useSettings(). Any change
// re-renders every consumer (the context value identity changes) and notifies
// non-React listeners through the singleton.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSettings, updateSettings, subscribe, type Settings } from "./index";

interface SettingsValue {
  settings: Settings;
  update: (patch: any) => void;
}

const Ctx = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(getSettings());
  useEffect(() => subscribe(() => setSettings(getSettings())), []);
  return <Ctx.Provider value={{ settings, update: updateSettings }}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be used within a SettingsProvider");
  return v;
}
