import { API_ROUTES, type ApiResponse, type AuthResult, type LoginDto, type RegisterDto,
  type RegisterResultDto, type OtpResultDto, type ResendOtpDto, type VerifyOtpDto, type ForgotPasswordDto,
  type ResetPasswordDto, type UserDto, type VerifyResetOtpResultDto } from '@brightloop/shared';
import { client, waitForSessionRefresh } from '@/api/client';

async function post<T>(path: string, payload: unknown): Promise<T> {
  const { data } = await client.post<ApiResponse<T>>(path, payload);
  if (data.data === undefined) throw new Error('The server returned an incomplete response');
  return data.data;
}
export const authApi = {
  login: (payload: LoginDto): Promise<AuthResult> => post(API_ROUTES.auth.login, payload),
  signup: (payload: RegisterDto): Promise<RegisterResultDto> => post(API_ROUTES.auth.register, payload),
  verifyOtp: (payload: VerifyOtpDto): Promise<AuthResult> => post(API_ROUTES.auth.verifyOtp, payload),
  resendOtp: (payload: ResendOtpDto): Promise<OtpResultDto> => post(API_ROUTES.auth.resendOtp, payload),
  forgotPassword: (payload: ForgotPasswordDto): Promise<OtpResultDto> => post(API_ROUTES.auth.forgotPassword, payload),
  verifyResetOtp: (payload: VerifyOtpDto): Promise<VerifyResetOtpResultDto> => post(API_ROUTES.auth.verifyResetOtp, payload),
  resetPassword: async (payload: ResetPasswordDto): Promise<void> => { await client.post(API_ROUTES.auth.resetPassword, payload); },
  logout: async (): Promise<void> => { await waitForSessionRefresh(); await client.post(API_ROUTES.auth.logout, {}); },
  me: async (signal?: AbortSignal): Promise<UserDto> => {
    const { data } = await client.get<ApiResponse<UserDto>>(API_ROUTES.users.me, { signal });
    if (!data.data) throw new Error('Missing user profile');
    return data.data;
  },
};
