import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
interface SubmitButtonProps { isLoading: boolean; children: React.ReactNode; disabled?: boolean }
/** Full-width form submit; the inline spinner marks a pending submit, not a page load. */
export function SubmitButton({ isLoading, children, disabled }: SubmitButtonProps): React.JSX.Element {
  return <Button type="submit" size="lg" className="w-full" disabled={isLoading || disabled} aria-busy={isLoading}>
    {isLoading && <Spinner />}{children}</Button>;
}
