import { useForm } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';

import { Link } from 'react-router-dom';

import { Form } from '@/components/ui/form';

import { FormHeading } from '@/components/global/form-heading';

import { SubmitButton } from '@/components/global/submit-button';

import { TextFormField } from '@/components/global/text-form-field';

import { useLogin } from '@/hooks/auth/use-login';

import { loginSchema, type LoginFormValues } from '@/components/forms/login/schema';

import { ROUTES } from '@/constants/routes';

export function LoginForm(): React.JSX.Element {

  const form = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const { submit, isLoading } = useLogin(form.setError);

  return <><FormHeading eyebrow="YOUR WORKSPACE AWAITS" title="Welcome back." description="A familiar place to pick up where you left off." />

    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" noValidate>

      <TextFormField control={form.control} name="email" label="Email address" type="email" autoComplete="email" placeholder="you@company.com" disabled={isLoading} />

      <TextFormField control={form.control} name="password" label="Password" type="password" autoComplete="current-password" placeholder="Enter your password" disabled={isLoading} />

      <div className="flex justify-end"><Link to={ROUTES.FORGOT_PASSWORD} className="text-sm underline-offset-4 hover:underline">Forgot password?</Link></div>

      <SubmitButton isLoading={isLoading}>Sign in</SubmitButton>

    </form></Form>

    <p className="mt-7 text-center text-sm text-muted-foreground">Don’t have an account? <Link className="font-medium text-foreground underline underline-offset-4" to={ROUTES.SIGNUP}>Sign up</Link></p></>;

}
