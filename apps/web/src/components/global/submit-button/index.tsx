import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
interface SubmitButtonProps { isLoading: boolean; children: React.ReactNode; disabled?: boolean }
export function SubmitButton({ isLoading, children, disabled }: SubmitButtonProps): React.JSX.Element {
  return <Button type="submit" size="lg" className="h-11 w-full gap-2 rounded-lg" disabled={isLoading || disabled} aria-busy={isLoading}>
    {isLoading && <Spinner />}{children}{!isLoading && <ArrowRight className="ml-auto size-4" />}</Button>;
}
