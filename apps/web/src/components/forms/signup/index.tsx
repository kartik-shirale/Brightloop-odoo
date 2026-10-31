import { useForm } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';

import { Link } from 'react-router-dom';

import { Form } from '@/components/ui/form';

import { FormHeading } from '@/components/global/form-heading';

import { SubmitButton } from '@/components/global/submit-button';

import { TextFormField } from '@/components/global/text-form-field';

import { useSignup } from '@/hooks/auth/use-signup';

import { signupSchema, type SignupFormValues } from '@/components/forms/signup/schema';

import { ROUTES } from '@/constants/routes';

export function SignupForm(): React.JSX.Element {

  const form = useForm<SignupFormValues>({ resolver: zodResolver(signupSchema), defaultValues: { username: '', email: '', password: '', confirmPassword: '' } });

  const { submit, isLoading } = useSignup(form.setError);

  return <><FormHeading title="Create an account" description="We will email you a code to verify your address." />

    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>

      <TextFormField control={form.control} name="username" label="Username" autoComplete="username" placeholder="Choose your username" disabled={isLoading} />

      <TextFormField control={form.control} name="email" label="Email address" type="email" autoComplete="email" placeholder="you@company.com" disabled={isLoading} />

      <TextFormField control={form.control} name="password" label="Password" type="password" autoComplete="new-password" placeholder="At least 9 characters, uppercase, lowercase and a symbol" disabled={isLoading} />

      <TextFormField control={form.control} name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" placeholder="Enter your password again" disabled={isLoading} />

      <SubmitButton isLoading={isLoading}>Create account</SubmitButton>

    </form></Form>

    <p className="mt-7 text-center text-sm text-muted-foreground">Already have an account? <Link className="font-medium text-foreground underline underline-offset-4" to={ROUTES.LOGIN}>Sign in</Link></p></>;

}
