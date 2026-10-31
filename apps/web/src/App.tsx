import { RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { ToastContainer } from 'react-toastify';
import { AuthProvider } from '@/context/auth-context';
import { ErrorFallback } from '@/components/global/error-fallback';
import { useTheme } from '@/hooks/common/use-theme';
import { router } from '@/router';
export function App():React.JSX.Element {const {resolvedTheme}=useTheme();return <ErrorBoundary FallbackComponent={ErrorFallback}><AuthProvider><RouterProvider router={router}/><ToastContainer position="top-right" autoClose={4000} closeOnClick theme={resolvedTheme}/></AuthProvider></ErrorBoundary>;}
