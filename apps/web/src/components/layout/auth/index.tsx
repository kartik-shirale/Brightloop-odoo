import { APP_NAME, APP_DESCRIPTION } from '@/constants/app';
import { getHomeRoute } from '@/constants/roles';
import { GalleryVerticalEnd, LockKeyhole } from 'lucide-react';

import { Navigate, Outlet } from 'react-router-dom';

import { ErrorBoundary } from 'react-error-boundary';

import { Badge } from '@/components/ui/badge';

import { ErrorFallback } from '@/components/global/error-fallback';

import { PageLoading } from '@/components/global/page-loading';

import { SessionError } from '@/components/global/session-error';

import { useAuth } from '@/hooks/auth/use-auth';

import { CONFIG } from '@/constants/config';

import { ROUTES } from '@/constants/routes';

export function AuthLayout(): React.JSX.Element {

  const { isLoading, isAuthenticated, error, role } = useAuth();

  if (isLoading) return <PageLoading />;

  if (isAuthenticated) return <Navigate to={role ? getHomeRoute(role) : ROUTES.LOGIN} replace />;

  return <main className="grid min-h-svh bg-background lg:grid-cols-2">

    <section className="flex flex-col px-6 py-7 sm:px-12 sm:py-10 lg:px-16">

      <a href={ROUTES.LOGIN} className="flex w-fit items-center gap-2.5 text-xl font-semibold tracking-tight" aria-label={`${APP_NAME} sign in`}>

        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><GalleryVerticalEnd className="size-5" /></span>{APP_NAME}<span className="ml-2 hidden border-l pl-4 text-xs font-normal tracking-normal text-muted-foreground sm:block">{APP_DESCRIPTION}</span>

      </a>

      <div className="flex flex-1 items-center justify-center py-12 sm:py-16"><div className="w-full max-w-sm">

        {error && <SessionError />}<ErrorBoundary FallbackComponent={ErrorFallback}><Outlet /></ErrorBoundary>

      </div></div>

      <footer className="flex items-center justify-between text-xs text-muted-foreground"><span>© {new Date().getFullYear()} {APP_NAME}</span><span className="inline-flex items-center gap-1.5"><LockKeyhole className="size-3" />A secure place to begin</span></footer>

    </section>

    <aside className="relative m-3 ml-0 hidden overflow-hidden rounded-2xl bg-muted lg:block" aria-label="A quiet mountain lake">

      <img src={CONFIG.COVER_IMAGE} alt="Alpine mountains reflected in a calm lake, surrounded by trees" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" />

      <div className="absolute inset-0 bg-linear-to-t from-background/90 via-background/10 to-transparent" />

      <Badge variant="secondary" className="absolute top-8 left-8 gap-2 border border-border/50 bg-background/85 px-3 py-1.5"><span className="size-1.5 rounded-full bg-primary" />Space for your best work</Badge>

      <div className="absolute right-10 bottom-12 left-10 xl:right-14 xl:left-14"><p className="mb-5 text-xs font-medium tracking-[0.2em] text-foreground/70 uppercase">A clearer way forward</p>

        <h2 className="max-w-lg text-4xl leading-tight font-medium tracking-tight text-foreground xl:text-5xl">Subscriptions.<br />Simply connected.</h2>

        <p className="mt-5 max-w-sm text-sm leading-6 text-foreground/75">One place for your plans, subscriptions, and recurring billing. Welcome to Brightloop.</p>

      </div>

    </aside>

  </main>;

}
