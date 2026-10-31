import { useForm } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';

import { REGEXP_ONLY_DIGITS } from 'input-otp';

import type { VerifyResetOtpResultDto } from '@brightloop/shared';

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

import { Button } from '@/components/ui/button';

import { Spinner } from '@/components/ui/spinner';

import { FormHeading } from '@/components/global/form-heading';

import { SubmitButton } from '@/components/global/submit-button';

import { useOtp } from '@/hooks/auth/use-otp';

import { otpSchema, type OtpFormValues } from '@/components/forms/otp/schema';

import { AUTH_LIMITS } from '@/constants/messages';

interface OtpFormProps { email: string; purpose: 'verify' | 'reset'; onVerified?: (result: VerifyResetOtpResultDto) => void }

const OTP_SLOTS = [0, 1, 2, 3, 4, 5] as const;

export function OtpForm({ email, purpose, onVerified }: OtpFormProps): React.JSX.Element {

  const form = useForm<OtpFormValues>({ resolver: zodResolver(otpSchema), defaultValues: { otp: '' } });

  const { verify, resend, seconds, resendCode } = useOtp({ email, purpose, onVerified, setError: form.setError });

  const isBusy = verify.isLoading || resend.isLoading;

  return <><FormHeading eyebrow="ONE SMALL STEP" title="Check your inbox." description={<>Enter the six-digit code sent to <span className="font-medium break-all text-foreground">{email}</span>. It expires in 5 minutes.</>} />

    <Form {...form}><form onSubmit={form.handleSubmit(verify.submit)} className="space-y-6" noValidate>

      <FormField control={form.control} name="otp" render={({ field }) => <FormItem>

        <FormLabel>Verification code</FormLabel><FormControl><InputOTP {...field} maxLength={AUTH_LIMITS.OTP_LENGTH}

          pattern={REGEXP_ONLY_DIGITS} autoComplete="one-time-code" inputMode="numeric" disabled={isBusy} containerClassName="w-full justify-between">

          <InputOTPGroup className="w-full justify-between gap-2">{OTP_SLOTS.map((slot) => <InputOTPSlot key={slot} index={slot} className="size-12 rounded-lg border first:rounded-lg last:rounded-lg" />)}</InputOTPGroup>

        </InputOTP></FormControl><FormMessage />

      </FormItem>} />

      <SubmitButton isLoading={verify.isLoading} disabled={resend.isLoading}>Verify code</SubmitButton>

    </form></Form>

    <div className="mt-6 flex flex-col items-center gap-1 text-sm text-muted-foreground"><p>Didn’t receive a code? Check your spam folder.</p>

      <Button type="button" variant="link" disabled={isBusy || seconds > 0} onClick={resendCode} aria-busy={resend.isLoading}>

        {resend.isLoading && <Spinner />}{seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'}</Button>

    </div></>;

}
