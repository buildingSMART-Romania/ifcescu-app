import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanguageProvider } from "./i18n/react";
import { SettingsProvider } from "./settings/react";
import "./theme/theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
