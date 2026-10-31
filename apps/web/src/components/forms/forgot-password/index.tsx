import { useForm } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';

import { Form } from '@/components/ui/form';

import { FormHeading } from '@/components/global/form-heading';

import { TextFormField } from '@/components/global/text-form-field';

import { SubmitButton } from '@/components/global/submit-button';

import { useForgotPassword } from '@/hooks/auth/use-forgot-password';

import { forgotPasswordSchema, type ForgotPasswordFormValues } from '@/components/forms/forgot-password/schema';

interface ForgotPasswordFormProps { onSent: (email: string) => void }

export function ForgotPasswordForm({ onSent }: ForgotPasswordFormProps): React.JSX.Element {

  const form = useForm<ForgotPasswordFormValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const { submit, isLoading } = useForgotPassword(onSent, form.setError);

  return <><FormHeading eyebrow="LET’S GET YOU BACK IN" title="Forgot your password?" description="It happens. Enter your email and we’ll send you a reset code." />

    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-6" noValidate>

      <TextFormField control={form.control} name="email" label="Email address" type="email" autoComplete="email" placeholder="you@company.com" disabled={isLoading} />

      <SubmitButton isLoading={isLoading}>Send reset code</SubmitButton>

    </form></Form></>;

}
