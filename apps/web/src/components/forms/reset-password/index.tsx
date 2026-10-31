import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form } from '@/components/ui/form';
import { FormHeading } from '@/components/global/form-heading';
import { TextFormField } from '@/components/global/text-form-field';
import { SubmitButton } from '@/components/global/submit-button';
import { useResetPassword } from '@/hooks/auth/use-reset-password';
import { resetPasswordSchema, type ResetPasswordFormValues } from '@/components/forms/reset-password/schema';
interface ResetPasswordFormProps { email: string; resetToken: string }
export function ResetPasswordForm({ email, resetToken }: ResetPasswordFormProps): React.JSX.Element {
  const form = useForm<ResetPasswordFormValues>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: '', confirmPassword: '' } });
  const { submit, isLoading } = useResetPassword(email, resetToken, form.setError);
  return <><FormHeading title="Choose a new password" description="Use at least 9 characters with uppercase, lowercase, and a special character. Your other sessions will be signed out." />
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" noValidate>
      <TextFormField control={form.control} name="password" label="New password" type="password" autoComplete="new-password" disabled={isLoading} />
      <TextFormField control={form.control} name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" disabled={isLoading} />
      <SubmitButton isLoading={isLoading}>Reset password</SubmitButton>
    </form></Form></>;
}
