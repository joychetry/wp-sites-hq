// SPDX-License-Identifier: GPL-3.0-or-later
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { setTextSize, textSize } from "./theme";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/controls.css";
// Every screen's CSS up front (a few KB): screens load as lazy chunks, but some rules are shared between them.
import.meta.glob("./styles/screens/*.css", { eager: true });

setTextSize(textSize());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
