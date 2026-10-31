import { NavLink,Outlet } from 'react-router-dom';
import { Layers,LogOut } from 'lucide-react';
import { PORTAL_NAVIGATION } from '@/constants/navigation';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/hooks/auth/use-logout';
export function PortalLayout():React.JSX.Element {const {logout,isLoading}=useLogout();return <div className="min-h-screen bg-muted/20"><header className="border-b bg-background"><div className="mx-auto flex max-w-7xl flex-wrap items-center gap-6 px-6 py-5"><NavLink to="/portal" className="flex items-center gap-2 text-xl font-semibold"><Layers/>Brightloop</NavLink><nav className="flex flex-1 flex-wrap gap-5">{PORTAL_NAVIGATION.map(item=><NavLink key={item.href} to={item.href} end className={({isActive})=>`text-sm ${isActive?'font-semibold text-primary':'text-muted-foreground'}`}>{item.label}</NavLink>)}<NavLink className="text-sm text-muted-foreground" to="/portal/security">Security</NavLink></nav><Button variant="outline" onClick={logout} disabled={isLoading}><LogOut/>Sign out</Button></div></header><main className="mx-auto max-w-7xl p-6 md:p-10"><Outlet/></main></div>;}
