import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeContext, type Theme, type ThemeContextValue } from '@/context/theme-context-value';
import { THEME_STORAGE_KEY } from '@/constants/app';

interface ThemeProviderProps { children: ReactNode; defaultTheme?: Theme }

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStoredTheme(fallback: Theme): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : fallback;
  } catch {
    return fallback;
  }
}

/** shadcn's Vite theme provider: toggles the `dark` class on <html> and remembers the choice. */
export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(defaultTheme));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies for this session.
    }
    setThemeState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
