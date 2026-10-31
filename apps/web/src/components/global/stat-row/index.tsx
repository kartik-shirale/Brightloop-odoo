import type { ReactNode } from 'react';

export interface Stat { label: string; value: ReactNode; meta?: string }

interface StatRowProps { stats: readonly Stat[] }

/** KPIs in one bordered container split by dividers, no card per metric. */
export function StatRow({ stats }: StatRowProps): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 divide-border rounded-md border lg:flex lg:divide-x">
      {stats.map(stat => (
        <div key={stat.label} className="flex flex-1 flex-col gap-1 p-4">
          <dt className="text-xs text-muted-foreground">{stat.label}</dt>
          <dd className="text-xl font-medium tabular-nums">{stat.value}</dd>
          {stat.meta && <dd className="text-xs text-muted-foreground">{stat.meta}</dd>}
        </div>
      ))}
    </dl>
  );
}
