import { Module } from '@nestjs/common';
import { AddressController } from './address.controller.js';
import { AddressService } from './address.service.js';

/**
 * `Address` (#47) — a buyer's own saved delivery addresses. `AddressService` is exported so #49's
 * `OrderService` can reuse `get()` for the exact snapshot invariant 5 needs at checkout, the same
 * "own resource" reuse `ShopModule` already does for `ShopService.findOwnShopRow`.
 */
@Module({
  controllers: [AddressController],
  providers: [AddressService],
  exports: [AddressService],
})
export class AddressModule {}

