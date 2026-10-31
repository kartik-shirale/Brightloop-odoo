import type { ReactNode } from 'react';

interface PageHeaderProps { title: string; description?: string; actions?: ReactNode }

/** Page title (20px, 500), an optional one-line description, actions on the same row. */
export function PageHeader({ title, description, actions }: PageHeaderProps): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-medium">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
