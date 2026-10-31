import { Link } from 'react-router-dom';
import { display, summarize } from '@/lib/display';
import { RELATED_RECORD_ROUTES } from '@/constants/routes';

interface DetailValueProps {
  name: string;
  value: unknown;
  /** Link nested records to their staff pages; off in the portal, where those pages do not exist. */
  linkRecords: boolean;
}

/** One value in a record's details grid. Nested records show their name and one helpful detail. */
export function DetailValue({ name, value, linkRecords }: DetailValueProps): React.JSX.Element {
  if (typeof value !== 'object' || value === null) return <span>{display(value, name)}</span>;
  const summary = summarize(value);
  const route = RELATED_RECORD_ROUTES[name];
  const label = linkRecords && route && summary.id !== undefined
    ? <Link to={route(summary.id)} className="hover:underline">{summary.label}</Link>
    : <span>{summary.label}</span>;
  return <span>{label}{summary.detail && <span className="text-muted-foreground"> · {summary.detail}</span>}</span>;
}
