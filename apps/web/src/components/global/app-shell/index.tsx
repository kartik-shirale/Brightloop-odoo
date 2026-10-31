import { Outlet, useLocation } from 'react-router-dom';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { AppSidebar } from '@/components/global/app-sidebar';
import { flattenNavigation, type NavGroup, type NavLinkItem } from '@/constants/navigation';

interface AppShellProps { home: string; groups: readonly NavGroup[]; accountLinks: readonly NavLinkItem[] }

/** Sidebar + slim top bar + centred content column, shared by the staff app and the portal. */
export function AppShell({ home, groups, accountLinks }: AppShellProps): React.JSX.Element {
  const { pathname } = useLocation();
  const title = [...flattenNavigation(groups), ...accountLinks]
    .filter(link => pathname === link.href || (link.href !== home && pathname.startsWith(`${link.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label;
  return (
    <SidebarProvider>
      <AppSidebar home={home} groups={groups} accountLinks={accountLinks} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="text-muted-foreground" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground">{title ?? 'Overview'}</span>
        </header>
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
