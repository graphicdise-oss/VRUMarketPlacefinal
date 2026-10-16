import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrderFreezeModule } from '../order/order-freeze.module.js';
import { PaymentChannelController } from './controllers/payment-channel.controller.js';
import { ShopAnalyticsController } from './controllers/shop-analytics.controller.js';
import { ShopController } from './controllers/shop.controller.js';
import { PaymentChannelService } from './services/payment-channel.service.js';
import { ShopAdminService } from './services/shop-admin.service.js';
import { ShopAnalyticsService } from './services/shop-analytics.service.js';
import { ShopService } from './services/shop.service.js';
import { ShopIdScopeResolver } from './shop-id.scope-resolver.js';

@Module({
  imports: [OrderFreezeModule, AuthModule],
  controllers: [ShopController, PaymentChannelController, ShopAnalyticsController],
  providers: [ShopService, ShopAdminService, ShopIdScopeResolver, PaymentChannelService, ShopAnalyticsService],
  exports: [ShopService, ShopAdminService, PaymentChannelService, ShopAnalyticsService],
})
export class ShopModule {}
