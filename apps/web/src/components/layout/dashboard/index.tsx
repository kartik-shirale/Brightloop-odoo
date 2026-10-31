import { AppShell } from '@/components/global/app-shell';
import { STAFF_ACCOUNT_LINKS, STAFF_NAVIGATION } from '@/constants/navigation';
import { ROUTES } from '@/constants/routes';

export function DashboardLayout(): React.JSX.Element {
  return <AppShell home={ROUTES.DASHBOARD} groups={STAFF_NAVIGATION} accountLinks={STAFF_ACCOUNT_LINKS} />;
}
