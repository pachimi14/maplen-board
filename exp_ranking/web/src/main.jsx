import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { detectLanguage } from "./i18n/detectLanguage.js";
import { I18nProvider } from "./i18n/I18nContext.jsx";
import "./index.css";

document.documentElement.lang = detectLanguage();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
