import { Link } from 'react-router-dom';
import { ROUTES } from '@/constants/routes';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
export default function NotFoundPage(): React.JSX.Element {
  return <main className="flex min-h-svh items-center justify-center p-6"><Empty><EmptyHeader><EmptyTitle>Page not found</EmptyTitle><EmptyDescription>This page may have moved.</EmptyDescription><Link to={ROUTES.HOME} className="mt-3 text-sm underline">Go to your workspace</Link></EmptyHeader></Empty></main>;
}
