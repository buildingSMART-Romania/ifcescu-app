import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LanguageProvider } from "./i18n/react";
import { t } from "./i18n";
import { SettingsProvider } from "./settings/react";
import "./theme/theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <SettingsProvider>
        {/* Root boundary: a render crash anywhere (header, modals, upload panel)
            shows a recoverable message instead of blanking the app. Uses the
            framework-agnostic `t` (initial language) — it renders outside the
            crashed React tree, so the hook isn't available here anyway. */}
        <ErrorBoundary title={t("app.crashTitle")} body={t("app.crashBody")} reloadLabel={t("app.reload")}>
          <App />
        </ErrorBoundary>
      </SettingsProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
