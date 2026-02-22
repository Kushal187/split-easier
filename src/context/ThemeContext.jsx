import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_THEME = 'splitWiserTheme';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    return (localStorage.getItem(STORAGE_THEME) || 'dark');
  });

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
