"use client";

import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    const stored = safeGet();
    if (stored) {
      setMode(stored);
      apply(stored);
    }
  }, []);

  function choose(next: Mode) {
    setMode(next);
    apply(next);
    safeSet(next);
  }

  const label = mode === "system" ? "Auto" : mode === "light" ? "Light" : "Dark";
  const next: Mode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";

  return (
    <button
      className="btn"
      style={{ marginTop: "auto", fontSize: 11.5 }}
      onClick={() => choose(next)}
      aria-label={`Theme: ${label}. Click for ${next}.`}
    >
      Theme · {label}
    </button>
  );
}

function apply(mode: Mode) {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  // AG Grid ships its own light/dark theme classes, so the grid wrappers read
  // this attribute rather than the CSS custom properties.
  root.dataset.resolvedTheme = resolved(mode);
  window.dispatchEvent(new Event("aegis-theme"));
}

export function resolved(mode: Mode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Browser storage can throw in private windows or with site data blocked, and
// a theme preference is never worth breaking the page over.
function safeGet(): Mode | null {
  try {
    const v = localStorage.getItem("aegis-theme");
    return v === "light" || v === "dark" || v === "system" ? v : null;
  } catch {
    return null;
  }
}

function safeSet(mode: Mode) {
  try {
    localStorage.setItem("aegis-theme", mode);
  } catch {
    /* ignore */
  }
}

/** Live-resolved theme for components that need the literal value. */
export function useResolvedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "light" || attr === "dark") return setTheme(attr);
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    };
    read();
    window.addEventListener("aegis-theme", read);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => {
      window.removeEventListener("aegis-theme", read);
      mq.removeEventListener("change", read);
    };
  }, []);

  return theme;
}
