export type Theme = 'light' | 'dark';

const KEY = 'cc_theme';
const META_COLORS: Record<Theme, string> = { dark: '#15131c', light: '#f7f6fa' };

/** The saved choice, or the device setting when the user never picked one. */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, save = true) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLORS[theme]);
  if (!save) return;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}
