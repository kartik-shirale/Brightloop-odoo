import { CheckCircle2, LayoutDashboard, ShieldCheck } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { Badge } from '@/components/ui/badge';

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

import { RoleGuard } from '@/components/global/role-guard';

import { useAuth } from '@/hooks/auth/use-auth';

import { Role } from '@/constants/roles';

const TEAM_ROLES = [Role.ADMIN, Role.STAFF] as const;

export function DashboardWelcome(): React.JSX.Element {

  const { user, hasRole } = useAuth();

  return <div className="space-y-8"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">YOUR OVERVIEW</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Welcome, {user?.name}.</h1><p className="mt-3 text-muted-foreground">You’re signed in. Make yourself at home.</p></div><Badge variant="outline" className="gap-2 bg-background px-3 py-2"><CheckCircle2 className="size-4" />Email verified</Badge></div>

    <div className="grid gap-5 md:grid-cols-2"><Card className="p-2"><CardHeader><ShieldCheck className="mb-3 size-5" /><CardTitle>Your account</CardTitle><CardDescription>Your workspace identity, all in one place.</CardDescription></CardHeader><CardContent className="space-y-4 pt-4"><div><p className="text-xs text-muted-foreground">Email address</p><p className="mt-1 break-all font-medium">{user?.email}</p></div><div><p className="text-xs text-muted-foreground">Access level</p><p className="mt-1 font-medium capitalize">{user?.role.toLowerCase()}</p></div></CardContent></Card>

      <Card className="p-2"><Empty><EmptyHeader><LayoutDashboard className="mx-auto mb-3 size-6 text-muted-foreground" /><EmptyTitle>A fresh workspace</EmptyTitle><EmptyDescription>Your workspace is ready. New activity will appear here when you get started.</EmptyDescription></EmptyHeader></Empty></Card></div>

    {hasRole(...TEAM_ROLES) && <RoleGuard roles={TEAM_ROLES}><Card><CardHeader><CardTitle>Team workspace</CardTitle><CardDescription>Your account has {user?.role.toLowerCase()} access. Team tools will appear here as they’re added.</CardDescription></CardHeader></Card></RoleGuard>}

  </div>;

}
