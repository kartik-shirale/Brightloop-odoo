import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/global/empty-state';
import { ROUTES } from '@/constants/routes';
export default function ForbiddenPage():React.JSX.Element{const navigate=useNavigate();return <main className="flex min-h-svh items-center justify-center p-4"><EmptyState icon={ShieldAlert} title="Access restricted" description="Your role does not have access to this page." actionLabel="Go to your home page" onAction={()=>navigate(ROUTES.HOME)}/></main>;}
