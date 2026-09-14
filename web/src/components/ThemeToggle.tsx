import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <Button
      aria-label={dark ? 'Use light theme' : 'Use DEFCON 5 theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      size="icon-sm"
      title={dark ? 'Light theme' : 'DEFCON 5 theme'}
      type="button"
      variant="outline"
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
