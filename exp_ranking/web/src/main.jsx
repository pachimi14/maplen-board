import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { I18nProvider } from "./i18n/I18nContext.jsx";
import "./index.css";

document.documentElement.lang = window.localStorage.getItem("maplen-board-lang") || "ja";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
