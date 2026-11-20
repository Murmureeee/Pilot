// @env browser
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { restoreLocale } from "./lib/i18n";
import "./assets/main.css";

restoreLocale();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
console.log("[app] mounted");
