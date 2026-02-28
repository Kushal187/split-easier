import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_THEME = 'splitEasierTheme';

const ThemeContext = createContext(null);

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';

  try {
    const stored = localStorage.getItem(STORAGE_THEME);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch (_) {}

  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_THEME, theme);
    } catch (_) {}
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState((prev) => (next === 'light' || next === 'dark' ? next : prev === 'light' ? 'dark' : 'light'));
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
