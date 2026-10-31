import { promisify } from 'node:util';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { closeKvStore, getKvStore } from './config/redis.js';
import { createApp } from './app.js';
import { logger } from './core/logger.js';
import { seed } from './prisma/seed.js';

async function main(): Promise<void> {
  await getKvStore().get('app:ready');
  await seed();
  const { app } = createApp();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Core listening'));
  let stopping = false;
  async function shutdown(reason: string, code = 0): Promise<void> {
    if (stopping) return;
    stopping = true;
    logger.info({ reason }, 'Shutting down');
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    try {
      await promisify(server.close.bind(server))();
      const results = await Promise.allSettled([prisma.close(), closeKvStore()]);
      for (const result of results) if (result.status === 'rejected') {
        logger.error({ err: result.reason }, 'Resource cleanup failed');
        code = 1;
      }
      process.exitCode = code;
    } catch (error) {
      logger.error({ err: error }, 'Shutdown failed');
      process.exitCode = 1;
    } finally { clearTimeout(deadline); }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => {
    logger.fatal({ err: error }, 'Unhandled rejection');
    void shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    void shutdown('uncaughtException', 1);
  });
  server.on('error', (error) => {
    logger.fatal({ err: error }, 'Server error');
    void shutdown('serverError', 1);
  });
}
void main().catch(async (error: unknown) => {
  logger.fatal({ err: error }, 'Core startup failed');
  await Promise.allSettled([prisma.close(), closeKvStore()]);
  process.exitCode = 1;
});
