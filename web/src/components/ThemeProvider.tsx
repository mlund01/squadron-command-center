import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'defcon5' | 'system';
type ResolvedTheme = 'light' | 'dark' | 'defcon5';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: ResolvedTheme;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const validThemes: Theme[] = ['light', 'dark', 'defcon5', 'system'];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme');
    return validThemes.includes(stored as Theme) ? (stored as Theme) : 'system';
  });

  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'defcon5');
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else if (resolvedTheme === 'defcon5') {
      root.classList.add('dark', 'defcon5');
    }
  }, [resolvedTheme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem('theme', t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
