import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyAndroidLayoutClass } from "./lib/platform";
import "@fontsource/sora/400.css";
import "@fontsource/sora/500.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/500.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import "@fontsource/material-symbols-rounded/400.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/android.css";

applyAndroidLayoutClass();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
