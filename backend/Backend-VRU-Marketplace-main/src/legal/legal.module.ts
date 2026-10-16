import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller.js';

/**
 * No service: the two things this module serves are constants (#75 · §90).
 *
 * A service that returned `CURRENT_PRIVACY_POLICY_VERSION` would be a layer with nothing in it.
 * The moment anything here needs to read the database or decide something, it gets one.
 */
@Module({
  controllers: [LegalController],
})
export class LegalModule {}
