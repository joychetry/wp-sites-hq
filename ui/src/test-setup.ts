import "@testing-library/jest-dom/vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Toaster, dismissAll } from "./components/feedback";

// Screens report results in toasts, as in the app, so every DOM test gets the toast layer.
if (typeof document !== "undefined") {
  let root: Root;
  let el: HTMLElement;
  beforeEach(() => {
    el = document.body.appendChild(document.createElement("div"));
    root = createRoot(el);
    act(() => root.render(createElement(Toaster)));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
      dismissAll();
    });
    el.remove();
  });
}
