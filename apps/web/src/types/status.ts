import type { ComponentProps } from 'react';
import type { Badge } from '@/components/ui/badge';

export interface StatusPresentation {
  label: string;
  variant: NonNullable<ComponentProps<typeof Badge>['variant']>;
}
