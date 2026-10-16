import { Module } from '@nestjs/common';
import { ShippingCarrierController } from './shipping-carrier.controller.js';
import { ShippingCarrierService } from './shipping-carrier.service.js';

/**
 * `ShippingCarrier` (#58) — the platform's set of couriers. No imports needed, same reasoning
 * `CategoryModule` gives: Prisma, the Clock and the audit writer are global, and
 * `@RequiresSuperAdmin()` is registered globally by `AuthModule`.
 */
@Module({
  controllers: [ShippingCarrierController],
  providers: [ShippingCarrierService],
})
export class ShippingCarrierModule {}
