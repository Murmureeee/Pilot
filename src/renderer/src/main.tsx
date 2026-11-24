// @env browser
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { restoreLocale, watchLocale } from "./lib/i18n";
import "./assets/main.css";

// 原生提示在渲染进程不可用时仍需要上次的界面语言。
watchLocale((locale) => void window.pi?.setLocale(locale).catch(() => {}));
restoreLocale();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
console.log("[app] mounted");
