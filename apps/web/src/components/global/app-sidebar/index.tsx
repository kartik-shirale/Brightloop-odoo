import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, ChevronsUpDown, Layers, LogOut } from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ModeToggle } from '@/components/global/mode-toggle';
import { useAuth } from '@/hooks/auth/use-auth';
import { useLogout } from '@/hooks/auth/use-logout';
import { APP_NAME } from '@/constants/app';
import type { NavGroup, NavItem, NavLinkItem } from '@/constants/navigation';

interface AppSidebarProps { home: string; groups: readonly NavGroup[]; accountLinks: readonly NavLinkItem[] }

function isActivePath(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

interface NavEntryProps { item: NavItem; pathname: string; home: string }

function NavEntry({ item, pathname, home }: NavEntryProps): React.JSX.Element {
  const { state } = useSidebar();
  const Icon = item.icon;
  const exact = item.href === home;
  const children = item.children ?? [];
  const childActive = children.some(child => isActivePath(pathname, child.href, false));

  // Collapsed to icons, a submenu cannot open, so the icon links to the section's first page.
  if (children.length === 0 || state === 'collapsed') {
    const active = isActivePath(pathname, item.href, exact) || childActive;
    return (
      <SidebarMenuItem>
        <SidebarMenuButton isActive={active} tooltip={item.label} className="data-active:font-medium" render={<NavLink to={item.href} end={exact} />}>
          <Icon className="text-muted-foreground" /><span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  return (
    <Collapsible defaultOpen={childActive} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger render={<SidebarMenuButton tooltip={item.label} />}>
          <Icon className="text-muted-foreground" /><span>{item.label}</span>
          <ChevronRight className="ml-auto text-muted-foreground transition-transform group-data-open/collapsible:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {children.map(child => (
              <SidebarMenuSubItem key={child.href}>
                <SidebarMenuSubButton isActive={isActivePath(pathname, child.href, false)} className="data-active:font-medium" render={<NavLink to={child.href} />}>
                  <span>{child.label}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function AppSidebar({ home, groups, accountLinks }: AppSidebarProps): React.JSX.Element {
  const { user, hasRole } = useAuth();
  const { logout, isLoading } = useLogout();
  const { pathname } = useLocation();
  const visible = groups
    .map(group => ({ ...group, items: group.items.filter(item => hasRole(...item.allowedRoles)) }))
    .filter(group => group.items.length > 0);
  const links = accountLinks.filter(link => hasRole(...link.allowedRoles));
  const initials = (user?.name ?? '?').slice(0, 2).toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={APP_NAME} render={<Link to={home} />}>
              <Layers className="text-muted-foreground" /><span className="font-medium">{APP_NAME}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {visible.map(group => (
          <SidebarGroup key={group.label ?? 'main'}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarMenu>{group.items.map(item => <NavEntry key={item.href} item={item} pathname={pathname} home={home} />)}</SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={user?.name ?? 'Account'} className="flex-1" />}>
                <Avatar className="size-6"><AvatarFallback className="text-xs">{initials}</AvatarFallback></Avatar>
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="truncate text-sm">{user?.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                </span>
                <ChevronsUpDown className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Signed in as {user?.role.toLowerCase()}</DropdownMenuLabel>
                  {links.map(link => <DropdownMenuItem key={link.href} render={<Link to={link.href} />}>{link.label}</DropdownMenuItem>)}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={isLoading} onClick={logout}><LogOut className="text-muted-foreground" />Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ModeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
