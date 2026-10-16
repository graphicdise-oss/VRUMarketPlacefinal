import { Module } from '@nestjs/common';
import { FavoriteController } from './favorite.controller.js';
import { FavoriteService } from './favorite.service.js';

@Module({
  controllers: [FavoriteController],
  providers: [FavoriteService],
})
export class FavoriteModule {}
