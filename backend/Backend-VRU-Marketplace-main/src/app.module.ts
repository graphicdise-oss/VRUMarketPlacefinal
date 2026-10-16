import { Module } from '@nestjs/common';
import { AccessLogModule } from './access-log/access-log.module.js';
import { AccountErasureModule } from './account-erasure/account-erasure.module.js';
import { AddressModule } from './address/address.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AreaModule } from './area/area.module.js';
import { ArticleModule } from './article/article.module.js';
import { BannerModule } from './banner/banner.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CartModule } from './cart/cart.module.js';
import { CategoryModule } from './category/category.module.js';
import { ChatModule } from './chat/chat.module.js';
import { CommunityModule } from './community/community.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { DisputeModule } from './dispute/dispute.module.js';
import { EmailModule } from './email/email.module.js';
import { FilesModule } from './files/files.module.js';
import { HealthModule } from './health/health.module.js';
import { LegalModule } from './legal/legal.module.js';
import { NotificationModule } from './notification/notification.module.js';
import { OrderModule } from './order/order.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProductModule } from './product/product.module.js';
import { ReviewModule } from './review/review.module.js';
import { ShippingCarrierModule } from './shipping-carrier/shipping-carrier.module.js';
import { ShopModule } from './shop/shop.module.js';
import { TimeModule } from './time/time.module.js';
import { FavoriteModule } from './favorite/favorite.module.js';
import { CouponModule } from './coupon/coupon.module.js';

/**
 * Composition root. Feature modules are listed here and nowhere else.
 *
 * AppConfigModule comes first because its environment validation has to run before anything
 * that depends on configuration is constructed — PrismaService reads the connection string
 * from it.
 *
 * AuthModule registers the two global guards, so every controller listed after it is
 * authenticated by default and has to say `@Public()` to opt out.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    TimeModule,
    EmailModule,
    AuditModule,
    AccessLogModule,
    NotificationModule,
    FilesModule,
    AuthModule,
    ArticleModule,
    AdminModule,
    BannerModule,
    CommunityModule,
    DashboardModule,
    ShopModule,
    ProductModule,
    CategoryModule,
    ShippingCarrierModule,
    AreaModule,
    AddressModule,
    CartModule,
    OrderModule,
    ReviewModule,
    DisputeModule,
    ChatModule,
    AccountErasureModule,
    LegalModule,
    HealthModule,
    FavoriteModule,
    CouponModule,
  ],
})
export class AppModule {}
