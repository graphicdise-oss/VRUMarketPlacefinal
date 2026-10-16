import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppException } from '../common/errors/app-exception.js';
import { collectFieldErrors } from '../common/errors/validation-exception-factory.js';

/**
 * K3's `class-validator` boundary, for a chat event instead of an HTTP body.
 *
 * Not Nest's global `ValidationPipe` (`bootstrap.ts` registers it with `app.useGlobalPipes`,
 * which does reach gateway handlers): a pipe throws during Nest's own argument-resolution step,
 * before a handler's body — and therefore before `respond()`'s try/catch — ever runs, and
 * `@nestjs/platform-socket.io`'s ack machinery only calls the client's callback on the success
 * path (see `ws-respond.ts`). A validation failure routed through the pipe would be logged and
 * the caller's ack would simply never fire, which for a client awaiting one is indistinguishable
 * from a server that hung. Validating explicitly, inside the handler, keeps every failure —
 * validation included — on the one path that always acks.
 */
export async function validateWsBody<T extends object>(cls: new () => T, plain: unknown): Promise<T> {
  const instance = plainToInstance(cls, plain ?? {});
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });

  if (errors.length > 0) {
    throw new AppException('VALIDATION_FAILED', { fieldErrors: collectFieldErrors(errors) });
  }

  return instance;
}
