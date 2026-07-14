/**
 * Shared light / dark theme for product + lab pages.
 * Persistence: localStorage key `rh-theme` = 'light' | 'dark'.
 */
const KEY = "rh-theme";

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch (_) {}
  if (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(KEY, t);
  } catch (_) {}
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
    btn.setAttribute("title", t === "dark" ? "Light mode" : "Dark mode");
    btn.textContent = t === "dark" ? "☀" : "☾";
  });
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

/** Call once at page boot — before paint if possible. */
export function initTheme() {
  applyTheme(getTheme());
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleTheme());
  });
}
