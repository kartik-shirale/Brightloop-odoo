import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
export default function ForbiddenPage():React.JSX.Element{return <main className="flex min-h-screen flex-col items-center justify-center gap-5"><ShieldAlert className="size-12 text-muted-foreground"/><h1 className="text-3xl font-semibold">Access restricted</h1><p className="text-muted-foreground">Your role does not have access to this area.</p><Link to="/"><Button>Return to your workspace</Button></Link></main>;}
