import { Module } from '@nestjs/common';
import { CategoryController } from './category.controller.js';
import { CategoryService } from './category.service.js';

/**
 * `Category` (#40) — the platform's one flat set of product categories. No imports needed:
 * Prisma, the Clock and the audit writer are all global modules, and every guard used here
 * (`@RequiresSuperAdmin()`) is registered globally by `AuthModule`.
 */
@Module({
  controllers: [CategoryController],
  providers: [CategoryService],
})
export class CategoryModule {}
