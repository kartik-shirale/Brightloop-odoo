import { test, expect, type Page } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { AuthResult, RoleDto } from '@brightloop/shared';
loadEnvFile(fileURLToPath(new URL('../../core/.env', import.meta.url)));

const session: AuthResult = { accessToken: 'test-token', accessTokenExpiresIn: 900,
  refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(), user: { id: 42, name: 'Alice', username: 'alice',
    email: 'alice@example.com', role: 'CUSTOMER', isActive: true, emailVerifiedAt: new Date().toISOString(), passwordChangedAt: null,
    lastLoginAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
async function mockApi(page: Page, role: RoleDto = 'CUSTOMER'): Promise<{ resets: Record<string, string>[]; refreshes: () => number }> {
  const authSession = { ...session, user: { ...session.user, role } };
  const resets: Record<string, string>[] = [];
  let signedIn = false;
  let refreshCount = 0;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postData() ? route.request().postDataJSON() as Record<string, string> : {};
    let data: unknown = {};
    let status = 200;
    if (path.endsWith('/refresh')) { refreshCount++; status = signedIn ? 200 : 401; data = { ...authSession, accessToken: 'refreshed-token' }; }
    else if (path.endsWith('/register')) { status = 201; data = { email: 'alice@example.com', expiresInSeconds: 300 }; }
    else if (path.endsWith('/verify-reset-otp')) { status = body.otp === '123456' ? 200 : 400; data = { resetToken: 'a'.repeat(96), expiresInSeconds: 300 }; }
    else if (path.endsWith('/verify-otp') || path.endsWith('/login')) {
      status = !body.otp || body.otp === '123456' ? 200 : 400;
      signedIn = status === 200;
      data = authSession;
    } else if (path.endsWith('/reset-password')) { resets.push(body); }
    else if (path.endsWith('/logout')) { signedIn = false; }
    else if (path.endsWith('/me')) { data = authSession.user; }
    else data = { expiresInSeconds: 300 };
    await route.fulfill({ status, json: status >= 400 ? { success: false, message: 'Invalid or expired code', error: { code: 'BAD_REQUEST' } } : { success: true, message: 'Success', data } });
  });
  return { resets, refreshes: () => refreshCount };
}

test('login validation, navigation and responsive cover', async ({ page }) => {
  await mockApi(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/login-clean.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  await expect(page.getByText('Enter your password', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('complementary')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/login-mobile.png', fullPage: true });
});

test('signup, wrong OTP, countdown, verification and dashboard', async ({ page }) => {
  await mockApi(page);
  await page.goto('/signup');
  await page.getByLabel('Username', { exact: true }).fill('alice');
  await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  await page.getByLabel('Confirm password', { exact: true }).fill('Password123!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/verify-otp/);
  await expect(page.getByRole('button', { name: /Resend code in/ })).toBeDisabled();
  await page.getByLabel('Verification code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByText('Invalid or expired code', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify code', exact: true })).toBeEnabled();
  await page.getByLabel('Verification code', { exact: true }).clear();
  await page.getByLabel('Verification code', { exact: true }).fill('123456');
  await expect(page.getByLabel('Verification code', { exact: true })).toHaveValue('123456');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page).toHaveURL(/portal/);
  await expect(page.getByRole('heading', { name: 'Welcome, Alice.' })).toBeVisible();
});

test('forgot password verifies OTP before accepting a new password', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
  await page.getByRole('button', { name: 'Send reset code', exact: true }).click();
  await page.getByLabel('Verification code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password.' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('Changed123!');
  await page.getByLabel('Confirm new password', { exact: true }).fill('Different123!');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByText('Passwords do not match', { exact: true })).toBeVisible();
  await page.getByLabel('Confirm new password', { exact: true }).fill('Changed123!');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page).toHaveURL(/login/);
  expect(api.resets).toHaveLength(1);
  expect(api.resets[0].resetToken).toBe('a'.repeat(96));
  await expect(page.getByText('Password changed successfully', { exact: true })).toBeVisible();
});

test('real admin login, cookie restoration and logout against PostgreSQL and Docker Redis', async ({ page }) => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Admin test requires the configured seed credentials');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/login/);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole('heading', { name: 'Welcome, Admin.' })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.name === 'odoo_refresh_token' && cookie.httpOnly)).toBe(true);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome, Admin.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/login/);
  expect(pageErrors).toEqual([]);
});

test('concurrent protected requests share one refresh and failed refresh clears the session', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/portal/);
  await page.route('**/api/v1/users/me', async (route) => {
    const authorized = route.request().headers().authorization === 'Bearer refreshed-token';
    await route.fulfill({ status: authorized ? 200 : 401, json: authorized ?
      { success: true, message: 'OK', data: session.user } : { success: false, message: 'Expired', error: { code: 'AUTH_REQUIRED' } } });
  });
  const names = await page.evaluate(async () => {
    const path = '/src/api/auth/index.ts';
    const { authApi } = await import(path);
    const users = await Promise.all([authApi.me(), authApi.me(), authApi.me()]);
    return users.map((user: { name: string }) => user.name);
  });
  expect(names).toEqual(['Alice', 'Alice', 'Alice']);
  expect(api.refreshes()).toBe(2);
  await page.route('**/api/v1/auth/refresh', async (route) => route.fulfill({ status: 401,
    json: { success: false, message: 'Session revoked', error: { code: 'SESSION_REVOKED' } } }));
  await page.route('**/api/v1/users/me', async (route) => route.fulfill({ status: 401,
    json: { success: false, message: 'Expired', error: { code: 'AUTH_REQUIRED' } } }));
  await page.evaluate(async () => {
    const path = '/src/api/auth/index.ts';
    const { authApi } = await import(path);
    try { await authApi.me(); } catch { /* A failed refresh is expected. */ }
  });
  await expect(page).toHaveURL(/login/);
});

test('customers cannot enter staff dashboard and land at their portal', async ({ page }) => {
  await mockApi(page);
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('alice@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/portal/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/portal/);
  await expect(page.getByText('Customer portal', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Brightloop', exact: true })).toBeVisible();
});

test('staff land at the internal dashboard and cannot enter the customer portal', async ({ page }) => {
  await mockApi(page, 'STAFF');
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('staff@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto('/portal');
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole('heading', { name: 'Welcome, Alice.' })).toBeVisible();
});
