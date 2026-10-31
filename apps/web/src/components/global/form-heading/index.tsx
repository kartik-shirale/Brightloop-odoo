import type { ReactNode } from 'react';
interface FormHeadingProps { title: string; description: ReactNode }
export function FormHeading({ title, description }: FormHeadingProps): React.JSX.Element {
  return <header className="mb-6 flex flex-col gap-1"><h1 className="text-xl font-medium">{title}</h1>
    <p className="text-sm text-muted-foreground">{description}</p></header>;
}
