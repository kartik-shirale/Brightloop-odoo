import type { ReactNode } from 'react';
interface FormHeadingProps { eyebrow: string; title: string; description: ReactNode }
export function FormHeading({ eyebrow, title, description }: FormHeadingProps): React.JSX.Element {
  return <header className="mb-8 space-y-3"><p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">{eyebrow}</p>
    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
    <p className="text-sm leading-6 text-muted-foreground">{description}</p></header>;
}
