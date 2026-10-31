import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/common/use-theme';

export function ModeToggle(): React.JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`}>
      {resolvedTheme === 'dark' ? <Sun className="text-muted-foreground" /> : <Moon className="text-muted-foreground" />}
    </Button>
  );
}
