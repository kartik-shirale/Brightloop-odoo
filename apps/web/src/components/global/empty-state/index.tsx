import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** shadcn Empty composition: one icon, a title, one sentence, at most one action. */
export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps): React.JSX.Element {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {actionLabel && onAction && <EmptyContent><Button variant="outline" onClick={onAction}>{actionLabel}</Button></EmptyContent>}
    </Empty>
  );
}
