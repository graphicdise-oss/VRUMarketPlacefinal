import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { initialiseApp } from './bootstrap.js';
import { AppConfig } from './config/app-config.module.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');

  // If the environment is unusable, AppConfigModule's validation throws here — before the
  // server listens. That is intentional: a process that boots with a missing secret and
  // fails on the first request that needs it is harder to diagnose than one that never
  // starts and says which variable is missing.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  await initialiseApp(app);

  const config = app.get(AppConfig);

  // 0.0.0.0 rather than the default localhost: inside a container, localhost is only
  // reachable from within the container itself.
  await app.listen(config.port, '0.0.0.0');

  logger.log(`Listening on port ${config.port} in ${config.nodeEnv} mode`);
  if (!config.isProduction) {
    logger.log(`OpenAPI document at /api/v1/docs`);
  }
}

await bootstrap();
