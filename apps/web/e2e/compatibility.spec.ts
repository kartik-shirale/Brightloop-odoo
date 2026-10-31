import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthResult, RoleDto } from '@brightloop/shared';

const origin = 'http://brightloop.test';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

for (const role of ['ADMIN', 'STAFF', 'CUSTOMER'] as const) {
  test(`Brightloop ${role} home and cross-role guard work without dev servers`, async ({ page }) => {
    let signedIn = false;
    const home = role === 'CUSTOMER' ? '/portal' : '/dashboard';
    const denied = role === 'CUSTOMER' ? '/dashboard' : '/portal';
    const session: AuthResult = { accessToken: 'test-token', accessTokenExpiresIn: 900,
      refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(), user: {
        id: 1, name: 'Compatibility Test', username: 'compatibility', email: 'test@example.com', role: role as RoleDto,
        isActive: true, emailVerifiedAt: new Date().toISOString(), passwordChangedAt: null, lastLoginAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      } };
    await page.route('https://images.unsplash.com/**', async (route) => route.abort());
    await page.route(`${origin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/')) {
        if (path.endsWith('/login')) signedIn = true;
        const allowed = signedIn;
        await route.fulfill({ status: allowed ? 200 : 401, json: allowed ?
          { success: true, message: 'Signed in', data: session } :
          { success: false, message: 'No session', error: { code: 'AUTH_REQUIRED' } } });
        return;
      }
      const file = path.startsWith('/assets/') || path === '/favicon.svg' ? resolve(dist, `.${path}`) : resolve(dist, 'index.html');
      if (!file.startsWith(resolve(dist) + sep)) throw new Error('Unexpected artifact path');
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/login`);
    await expect(page).toHaveTitle('Brightloop — Subscription Management');
    await expect(page.getByRole('link', { name: 'Brightloop sign in' })).toBeVisible();
    await page.getByLabel('Email address', { exact: true }).fill('test@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Password123!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(`${origin}${home}`);
    await page.goto(`${origin}${denied}`);
    await expect(page).toHaveURL(`${origin}${home}`);
    await page.goto(`${origin}/`);
    await expect(page).toHaveURL(`${origin}${home}`);
    expect(errors).toEqual([]);
  });
}
