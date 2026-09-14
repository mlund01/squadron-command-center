import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ThemeContext } from '@/components/theme';
import type { Theme } from '@/components/theme';

function initialTheme(): Theme {
  const stored = window.localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  function setTheme(nextTheme: Theme) {
    setThemeState(nextTheme);
    window.localStorage.setItem('theme', nextTheme);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
