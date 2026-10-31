import Redis from 'ioredis';
import { timingSafeEqual } from 'node:crypto';
import { env } from './env.js';
import { logger } from '../core/logger.js';
import { serviceUnavailable } from '../core/errors.js';

export interface KvStore {
  get(key: string): Promise<string | null>;
  take(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  deleteIfValue(key: string, value: string): Promise<void>;
  del(key: string): Promise<number>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  decrement(key: string): Promise<void>;
  ttl(key: string): Promise<number>;
  /** 1 = accepted, 0 = expired/missing, negative = remaining attempts (+1). */
  verifyOtp(key: string, digest: string, maxAttempts: number): Promise<number>;
}
interface MemoryEntry { value: string; expiresAtMs: number }

/** Deterministic test double. Runtime always uses Redis. */
export class MemoryKvStore implements KvStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private entry(key: string): MemoryEntry | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAtMs > Date.now()) return entry;
    this.entries.delete(key);
    return undefined;
  }
  async get(key: string): Promise<string | null> { return this.entry(key)?.value ?? null; }
  async take(key: string): Promise<string | null> {
    const value = this.entry(key)?.value ?? null;
    this.entries.delete(key);
    return value;
  }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAtMs: Date.now() + ttlSeconds * 1000 });
  }
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.entry(key)) return false;
    this.entries.set(key, { value, expiresAtMs: Date.now() + ttlSeconds * 1000 });
    return true;
  }
  async deleteIfValue(key: string, value: string): Promise<void> {
    if (this.entry(key)?.value === value) this.entries.delete(key);
  }
  async del(key: string): Promise<number> { return this.entries.delete(key) ? 1 : 0; }
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.entry(key);
    const value = Number(entry?.value ?? 0) + 1;
    this.entries.set(key, { value: String(value), expiresAtMs: entry?.expiresAtMs ?? Date.now() + ttlSeconds * 1000 });
    return value;
  }
  async decrement(key: string): Promise<void> {
    const entry = this.entry(key);
    if (!entry) return;
    const value = Number(entry.value) - 1;
    if (value <= 0) this.entries.delete(key);
    else entry.value = String(value);
  }
  async ttl(key: string): Promise<number> {
    const entry = this.entry(key);
    return entry ? Math.ceil((entry.expiresAtMs - Date.now()) / 1000) : -2;
  }
  async verifyOtp(key: string, digest: string, maxAttempts: number): Promise<number> {
    // No awaits between read and write: concurrent callers cannot consume twice.
    const entry = this.entry(key);
    if (!entry) return 0;
    const record = JSON.parse(entry.value) as { digest: string; attempts: number };
    if (timingSafeEqual(Buffer.from(record.digest, 'hex'), Buffer.from(digest, 'hex'))) {
      this.entries.delete(key);
      return 1;
    }
    record.attempts += 1;
    if (record.attempts >= maxAttempts) this.entries.delete(key);
    else entry.value = JSON.stringify(record);
    return -(maxAttempts - record.attempts + 1);
  }
}

const VERIFY_OTP = `
local stored = redis.call('GET', KEYS[1])
if not stored then return 0 end
local record = cjson.decode(stored)
if record.digest == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
record.attempts = record.attempts + 1
local remaining = tonumber(ARGV[2]) - record.attempts
if remaining <= 0 then redis.call('DEL', KEYS[1])
else redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL') end
return -(remaining + 1)
`;
const INCREMENT = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return value
`;

export class RedisKvStore implements KvStore {
  constructor(private readonly client: Redis) {}
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      logger.error({ err: error }, 'Redis operation failed');
      throw serviceUnavailable('Redis is unavailable. Start it with docker compose up -d redis.');
    }
  }
  async get(key: string): Promise<string | null> { return this.run(() => this.client.get(key)); }
  async take(key: string): Promise<string | null> { return this.run(() => this.client.getdel(key)); }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.run(() => this.client.set(key, value, 'EX', ttlSeconds));
  }
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.run(() => this.client.set(key, value, 'EX', ttlSeconds, 'NX'))) === 'OK';
  }
  async deleteIfValue(key: string, value: string): Promise<void> {
    await this.run(() => this.client.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, key, value));
  }
  async del(key: string): Promise<number> { return this.run(() => this.client.del(key)); }
  async incr(key: string, ttlSeconds: number): Promise<number> {
    return Number(await this.run(() => this.client.eval(INCREMENT, 1, key, ttlSeconds)));
  }
  async decrement(key: string): Promise<void> {
    await this.run(() => this.client.eval("local value = redis.call('GET', KEYS[1]); if not value then return 0 end; if tonumber(value) <= 1 then return redis.call('DEL', KEYS[1]) end; return redis.call('DECR', KEYS[1])", 1, key));
  }
  async ttl(key: string): Promise<number> { return this.run(() => this.client.ttl(key)); }
  async verifyOtp(key: string, digest: string, maxAttempts: number): Promise<number> {
    return Number(await this.run(() => this.client.eval(VERIFY_OTP, 1, key, digest, maxAttempts)));
  }
}
let store: KvStore | undefined;
let client: Redis | undefined;
export function getKvStore(): KvStore {
  if (!store) {
    client = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1,
      connectTimeout: 3000, retryStrategy: () => null });
    client.on('error', (error) => logger.error({ err: error }, 'Redis connection error'));
    store = new RedisKvStore(client);
  }
  return store;
}
export async function closeKvStore(): Promise<void> {
  const connection = client;
  store = undefined;
  client = undefined;
  if (connection?.status === 'ready') await connection.quit();
  else connection?.disconnect();
}
