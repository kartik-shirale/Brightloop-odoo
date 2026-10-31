import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import * as shared from '../dist/index.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const schema = read('../../apps/core/src/prisma/contract.prisma');
const backendPlan = read('../../docs/plan/backend.md');
const endpointSource = read('../src/types/endpoints.ts');
const registered = new Set([...endpointSource.matchAll(/^\s*'(GET|POST|PUT|PATCH|DELETE) ([^']+)':/gm)].map((match) => `${match[1]} ${match[2]}`));

test('every schema enum is exported with exactly the same keys and values', () => {
  const enums = [...schema.matchAll(/enum\s+(\w+)\s*\{([^}]+)\}/g)];
  assert.ok(enums.length > 0);
  for (const [, name, body] of enums) {
    const values = body.split('\n').map((line) => line.replace(/\/\/.*$/, '').trim()).filter(Boolean).map((line) => line.split(/\s+/)[0]);
    assert.deepEqual(shared[name], Object.fromEntries(values.map((value) => [value, value])), name);
  }
});

test('all endpoint cards in the backend plan have a shared contract', () => {
  let checked = 0;
  for (const section of backendPlan.split(/(?=^### M\d+\.)/m).slice(1)) {
    const prefix = section.match(/(?:Path|Prefix) `([^`]+)`/)?.[1];
    assert.ok(prefix, 'Each module must have an API prefix');
    for (const [, method, relative] of section.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)`/gm)) {
      const path = relative === '/me' ? '/api/v1/me'
        : relative.startsWith('/portal/') ? `/api/v1${relative}`
        : `${prefix}${relative === '/' ? '' : relative}`;
      assert.ok(registered.has(`${method} ${path}`), `Missing planned contract: ${method} ${path}`);
      checked++;
    }
    // Reports use a GET-only table without a method column.
    if (prefix === '/api/v1/reports') {
      for (const [, path] of section.matchAll(/^\| `(\/[^`]+)` \|/gm)) {
        assert.ok(registered.has(`GET ${prefix}${path}`), `Missing report: ${path}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 90, `Unexpectedly low plan coverage: ${checked}`);
  assert.ok(registered.has('GET /api/v1/audit-logs'));
});

test('all declared planned domain error codes are exported', () => {
  const errorsSection = backendPlan.split('### 3.3 Envelopes and domain error codes')[1].split('### 3.4')[0];
  for (const [, code] of errorsSection.matchAll(/^\| `([A-Z_]+)` \|/gm)) {
    assert.equal(shared.DOMAIN_ERROR_CODES[code], code);
  }
  for (const code of ['NOTHING_TO_BILL', 'ALREADY_BILLED']) assert.equal(shared.DOMAIN_ERROR_CODES[code], code);
});

test('shared source imports stay inside shared and do not depend on server/browser libraries', () => {
  const directory = new URL('../src/types/', import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.ts'))) {
    const source = read(`../src/types/${file}`);
    for (const [, dependency] of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      assert.match(dependency, /^\.\/[^/]+\.js$/, `${file}: forbidden dependency ${dependency}`);
    }
    assert.doesNotMatch(source, /\b(?:Buffer|PrismaClient|RequestHandler|ReactNode)\b/, file);
  }
});

test('existing auth runtime routes remain compatible', () => {
  assert.equal(shared.API_ROUTES.auth.login, '/api/v1/auth/login');
  assert.equal(shared.API_ROUTES.auth.session(7), '/api/v1/auth/sessions/7');
  assert.equal(shared.API_ROUTES.users.me, '/api/v1/users/me');
});
