import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/ThemeProvider';

function Defcon5Icon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 257" fill="currentColor" className={className}>
      <path d="M1.06369 255.775L109.564 1.27494L218.064 255.775L109.564 190.775L1.06369 255.775Z" />
    </svg>
  );
}

const cycle = { light: 'dark', dark: 'defcon5', defcon5: 'system', system: 'light' } as const;
const icons = { light: Sun, dark: Moon, defcon5: Defcon5Icon, system: Monitor } as const;
const labels = { light: 'Light', dark: 'Dark', defcon5: 'DEFCON 5', system: 'System' } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = icons[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 defcon5:text-green-400 defcon5:hover:text-green-300 defcon5:hover:bg-green-900/30"
      onClick={() => setTheme(cycle[theme])}
      title={`Theme: ${labels[theme]}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
