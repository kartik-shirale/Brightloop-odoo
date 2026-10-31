import { AppShell } from '@/components/global/app-shell';
import { PORTAL_ACCOUNT_LINKS, PORTAL_NAVIGATION } from '@/constants/navigation';
import { ROUTES } from '@/constants/routes';

export function PortalLayout(): React.JSX.Element {
  return <AppShell home={ROUTES.PORTAL} groups={PORTAL_NAVIGATION} accountLinks={PORTAL_ACCOUNT_LINKS} />;
}
