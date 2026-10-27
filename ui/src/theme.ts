// Theme: the OS setting unless the person picked light or dark.
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "mc-theme";

function resolve(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(
    () => (localStorage.getItem(KEY) as ThemeChoice | null) ?? "system",
  );
  useEffect(() => {
    const apply = () => (document.documentElement.dataset.theme = resolve(choice));
    apply();
    localStorage.setItem(KEY, choice);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", apply);
    return () => mq?.removeEventListener("change", apply);
  }, [choice]);
  return { choice, setChoice };
}

// Row height: comfortable by default, compact for people who want more rows.
export type Density = "comfortable" | "compact";
const DENSITY = "mc-density";

export function useDensity() {
  const [density, setDensity] = useState<Density>(
    () => (localStorage.getItem(DENSITY) as Density | null) ?? "comfortable",
  );
  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem(DENSITY, density);
  }, [density]);
  return { density, setDensity };
}
