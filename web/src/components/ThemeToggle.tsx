import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/ThemeProvider';

const cycle = { light: 'dark', dark: 'system', system: 'light' } as const;
const icons = { light: Sun, dark: Moon, system: Monitor } as const;
const labels = { light: 'Light', dark: 'Dark', system: 'System' } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = icons[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => setTheme(cycle[theme])}
      title={`Theme: ${labels[theme]}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
